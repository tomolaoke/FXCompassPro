import { describe, expect, it } from "vitest";
import { compareBrokerPrice } from "./compare";

const PIP = 0.0001; // EURUSD-style

describe("compareBrokerPrice", () => {
  it("reports no mismatch when the prices agree within tolerance", () => {
    const result = compareBrokerPrice(1.085, { bid: 1.0849, ask: 1.0851, enteredAt: 0 }, PIP, 5, 0);
    expect(result.toleranceExceeded).toBe(false);
    expect(result.brokerMid).toBeCloseTo(1.085, 10);
  });

  it("flags a mismatch once the divergence exceeds the configured tolerance", () => {
    // Provider 1.0850 vs broker mid 1.0900 — 50 pips apart.
    const result = compareBrokerPrice(1.085, { bid: 1.0899, ask: 1.0901, enteredAt: 0 }, PIP, 5, 0);
    expect(result.toleranceExceeded).toBe(true);
    expect(result.differencePips).toBeCloseTo(50, 5);
  });

  it("is symmetric — direction of the divergence does not matter", () => {
    const above = compareBrokerPrice(1.09, { bid: 1.0849, ask: 1.0851, enteredAt: 0 }, PIP, 5, 0);
    const below = compareBrokerPrice(1.085, { bid: 1.0899, ask: 1.0901, enteredAt: 0 }, PIP, 5, 0);
    expect(above.toleranceExceeded).toBe(true);
    expect(below.toleranceExceeded).toBe(true);
  });

  it("reports the broker's own spread", () => {
    const result = compareBrokerPrice(1.085, { bid: 1.0848, ask: 1.0852, enteredAt: 0 }, PIP, 5, 0);
    expect(result.brokerSpread).toBeCloseTo(0.0004, 10);
  });

  it("reports how old the manually entered price is", () => {
    const result = compareBrokerPrice(
      1.085,
      { bid: 1.0849, ask: 1.0851, enteredAt: 1000 },
      PIP,
      5,
      6000,
    );
    expect(result.brokerAgeMs).toBe(5000);
  });

  it("sits exactly at the tolerance boundary without exceeding it", () => {
    // Exactly 5 pips apart, tolerance 5 — not exceeded (strictly greater-than).
    const result = compareBrokerPrice(
      1.0855,
      { bid: 1.0849, ask: 1.0851, enteredAt: 0 },
      PIP,
      5,
      0,
    );
    expect(result.toleranceExceeded).toBe(false);
  });
});
