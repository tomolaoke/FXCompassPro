import { describe, expect, it } from "vitest";
import { DEFAULT_CLOCK_CONFIG } from "../domain/clock";
import { DEFAULT_STRATEGY_CONFIG } from "../config/strategy";
import { timeframeDef } from "../config/timeframes";
import { readTimeframe } from "./timeframe-reading";
import { buildSeries, FIXED_NOW } from "./test-helpers";

const CLOCK = DEFAULT_CLOCK_CONFIG;
const CONFIG = DEFAULT_STRATEGY_CONFIG;

describe("readTimeframe — confirmed events", () => {
  it("confirms bullish on a reclaim through 30 with a closing bullish candle", () => {
    const candles = buildSeries("M15", "CONFIRMED_BULLISH", FIXED_NOW, CLOCK);
    const result = readTimeframe("M15", candles, CONFIG, FIXED_NOW, CLOCK, false);
    expect(result.state).toBe("BULLISH");
    expect(result.stochastic?.event).toBe("CONFIRMED_BULLISH");
    expect(result.stochastic?.k).toBeGreaterThan(30);
    expect(result.stochastic?.previousK).toBeLessThanOrEqual(30);
  });

  it("confirms bearish on a break through 70 with a closing bearish candle", () => {
    const candles = buildSeries("M15", "CONFIRMED_BEARISH", FIXED_NOW, CLOCK);
    const result = readTimeframe("M15", candles, CONFIG, FIXED_NOW, CLOCK, false);
    expect(result.state).toBe("BEARISH");
    expect(result.stochastic?.event).toBe("CONFIRMED_BEARISH");
    expect(result.stochastic?.k).toBeLessThan(70);
    expect(result.stochastic?.previousK).toBeGreaterThanOrEqual(70);
  });

  it("reports NEUTRAL on a flat series with no reclaim, cross or curl", () => {
    const candles = buildSeries("M15", "FLAT", FIXED_NOW, CLOCK);
    const result = readTimeframe("M15", candles, CONFIG, FIXED_NOW, CLOCK, false);
    expect(result.state).toBe("NEUTRAL");
    expect(result.stochastic?.event).toBe("NEUTRAL");
  });

  it("works identically across every configured timeframe", () => {
    for (const tf of ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN"] as const) {
      const bull = buildSeries(tf, "CONFIRMED_BULLISH", FIXED_NOW, CLOCK);
      const result = readTimeframe(tf, bull, CONFIG, FIXED_NOW, CLOCK, false);
      expect(result.state, `${tf} should confirm bullish`).toBe("BULLISH");
    }
  });
});

describe("readTimeframe — a reclaim alone is not enough", () => {
  it("does not confirm when the closing candle disagrees with the reclaim", () => {
    // Reuse the bullish reclaim shape but flip the final candle's body so the
    // close is bearish even though %K reclaimed upward — price action must
    // agree with the Stochastic event, not just the event alone.
    const candles = buildSeries("M15", "CONFIRMED_BULLISH", FIXED_NOW, CLOCK);
    const last = candles[candles.length - 1]!;
    candles[candles.length - 1] = { ...last, o: last.c + 1, c: last.c };
    // The close is unchanged (still the reclaim value), but now o > c: bearish body.
    const result = readTimeframe("M15", candles, CONFIG, FIXED_NOW, CLOCK, false);
    expect(result.stochastic?.event).not.toBe("CONFIRMED_BULLISH");
    expect(result.state).not.toBe("BULLISH");
  });
});

describe("readTimeframe — data problems never become a direction", () => {
  it("reports DATA_MISSING with too few candles", () => {
    const result = readTimeframe(
      "M15",
      [{ t: FIXED_NOW, o: 1, h: 1, l: 1, c: 1 }],
      CONFIG,
      FIXED_NOW,
      CLOCK,
      false,
    );
    expect(result.state).toBe("DATA_MISSING");
    expect(result.stochastic).toBeNull();
  });

  it("reports DATA_MISSING when candles are undefined", () => {
    const result = readTimeframe("M15", undefined, CONFIG, FIXED_NOW, CLOCK, false);
    expect(result.state).toBe("DATA_MISSING");
  });

  it("refuses synthetic data even when it looks like a clean confirmed signal", () => {
    const candles = buildSeries("M15", "CONFIRMED_BULLISH", FIXED_NOW, CLOCK);
    const result = readTimeframe("M15", candles, CONFIG, FIXED_NOW, CLOCK, true);
    expect(result.state).toBe("DATA_MISSING");
    expect(result.explanation).toMatch(/sample data/i);
  });

  it("reports DATA_STALE when the last closed candle is older than the freshness limit", () => {
    const candles = buildSeries("M15", "CONFIRMED_BULLISH", FIXED_NOW, CLOCK);
    // Push "now" far into the future relative to the built series.
    const farFuture = FIXED_NOW + timeframeDef("M15").staleAfterMinutes * 60_000 * 5;
    const result = readTimeframe("M15", candles, CONFIG, farFuture, CLOCK, false);
    expect(result.state).toBe("DATA_STALE");
  });

  it("reports CANDLE_OPEN when the only recent candle has not closed and there is no closed history", () => {
    const def = timeframeDef("M15");
    const candles = buildSeries("M15", "FLAT", FIXED_NOW, CLOCK, def.minBars - 1);
    // Extend with one more candle that is still open as of `now`.
    const lastClosed = candles[candles.length - 1]!;
    const stillOpenT = lastClosed.t + timeframeDef("M15").minutes * 60_000;
    const withOpenBar = [...candles, { t: stillOpenT, o: 95, h: 110, l: 90, c: 95 }];
    const result = readTimeframe("M15", withOpenBar, CONFIG, stillOpenT + 60_000, CLOCK, false);
    expect(result.state).toBe("CANDLE_OPEN");
  });

  it("reports DATA_INVALID for a timestamp implausibly in the future", () => {
    const candles = buildSeries("M15", "CONFIRMED_BULLISH", FIXED_NOW, CLOCK);
    // `now` set well before the series was generated relative to itself, so
    // every candle's timestamp ends up in the future relative to `now`.
    const result = readTimeframe("M15", candles, CONFIG, FIXED_NOW - 2 * 60 * 60_000, CLOCK, false);
    expect(result.state).toBe("DATA_INVALID");
  });
});
