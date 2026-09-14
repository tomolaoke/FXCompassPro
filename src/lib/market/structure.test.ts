import { describe, expect, it } from "vitest";
import {
  displacementCandles,
  equalLevels,
  fairValueGaps,
  keyLevels,
  liquiditySweep,
  sessionOf,
  structureShift,
} from "./structure";
import type { Candle } from "./types";

const DAY = 86_400_000;
const c = (t: number, o: number, h: number, l: number, close: number): Candle => ({
  t,
  o,
  h,
  l,
  c: close,
});

describe("fairValueGaps", () => {
  it("detects a bullish gap when candle 3's low clears candle 1's high", () => {
    const candles = [c(0, 10, 11, 9, 10), c(1, 10, 12, 9, 11), c(2, 13, 14, 12.5, 13.5)];
    const gaps = fairValueGaps(candles);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ direction: "BULLISH", from: 11, to: 12.5 });
  });

  it("detects a bearish gap when candle 3's high sits below candle 1's low", () => {
    const candles = [c(0, 10, 11, 9, 10), c(1, 9, 10, 8, 8.5), c(2, 7, 7.5, 6, 6.5)];
    const gaps = fairValueGaps(candles);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ direction: "BEARISH", from: 7.5, to: 9 });
  });

  it("finds nothing in overlapping, gapless candles", () => {
    const candles = [c(0, 10, 11, 9, 10), c(1, 10, 11, 9, 10), c(2, 10, 11, 9, 10)];
    expect(fairValueGaps(candles)).toEqual([]);
  });

  it("respects the limit, keeping the most recent gaps", () => {
    // Five independent three-candle gap patterns back to back.
    const candles: Candle[] = [];
    let price = 100;
    for (let i = 0; i < 5; i++) {
      candles.push(c(candles.length, price, price + 1, price - 1, price));
      candles.push(c(candles.length, price, price + 1, price - 1, price + 0.5));
      price += 10; // guarantees the next candle's low clears the first candle's high
      candles.push(c(candles.length, price, price + 1, price - 1, price));
    }
    const gaps = fairValueGaps(candles, 2);
    expect(gaps).toHaveLength(2);
  });
});

describe("displacementCandles", () => {
  it("flags a candle whose body is a large multiple of ATR", () => {
    // Fifteen quiet candles to warm up ATR at a small, stable range, then one huge body.
    const quiet = Array.from({ length: 15 }, (_, i) => c(i, 100, 100.5, 99.5, 100));
    const big = c(15, 100, 120, 99, 119);
    const indices = displacementCandles([...quiet, big], 1.5);
    expect(indices).toContain(15);
    expect(indices).not.toContain(5);
  });

  it("flags nothing when every candle is the same modest size", () => {
    const candles = Array.from({ length: 20 }, (_, i) => c(i, 100, 101, 99, 100.5));
    expect(displacementCandles(candles, 1.5)).toEqual([]);
  });
});

describe("equalLevels", () => {
  it("groups two swing highs within tolerance into one equal-highs level", () => {
    // Two isolated peaks (3 and 3.01) separated by a clean valley, each with
    // lookback room on both sides so the fractal detector can register both.
    const heights = [1, 2, 3, 2, 1, 2, 3.01, 2, 1];
    const candles = heights.map((h, i) => c(i, h, h, h - 0.5, h));
    const groups = equalLevels(candles, 0.05);
    const highs = groups.filter((g) => g.type === "HIGH");
    expect(highs).toHaveLength(1);
    expect(highs[0]!.count).toBe(2);
  });

  it("does not group swings further apart than the tolerance", () => {
    const heights = [1, 2, 3, 1, 2, 5, 1];
    const candles = heights.map((h, i) => c(i, h, h, h - 0.5, h));
    const groups = equalLevels(candles, 0.1);
    expect(groups.filter((g) => g.type === "HIGH")).toEqual([]);
  });

  it("requires at least two touches to report a level", () => {
    const heights = [1, 2, 3, 1, 2, 1];
    const candles = heights.map((h, i) => c(i, h, h, h - 0.5, h));
    expect(equalLevels(candles, 0.01)).toEqual([]);
  });
});

