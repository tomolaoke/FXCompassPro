/**
 * Reads a single timeframe: turns raw candles into a TimeframeState plus a
 * full StochasticReading, independent of any proposed trade direction.
 *
 * This is a deliberate two-pass design. Pass one (this file) answers "what is
 * this chart doing?" without reference to a direction. Pass two, in
 * evaluate.ts, compares that answer against the final direction to produce the
 * AGREEING/CONFLICTING relation. Merging the two passes would make it
 * impossible to ask "what does the weekly chart say?" without already having
 * decided what you expect it to say.
 */

import { stochastic, type StochPoint } from "../indicators";
import {
  candleCloseTime,
  isCandleClosed,
  lastClosedCandleOpen,
  freshness,
  type ClockConfig,
} from "../domain/clock";
import type { StochasticEvent, StochasticReading, TimeframeState } from "../domain/states";
import { timeframeDef, type Timeframe } from "../config/timeframes";
import type { StrategyConfig } from "../config/strategy";
import type { Candle } from "../types";

export interface TimeframeReadingResult {
  readonly state: TimeframeState;
  readonly stochastic: StochasticReading | null;
  readonly dataAgeMs: number | null;
  readonly candleClosed: boolean | null;
  readonly candleOpenTime: number | null;
  readonly explanation: string;
}

const UNAVAILABLE: TimeframeReadingResult = {
  state: "DATA_MISSING",
  stochastic: null,
  dataAgeMs: null,
  candleClosed: null,
  candleOpenTime: null,
  explanation: "No candles available for this timeframe.",
};

/**
 * Reads one timeframe.
 *
 * `isSynthetic` short-circuits to DATA_MISSING regardless of how convincing the
 * sample data looks: config.dataQuality.rejectSyntheticData means synthetic
 * candles must never produce a directional state, because they were generated
 * from a seeded random walk, not the market.
 */
export function readTimeframe(
  timeframe: Timeframe,
  candles: Candle[] | undefined,
  config: StrategyConfig,
  now: number,
  clock: ClockConfig,
  isSynthetic: boolean,
): TimeframeReadingResult {
  const def = timeframeDef(timeframe);

  if (!candles || candles.length < def.minBars) {
    return {
      ...UNAVAILABLE,
      explanation: `Needs at least ${def.minBars} candles; ${candles?.length ?? 0} available.`,
    };
  }

  if (isSynthetic && config.dataQuality.rejectSyntheticData) {
    return {
      state: "DATA_MISSING",
      stochastic: null,
      dataAgeMs: null,
      candleClosed: null,
      candleOpenTime: null,
      explanation: "Sample data only — no verified market data for this timeframe.",
    };
  }

  const lastCandle = candles[candles.length - 1]!;
  const candleClosed = isCandleClosed(lastCandle.t, timeframe, now, clock);

  // A confirmed reading may only use the last CLOSED candle. If the latest bar
  // is still forming, step back one — the open bar still informs CANDLE_OPEN
  // below, but never contributes to a BULLISH/BEARISH state.
  const closedCandles = candleClosed ? candles : candles.slice(0, -1);
  if (closedCandles.length < def.minBars) {
    return {
      state: "CANDLE_OPEN",
      stochastic: null,
      dataAgeMs: now - lastCandle.t,
      candleClosed: false,
      candleOpenTime: lastCandle.t,
      explanation: "Latest candle has not closed and no closed candle history is available yet.",
    };
  }

  const referenceCandle = closedCandles[closedCandles.length - 1]!;
  // Measured from the candle's CLOSE, not its open — "how long since the last
  // complete piece of information arrived," which is what staleness actually
  // means. Measuring from open would put the worst case at nearly 2 bar
  // widths (just before the next bar closes, the previous CLOSED bar's open
  // is almost 2x its own duration in the past), which left several of the
  // tight readiness limits in config/timeframes.ts permanently unsatisfiable
  // even with perfectly fresh data.
  const fresh = freshness(
    candleCloseTime(referenceCandle.t, timeframe, clock),
    timeframe,
    now,
    clock,
  );
  if (fresh.isStale) {
    return {
      state: "DATA_STALE",
      stochastic: null,
      dataAgeMs: fresh.ageMs,
      candleClosed: true,
      candleOpenTime: referenceCandle.t,
      explanation: `Last closed candle is ${Math.round(fresh.ageMs / 60_000)} minutes old, past the freshness limit for ${timeframe}.`,
    };
  }
  if (fresh.isImplausible) {
    return {
      state: "DATA_INVALID",
      stochastic: null,
      dataAgeMs: fresh.ageMs,
      candleClosed: true,
      candleOpenTime: referenceCandle.t,
      explanation: "Candle timestamp is in the future — treated as a data fault, not fresh data.",
    };
  }

  const points = stochastic(
    closedCandles,
    config.momentum.kPeriod,
    config.momentum.slowing,
    config.momentum.dPeriod,
  );
  const reading = classifyStochastic(points, closedCandles, config);

  if (!reading) {
    return {
      state: "DATA_MISSING",
      stochastic: null,
      dataAgeMs: fresh.ageMs,
      candleClosed: true,
      candleOpenTime: referenceCandle.t,
      explanation: `Not enough closed history yet for Stochastic ${config.momentum.kPeriod},${config.momentum.slowing},${config.momentum.dPeriod} on ${timeframe}.`,
    };
  }

  const state = stateFromEvent(reading.event);

  const notClosedSuffix = candleClosed
    ? ""
    : " (latest forming candle excluded; reading based on the last closed candle)";

  return {
    state,
    stochastic: reading,
    dataAgeMs: fresh.ageMs,
    candleClosed: true,
    candleOpenTime: referenceCandle.t,
    explanation: `${explainEvent(reading.event, reading)}${notClosedSuffix}`,
  };
}

