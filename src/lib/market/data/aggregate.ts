/**
 * Rolls a finer candle series up into a coarser timeframe, bucketed on the
 * broker's server session rather than the UTC day.
 *
 * Shared between the live provider pipeline (market.server.ts) and the
 * backtester, so both read history through identical bucket boundaries — a
 * backtest whose candles are aligned differently from live would produce
 * results that silently do not transfer.
 */

import { bucketStart, DEFAULT_CLOCK_CONFIG, type ClockConfig } from "../domain/clock";
import type { Timeframe } from "../config/timeframes";
import type { Candle } from "../types";

export function aggregate(
  base: readonly Candle[],
  tf: Timeframe,
  clock: ClockConfig = DEFAULT_CLOCK_CONFIG,
): Candle[] {
  const out: Candle[] = [];
  let current: Candle | null = null;
  let currentKey = Number.NaN;
  for (const c of base) {
    const key = bucketStart(c.t, tf, clock);
    if (!current || key !== currentKey) {
      if (current) out.push(current);
      current = { t: key, o: c.o, h: c.h, l: c.l, c: c.c };
      currentKey = key;
      continue;
    }
    current.h = Math.max(current.h, c.h);
    current.l = Math.min(current.l, c.l);
    current.c = c.c;
  }
  if (current) out.push(current);
  return out;
}
