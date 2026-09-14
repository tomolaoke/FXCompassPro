/**
 * Candle-series normalisation.
 *
 * A provider response is never trusted as-is: duplicates happen, bars arrive
 * out of order, OHLC values can be malformed, and gaps (weekend closures,
 * provider outages, thin liquidity) are common. This runs once, right after
 * parsing a provider response, before anything else touches the series.
 */

import type { Candle } from "../types";

export interface Gap {
  /** Close time of the candle before the gap. */
  readonly afterT: number;
  /** Open time of the candle after the gap. */
  readonly beforeT: number;
  readonly missingBars: number;
}

export interface NormalizeResult {
  readonly candles: Candle[];
  readonly duplicatesRemoved: number;
  readonly reordered: boolean;
  readonly invalidDropped: number;
  readonly gaps: readonly Gap[];
}

function isSaneOhlc(c: Candle): boolean {
  if (![c.t, c.o, c.h, c.l, c.c].every(Number.isFinite)) return false;
  if (c.h < c.o || c.h < c.c || c.h < c.l) return false;
  if (c.l > c.o || c.l > c.c) return false;
  return true;
}

/**
 * Normalises a raw candle array for a single timeframe.
 *
 * Order of operations matters: sort first (so "duplicate" means "same open
 * time", not "same position"), then drop exact duplicates, then drop bars that
 * fail OHLC sanity, then detect gaps in what remains. A bar dropped for bad
 * OHLC does not count as a gap of size zero — it is simply missing, same as
 * data the provider never sent.
 *
 * `expectedGapMs` is the caller's normal bar spacing (weekday, market hours).
 * A gap is only reported when the actual spacing exceeds it by more than one
 * full bar, which is what keeps an ordinary weekend close from being reported
 * as a data fault: the caller is expected to pass a spacing tolerant of that,
 * or to filter weekend gaps out of the result separately.
 */
export function normalizeCandles(raw: readonly Candle[], expectedGapMs: number): NormalizeResult {
  const sorted = [...raw].sort((a, b) => a.t - b.t);
  const reordered = sorted.some((c, i) => raw[i] !== c);

  const deduped: Candle[] = [];
  let duplicatesRemoved = 0;
  for (const c of sorted) {
    const last = deduped[deduped.length - 1];
    if (last && last.t === c.t) {
      duplicatesRemoved += 1;
      // Keep the later-arriving value: a resent bar is usually a correction.
      deduped[deduped.length - 1] = c;
      continue;
    }
    deduped.push(c);
  }

  const valid: Candle[] = [];
  let invalidDropped = 0;
  for (const c of deduped) {
    if (isSaneOhlc(c)) valid.push(c);
    else invalidDropped += 1;
  }

  const gaps: Gap[] = [];
  for (let i = 1; i < valid.length; i++) {
    const prev = valid[i - 1]!;
    const cur = valid[i]!;
    const spacing = cur.t - prev.t;
    if (spacing > expectedGapMs * 1.5) {
      gaps.push({
        afterT: prev.t,
        beforeT: cur.t,
        missingBars: Math.round(spacing / expectedGapMs) - 1,
      });
    }
  }

  return { candles: valid, duplicatesRemoved, reordered, invalidDropped, gaps };
}

/**
 * Splits gaps into weekend closures (expected, not a data fault) and
 * everything else (a genuine hole in the data, worth surfacing).
 *
 * A gap is treated as a weekend close when it starts on Friday and ends on
 * Sunday or Monday in the given timezone — the ordinary FX market closure.
 */
export function splitWeekendGaps(
  gaps: readonly Gap[],
  timeZone: string,
): { weekend: Gap[]; unexplained: Gap[] } {
  const weekend: Gap[] = [];
  const unexplained: Gap[] = [];
  for (const gap of gaps) {
    const startDay = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(
      new Date(gap.afterT),
    );
    const endDay = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(
      new Date(gap.beforeT),
    );
    if (startDay === "Fri" && (endDay === "Sun" || endDay === "Mon")) weekend.push(gap);
    else unexplained.push(gap);
  }
  return { weekend, unexplained };
}