describe("liquiditySweep", () => {
  it("detects a sell-side sweep: a prior low is taken then price closes back above it", () => {
    // Establish a swing low around index 3 at price 95, then later wick below it
    // and close back inside.
    const candles = [
      c(0, 100, 101, 99, 100),
      c(1, 100, 101, 97, 98),
      c(2, 98, 99, 96, 97),
      c(3, 97, 98, 95, 96), // swing low ~95
      c(4, 96, 99, 96, 98),
      c(5, 98, 100, 97, 99),
      ...Array.from({ length: 6 }, (_, i) =>
        c(6 + i, 99 + i * 0.1, 100 + i * 0.1, 98 + i * 0.1, 99 + i * 0.1),
      ),
      c(12, 100, 100.5, 94, 96), // sweeps below 95, closes back above it
    ];
    const result = liquiditySweep(candles, 40);
    expect(result.detected).toBe(true);
    expect(result.side).toBe("SELL_SIDE");
  });

  it("finds nothing when price never revisits a prior extreme", () => {
    const candles = Array.from({ length: 30 }, (_, i) => c(i, 100 + i, 101 + i, 99 + i, 100.5 + i));
    expect(liquiditySweep(candles, 20).detected).toBe(false);
  });
});

describe("structureShift", () => {
  it("detects a bullish shift when the close breaks the most recent swing high", () => {
    // structureShift requires at least two swings found in total (of either
    // type) before it looks at direction, so the fixture needs one clean LOW
    // swing (harmless, never revisited) plus one clean HIGH swing that the
    // final candle then closes above. Each needs lookback (2) room on both
    // sides, so neither candidate may sit within 2 bars of either edge.
    const h = [100, 100, 100, 100, 100, 120, 100, 100, 145];
    const l = [90, 90, 70, 90, 90, 90, 90, 90, 90];
    const close = [95, 95, 95, 95, 95, 95, 95, 95, 141]; // final bar breaks above the 120 high
    const candles = h.map((hi, i) => c(i, close[i]!, hi, l[i]!, close[i]!));
    const shift = structureShift(candles);
    expect(shift.detected).toBe(true);
    expect(shift.direction).toBe("BULLISH");
  });

  it("detects a bearish shift when the close breaks the most recent swing low", () => {
    const h = [100, 100, 110, 100, 100, 100, 100, 100, 100];
    const l = [90, 90, 90, 90, 90, 60, 90, 90, 35];
    const close = [95, 95, 95, 95, 95, 95, 95, 95, 39]; // final bar breaks below the 60 low
    const candles = h.map((hi, i) => c(i, close[i]!, hi, l[i]!, close[i]!));
    const shift = structureShift(candles);
    expect(shift.detected).toBe(true);
    expect(shift.direction).toBe("BEARISH");
  });

  it("reports nothing detected with fewer than two swings", () => {
    const candles = [c(0, 100, 101, 99, 100), c(1, 100, 101, 99, 100)];
    expect(structureShift(candles).detected).toBe(false);
  });
});

describe("keyLevels", () => {
  it("reports the PREVIOUS day's high/low, not the current day's", () => {
    const day1 = Array.from({ length: 4 }, (_, i) => c(i * 3_600_000, 100, 110, 90, 100));
    const day2 = Array.from({ length: 4 }, (_, i) => c(DAY + i * 3_600_000, 100, 105, 95, 100));
    const levels = keyLevels([...day1, ...day2]);
    expect(levels.prevDayHigh).toBe(110);
    expect(levels.prevDayLow).toBe(90);
  });

  it("returns null extremes with fewer than two periods of data", () => {
    const oneDay = Array.from({ length: 4 }, (_, i) => c(i * 3_600_000, 100, 110, 90, 100));
    const levels = keyLevels(oneDay);
    expect(levels.prevDayHigh).toBeNull();
    expect(levels.prevDayLow).toBeNull();
  });

  it("only reports support below, and resistance above, the last close", () => {
    const heights = [100, 105, 110, 105, 100, 95, 90, 95, 100, 105, 110, 105, 100];
    const candles = heights.map((h, i) => c(i * 3_600_000, h, h + 1, h - 1, h));
    const levels = keyLevels(candles);
    const last = candles[candles.length - 1]!.c;
    for (const s of levels.support) expect(s).toBeLessThan(last);
    for (const r of levels.resistance) expect(r).toBeGreaterThan(last);
  });
});

describe("sessionOf", () => {
  const utc = (h: number) => Date.UTC(2025, 0, 6, h, 0, 0); // a Monday

  it("reports the London/New York overlap in the early afternoon UTC", () => {
    expect(sessionOf(utc(14))).toBe("LONDON_NY_OVERLAP");
  });

  it("reports London in the morning", () => {
    expect(sessionOf(utc(9))).toBe("LONDON");
  });

  it("reports New York in the late afternoon", () => {
    expect(sessionOf(utc(18))).toBe("NEW_YORK");
  });

  it("reports Asia overnight", () => {
    expect(sessionOf(utc(2))).toBe("ASIA");
  });

  it("reports off-hours in the dead patch after the New York close", () => {
    expect(sessionOf(utc(22))).toBe("OFF_HOURS");
  });
});
