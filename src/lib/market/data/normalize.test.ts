import { describe, expect, it } from "vitest";
import { normalizeCandles, splitWeekendGaps } from "./normalize";
import type { Candle } from "../types";

const HOUR = 3_600_000;

function candle(t: number, o = 100, h = 101, l = 99, c = 100): Candle {
  return { t, o, h, l, c };
}

describe("normalizeCandles — ordering", () => {
  it("sorts out-of-order candles", () => {
    const input = [candle(3 * HOUR), candle(1 * HOUR), candle(2 * HOUR)];
    const result = normalizeCandles(input, HOUR);
    expect(result.candles.map((c) => c.t)).toEqual([HOUR, 2 * HOUR, 3 * HOUR]);
    expect(result.reordered).toBe(true);
  });

  it("reports no reordering when already sorted", () => {
    const input = [candle(1 * HOUR), candle(2 * HOUR), candle(3 * HOUR)];
    const result = normalizeCandles(input, HOUR);
    expect(result.reordered).toBe(false);
  });
});

describe("normalizeCandles — duplicates", () => {
  it("removes an exact duplicate timestamp, keeping the later value", () => {
    const input = [candle(1 * HOUR, 100, 101, 99, 100), candle(1 * HOUR, 100, 102, 98, 101)];
    const result = normalizeCandles(input, HOUR);
    expect(result.candles).toHaveLength(1);
    expect(result.candles[0]!.c).toBe(101);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it("removes duplicates that arrive out of order", () => {
    const input = [candle(2 * HOUR), candle(1 * HOUR), candle(1 * HOUR)];
    const result = normalizeCandles(input, HOUR);
    expect(result.candles).toHaveLength(2);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it("counts several duplicates of the same bar correctly", () => {
    const input = [candle(HOUR), candle(HOUR), candle(HOUR)];
    const result = normalizeCandles(input, HOUR);
    expect(result.candles).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(2);
  });
});

describe("normalizeCandles — OHLC sanity", () => {
  it("drops a candle whose high is below its open", () => {
    const bad = candle(HOUR, 100, 99, 90, 95); // h < o
    const result = normalizeCandles([candle(0), bad, candle(2 * HOUR)], HOUR);
    expect(result.candles.map((c) => c.t)).toEqual([0, 2 * HOUR]);
    expect(result.invalidDropped).toBe(1);
  });

  it("drops a candle whose low is above its close", () => {
    const bad = candle(HOUR, 100, 105, 102, 100); // l > c
    const result = normalizeCandles([candle(0), bad], HOUR);
    expect(result.invalidDropped).toBe(1);
  });

  it("drops a candle with a non-finite value", () => {
    const bad = { t: HOUR, o: 100, h: Number.NaN, l: 99, c: 100 };
    const result = normalizeCandles([candle(0), bad], HOUR);
    expect(result.invalidDropped).toBe(1);
  });

  it("keeps a doji (open equals close)", () => {
    const doji = candle(HOUR, 100, 101, 99, 100);
    const result = normalizeCandles([doji], HOUR);
    expect(result.invalidDropped).toBe(0);
    expect(result.candles).toHaveLength(1);
  });

  it("surfaces the resulting hole as a gap once the invalid candle is dropped", () => {
    // Dropping the invalid bar leaves real 2x spacing between its neighbours —
    // the data is genuinely missing there now, so it must be reported as a
    // gap rather than silently absorbed by the drop.
    const bad = candle(HOUR, 100, 99, 90, 95);
    const result = normalizeCandles([candle(0), bad, candle(2 * HOUR)], HOUR);
    expect(result.invalidDropped).toBe(1);
    expect(result.gaps).toEqual([{ afterT: 0, beforeT: 2 * HOUR, missingBars: 1 }]);
  });
});

describe("normalizeCandles — gap detection", () => {
  it("detects no gap for perfectly regular spacing", () => {
    const input = [candle(0), candle(HOUR), candle(2 * HOUR), candle(3 * HOUR)];
    expect(normalizeCandles(input, HOUR).gaps).toEqual([]);
  });

  it("detects a gap when spacing exceeds 1.5x the expected interval", () => {
    const input = [candle(0), candle(5 * HOUR)];
    const result = normalizeCandles(input, HOUR);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]).toEqual({ afterT: 0, beforeT: 5 * HOUR, missingBars: 4 });
  });

  it("reports a gap of one missing bar at exactly 2x the expected spacing", () => {
    // 2x spacing is past the 1.5x threshold, so even a single skipped bar
    // must be surfaced rather than silently tolerated.
    const input = [candle(0), candle(2 * HOUR)];
    const result = normalizeCandles(input, HOUR);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]!.missingBars).toBe(1);
  });

  it("reports multiple gaps across a series", () => {
    const input = [
      candle(0),
      candle(HOUR),
      candle(10 * HOUR),
      candle(11 * HOUR),
      candle(20 * HOUR),
    ];
    const result = normalizeCandles(input, HOUR);
    expect(result.gaps).toHaveLength(2);
  });
});

describe("normalizeCandles — empty and trivial input", () => {
  it("handles an empty array", () => {
    const result = normalizeCandles([], HOUR);
    expect(result.candles).toEqual([]);
    expect(result.gaps).toEqual([]);
    expect(result.duplicatesRemoved).toBe(0);
    expect(result.invalidDropped).toBe(0);
  });

  it("handles a single candle", () => {
    const result = normalizeCandles([candle(0)], HOUR);
    expect(result.candles).toHaveLength(1);
    expect(result.gaps).toEqual([]);
  });
});

describe("splitWeekendGaps", () => {
  const TZ = "UTC";
  // Friday 21:00 UTC, 5 January 2024, to Monday 00:00 UTC, 8 January 2024.
  const fridayClose = Date.UTC(2024, 0, 5, 21, 0, 0);
  const mondayOpen = Date.UTC(2024, 0, 8, 0, 0, 0);

  it("classifies a Friday-to-Monday gap as a weekend close", () => {
    const gap = { afterT: fridayClose, beforeT: mondayOpen, missingBars: 100 };
    const { weekend, unexplained } = splitWeekendGaps([gap], TZ);
    expect(weekend).toHaveLength(1);
    expect(unexplained).toHaveLength(0);
  });

  it("classifies a Friday-to-Sunday gap as a weekend close", () => {
    const sundayOpen = Date.UTC(2024, 0, 7, 22, 0, 0);
    const gap = { afterT: fridayClose, beforeT: sundayOpen, missingBars: 90 };
    const { weekend } = splitWeekendGaps([gap], TZ);
    expect(weekend).toHaveLength(1);
  });

  it("does not classify a midweek gap as a weekend close", () => {
    const tuesday = Date.UTC(2024, 0, 9, 12, 0, 0);
    const wednesday = Date.UTC(2024, 0, 10, 12, 0, 0);
    const gap = { afterT: tuesday, beforeT: wednesday, missingBars: 5 };
    const { unexplained } = splitWeekendGaps([gap], TZ);
    expect(unexplained).toHaveLength(1);
  });

  it("preserves gap order across both buckets", () => {
    const midweek = {
      afterT: Date.UTC(2024, 0, 9),
      beforeT: Date.UTC(2024, 0, 10),
      missingBars: 1,
    };
    const weekendGap = { afterT: fridayClose, beforeT: mondayOpen, missingBars: 100 };
    const { weekend, unexplained } = splitWeekendGaps([midweek, weekendGap], TZ);
    expect(unexplained).toEqual([midweek]);
    expect(weekend).toEqual([weekendGap]);
  });
});
