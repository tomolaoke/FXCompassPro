/**
 * Exercises the audit-trail persistence layer against a real in-memory
 * SQLite database (libsql supports `:memory:` directly — no mocking), so
 * these prove actual round-trip behaviour rather than asserting against a
 * mock's return value.
 *
 * DATABASE_URL must be set before the first `getDb()` call anywhere in this
 * process, so it is set here at module load time, before any import that
 * could transitively reach client.server.ts.
 */
process.env["DATABASE_URL"] = ":memory:";

import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CLOCK_CONFIG } from "../market/domain/clock";
import { DEFAULT_STRATEGY_CONFIG, strategyVersion } from "../market/config/strategy";
import { ALL_TIMEFRAMES } from "../market/config/timeframes";
import { evaluateSignal } from "../market/engine/evaluate";
import { buildSeries, FIXED_NOW } from "../market/engine/test-helpers";
import type { Candle, Quote } from "../market/types";
import type { Timeframe } from "../market/config/timeframes";

const CLOCK = DEFAULT_CLOCK_CONFIG;
const TEST_CONFIG = {
  ...DEFAULT_STRATEGY_CONFIG,
  location: { ...DEFAULT_STRATEGY_CONFIG.location, requireLocation: false },
  structure: { ...DEFAULT_STRATEGY_CONFIG.structure, requireStructure: false },
};

function fixtureSignal() {
  const series: Partial<Record<Timeframe, Candle[]>> = {};
  for (const tf of ALL_TIMEFRAMES)
    series[tf] = buildSeries(tf, "CONFIRMED_BULLISH", FIXED_NOW, CLOCK);
  const quote: Quote = {
    symbol: "XAUUSD",
    bid: 99.95,
    ask: 100.05,
    mid: 100,
    spread: 0.1,
    timestamp: FIXED_NOW,
    provider: "Test",
    kind: "live",
    quality: 100,
  };
  return evaluateSignal({
    symbol: "XAUUSD",
    quote,
    series,
    syntheticTimeframes: new Set(),
    provider: "TwelveData",
    config: TEST_CONFIG,
    strategyVersion: strategyVersion(TEST_CONFIG),
    risk: {
      accountCapital: 1000,
      accountCurrency: "USD",
      riskPercent: 1,
      maxDailyLossPercent: 2,
      maxOpenTrades: 1,
      maxCorrelatedExposure: 1,
      allowStacking: false,
      allowPartials: true,
      leverage: 500,
      minLot: 0.01,
      lotStep: 0.01,
      maxLot: 10,
      maxSpreadPips: 4,
      maxDataAgeMinutes: 20,
    },
    clock: CLOCK,
    now: FIXED_NOW,
  });
}

describe("signals.server — audit trail round-trip (real in-memory SQLite)", () => {
  let recordSignalAudit: typeof import("./signals.server").recordSignalAudit;
  let getSignalById: typeof import("./signals.server").getSignalById;
  let updateSignalOutcome: typeof import("./signals.server").updateSignalOutcome;
  let SignalNotFoundError: typeof import("./signals.server").SignalNotFoundError;

  beforeEach(async () => {
    const mod = await import("./signals.server");
    recordSignalAudit = mod.recordSignalAudit;
    getSignalById = mod.getSignalById;
    updateSignalOutcome = mod.updateSignalOutcome;
    SignalNotFoundError = mod.SignalNotFoundError;
  });

  it("round-trips a signal's plan values byte-for-byte through getSignalById — the fix for chart/dashboard drift", async () => {
    const signal = fixtureSignal();
    const id = await recordSignalAudit({ signal });
    const stored = await getSignalById(id);

    expect(stored).not.toBeNull();
    // These are exactly the fields a chart snapshot, the dashboard card, and
    // a paper-trade record must all agree on — this is the direct proof that
    // what gets persisted is what evaluateSignal actually produced, not a
    // rounded or independently-recomputed copy.
    expect(stored!.label).toBe(signal.label);
    expect(stored!.direction).toBe(signal.direction);
    expect(stored!.strategyVersion).toBe(signal.strategyVersion);
    expect(stored!.entryPrice).toBe(signal.entryPrice);
    expect(stored!.stopLoss).toBe(signal.stopLoss);
    expect(stored!.invalidationLevel).toBe(signal.invalidationLevel);
    expect(stored!.takeProfit1).toBe(signal.takeProfit1);
    expect(stored!.takeProfit2).toBe(signal.takeProfit2);
    expect(stored!.takeProfit3).toBe(signal.takeProfit3);
    expect(stored!.rrTp1).toBe(signal.riskRewardRatios.tp1);
    expect(stored!.rrTp2).toBe(signal.riskRewardRatios.tp2);
    expect(stored!.rrTp3).toBe(signal.riskRewardRatios.tp3);
    expect(stored!.generatedAt).toBe(signal.generatedAt);
    expect(stored!.timeframes.length).toBe(signal.timeframes.length);
    expect(stored!.timeframes.map((t) => t.state)).toEqual(signal.timeframes.map((t) => t.state));
  });

  it("returns null for an unknown id rather than throwing or otherwise leaking whether it ever existed", async () => {
    expect(await getSignalById("does-not-exist")).toBeNull();
  });

  it("updateSignalOutcome rejects an unknown id instead of silently updating zero rows", async () => {
    await expect(updateSignalOutcome({ id: "does-not-exist", outcome: "WIN" })).rejects.toThrow(
      SignalNotFoundError,
    );
  });

  it("updateSignalOutcome changes only outcome/rMultiple — every other recorded evidence field is untouched", async () => {
    const signal = fixtureSignal();
    const id = await recordSignalAudit({ signal });
    const before = await getSignalById(id);

    await updateSignalOutcome({ id, outcome: "WIN", rMultiple: 2.5 });
    const after = await getSignalById(id);

    expect(after!.outcome).toBe("WIN");
    expect(after!.rMultiple).toBe(2.5);
    // Immutable evidence: identical to what was first recorded.
    expect(after!.entryPrice).toBe(before!.entryPrice);
    expect(after!.stopLoss).toBe(before!.stopLoss);
    expect(after!.takeProfit1).toBe(before!.takeProfit1);
    expect(after!.takeProfit2).toBe(before!.takeProfit2);
    expect(after!.takeProfit3).toBe(before!.takeProfit3);
    expect(after!.strategyVersion).toBe(before!.strategyVersion);
    expect(after!.timeframesJson).toBe(before!.timeframesJson);
    expect(after!.generatedAt).toBe(before!.generatedAt);
  });
});
