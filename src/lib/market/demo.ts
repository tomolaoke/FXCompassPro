import { TF_MINUTES, type Candle, type Quote, type Timeframe } from "./types";
import { specFor } from "./instruments";

/**
 * Deterministic pseudo-random demo candles.
 * These are SYNTHETIC and clearly labelled everywhere they appear.
 * They exist so the interface can be reviewed offline; they are never real prices.
 */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASE_PRICE: Record<string, number> = {
  XAUUSD: 2380,
  EURJPY: 168.4,
  USDJPY: 152.6,
  EURUSD: 1.0842,
  GBPUSD: 1.2715,
  AUDUSD: 0.6612,
};

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function demoCandles(
  symbol: string,
  timeframe: Timeframe,
  count = 220,
  anchor = 1757000000000,
): Candle[] {
  const spec = specFor(symbol);
  const base = BASE_PRICE[symbol.toUpperCase()] ?? 1.1;
  const rand = mulberry32(hash(`${symbol}:${timeframe}`));
  const stepMs = TF_MINUTES[timeframe] * 60000;
  const vol = base * 0.0018 * Math.sqrt(TF_MINUTES[timeframe] / 15);
  const candles: Candle[] = [];
  let price = base;
  let drift = (rand() - 0.5) * vol * 0.4;
  for (let i = count - 1; i >= 0; i--) {
    if (i % 18 === 0) drift = (rand() - 0.5) * vol * 0.5;
    const o = price;
    const move = drift + (rand() - 0.5) * vol * 2;
    const c = o + move;
    const wick = Math.abs(move) * (0.4 + rand());
    const h = Math.max(o, c) + wick * rand();
    const l = Math.min(o, c) - wick * rand();
    price = c;
    candles.push({
      t: anchor - i * stepMs,
      o: round(o, spec.digits),
      h: round(h, spec.digits),
      l: round(l, spec.digits),
      c: round(c, spec.digits),
    });
  }
  return candles;
}

function round(v: number, digits: number) {
  return Number(v.toFixed(digits));
}

export function demoQuote(symbol: string, candles: Candle[]): Quote {
  const spec = specFor(symbol);
  const last = candles[candles.length - 1];
  const mid = last?.c ?? BASE_PRICE[symbol.toUpperCase()] ?? 1;
  const spread = (spec.typicalSpreadPips ?? 1) * spec.pipSize;
  return {
    symbol,
    bid: round(mid - spread / 2, spec.digits),
    ask: round(mid + spread / 2, spec.digits),
    mid: round(mid, spec.digits),
    spread: round(spread, spec.digits + 1),
    timestamp: last?.t ?? Date.now(),
    provider: "Demo dataset (synthetic)",
    kind: "demo",
    quality: 20,
    note: "Synthetic sample data for interface review. Not a market price.",
  };
}

export function demoSeries(symbol: string): Partial<Record<Timeframe, Candle[]>> {
  const tfs: Timeframe[] = ["MN", "W1", "D1", "H4", "H1", "M30", "M15", "M5"];
  const out: Partial<Record<Timeframe, Candle[]>> = {};
  for (const tf of tfs) out[tf] = demoCandles(symbol, tf);
  return out;
}
