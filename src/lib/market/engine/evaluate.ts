/**
 * The orchestrator: turns raw candles for all configured timeframes into one
 * EngineSignal.
 *
 * The core discipline, everywhere below: short-term direction and
 * higher-timeframe bias are two separate computations that are never merged
 * into one vote. M5 and M1 never appear in a direction vote. NOT_CONFIGURED is
 * never produced here — only the strategy-config reader may produce it.
 */

import { atr, swings } from "../indicators";
import { specFor, toPips } from "../instruments";
import {
  compareBrokerPrice,
  PRICE_MISMATCH_MESSAGE,
  type BrokerComparison,
} from "../broker/compare";
import {
  displacementCandles,
  fairValueGaps,
  keyLevels,
  liquiditySweep,
  orderBlocks,
  structureShift,
} from "../structure";
import { sessionAt, type ClockConfig, DEFAULT_CLOCK_CONFIG } from "../domain/clock";
import {
  allowsCountertrend,
  broadContextTimeframes,
  categoryCap,
  configuredTimeframes,
  directionalTimeframes,
  issuesPermission,
  maxScore,
  primaryContextTimeframes,
  roleOf,
  type StrategyConfig,
} from "../config/strategy";
import { groupByBaseSeries, type BaseSeries, type Timeframe } from "../config/timeframes";
import {
  isDataProblem,
  isDirectional,
  isTradeSignalEvent,
  notFullyAlignedReason as reasonNotFullyAligned,
  signalLabel,
  type BlockReason,
  type BroadContextRelation,
  type GroupDirection,
  type HeuristicScore,
  type Readiness,
  type ScoreCategory,
  type StateRelation,
  type TimeframeState,
} from "../domain/states";
import { readTimeframe } from "./timeframe-reading";
import type { EngineSignal, TimeframeReading } from "./types";
import type { Candle, Quote, RiskSettings } from "../types";

export interface EvaluateInput {
  readonly symbol: string;
  readonly quote: Quote;
  readonly series: Partial<Record<Timeframe, Candle[]>>;
  readonly syntheticTimeframes: ReadonlySet<Timeframe>;
  readonly provider: string;
  readonly config: StrategyConfig;
  readonly strategyVersion: string;
  readonly risk: RiskSettings;
  readonly newsRisk?: string | null;
  /** A manually entered broker price, when one has been recorded for this symbol. */
  readonly brokerQuote?: { bid: number; ask: number; enteredAt: number } | null;
  readonly clock?: ClockConfig;
  readonly now?: number;
}

function directionFromState(state: TimeframeState): "BULLISH" | "BEARISH" | null {
  return state === "BULLISH" ? "BULLISH" : state === "BEARISH" ? "BEARISH" : null;
}

/**
 * Majority vote among a set of readings' states.
 *
 * Deliberately conservative: a majority is required, not a plurality, so a
 * near-even split resolves to NEUTRAL rather than to whichever side happened to
 * have one more vote.
 */
function voteDirection(states: readonly TimeframeState[], minRequired: number): GroupDirection {
  const usable = states.filter((s) => s === "BULLISH" || s === "BEARISH" || s === "NEUTRAL");
  if (usable.length < minRequired) return "INSUFFICIENT_DATA";
  const bulls = states.filter((s) => s === "BULLISH").length;
  const bears = states.filter((s) => s === "BEARISH").length;
  const needed = Math.max(1, Math.ceil(usable.length / 2));
  if (bulls >= needed && bulls > bears) return "BULLISH";
  if (bears >= needed && bears > bulls) return "BEARISH";
  if (bulls === 0 && bears === 0) return "NEUTRAL";
  return "INCONCLUSIVE";
}

function relationOf(state: TimeframeState, direction: "BUY" | "SELL" | null): StateRelation {
  if (direction === null) return "NOT_APPLICABLE";
  const d = directionFromState(state);
  if (d === null) return "NOT_APPLICABLE";
  const agrees =
    (d === "BULLISH" && direction === "BUY") || (d === "BEARISH" && direction === "SELL");
  return agrees ? "AGREEING" : "CONFLICTING";
}