/** A confirmed state requires CONFIRMED_BULLISH/BEARISH; everything else the momentum layer produces is NEUTRAL or INCONCLUSIVE. */
function stateFromEvent(event: StochasticEvent): TimeframeState {
  switch (event) {
    case "CONFIRMED_BULLISH":
      return "BULLISH";
    case "CONFIRMED_BEARISH":
      return "BEARISH";
    case "NEUTRAL":
      return "NEUTRAL";
    case "INCONCLUSIVE":
      return "INCONCLUSIVE";
    // Extreme readings, curls, crosses and reclaims are real events but are
    // explicitly not, on their own, a directional trade state — see
    // docs/strategy-rules.md. They surface through the Stochastic reading, not
    // through the timeframe state.
    default:
      return "INCONCLUSIVE";
  }
}

function explainEvent(event: StochasticEvent, r: StochasticReading): string {
  const k = r.k?.toFixed(1) ?? "—";
  switch (event) {
    case "CONFIRMED_BULLISH":
      return `K ${k}: bullish, confirmed by a closed-candle reclaim and price action.`;
    case "CONFIRMED_BEARISH":
      return `K ${k}: bearish, confirmed by a closed-candle break and price action.`;
    case "EXTREME_OVERSOLD":
      return `K ${k}: deeply oversold. Not a signal on its own — extremes persist in a trend.`;
    case "EXTREME_OVERBOUGHT":
      return `K ${k}: deeply overbought. Not a signal on its own — extremes persist in a trend.`;
    case "CURLING_UP":
      return `K ${k}: turning up from a low reading, no level cross yet.`;
    case "CURLING_DOWN":
      return `K ${k}: turning down from a high reading, no level cross yet.`;
    case "K_D_CROSS_UP":
      return `K ${k}: %K crossed above %D. A crossover alone is not a trade signal.`;
    case "K_D_CROSS_DOWN":
      return `K ${k}: %K crossed below %D. A crossover alone is not a trade signal.`;
    case "THRESHOLD_RECLAIM_UP":
      return `K ${k}: closed back above the oversold level. A reclaim alone is not a trade signal.`;
    case "THRESHOLD_RECLAIM_DOWN":
      return `K ${k}: closed back below the overbought level. A reclaim alone is not a trade signal.`;
    case "NEUTRAL":
      return `K ${k}: no usable Stochastic reading.`;
    case "INCONCLUSIVE":
      return `K ${k}: mixed reading — event present but not confirmed by price action.`;
  }
}

/**
 * Classifies the last two Stochastic readings into one event, per
 * docs/strategy-rules.md:
 *
 *   extreme → curling → K/D cross → threshold reclaim → CONFIRMED
 *
 * CONFIRMED requires a closed-candle price-action agreement (the candle closed
 * in the same direction as the event) on top of the Stochastic event — matching
 * "Stochastic event + closed-candle price action" from the project rules.
 */
