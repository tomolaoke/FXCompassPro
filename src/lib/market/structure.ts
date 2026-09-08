import { atr, swings, type Swing } from "./indicators";
import type { Candle, Session } from "./types";

export interface FairValueGap {
  from: number;
  to: number;
  direction: "BULLISH" | "BEARISH";
  index: number;
  time: number;
}

/** Three-candle imbalance: candle 1 high < candle 3 low (bullish) and vice versa. */
export function fairValueGaps(candles: Candle[], limit = 8): FairValueGap[] {
  const out: FairValueGap[] = [];
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2]!;
    const c = candles[i]!;
    if (c.l > a.h) {
      out.push({ from: a.h, to: c.l, direction: "BULLISH", index: i, time: c.t });
    } else if (c.h < a.l) {
      out.push({ from: c.h, to: a.l, direction: "BEARISH", index: i, time: c.t });
    }
  }
  return out.slice(-limit);
}

export interface OrderBlock {
  from: number;
  to: number;
  direction: "BULLISH" | "BEARISH";
  index: number;
}

/**
 * Order-block approximation: the last opposing candle before a displacement move.
 * This is an approximation of a discretionary concept, not an institutional fact.
 */
export function orderBlocks(candles: Candle[], limit = 6): OrderBlock[] {
  const a = atr(candles, 14);
  const out: OrderBlock[] = [];
  for (let i = 1; i < candles.length; i++) {
    const range = a[i];
    if (!range) continue;
    const c = candles[i]!;
    const body = Math.abs(c.c - c.o);
    if (body < range * 1.5) continue;
    const prev = candles[i - 1]!;
    const bullish = c.c > c.o;
    if (bullish && prev.c < prev.o) {
      out.push({ from: prev.l, to: prev.h, direction: "BULLISH", index: i - 1 });
    } else if (!bullish && prev.c > prev.o) {
      out.push({ from: prev.l, to: prev.h, direction: "BEARISH", index: i - 1 });
    }
  }
  return out.slice(-limit);
}

export function displacementCandles(candles: Candle[], multiplier = 1.5): number[] {
  const a = atr(candles, 14);
  const out: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const range = a[i];
    if (!range) continue;
    const c = candles[i]!;
    if (Math.abs(c.c - c.o) >= range * multiplier) out.push(i);
  }
  return out;
}

export interface EqualLevels {
  price: number;
  count: number;
  type: "HIGH" | "LOW";
}

export function equalLevels(candles: Candle[], tolerance: number): EqualLevels[] {
  const sw = swings(candles, 2);
  const groups: EqualLevels[] = [];
  for (const s of sw) {
    const hit = groups.find(
      (g) => g.type === s.type && Math.abs(g.price - s.price) <= tolerance,
    );
    if (hit) {
      hit.count += 1;
      hit.price = (hit.price * (hit.count - 1) + s.price) / hit.count;
    } else {
      groups.push({ price: s.price, count: 1, type: s.type });
    }
  }
  return groups.filter((g) => g.count >= 2);
}

export interface SweepResult {
  detected: boolean;
  side: "SELL_SIDE" | "BUY_SIDE" | null;
  level: number | null;
  index: number | null;
}

/**
 * Liquidity sweep: price trades through a prior swing level then closes back inside it.
 * sell-side = a prior low taken out (fuel for buys); buy-side = a prior high taken out.
 */
export function liquiditySweep(candles: Candle[], lookback = 40): SweepResult {
  const start = Math.max(2, candles.length - lookback);
  const sw = swings(candles.slice(0, candles.length - 1), 2);
  const recent = candles.slice(start);
  for (let i = recent.length - 1; i >= Math.max(0, recent.length - 6); i--) {
    const c = recent[i]!;
    const absIndex = start + i;
    const priorLows = sw.filter((s) => s.type === "LOW" && s.index < absIndex - 1);
    const priorHighs = sw.filter((s) => s.type === "HIGH" && s.index < absIndex - 1);
    const takenLow = nearestBelow(priorLows, c.l);
    if (takenLow && c.l < takenLow.price && c.c > takenLow.price) {
      return { detected: true, side: "SELL_SIDE", level: takenLow.price, index: absIndex };
    }
    const takenHigh = nearestAbove(priorHighs, c.h);
    if (takenHigh && c.h > takenHigh.price && c.c < takenHigh.price) {
      return { detected: true, side: "BUY_SIDE", level: takenHigh.price, index: absIndex };
    }
  }
  return { detected: false, side: null, level: null, index: null };
}

