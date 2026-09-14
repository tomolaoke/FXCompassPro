/**
 * Determines whether a paper-traded (accepted, recorded) signal has since hit
 * its stop or a target, from real subsequent price action rather than a
 * user's manual guess.
 *
 * Reuses `resolveExit` from the backtester unchanged: "did this position's
 * stop or target get touched by this bar's range" is exactly the same
 * question forward-testing asks that backtesting does. Two separate
 * implementations of that question would be two places for the same-candle
 * ambiguity rule to quietly drift out of sync.
 */

import { resolveExit, type OpenPosition } from "../backtest/replay";
import type { SameCandleRule } from "../backtest/types";
import type { Candle } from "../types";

export type PaperOutcome = "WIN" | "LOSS" | "BREAKEVEN" | "PENDING";

export interface PaperTradeLevels {
  readonly direction: "BUY" | "SELL";
  readonly entryPrice: number;
  readonly stopLoss: number;
  readonly takeProfits: readonly [number, number, number];
}

export interface PaperOutcomeResult {
  readonly outcome: PaperOutcome;
  readonly exitPrice: number | null;
  readonly exitAt: number | null;
  readonly rMultiple: number | null;
}

const STILL_PENDING: PaperOutcomeResult = {
  outcome: "PENDING",
  exitPrice: null,
  exitAt: null,
  rMultiple: null,
};

/**
 * Walks candles that occurred after the recorded entry, checking each one
 * against the stored stop and targets. Only candles strictly after
 * `entryAt` are considered — the entry itself is a given, not something this
 * function re-derives.
 */
export function determinePaperOutcome(
  levels: PaperTradeLevels,
  entryAt: number,
  candlesSinceEntry: readonly Candle[],
  sameCandleRule: SameCandleRule = "STOP_FIRST",
): PaperOutcomeResult {
  const position: OpenPosition = {
    direction: levels.direction,
    generatedAtIndex: 0,
    generatedAt: entryAt,
    entryAt,
    entryPrice: levels.entryPrice,
    label: "",
    entryZone: [levels.entryPrice, levels.entryPrice],
    stopLoss: levels.stopLoss,
    takeProfits: levels.takeProfits,
    session: "",
    higherTimeframeBias: "",
    broadContextRelation: "",
  };

  const relevant = candlesSinceEntry.filter((c) => c.t > entryAt);
  for (const bar of relevant) {
    const resolved = resolveExit(bar, position, sameCandleRule);
    if (!resolved) continue;
    if (resolved.reason === "SAME_CANDLE_EXCLUDED" || resolved.price === null) {
      // The same-candle ambiguity is unresolvable from this bar alone;
      // treated as still pending rather than guessed at, consistent with the
      // EXCLUDE option's meaning in the backtester.
      continue;
    }

    const isBuy = levels.direction === "BUY";
    const riskPerUnit = Math.abs(levels.entryPrice - levels.stopLoss);
    const pnl = isBuy ? resolved.price - levels.entryPrice : levels.entryPrice - resolved.price;
    const rMultiple = riskPerUnit > 0 ? Number((pnl / riskPerUnit).toFixed(4)) : null;

    return {
      outcome: pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : "BREAKEVEN",
      exitPrice: resolved.price,
      exitAt: resolved.at,
      rMultiple,
    };
  }

  return STILL_PENDING;
}