/** Aggregates a group of readings' relations into one summary relation. */
function aggregateRelation(readings: readonly TimeframeReading[]): BroadContextRelation {
  if (readings.length === 0) return "UNAVAILABLE";
  const conflicting = readings.filter((r) => r.relation === "CONFLICTING").length;
  const agreeing = readings.filter((r) => r.relation === "AGREEING").length;
  const dataProblem = readings.filter((r) => isDataProblem(r.state)).length;
  // Any conflict is surfaced immediately — MN/W1 disagreement must be
  // prominently visible, not averaged away by an agreeing sibling.
  if (conflicting > 0) return "CONFLICTING";
  if (agreeing > 0 && agreeing === readings.length) return "ALIGNED";
  if (dataProblem > 0 && agreeing === 0) return "UNAVAILABLE";
  return "NEUTRAL";
}

export function evaluateSignal(input: EvaluateInput): EngineSignal {
  const now = input.now ?? Date.now();
  const clock = input.clock ?? DEFAULT_CLOCK_CONFIG;
  const { config } = input;
  const spec = specFor(input.symbol);
  const price = input.quote.mid;

  const reasons: string[] = [];
  const warnings: string[] = [];
  const blockReasons: BlockReason[] = [];
  const calculationErrors: string[] = [];

  // ── pass 1: read every configured timeframe, direction-agnostic ──────────
  const configured = configuredTimeframes(config);
  const rawReadings = new Map<
    Timeframe,
    { state: TimeframeState; result: ReturnType<typeof readTimeframe> }
  >();
  for (const tf of configured) {
    const result = readTimeframe(
      tf,
      input.series[tf],
      config,
      now,
      clock,
      input.syntheticTimeframes.has(tf),
    );
    rawReadings.set(tf, { state: result.state, result });
  }

  // ── direction: short-term vs higher-timeframe, computed separately ───────
  const operationalTfs = config.roles.OPERATIONAL;
  const shortTermStates = operationalTfs.map((tf) => rawReadings.get(tf)!.state);
  const shortTermDirection = voteDirection(
    shortTermStates,
    config.dataQuality.minShortTermTimeframes,
  );

  const higherTfs = [...config.roles.BROAD_CONTEXT, ...config.roles.PRIMARY_CONTEXT];
  const higherStates = higherTfs.map((tf) => rawReadings.get(tf)!.state);
  const higherTimeframeBias = voteDirection(higherStates, config.dataQuality.minHigherTimeframes);

  const finalDirection: "BUY" | "SELL" | null =
    shortTermDirection === "BULLISH" ? "BUY" : shortTermDirection === "BEARISH" ? "SELL" : null;

  // ── pass 2: relation, now that direction is known ─────────────────────────
  const timeframes: TimeframeReading[] = configured.map((tf) => {
    const { state, result } = rawReadings.get(tf)!;
    const role = roleOf(tf, config)!;
    return {
      timeframe: tf,
      role,
      state,
      relation: relationOf(state, finalDirection),
      stochastic: result.stochastic,
      dataAgeMs: result.dataAgeMs,
      candleClosed: result.candleClosed,
      candleOpenTime: result.candleOpenTime,
      isSynthetic: input.syntheticTimeframes.has(tf),
      provider: input.syntheticTimeframes.has(tf) ? "Sample dataset (synthetic)" : input.provider,
      includedInStrategy: true,
      explanation: result.explanation,
    };
  });
  const readingOf = (tf: Timeframe) => timeframes.find((r) => r.timeframe === tf)!;

  // ── broad / primary context relation ──────────────────────────────────────
  const broadReadings = broadContextTimeframes(config).map(readingOf);
  const primaryReadings = primaryContextTimeframes(config).map(readingOf);
  const broadContextRelation = aggregateRelation(broadReadings);
  const primaryContextRelation = aggregateRelation(primaryReadings);

  if (broadContextRelation === "CONFLICTING") {
    warnings.push(
      `Higher context disagrees: ${broadReadings
        .filter((r) => r.relation === "CONFLICTING")
        .map((r) => `${r.timeframe} (${r.state.toLowerCase()})`)
        .join(", ")}.`,
    );
  }
  if (broadContextRelation === "UNAVAILABLE") {
    warnings.push("Monthly and/or weekly context is unavailable — broad picture unverified.");
  }

  // ── the countertrend hard block ────────────────────────────────────────────
  const opposingBroadCount = broadReadings.filter((r) => r.relation === "CONFLICTING").length;
  const opposingPrimaryCount = primaryReadings.filter((r) => r.relation === "CONFLICTING").length;
  let countertrendBlocked = false;
  let countertrendBlockReason: string | null = null;

  if (
    config.countertrendBlock.enabled &&
    finalDirection !== null &&
    opposingBroadCount >= config.countertrendBlock.minOpposingBroadContext &&
    opposingPrimaryCount >= config.countertrendBlock.minOpposingPrimaryContext
  ) {
    const reversalConfirmed =
      config.countertrendBlock.reversalExceptionEnabled &&
      config.countertrendBlock.reversalExceptionTimeframes.some((tf) => {
        const event = readingOf(tf).stochastic?.event;
        if (!event || !isTradeSignalEvent(event)) return false;
        const wants = finalDirection === "BUY" ? "CONFIRMED_BULLISH" : "CONFIRMED_BEARISH";
        return event === wants;
      });

    if (!reversalConfirmed) {
      countertrendBlocked = true;
      countertrendBlockReason =
        "Monthly/weekly and D1/H4 all oppose this direction with no confirmed reversal structure — " +
        "blocked to avoid catching a falling knife. A documented reversal exception would lift this.";
      blockReasons.push("HTF_CONFLICT");
      warnings.push(countertrendBlockReason);
    } else {
      reasons.push(
        `Countertrend hard block lifted: a confirmed reversal structure is present on ${config.countertrendBlock.reversalExceptionTimeframes.join("/")}.`,
      );
    }
  }

  // A closed market (weekend, broker server time) has no live price action to
  // confirm entry or execution against — holding at WATCH rather than issuing
  // a trade-ready signal that could not actually be filled right now.
  const session = sessionAt(now, clock);
  const marketClosed = session === "CLOSED";

  // ── readiness ladder ───────────────────────────────────────────────────────
  let readiness: Readiness = "NONE";
  let terminal: "INSUFFICIENT_DATA" | "DATA_QUALITY_ERROR" | "INVALID" | undefined;

  if (shortTermDirection === "INSUFFICIENT_DATA" || higherTimeframeBias === "INSUFFICIENT_DATA") {
    terminal = "INSUFFICIENT_DATA";
    warnings.push("Not enough valid timeframes to judge direction with confidence.");
  } else if (finalDirection !== null) {
    readiness = "WATCH";

    const primaryConflictBlocksProgress =
      primaryContextRelation === "CONFLICTING" && !allowsCountertrend(config.permissionMode);
    if (primaryConflictBlocksProgress) {
      blockReasons.push("HTF_CONFLICT");
      warnings.push("D1/H4 disagree with the short-term direction — held at WATCH.");
    }

    const strictBlocksProgress =
      config.permissionMode === "STRICT" &&
      (broadContextRelation === "CONFLICTING" || timeframes.some((r) => isDataProblem(r.state)));
    if (strictBlocksProgress) {
      blockReasons.push("NOT_FULLY_ALIGNED");
    }

    if (marketClosed) {
      blockReasons.push("MARKET_CLOSED");
      warnings.push(
        "Market is closed (weekend, broker server time) — held at WATCH; no new trade-ready signal until it reopens.",
      );
    }

    if (
      !primaryConflictBlocksProgress &&
      !strictBlocksProgress &&
      !countertrendBlocked &&
      !marketClosed
    ) {
      // ── SETUP: location + structure must confirm ────────────────────────
      const execTf = pickExecutionTimeframe(config, input.series);
      const exec = execTf ? (input.series[execTf] ?? []) : [];
      const levels = exec.length
        ? computeLevels(exec, config, price, finalDirection, input.symbol)
        : null;

      const locationOk = !config.location.requireLocation || levels?.nearLevel;
      const structureOk = !config.structure.requireStructure || levels?.structureConfirmed;
      if (!locationOk) blockReasons.push("NO_LOCATION_EDGE");
      if (!structureOk) blockReasons.push("NO_STRUCTURE_CONFIRMATION");

      if (locationOk && structureOk) {
        readiness = "SETUP";
        if (levels) {
          reasons.push(...levels.reasons);
        }

        // ── READY: entry confirmation + execution trigger, on closed candles ─
        const entryTf = config.roles.ENTRY_CONFIRMATION[0];
        const triggerTf = config.roles.EXECUTION_TRIGGER[0];
        const entryReading = entryTf ? readingOf(entryTf) : null;
        const triggerReading = triggerTf ? readingOf(triggerTf) : null;

        const entryConfirms = entryReading?.relation === "AGREEING";
        const triggerFires =
          triggerReading !== null &&
          triggerReading.stochastic !== null &&
          triggerReading.stochastic.event !== "NEUTRAL" &&
          triggerReading.stochastic.event !== "INCONCLUSIVE" &&
          (directionFromState(triggerReading.state) !== null
            ? triggerReading.relation === "AGREEING"
            : true);

        if (!entryReading || !entryConfirms) {
          warnings.push(
            entryTf
              ? `${entryTf} has not confirmed the direction yet — no entry confirmation.`
              : "No entry-confirmation timeframe configured.",
          );
        }
        if (!triggerReading || !triggerFires) {
          warnings.push(
            triggerTf
              ? `${triggerTf} has not triggered yet.`
              : "No execution-trigger timeframe configured.",
          );
        }

        const closedCandlesOk =
          (!entryReading || entryReading.candleClosed !== false) &&
          (!triggerReading || triggerReading.candleClosed !== false);

        const noSyntheticInPath = ![...operationalTfs, entryTf, triggerTf]
          .filter((tf): tf is Timeframe => Boolean(tf))
          .some((tf) => readingOf(tf).isSynthetic);

        if (
          entryReading &&
          entryConfirms &&
          triggerReading &&
          triggerFires &&
          closedCandlesOk &&
          noSyntheticInPath &&
          levels?.valid &&
          issuesPermission(config.permissionMode)
        ) {
          readiness = "READY";
        } else if (!noSyntheticInPath) {
          blockReasons.push("SYNTHETIC_DATA");
          warnings.push("Sample data is present in the entry/trigger path — cannot reach READY.");
        } else if (!issuesPermission(config.permissionMode)) {
          blockReasons.push("MANUAL_MODE");
        } else if (levels && !levels.valid) {
          calculationErrors.push(...levels.errors);
        }
      }
    }
  }

  if (calculationErrors.length > 0) terminal = "INVALID";

  // ── score ──────────────────────────────────────────────────────────────────
  const score = computeScore(config, {
    shortTermStates,
    higherStates,
    timeframes,
    broadContextRelation,
    primaryContextRelation,
    finalDirection,
  });

  // ── levels for display (recomputed once, at whatever readiness reached) ───
  const execTf = pickExecutionTimeframe(config, input.series);
  const exec = execTf ? (input.series[execTf] ?? []) : [];
  const levels =
    readiness === "SETUP" || readiness === "READY"
      ? computeLevels(exec, config, price, finalDirection ?? "BUY", input.symbol)
      : null;
  const showLevels = readiness === "READY" && levels?.valid;

  // ── label ──────────────────────────────────────────────────────────────────
  const label = signalLabel({
    direction: finalDirection,
    readiness,
    broadContext: broadContextRelation,
    ...(terminal !== undefined ? { terminal } : {}),
  });
  const notFullyAlignedReason =
    readiness === "READY" && broadContextRelation !== "ALIGNED"
      ? reasonNotFullyAligned(broadContextRelation)
      : null;

  const spreadPips = input.quote.spread !== null ? toPips(input.quote.spread, input.symbol) : null;
  if (spreadPips !== null && spreadPips > input.risk.maxSpreadPips) {
    warnings.push(
      `Spread ${spreadPips.toFixed(1)} pips is above your ${input.risk.maxSpreadPips} pip limit.`,
    );
    blockReasons.push("SPREAD_TOO_WIDE");
  }
  if (input.newsRisk) {
    warnings.push(`Event risk noted: ${input.newsRisk}.`);
    blockReasons.push("NEWS_WINDOW");
  }

  let brokerComparison: BrokerComparison | null = null;
  if (input.brokerQuote) {
    brokerComparison = compareBrokerPrice(
      input.quote.mid,
      input.brokerQuote,
      spec.pipSize,
      config.dataQuality.maxBrokerDivergencePips,
      now,
    );
    if (brokerComparison.toleranceExceeded) {
      warnings.push(
        `${PRICE_MISMATCH_MESSAGE} — provider ${input.quote.mid.toFixed(spec.digits)} vs broker ` +
          `${brokerComparison.brokerMid.toFixed(spec.digits)} (${brokerComparison.differencePips.toFixed(1)} pips).`,
      );
      blockReasons.push("BROKER_PRICE_MISMATCH");
    }
  }

  return {
    symbol: input.symbol,
    strategyVersion: input.strategyVersion,
    label,
    direction: finalDirection,
    readiness,
    shortTermDirection,
    higherTimeframeBias,
    broadContextRelation,
    primaryContextRelation,
    notFullyAlignedReason,
    countertrendBlocked,
    countertrendBlockReason,
    timeframes,
    score,
    reasons: reasons.length ? reasons : ["No confirmation majority in either direction yet."],
    warnings,
    blockReasons,
    calculationErrors,
    entryZone: showLevels ? levels!.entryZone : null,
    entryPrice: showLevels ? levels!.entryPrice : null,
    stopLoss: showLevels ? levels!.stopLoss : null,
    invalidationLevel: showLevels ? levels!.invalidation : null,
    takeProfit1: showLevels ? levels!.tps[0]! : null,
    takeProfit2: showLevels ? levels!.tps[1]! : null,
    takeProfit3: showLevels ? levels!.tps[2]! : null,
    riskRewardRatios: showLevels ? levels!.ratios : { tp1: null, tp2: null, tp3: null },
    triggerCondition: levels?.trigger ?? "Waiting for the higher-timeframe stack to line up.",
    invalidationCondition:
      levels?.invalidationCondition ?? "No setup yet, so nothing to invalidate.",
    session,
    newsRisk: input.newsRisk ?? null,
    brokerComparison,
    dataTimestamp: input.quote.timestamp,
    dataSource: input.quote.provider,
    dataKind: input.quote.kind,
    generatedAt: now,
    expiresAt: now + 1000 * 60 * 90,
  };
}

