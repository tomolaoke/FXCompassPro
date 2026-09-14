import { describe, expect, it } from "vitest";
import { atr, ema, rsi, sma, stochastic, stochStateOf, swings } from "./indicators";
import type { Candle } from "./types";

const c = (t: number, o: number, h: number, l: number, close: number): Candle => ({
  t,
  o,
  h,
  l,
  c: close,
});

describe("sma", () => {
  it("is null before the window fills", () => {
    const out = sma([1, 2, 3], 5);
    expect(out).toEqual([null, null, null]);
  });

  it("computes a simple moving average once the window fills", () => {
    const out = sma([1, 2, 3, 4, 5], 3);
    expect(out).toEqual([null, null, 2, 3, 4]);
  });

  it("handles a window of 1 as the identity", () => {
    expect(sma([5, 6, 7], 1)).toEqual([5, 6, 7]);
  });
});

describe("ema", () => {
  it("is null before the window fills", () => {
    expect(ema([1, 2], 5)).toEqual([null, null]);
  });

  it("seeds the first value from a simple average, then applies the multiplier", () => {
    // period 3: k = 2/(3+1) = 0.5. Seed = avg(1,2,3) = 2.
    const out = ema([1, 2, 3, 4], 3);
    expect(out[2]).toBe(2);
    expect(out[3]).toBeCloseTo(2 + 0.5 * (4 - 2), 10); // 3
  });
});

describe("stochastic", () => {
  it("returns null k/d before the combined warm-up completes", () => {
    // kPeriod 3, slowing 2, dPeriod 2 → first d at index kPeriod-1+slowing-1+dPeriod-1 = 2+1+1=4
    const candles = [1, 2, 3, 4, 5, 6].map((v, i) => c(i, v, v + 1, v - 1, v));
    const out = stochastic(candles, 3, 2, 2);
    expect(out[0]!.k).toBeNull();
    expect(out[0]!.d).toBeNull();
  });

  it("reads 100 when the close is at the top of the window's range", () => {
    const candles = [
      c(0, 10, 12, 8, 10),
      c(1, 10, 12, 8, 10),
      c(2, 10, 12, 8, 12), // closes at the window high
    ];
    const out = stochastic(candles, 3, 1, 1);
    expect(out[2]!.k).toBe(100);
  });

  it("reads 0 when the close is at the bottom of the window's range", () => {
    const candles = [c(0, 10, 12, 8, 10), c(1, 10, 12, 8, 10), c(2, 10, 12, 8, 8)];
    const out = stochastic(candles, 3, 1, 1);
    expect(out[2]!.k).toBe(0);
  });

  it("reads 50 when the high and low of the window are equal, to avoid a divide by zero", () => {
    const candles = [c(0, 10, 10, 10, 10), c(1, 10, 10, 10, 10)];
    const out = stochastic(candles, 2, 1, 1);
    expect(out[1]!.k).toBe(50);
  });
});

describe("stochStateOf", () => {
  const point = (k: number) => ({ k, d: k });

  it("reports UNKNOWN with no data", () => {
    expect(stochStateOf([])).toBe("UNKNOWN");
  });

  it("reports OVERBOUGHT at or above 80", () => {
    expect(stochStateOf([point(70), point(85)])).toBe("OVERBOUGHT");
  });

  it("reports OVERSOLD at or below 20", () => {
    expect(stochStateOf([point(30), point(15)])).toBe("OVERSOLD");
  });

  it("reports RECOVERING_FROM_OVERSOLD when turning up through 30", () => {
    expect(stochStateOf([point(25), point(35)])).toBe("RECOVERING_FROM_OVERSOLD");
  });

  it("reports ROLLING_FROM_OVERBOUGHT when turning down through 70", () => {
    expect(stochStateOf([point(75), point(65)])).toBe("ROLLING_FROM_OVERBOUGHT");
  });

  it("reports NEUTRAL in the middle of the range with no transition", () => {
    expect(stochStateOf([point(50), point(52)])).toBe("NEUTRAL");
  });
});

describe("rsi", () => {
  it("is null on the first bar", () => {
    expect(rsi([c(0, 1, 1, 1, 1)])[0]).toBeNull();
  });

  it("reads ~100 when every change in the warm-up window is a gain", () => {
    // avgLoss floors at 1e-9 to avoid a divide-by-zero, so this lands just
    // under 100 rather than exactly on it — that epsilon is deliberate.
    const candles = Array.from({ length: 15 }, (_, i) => c(i, i, i, i, i + 1));
    const out = rsi(candles, 14);
    expect(out[14]).toBeCloseTo(100, 5);
  });

  it("reads 0 when every change in the warm-up window is a loss", () => {
    const candles = Array.from({ length: 15 }, (_, i) => c(i, 20 - i, 20 - i, 20 - i, 19 - i));
    const out = rsi(candles, 14);
    expect(out[14]).toBe(0);
  });
});

describe("atr", () => {
  it("uses the high-low range on the first bar, with no previous close", () => {
    const out = atr([c(0, 10, 15, 5, 12)], 1);
    expect(out[0]).toBe(10);
  });

  it("uses the widest of the three true-range components thereafter", () => {
    // Bar 2 gaps up: prevClose=12, high=20, low=18 → true range = high-prevClose = 8,
    // which exceeds the bar's own high-low range of 2.
    const candles = [c(0, 10, 15, 5, 12), c(1, 18, 20, 18, 19)];
    const out = atr(candles, 1);
    expect(out[1]).toBe(8);
  });

  it("averages true range over the period once warmed up", () => {
    const candles = [c(0, 10, 12, 8, 10), c(1, 10, 14, 6, 10), c(2, 10, 11, 9, 10)];
    // true ranges: 4, max(8, |14-10|=4, |6-10|=4)=8, max(2,|11-10|=1,|9-10|=1)=2
    const out = atr(candles, 3);
    expect(out[2]).toBeCloseTo((4 + 8 + 2) / 3, 10);
  });
});

describe("swings", () => {
  it("finds no swings in a monotonic series", () => {
    const candles = Array.from({ length: 10 }, (_, i) => c(i, i, i + 1, i, i + 1));
    expect(swings(candles, 2)).toEqual([]);
  });

  it("finds a swing high at a single sharp peak", () => {
    const heights = [1, 2, 3, 5, 3, 2, 1];
    const candles = heights.map((h, i) => c(i, h, h, h - 1, h));
    const found = swings(candles, 2);
    expect(found.some((s) => s.type === "HIGH" && s.index === 3)).toBe(true);
  });

  it("finds a swing low at a single sharp trough", () => {
    const depths = [5, 4, 3, 1, 3, 4, 5];
    const candles = depths.map((d, i) => c(i, d, d + 1, d, d));
    const found = swings(candles, 2);
    expect(found.some((s) => s.type === "LOW" && s.index === 3)).toBe(true);
  });

  it("requires lookback bars on both sides, so edges can never be swings", () => {
    const candles = [c(0, 100, 100, 100, 100), c(1, 1, 1, 1, 1), c(2, 100, 100, 100, 100)];
    // The dip at index 1 has only one neighbour on each side; lookback 2 needs two.
    expect(swings(candles, 2)).toEqual([]);
  });

  it("does not call a flat run of equal values a swing", () => {
    const candles = Array.from({ length: 7 }, (_, i) => c(i, 5, 5, 5, 5));
    expect(swings(candles, 2)).toEqual([]);
  });
});
