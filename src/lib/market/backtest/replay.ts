/**
 * Candle-by-candle backtest replay.
 *
 * The look-ahead guarantee comes from reusing the exact live evaluation path,
 * not from bespoke backtest logic: at each step the full multi-timeframe
 * history is sliced to candles whose open time is at or before the bar that
 * has just closed, and `evaluateSignal` is called with that slice and a `now`
 * set to the instant the bar closed. `readTimeframe` already refuses to read
 * a candle that has not closed as of `now` — the same rule that keeps a live
 * signal from confirming off an open candle keeps a backtest from confirming
 * off a bar the strategy could not yet have seen. There is no second
 * "backtest-only" notion of look-ahead prevention to keep in sync with the
 * live one.
 */

import { aggregate } from "../data/aggregate";
import { evaluateSignal } from "../engine/evaluate";
import { DEFAULT_CLOCK_CONFIG } from "../domain/clock";
import { ALL_TIMEFRAMES, timeframeDef, type Timeframe } from "../config/timeframes";
import type { Candle, Quote } from "../types";
import type {
  BacktestConfig,
  BacktestRun,
  BacktestTrade,
  SameCandleRule,
  TradeExitReason,
} from "./types";

interface PendingSignal {
  readonly direction: "BUY" | "SELL";
  readonly generatedAtIndex: number;
  readonly generatedAt: number;
  readonly label: string;
  readonly entryZone: readonly [number, number];
  readonly stopLoss: number;
  readonly takeProfits: readonly [number, number, number];
  readonly session: string;
  readonly higherTimeframeBias: string;
  readonly broadContextRelation: string;
}

export interface OpenPosition extends PendingSignal {
  readonly entryAt: number;
  readonly entryPrice: number;
}

export interface ExitResolution {
  readonly at: number;
  /** Null only for SAME_CANDLE_EXCLUDED, where the trade is dropped rather than priced. */
  readonly price: number | null;
  readonly reason: TradeExitReason;
}

/**
 * Decides how one bar resolves an open position: pure and independently
 * tested, since the same-candle ambiguity rule is the single most
 * consequential assumption a backtest makes — a backtest that resolves it
 * optimistically will flatter every result built on top of it.
 */
export function resolveExit(
  bar: Candle,
  position: OpenPosition,
  sameCandleRule: SameCandleRule,
): ExitResolution | null {
  const isBuy = position.direction === "BUY";
  const stopHit = isBuy ? bar.l <= position.stopLoss : bar.h >= position.stopLoss;
  const tpHitIndex = position.takeProfits.findIndex((tp) => (isBuy ? bar.h >= tp : bar.l <= tp));
  const tpHit = tpHitIndex >= 0;

  if (!stopHit && !tpHit) return null;

  if (stopHit && tpHit) {
    switch (sameCandleRule) {
      case "EXCLUDE":
        return { at: bar.t, price: null, reason: "SAME_CANDLE_EXCLUDED" };
      case "STOP_FIRST":
        return { at: bar.t, price: position.stopLoss, reason: "STOP" };
      case "TARGET_FIRST":
        return {
          at: bar.t,
          price: position.takeProfits[tpHitIndex]!,
          reason: tpExitReason(tpHitIndex),
        };
    }
  }

  if (stopHit) return { at: bar.t, price: position.stopLoss, reason: "STOP" };
  return { at: bar.t, price: position.takeProfits[tpHitIndex]!, reason: tpExitReason(tpHitIndex) };
}

/** Precomputes every configured timeframe's full history from one base series, once. */
function buildFullHistory(
  baseTimeframe: Timeframe,
  baseCandles: readonly Candle[],
): Partial<Record<Timeframe, Candle[]>> {
  const history: Partial<Record<Timeframe, Candle[]>> = { [baseTimeframe]: [...baseCandles] };
  for (const tf of ALL_TIMEFRAMES) {
    if (tf === baseTimeframe) continue;
    if (timeframeDef(tf).minutes < timeframeDef(baseTimeframe).minutes) continue; // cannot derive a finer series from a coarser one
    history[tf] = aggregate(baseCandles, tf, DEFAULT_CLOCK_CONFIG);
  }
  return history;
}