/** The fastest configured OPERATIONAL/ENTRY_CONFIRMATION timeframe with data. */
function pickExecutionTimeframe(
  config: StrategyConfig,
  series: Partial<Record<Timeframe, Candle[]>>,
): Timeframe | null {
  const candidates = [...config.roles.OPERATIONAL]
    .reverse()
    .concat(config.roles.ENTRY_CONFIRMATION);
  return candidates.find((tf) => (series[tf]?.length ?? 0) > 0) ?? null;
}

interface LevelResult {
  nearLevel: boolean;
  structureConfirmed: boolean;
  valid: boolean;
  errors: string[];
  reasons: string[];
  entryZone: [number, number];
  entryPrice: number;
  stopLoss: number;
  invalidation: number;
  tps: [number, number, number];
  ratios: { tp1: number | null; tp2: number | null; tp3: number | null };
  trigger: string;
  invalidationCondition: string;
}

/**
 * Entry, stop, target and validity for the proposed direction on the execution
 * series. Adapted from the previous single-pass engine's level logic; the
 * numeric method is unchanged; only the gating around it (when it may be
 * shown, and what it may unlock) has changed.
 */
function computeLevels(
  exec: Candle[],
  config: StrategyConfig,
  price: number,
  direction: "BUY" | "SELL",
  symbol: string,
): LevelResult {
  const isBuy = direction === "BUY";
  const errors: string[] = [];
  const reasons: string[] = [];

  if (exec.length < 30) {
    return {
      nearLevel: false,
      structureConfirmed: false,
      valid: false,
      errors: ["Not enough execution-timeframe history to calculate levels."],
      reasons,
      entryZone: [price, price],
      entryPrice: price,
      stopLoss: price,
      invalidation: price,
      tps: [price, price, price],
      ratios: { tp1: null, tp2: null, tp3: null },
      trigger: "Not enough history.",
      invalidationCondition: "Not enough history.",
    };
  }

  const levels = keyLevels(exec);
  const atrSeries = atr(exec, config.volatility.atrPeriod);
  const atrValue = atrSeries[atrSeries.length - 1] ?? price * 0.001;
  const sweep = liquiditySweep(exec, config.structure.sweepLookbackBars);
  const shift = structureShift(exec);
  const gaps = fairValueGaps(exec, config.structure.maxFairValueGaps);
  const blocks = orderBlocks(exec, config.structure.maxOrderBlocks);
  const displacement = displacementCandles(exec, config.structure.displacementAtr);
  const lastDisplacement = displacement.length
    ? displacement[displacement.length - 1]! >= exec.length - 2
    : false;

  const zoneCandidates = isBuy
    ? [levels.prevDayLow, levels.prevWeekLow, ...levels.support]
    : [levels.prevDayHigh, levels.prevWeekHigh, ...levels.resistance];
  const nearLevel = zoneCandidates
    .filter((v): v is number => typeof v === "number")
    .some((v) => Math.abs(v - price) <= atrValue * config.location.toleranceAtr);
  if (nearLevel) {
    reasons.push("Price is near a mapped support/resistance level.");
  }

  const sweepAligned =
    sweep.detected && (isBuy ? sweep.side === "SELL_SIDE" : sweep.side === "BUY_SIDE");
  const shiftAligned =
    shift.detected && (isBuy ? shift.direction === "BULLISH" : shift.direction === "BEARISH");
  const structureConfirmed = sweepAligned || shiftAligned || lastDisplacement;
  if (sweepAligned) reasons.push(`${isBuy ? "Sell-side" : "Buy-side"} liquidity sweep detected.`);
  if (shiftAligned) reasons.push("Market-structure shift confirmed on the execution timeframe.");

  const usableZone = (from: number, to: number): [number, number] | null => {
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    const tolerance = atrValue * 0.25;
    if (isBuy && low > price + tolerance) return null;
    if (!isBuy && high < price - tolerance) return null;
    const distance = isBuy ? price - high : low - price;
    if (distance > atrValue * config.entry.maxEntryDistanceAtr) return null;
    return [low, high];
  };

  const alignedGap = gaps
    .filter((g) => (isBuy ? g.direction === "BULLISH" : g.direction === "BEARISH"))
    .map((g) => usableZone(g.from, g.to))
    .find((z): z is [number, number] => z !== null);
  const alignedBlock = blocks
    .filter((b) => (isBuy ? b.direction === "BULLISH" : b.direction === "BEARISH"))
    .map((b) => usableZone(b.from, b.to))
    .find((z): z is [number, number] => z !== null);

  const entryZone: [number, number] = alignedGap ??
    alignedBlock ?? [
      isBuy ? price - atrValue * config.entry.fallbackZoneAtr : price,
      isBuy ? price : price + atrValue * config.entry.fallbackZoneAtr,
    ];
  const inZone = price >= entryZone[0] && price <= entryZone[1];
  const spec = specFor(symbol);
  const digits = spec.digits;
  const entryPrice = Number((inZone ? price : (entryZone[0] + entryZone[1]) / 2).toFixed(digits));

  const structuralLow = Math.min(
    ...exec.slice(-config.structure.structureLookbackBars).map((c) => c.l),
  );
  const structuralHigh = Math.max(
    ...exec.slice(-config.structure.structureLookbackBars).map((c) => c.h),
  );
  const invalidation = isBuy ? (sweep.level ?? structuralLow) : (sweep.level ?? structuralHigh);
  const buffer = atrValue * config.entry.stopBufferAtr;
  const minRisk = Math.max(atrValue * config.entry.minStopAtr, 1e-9);
  const rawStop = isBuy
    ? Math.min(structuralLow, invalidation) - buffer
    : Math.max(structuralHigh, invalidation) + buffer;
  const stopLoss = Number(
    (isBuy
      ? Math.min(rawStop, entryPrice - minRisk)
      : Math.max(rawStop, entryPrice + minRisk)
    ).toFixed(digits),
  );

  const riskDistance = Math.abs(entryPrice - stopLoss);
  const maxRisk = atrValue * config.entry.maxStopAtr;
  if (riskDistance > maxRisk) {
    errors.push(`Stop distance of ${riskDistance.toFixed(digits)} exceeds the configured maximum.`);
  }

  const candidateTargets = (
    isBuy
      ? [levels.resistance[0], levels.prevDayHigh, levels.prevWeekHigh]
      : [levels.support[0], levels.prevDayLow, levels.prevWeekLow]
  )
    .filter((t): t is number => typeof t === "number")
    .filter((t) => (isBuy ? t > entryPrice : t < entryPrice))
    .sort((a, b) => (isBuy ? a - b : b - a));

  const multiples = config.entry.targetRMultiples;
  const chosen: number[] = [];
  for (let i = 0; i < 3; i++) {
    const floorDist = riskDistance * (multiples[i] ?? multiples[multiples.length - 1]!);
    const minDist = chosen.length
      ? Math.abs(chosen[chosen.length - 1]! - entryPrice) + riskDistance * 0.5
      : riskDistance;
    const fromLevel = candidateTargets.find(
      (t) => Math.abs(t - entryPrice) >= Math.max(minDist, riskDistance),
    );
    const dist = Math.max(
      floorDist,
      minDist,
      fromLevel !== undefined ? Math.abs(fromLevel - entryPrice) : 0,
    );
    chosen.push(Number((isBuy ? entryPrice + dist : entryPrice - dist).toFixed(digits)));
    if (fromLevel !== undefined) candidateTargets.splice(candidateTargets.indexOf(fromLevel), 1);
  }
  const tps: [number, number, number] = [chosen[0]!, chosen[1]!, chosen[2]!];

  const rr = (tp: number) => {
    if (riskDistance <= 0) return null;
    const reward = isBuy ? tp - entryPrice : entryPrice - tp;
    return reward <= 0 ? null : Number((reward / riskDistance).toFixed(2));
  };
  const ratios = { tp1: rr(tps[0]), tp2: rr(tps[1]), tp3: rr(tps[2]) };

  if (riskDistance <= 0) errors.push("Stop-loss is not on the correct side of the entry.");
  const ordered = isBuy
    ? entryPrice < tps[0] && tps[0] < tps[1] && tps[1] < tps[2]
    : entryPrice > tps[0] && tps[0] > tps[1] && tps[1] > tps[2];
  if (!ordered) errors.push("Target order is invalid for this direction.");
  if (ratios.tp1 === null) errors.push("Reward-to-risk could not be calculated for TP1.");
  else if (ratios.tp1 < config.entry.minRiskReward) {
    errors.push(
      `TP1 reward-to-risk ${ratios.tp1} is below the minimum ${config.entry.minRiskReward}.`,
    );
  }

  return {
    nearLevel,
    structureConfirmed,
    valid: errors.length === 0,
    errors,
    reasons,
    entryZone,
    entryPrice,
    stopLoss,
    invalidation,
    tps,
    ratios,
    trigger: `${isBuy ? "Bullish" : "Bearish"} entry-confirmation then a trigger while price is inside ${entryZone[0].toFixed(digits)}–${entryZone[1].toFixed(digits)}.`,
    invalidationCondition: isBuy
      ? `A close below ${invalidation.toFixed(digits)} invalidates the idea.`
      : `A close above ${invalidation.toFixed(digits)} invalidates the idea.`,
  };
}