function nearestBelow(list: Swing[], price: number): Swing | null {
  const below = list.filter((s) => s.price > price);
  return below.length ? below.reduce((a, b) => (a.price < b.price ? a : b)) : null;
}

function nearestAbove(list: Swing[], price: number): Swing | null {
  const above = list.filter((s) => s.price < price);
  return above.length ? above.reduce((a, b) => (a.price > b.price ? a : b)) : null;
}

export interface StructureShift {
  detected: boolean;
  direction: "BULLISH" | "BEARISH" | null;
  level: number | null;
}

/** Market-structure shift: last close breaks the most recent opposing swing. */
export function structureShift(candles: Candle[]): StructureShift {
  const sw = swings(candles, 2);
  const last = candles[candles.length - 1];
  if (!last || sw.length < 2) return { detected: false, direction: null, level: null };
  const lastHigh = [...sw].reverse().find((s) => s.type === "HIGH");
  const lastLow = [...sw].reverse().find((s) => s.type === "LOW");
  if (lastHigh && last.c > lastHigh.price) {
    return { detected: true, direction: "BULLISH", level: lastHigh.price };
  }
  if (lastLow && last.c < lastLow.price) {
    return { detected: true, direction: "BEARISH", level: lastLow.price };
  }
  return { detected: false, direction: null, level: null };
}

export interface KeyLevels {
  prevDayHigh: number | null;
  prevDayLow: number | null;
  prevWeekHigh: number | null;
  prevWeekLow: number | null;
  prevMonthHigh: number | null;
  prevMonthLow: number | null;
  support: number[];
  resistance: number[];
}

export function keyLevels(candles: Candle[]): KeyLevels {
  const day = periodExtremes(candles, (d) => d.toISOString().slice(0, 10));
  const week = periodExtremes(candles, (d) => {
    const onejan = Date.UTC(d.getUTCFullYear(), 0, 1);
    const week = Math.floor((d.getTime() - onejan) / (7 * 86400000));
    return `${d.getUTCFullYear()}-W${week}`;
  });
  const month = periodExtremes(candles, (d) => d.toISOString().slice(0, 7));
  const last = candles[candles.length - 1]?.c ?? 0;
  const sw = swings(candles, 3);
  const support = uniqueSorted(
    sw.filter((s) => s.type === "LOW" && s.price < last).map((s) => s.price),
  )
    .reverse()
    .slice(0, 3);
  const resistance = uniqueSorted(
    sw.filter((s) => s.type === "HIGH" && s.price > last).map((s) => s.price),
  ).slice(0, 3);
  return {
    prevDayHigh: day.high,
    prevDayLow: day.low,
    prevWeekHigh: week.high,
    prevWeekLow: week.low,
    prevMonthHigh: month.high,
    prevMonthLow: month.low,
    support,
    resistance,
  };
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values.map((v) => Number(v.toFixed(6))))].sort((a, b) => a - b);
}

function periodExtremes(
  candles: Candle[],
  keyOf: (d: Date) => string,
): { high: number | null; low: number | null } {
  if (!candles.length) return { high: null, low: null };
  const buckets = new Map<string, { high: number; low: number }>();
  const order: string[] = [];
  for (const c of candles) {
    const key = keyOf(new Date(c.t));
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, { high: c.h, low: c.l });
      order.push(key);
    } else {
      existing.high = Math.max(existing.high, c.h);
      existing.low = Math.min(existing.low, c.l);
    }
  }
  if (order.length < 2) return { high: null, low: null };
  const prev = buckets.get(order[order.length - 2]!)!;
  return { high: prev.high, low: prev.low };
}

export function sessionOf(timestamp: number): Session {
  const hour = new Date(timestamp).getUTCHours();
  if (hour >= 13 && hour < 16) return "LONDON_NY_OVERLAP";
  if (hour >= 7 && hour < 13) return "LONDON";
  if (hour >= 16 && hour < 21) return "NEW_YORK";
  if (hour >= 23 || hour < 7) return "ASIA";
  return "OFF_HOURS";
}

export const SESSION_LABEL: Record<Session, string> = {
  ASIA: "Asia",
  LONDON: "London",
  NEW_YORK: "New York",
  LONDON_NY_OVERLAP: "London / New York overlap",
  OFF_HOURS: "Off hours",
};
