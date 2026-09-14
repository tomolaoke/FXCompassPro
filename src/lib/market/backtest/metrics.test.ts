import { describe, expect, it } from "vitest";
import { computeMetrics, segmentBy } from "./metrics";
import type { BacktestTrade } from "./types";

function trade(overrides: Partial<BacktestTrade> = {}): BacktestTrade {
  return {
    direction: "BUY",
    signalGeneratedAt: 0,
    signalLabel: "FULLY ALIGNED BUY READY",
    entryAt: 0,
    entryPrice: 100,
    stopLoss: 95,
    takeProfits: [105, 110, 115],
    exitAt: 1,
    exitPrice: 105,
    exitReason: "TAKE_PROFIT_1",
    pnl: 5,
    rMultiple: 1,
    session: "LONDON",
    higherTimeframeBias: "BULLISH",
    broadContextRelation: "ALIGNED",
    ...overrides,
  };
}

describe("computeMetrics", () => {
  it("reports every field as null/zero on an empty run rather than dividing by zero", () => {
    const m = computeMetrics([]);
    expect(m.sampleSize).toBe(0);
    expect(m.winRate).toBeNull();
    expect(m.profitFactor).toBeNull();
    expect(m.expectancyR).toBeNull();
    expect(m.averageWin).toBeNull();
    expect(m.averageLoss).toBeNull();
    expect(m.netReturn).toBe(0);
  });

  it("counts unfilled signals separately from settled trades", () => {
    const trades = [
      trade(),
      trade({
        entryAt: null,
        entryPrice: null,
        exitAt: null,
        exitPrice: null,
        pnl: null,
        rMultiple: null,
        exitReason: "EXPIRED_UNFILLED",
      }),
    ];
    const m = computeMetrics(trades);
    expect(m.sampleSize).toBe(2);
    expect(m.filledCount).toBe(1);
    expect(m.unfilledCount).toBe(1);
  });

  it("computes win rate over settled trades only", () => {
    const trades = [
      trade({ pnl: 5 }),
      trade({ pnl: 3 }),
      trade({ pnl: -2 }),
      trade({ entryAt: null, pnl: null, exitReason: "EXPIRED_UNFILLED" }),
    ];
    const m = computeMetrics(trades);
    expect(m.winRate).toBeCloseTo(2 / 3, 10);
  });

  it("computes gross profit, gross loss and profit factor", () => {
    const trades = [
      trade({ pnl: 10 }),
      trade({ pnl: 20 }),
      trade({ pnl: -5 }),
      trade({ pnl: -10 }),
    ];
    const m = computeMetrics(trades);
    expect(m.grossProfit).toBe(30);
    expect(m.grossLoss).toBe(15);
    expect(m.profitFactor).toBe(2);
    expect(m.netReturn).toBe(15);
  });

  it("returns a null profit factor when there are no losses to divide by", () => {
    const m = computeMetrics([trade({ pnl: 10 }), trade({ pnl: 5 })]);
    expect(m.profitFactor).toBeNull();
  });

  it("computes expectancy as the mean R-multiple", () => {
    const trades = [trade({ rMultiple: 2 }), trade({ rMultiple: -1 }), trade({ rMultiple: 1 })];
    const m = computeMetrics(trades);
    expect(m.expectancyR).toBeCloseTo((2 - 1 + 1) / 3, 10);
  });

  it("computes maximum drawdown from the equity curve, not just the total loss", () => {
    // Equity path: 0 -> 10 -> 4 -> 12. Peak-to-trough is 10 -> 4 = 6, even
    // though the run ends up net positive.
    const trades = [trade({ pnl: 10 }), trade({ pnl: -6 }), trade({ pnl: 8 })];
    const m = computeMetrics(trades);
    expect(m.maxDrawdown).toBe(6);
  });

  it("computes the longest losing streak, resetting on any win", () => {
    const trades = [
      trade({ pnl: 1 }),
      trade({ pnl: -1 }),
      trade({ pnl: -1 }),
      trade({ pnl: -1 }),
      trade({ pnl: 1 }),
      trade({ pnl: -1 }),
    ];
    const m = computeMetrics(trades);
    expect(m.maxLosingStreak).toBe(3);
  });

  it("withholds the Sharpe-like ratio below the minimum sample size", () => {
    const trades = Array.from({ length: 10 }, () => trade({ rMultiple: 1 }));
    const m = computeMetrics(trades);
    expect(m.sharpeLike).toBeNull();
  });

  it("computes a Sharpe-like ratio once the minimum sample size is reached", () => {
    const trades = Array.from({ length: 25 }, (_, i) =>
      trade({ rMultiple: i % 2 === 0 ? 1 : -0.5 }),
    );
    const m = computeMetrics(trades);
    expect(m.sharpeLike).not.toBeNull();
  });

  it("never presents a zero-variance sample as an infinite ratio", () => {
    const trades = Array.from({ length: 25 }, () => trade({ rMultiple: 1 }));
    const m = computeMetrics(trades);
    expect(m.sharpeLike).toBeNull();
  });
});

describe("segmentBy", () => {
  it("splits trades into independent metric buckets by session", () => {
    const trades = [
      trade({ session: "LONDON", pnl: 10 }),
      trade({ session: "LONDON", pnl: -5 }),
      trade({ session: "NEW_YORK", pnl: 20 }),
    ];
    const segments = segmentBy(trades, "session");
    expect(segments["LONDON"]!.sampleSize).toBe(2);
    expect(segments["NEW_YORK"]!.sampleSize).toBe(1);
    expect(segments["NEW_YORK"]!.netReturn).toBe(20);
  });

  it("segments by higher-timeframe agreement, the split the app is built around", () => {
    const trades = [
      trade({ broadContextRelation: "ALIGNED", pnl: 10 }),
      trade({ broadContextRelation: "ALIGNED", pnl: 8 }),
      trade({ broadContextRelation: "CONFLICTING", pnl: -10 }),
      trade({ broadContextRelation: "CONFLICTING", pnl: -8 }),
    ];
    const segments = segmentBy(trades, "broadContextRelation");
    expect(segments["ALIGNED"]!.winRate).toBe(1);
    expect(segments["CONFLICTING"]!.winRate).toBe(0);
  });
});