interface ScoreInputs {
  shortTermStates: readonly TimeframeState[];
  higherStates: readonly TimeframeState[];
  timeframes: readonly TimeframeReading[];
  broadContextRelation: BroadContextRelation;
  primaryContextRelation: BroadContextRelation;
  finalDirection: "BUY" | "SELL" | null;
}

/**
 * A heuristic score, never a probability. Category caps stop one dimension
 * from carrying the whole result; a higher-timeframe conflict caps the total
 * regardless of how good the lower timeframes look.
 */
function computeScore(config: StrategyConfig, inputs: ScoreInputs): HeuristicScore {
  const byCategory: Record<ScoreCategory, number> = {
    MOMENTUM: 0,
    LOCATION: 0,
    STRUCTURE: 0,
    TREND: 0,
    VOLATILITY: 0,
    MTF_AGREEMENT: 0,
  };

  if (inputs.finalDirection !== null) {
    const wantBullish = inputs.finalDirection === "BUY";
    const agree = inputs.shortTermStates.filter((s) =>
      wantBullish ? s === "BULLISH" : s === "BEARISH",
    ).length;
    const usable = inputs.shortTermStates.filter(
      (s) => s === "BULLISH" || s === "BEARISH" || s === "NEUTRAL",
    ).length;
    byCategory.MOMENTUM = usable > 0 ? categoryCap("MOMENTUM", config) * (agree / usable) : 0;

    // Correlated multi-timeframe agreement: group by shared base series so
    // three timeframes rolled from one provider request are not counted as
    // three independent confirmations.
    const directional = directionalTimeframes(config);
    const groups = groupByBaseSeries(directional);
    let mtfPoints = 0;
    const decay = config.scoring.correlatedAgreementDecay;
    for (const [, tfs] of groups as Map<BaseSeries, Timeframe[]>) {
      let weight = 1;
      for (const tf of tfs) {
        const reading = inputs.timeframes.find((r) => r.timeframe === tf);
        if (reading?.relation === "AGREEING") {
          mtfPoints += weight;
          weight *= decay;
        }
      }
    }
    const maxPossibleMtf =
      groups.size > 0 ? [...groups.values()].reduce((sum, tfs) => sum + tfs.length, 0) : 1;
    byCategory.MTF_AGREEMENT =
      categoryCap("MTF_AGREEMENT", config) * Math.min(1, mtfPoints / Math.max(1, maxPossibleMtf));
  }

  // Location / structure / trend / volatility are folded into the level
  // computation's reasons for now (surfaced via `reasons`); the category caps
  // give them room to be scored precisely once that computation is unified
  // with this one in a later pass.
  byCategory.LOCATION = 0;
  byCategory.STRUCTURE = 0;
  byCategory.TREND = 0;
  byCategory.VOLATILITY = 0;

  let total = Object.values(byCategory).reduce((sum, v) => sum + v, 0);
  let cappedBy: string | null = null;

  const conflicted =
    inputs.broadContextRelation === "CONFLICTING" ||
    inputs.primaryContextRelation === "CONFLICTING";
  if (conflicted && total > config.scoring.conflictScoreCap) {
    total = config.scoring.conflictScoreCap;
    cappedBy = "higher-timeframe conflict";
  }

  const max = maxScore(config);
  total = Math.max(0, Math.min(max, Math.round(total)));

  return {
    value: total,
    max,
    label:
      total >= config.scoring.highThreshold
        ? "HIGH"
        : total >= config.scoring.mediumThreshold
          ? "MEDIUM"
          : "LOW",
    isHeuristic: true,
    cappedBy,
    byCategory,
  };
}