export function classifyStochastic(
  points: StochPoint[],
  closedCandles: Candle[],
  config: StrategyConfig,
): StochasticReading | null {
  const { deepOversold, oversold, overbought, deepOverbought, requireLevelCross } = config.momentum;

  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const prev2 = points[points.length - 3];
  if (!last || last.k === null) return null;

  const k = last.k;
  const d = last.d;
  const kPrev = prev?.k ?? k;
  const kPrev2 = prev2?.k ?? kPrev;
  const dPrev = prev?.d ?? d;

  const lastCandle = closedCandles[closedCandles.length - 1]!;
  const candleBullish = lastCandle.c > lastCandle.o;
  const candleBearish = lastCandle.c < lastCandle.o;

  const kSlope = k - kPrev;
  const dSlope = d !== null && dPrev !== null ? d - dPrev : null;

  const crossUp = d !== null && dPrev !== null && kPrev <= dPrev && k > d;
  const crossDown = d !== null && dPrev !== null && kPrev >= dPrev && k < d;

  const reclaimLevel = (level: number): boolean => kPrev <= level && k > level;
  const breakLevel = (level: number): boolean => kPrev >= level && k < level;

  const reclaimUp = reclaimLevel(oversold) || reclaimLevel(deepOversold);
  const reclaimLevelValue = reclaimLevel(deepOversold) ? deepOversold : oversold;
  const breakDown = breakLevel(overbought) || breakLevel(deepOverbought);
  const breakLevelValue = breakLevel(deepOverbought) ? deepOverbought : overbought;

  const curlingUp = kSlope > 0 && kPrev <= kPrev2 && k < 50;
  const curlingDown = kSlope < 0 && kPrev >= kPrev2 && k > 50;

  const extremeOversold = k <= deepOversold;
  const extremeOverbought = k >= deepOverbought;

  const base = {
    k: Number(k.toFixed(2)),
    d: d === null ? null : Number(d.toFixed(2)),
    previousK: Number(kPrev.toFixed(2)),
    previousD: dPrev === null ? null : Number(dPrev.toFixed(2)),
    kSlope: Number(kSlope.toFixed(3)),
    dSlope: dSlope === null ? null : Number(dSlope.toFixed(3)),
    candleClosed: true,
    candleOpenTime: lastCandle.t,
    calculatedAt: Date.now(),
  };

  // Confirmed: a genuine reclaim/break (or, when level crosses are not
  // required, an extreme-plus-curl) AND the closed candle agrees.
  const bullishEventPresent = requireLevelCross
    ? reclaimUp
    : reclaimUp || (extremeOversold && curlingUp);
  const bearishEventPresent = requireLevelCross
    ? breakDown
    : breakDown || (extremeOverbought && curlingDown);

  if (bullishEventPresent && candleBullish) {
    return {
      ...base,
      crossDirection: crossUp ? "UP" : "NONE",
      thresholdCross: "RECLAIM_UP",
      crossedLevel: reclaimLevelValue,
      event: "CONFIRMED_BULLISH",
    };
  }
  if (bearishEventPresent && candleBearish) {
    return {
      ...base,
      crossDirection: crossDown ? "DOWN" : "NONE",
      thresholdCross: "BREAK_DOWN",
      crossedLevel: breakLevelValue,
      event: "CONFIRMED_BEARISH",
    };
  }

  // Not confirmed by price action, but the Stochastic event itself is real —
  // report it so the UI can show "reclaimed but not confirmed" rather than
  // nothing at all.
  if (bullishEventPresent || bearishEventPresent) {
    return {
      ...base,
      crossDirection: crossUp ? "UP" : crossDown ? "DOWN" : "NONE",
      thresholdCross: bullishEventPresent ? "RECLAIM_UP" : "BREAK_DOWN",
      crossedLevel: bullishEventPresent ? reclaimLevelValue : breakLevelValue,
      event: bullishEventPresent ? "THRESHOLD_RECLAIM_UP" : "THRESHOLD_RECLAIM_DOWN",
    };
  }

  if (crossUp) {
    return {
      ...base,
      crossDirection: "UP",
      thresholdCross: "NONE",
      crossedLevel: null,
      event: "K_D_CROSS_UP",
    };
  }
  if (crossDown) {
    return {
      ...base,
      crossDirection: "DOWN",
      thresholdCross: "NONE",
      crossedLevel: null,
      event: "K_D_CROSS_DOWN",
    };
  }

  if (curlingUp) {
    return {
      ...base,
      crossDirection: "NONE",
      thresholdCross: "NONE",
      crossedLevel: null,
      event: "CURLING_UP",
    };
  }
  if (curlingDown) {
    return {
      ...base,
      crossDirection: "NONE",
      thresholdCross: "NONE",
      crossedLevel: null,
      event: "CURLING_DOWN",
    };
  }
  if (extremeOversold) {
    return {
      ...base,
      crossDirection: "NONE",
      thresholdCross: "NONE",
      crossedLevel: null,
      event: "EXTREME_OVERSOLD",
    };
  }
  if (extremeOverbought) {
    return {
      ...base,
      crossDirection: "NONE",
      thresholdCross: "NONE",
      crossedLevel: null,
      event: "EXTREME_OVERBOUGHT",
    };
  }

  return {
    ...base,
    crossDirection: "NONE",
    thresholdCross: "NONE",
    crossedLevel: null,
    event: "NEUTRAL",
  };
}

/** Open time of the last closed candle for a timeframe, used by callers that need a stable reference. */
export function lastClosedOpen(timeframe: Timeframe, now: number, clock: ClockConfig): number {
  return lastClosedCandleOpen(timeframe, now, clock);
}