/** Every timeframe's history trimmed to candles that have opened at or before `asOfT`. */
function sliceHistory(
  full: Partial<Record<Timeframe, Candle[]>>,
  asOfT: number,
): Partial<Record<Timeframe, Candle[]>> {
  const sliced: Partial<Record<Timeframe, Candle[]>> = {};
  for (const [tf, candles] of Object.entries(full) as [Timeframe, Candle[]][]) {
    const cut = candles.filter((c) => c.t <= asOfT);
    if (cut.length > 0) sliced[tf] = cut;
  }
  return sliced;
}

function quoteFrom(symbol: string, closedBar: Candle): Quote {
  return {
    symbol,
    bid: closedBar.c,
    ask: closedBar.c,
    mid: closedBar.c,
    spread: 0,
    timestamp: closedBar.t,
    provider: "Backtest replay",
    kind: "delayed",
    quality: 100,
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/**
 * Runs one full replay and returns every completed and unfilled trade.
 *
 * Single position at a time, matching the default `maxOpenTrades: 1` risk
 * setting — a second candidate signal while one is open or pending is simply
 * not actioned, the same as a trader who does not stack positions.
 */
export function runBacktest(config: BacktestConfig): BacktestRun {
  const { symbol, baseTimeframe, baseCandles, costs, sameCandleRule, maxBarsToFill } = config;
  const fullHistory = buildFullHistory(baseTimeframe, baseCandles);

  const trades: BacktestTrade[] = [];
  let pending: PendingSignal | null = null;
  let open: OpenPosition | null = null;
  let candidateCount = 0;

  for (let i = 0; i < baseCandles.length; i++) {
    const bar = baseCandles[i]!;
    const nextBarT = baseCandles[i + 1]?.t ?? bar.t + timeframeDef(baseTimeframe).minutes * 60_000;

    // ── 1. resolve fills and exits using this bar's now-known range ─────────
    if (open) {
      const resolved = resolveExit(bar, open, sameCandleRule);
      if (resolved) {
        trades.push(
          finishTrade(
            open,
            resolved.at,
            resolved.price,
            resolved.reason,
            costs,
            open.direction === "BUY",
          ),
        );
        open = null;
      }
    } else if (pending) {
      const isBuy = pending.direction === "BUY";
      const [zoneLow, zoneHigh] = pending.entryZone;
      const zoneReached = bar.h >= zoneLow && bar.l <= zoneHigh;
      const barsWaited = i - pending.generatedAtIndex;

      if (zoneReached) {
        const fillPrice = clamp(bar.o, zoneLow, zoneHigh);
        open = { ...pending, entryAt: bar.t, entryPrice: fillPrice };
        pending = null;
      } else if (barsWaited >= maxBarsToFill) {
        trades.push({
          direction: pending.direction,
          signalGeneratedAt: pending.generatedAt,
          signalLabel: pending.label,
          entryAt: null,
          entryPrice: null,
          stopLoss: pending.stopLoss,
          takeProfits: pending.takeProfits,
          exitAt: null,
          exitPrice: null,
          exitReason: "EXPIRED_UNFILLED",
          pnl: null,
          rMultiple: null,
          session: pending.session,
          higherTimeframeBias: pending.higherTimeframeBias,
          broadContextRelation: pending.broadContextRelation,
        });
        pending = null;
      }
    }

    // ── 2. generate a new signal from data through this now-closed bar ──────
    if (!open && !pending) {
      const slicedSeries = sliceHistory(fullHistory, bar.t);
      const signal = evaluateSignal({
        symbol,
        quote: quoteFrom(symbol, bar),
        series: slicedSeries,
        syntheticTimeframes: new Set(),
        provider: "Backtest replay",
        config: config.strategy,
        strategyVersion: config.strategyVersion,
        risk: config.risk,
        clock: DEFAULT_CLOCK_CONFIG,
        now: nextBarT,
      });

      if (
        signal.readiness === "READY" &&
        signal.direction &&
        signal.entryZone &&
        signal.stopLoss !== null &&
        signal.takeProfit1 !== null &&
        signal.takeProfit2 !== null &&
        signal.takeProfit3 !== null
      ) {
        candidateCount += 1;
        pending = {
          direction: signal.direction,
          generatedAtIndex: i,
          generatedAt: bar.t,
          label: signal.label,
          entryZone: signal.entryZone,
          stopLoss: signal.stopLoss,
          takeProfits: [signal.takeProfit1, signal.takeProfit2, signal.takeProfit3],
          session: signal.session,
          higherTimeframeBias: signal.higherTimeframeBias,
          broadContextRelation: signal.broadContextRelation,
        };
      }
    }
  }

  // ── end of data: close out whatever is left, rather than dropping it ──────
  const lastBar = baseCandles[baseCandles.length - 1];
  if (open && lastBar) {
    trades.push(
      finishTrade(open, lastBar.t, lastBar.c, "END_OF_DATA", costs, open.direction === "BUY"),
    );
  } else if (pending) {
    trades.push({
      direction: pending.direction,
      signalGeneratedAt: pending.generatedAt,
      signalLabel: pending.label,
      entryAt: null,
      entryPrice: null,
      stopLoss: pending.stopLoss,
      takeProfits: pending.takeProfits,
      exitAt: null,
      exitPrice: null,
      exitReason: "EXPIRED_UNFILLED",
      pnl: null,
      rMultiple: null,
      session: pending.session,
      higherTimeframeBias: pending.higherTimeframeBias,
      broadContextRelation: pending.broadContextRelation,
    });
  }

  return {
    symbol,
    strategyVersion: config.strategyVersion,
    fromT: baseCandles[0]?.t ?? 0,
    toT: baseCandles[baseCandles.length - 1]?.t ?? 0,
    trades,
    candidateCount,
  };
}

function tpExitReason(index: number): TradeExitReason {
  return index === 0 ? "TAKE_PROFIT_1" : index === 1 ? "TAKE_PROFIT_2" : "TAKE_PROFIT_3";
}

function finishTrade(
  position: OpenPosition,
  exitAt: number | null,
  rawExitPrice: number | null,
  reason: TradeExitReason,
  costs: BacktestConfig["costs"],
  isBuy: boolean,
): BacktestTrade {
  const riskPerUnit = Math.abs(position.entryPrice - position.stopLoss);
  const costPerSide = costs.spread + costs.slippage + costs.commissionPriceUnitsPerSide;

  let pnl: number | null = null;
  let rMultiple: number | null = null;
  let exitPrice: number | null = null;

  if (rawExitPrice !== null) {
    // Spread and slippage cross against the position on both sides, per
    // docs/backtesting.md: a worse fill on entry, a worse fill on exit,
    // regardless of direction.
    const adjustedEntry = isBuy
      ? position.entryPrice + costPerSide
      : position.entryPrice - costPerSide;
    exitPrice = isBuy ? rawExitPrice - costPerSide : rawExitPrice + costPerSide;
    pnl = isBuy ? exitPrice - adjustedEntry : adjustedEntry - exitPrice;
    rMultiple = riskPerUnit > 0 ? Number((pnl / riskPerUnit).toFixed(4)) : null;
  }

  return {
    direction: position.direction,
    signalGeneratedAt: position.generatedAt,
    signalLabel: position.label,
    entryAt: position.entryAt,
    entryPrice: position.entryPrice,
    stopLoss: position.stopLoss,
    takeProfits: position.takeProfits,
    exitAt,
    exitPrice,
    exitReason: reason,
    pnl,
    rMultiple,
    session: position.session,
    higherTimeframeBias: position.higherTimeframeBias,
    broadContextRelation: position.broadContextRelation,
  };
}
