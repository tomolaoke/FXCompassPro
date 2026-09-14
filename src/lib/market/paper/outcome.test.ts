import { describe, expect, it } from "vitest";
import { determinePaperOutcome, type PaperTradeLevels } from "./outcome";
import type { Candle } from "../types";

const c = (t: number, o: number, h: number, l: number, close: number): Candle => ({
  t,
  o,
  h,
  l,
  c: close,
});

function longTrade(overrides: Partial<PaperTradeLevels> = {}): PaperTradeLevels {
  return {
    direction: "BUY",
    entryPrice: 100,
    stopLoss: 95,
    takeProfits: [105, 110, 115],
    ...overrides,
  };
}

describe("determinePaperOutcome", () => {
  it("stays PENDING while price never reaches the stop or a target", () => {
    const candles = [c(1, 100, 102, 98, 101), c(2, 101, 103, 99, 102)];
    const result = determinePaperOutcome(longTrade(), 0, candles);
    expect(result.outcome).toBe("PENDING");
    expect(result.exitAt).toBeNull();
  });

  it("reports WIN when a target is reached", () => {
    const candles = [c(1, 100, 101, 99, 100), c(2, 101, 106, 100, 105)];
    const result = determinePaperOutcome(longTrade(), 0, candles);
    expect(result.outcome).toBe("WIN");
    expect(result.exitPrice).toBe(105);
    expect(result.rMultiple).toBeCloseTo(1, 10);
  });

  it("reports LOSS when the stop is reached", () => {
    const candles = [c(1, 100, 101, 99, 100), c(2, 100, 101, 94, 96)];
    const result = determinePaperOutcome(longTrade(), 0, candles);
    expect(result.outcome).toBe("LOSS");
    expect(result.exitPrice).toBe(95);
    expect(result.rMultiple).toBeCloseTo(-1, 10);
  });

  it("ignores candles at or before the recorded entry time", () => {
    // This candle would hit the stop, but it happened before/at entry and
    // must not be attributed to a position that did not exist yet.
    const candles = [c(0, 100, 101, 90, 95), c(5, 100, 106, 99, 105)];
    const result = determinePaperOutcome(longTrade(), 0, candles);
    expect(result.outcome).toBe("WIN");
  });

  it("defaults to the pessimistic STOP_FIRST rule on a same-candle ambiguity", () => {
    const candles = [c(1, 100, 106, 94, 100)]; // touches both stop and TP1
    const result = determinePaperOutcome(longTrade(), 0, candles);
    expect(result.outcome).toBe("LOSS");
    expect(result.exitPrice).toBe(95);
  });

  it("stays PENDING when EXCLUDE is configured and a same-candle ambiguity occurs", () => {
    const candles = [c(1, 100, 106, 94, 100)];
    const result = determinePaperOutcome(longTrade(), 0, candles, "EXCLUDE");
    expect(result.outcome).toBe("PENDING");
  });

  it("mirrors correctly for a SELL position", () => {
    const sell = longTrade({
      direction: "SELL",
      entryPrice: 100,
      stopLoss: 105,
      takeProfits: [95, 90, 85],
    });
    const candles = [c(1, 100, 101, 94, 96)];
    const result = determinePaperOutcome(sell, 0, candles);
    expect(result.outcome).toBe("WIN");
    expect(result.exitPrice).toBe(95);
  });

  it("resolves at the first bar that closes the trade, not a later one", () => {
    const candles = [
      c(1, 100, 101, 99, 100),
      c(2, 100, 106, 99, 105), // TP1 reached here
      c(3, 105, 120, 104, 119), // would also clear TP2/TP3, but the trade already closed
    ];
    const result = determinePaperOutcome(longTrade(), 0, candles);
    expect(result.exitAt).toBe(2);
    expect(result.exitPrice).toBe(105);
  });
});
