/**
 * Deterministic candle-series builders for engine tests.
 *
 * Every candle in a built series shares the same high (110) and low (90), so
 * a Stochastic(25,2,4) window's high/low never changes regardless of position.
 * That makes %K a direct, exactly predictable function of the candle's close:
 *
 *   rawK[i] = (close[i] - 90) / (110 - 90) * 100
 *
 * A series is flat at a baseline close for every bar except the last, which
 * jumps. That reproduces a clean "reclaim through a level, confirmed by the
 * closing candle" event without needing to reverse-engineer the oscillator.
 */

import { bucketStart, lastClosedCandleOpen, type ClockConfig } from "../domain/clock";
import { timeframeDef, type Timeframe } from "../config/timeframes";
import type { Candle } from "../types";

const HIGH = 110;
const LOW = 90;
/** rawK 25 — comfortably oversold (below 30), not deep (above 20). */
const FLAT_BULLISH_CLOSE = 95;
/** rawK 75 — comfortably overbought (above 70), not deep (below 80). */
const FLAT_BEARISH_CLOSE = 105;
/** rawK 95 on the final bar — a clean reclaim through 30 from a 25 baseline. */
const JUMP_BULLISH_CLOSE = 109;
/** rawK 5 on the final bar — a clean break through 70 from a 75 baseline. */
const JUMP_BEARISH_CLOSE = 91;

export type SeriesShape =
  | "CONFIRMED_BULLISH"
  | "CONFIRMED_BEARISH"
  | "FLAT"
  /**
   * Same %K reclaim as CONFIRMED_BULLISH, but the final candle closes red
   * (open above close) instead of green — a real THRESHOLD_RECLAIM_UP event
   * with no closed-candle price-action confirmation, so it must never be
   * treated as a trade signal on its own.
   */
  | "RECLAIM_ONLY_BULLISH";

function previousBucket(openTime: number, tf: Timeframe, clock: ClockConfig): number {
  return bucketStart(openTime - 1, tf, clock);
}

/**
 * Builds `count` closed candles for `tf`, ending at the last bucket that has
 * closed as of `now`. Age is therefore always well under the timeframe's
 * staleness limit, regardless of where `now` falls relative to a boundary.
 */
export function buildSeries(
  tf: Timeframe,
  shape: SeriesShape,
  now: number,
  clock: ClockConfig,
  count?: number,
): Candle[] {
  const total = count ?? timeframeDef(tf).minBars + 15;
  const opens: number[] = [lastClosedCandleOpen(tf, now, clock)];
  for (let i = 1; i < total; i++) {
    opens.unshift(previousBucket(opens[0]!, tf, clock));
  }

  return opens.map((t, i) => {
    const isLast = i === opens.length - 1;
    if (shape === "CONFIRMED_BULLISH") {
      return isLast
        ? { t, o: 105, h: HIGH, l: LOW, c: JUMP_BULLISH_CLOSE }
        : { t, o: FLAT_BULLISH_CLOSE, h: HIGH, l: LOW, c: FLAT_BULLISH_CLOSE };
    }
    if (shape === "CONFIRMED_BEARISH") {
      return isLast
        ? { t, o: 95, h: HIGH, l: LOW, c: JUMP_BEARISH_CLOSE }
        : { t, o: FLAT_BEARISH_CLOSE, h: HIGH, l: LOW, c: FLAT_BEARISH_CLOSE };
    }
    if (shape === "RECLAIM_ONLY_BULLISH") {
      // Identical %K path to CONFIRMED_BULLISH (same close), but o > c makes
      // the closing candle red — the reclaim is real, the confirmation isn't.
      return isLast
        ? { t, o: HIGH, h: HIGH, l: LOW, c: JUMP_BULLISH_CLOSE }
        : { t, o: FLAT_BULLISH_CLOSE, h: HIGH, l: LOW, c: FLAT_BULLISH_CLOSE };
    }
    // FLAT: rawK pinned at 25 throughout — no cross, no reclaim, no signal.
    return { t, o: FLAT_BULLISH_CLOSE, h: HIGH, l: LOW, c: FLAT_BULLISH_CLOSE };
  });
}

/** A fixed instant used across engine tests. Its exact value does not matter. */
export const FIXED_NOW = Date.UTC(2025, 6, 15, 12, 0, 0);
