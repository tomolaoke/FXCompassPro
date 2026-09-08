import type { Candle, StochState } from "./types";

/** Simple moving average of a series. Returns array aligned to input (null before warm-up). */
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    if (prev === null) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += values[j]!;
      prev = sum / period;
    } else {
      prev = v * k + prev * (1 - k);
    }
    out.push(prev);
  }
  return out;
}

export interface StochPoint {
  k: number | null;
  d: number | null;
}

/**
 * Stochastic Oscillator with slowing, matching the classic MT-style calculation.
 * Defaults are the user's personal settings: K 25, slowing 2, D 4.
 */
export function stochastic(
  candles: Candle[],
  kPeriod = 25,
  slowing = 2,
  dPeriod = 4,
): StochPoint[] {
  const rawK: (number | null)[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < kPeriod - 1) {
      rawK.push(null);
      continue;
    }
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      hh = Math.max(hh, candles[j]!.h);
      ll = Math.min(ll, candles[j]!.l);
    }
    const range = hh - ll;
    rawK.push(range === 0 ? 50 : ((candles[i]!.c - ll) / range) * 100);
  }

  const slowK: (number | null)[] = rawK.map((_, i) => {
    if (i < slowing - 1) return null;
    const window = rawK.slice(i - slowing + 1, i + 1);
    if (window.some((v) => v === null)) return null;
    return (window as number[]).reduce((a, b) => a + b, 0) / slowing;
  });

  const d: (number | null)[] = slowK.map((_, i) => {
    if (i < dPeriod - 1) return null;
    const window = slowK.slice(i - dPeriod + 1, i + 1);
    if (window.some((v) => v === null)) return null;
    return (window as number[]).reduce((a, b) => a + b, 0) / dPeriod;
  });

  return slowK.map((k, i) => ({ k, d: d[i] ?? null }));
}

/** Interpret the last stochastic readings against the 20/30/70/80 levels. */
export function stochStateOf(points: StochPoint[]): StochState {
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  if (!last || last.k === null) return "UNKNOWN";
  const k = last.k;
  const kPrev = prev?.k ?? k;
  if (k >= 80) return "OVERBOUGHT";
  if (k >= 70) return kPrev > k ? "ROLLING_FROM_OVERBOUGHT" : "OVERBOUGHT";
  if (k <= 20) return "OVERSOLD";
  if (k <= 30) return kPrev < k ? "RECOVERING_FROM_OVERSOLD" : "OVERSOLD";
  if (kPrev <= 30 && k > 30 && k < 50) return "RECOVERING_FROM_OVERSOLD";
  if (kPrev >= 70 && k < 70 && k > 50) return "ROLLING_FROM_OVERBOUGHT";
  return "NEUTRAL";
}

export function rsi(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = [];
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      out.push(null);
      continue;
    }
    const change = candles[i]!.c - candles[i - 1]!.c;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (i <= period) {
      avgGain += gain / period;
      avgLoss += loss / period;
      out.push(i === period ? 100 - 100 / (1 + avgGain / (avgLoss || 1e-9)) : null);
      continue;
    }
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out.push(100 - 100 / (1 + avgGain / (avgLoss || 1e-9)));
  }
  return out;
}

export function atr(candles: Candle[], period = 14): (number | null)[] {
  const trs: number[] = candles.map((c, i) => {
    if (i === 0) return c.h - c.l;
    const prevClose = candles[i - 1]!.c;
    return Math.max(c.h - c.l, Math.abs(c.h - prevClose), Math.abs(c.l - prevClose));
  });
  return sma(trs, period);
}

export interface Swing {
  index: number;
  price: number;
  type: "HIGH" | "LOW";
  time: number;
}

/** Fractal swing detection with a symmetric lookback window. */
export function swings(candles: Candle[], lookback = 2): Swing[] {
  const found: Swing[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i]!;
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j]!.h >= c.h) isHigh = false;
      if (candles[j]!.l <= c.l) isLow = false;
    }
    if (isHigh) found.push({ index: i, price: c.h, type: "HIGH", time: c.t });
    if (isLow) found.push({ index: i, price: c.l, type: "LOW", time: c.t });
  }
  return found;
}
