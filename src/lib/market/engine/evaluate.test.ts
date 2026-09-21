import { describe, expect, it } from "vitest";
import { bucketStart, DEFAULT_CLOCK_CONFIG } from "../domain/clock";
import { DEFAULT_STRATEGY_CONFIG, strategyVersion, type StrategyConfig } from "../config/strategy";
import { ALL_TIMEFRAMES, timeframeDef, type Timeframe } from "../config/timeframes";
import type { Candle, Quote, RiskSettings } from "../types";
import { evaluateSignal, type EvaluateInput } from "./evaluate";
import { buildSeries, FIXED_NOW, type SeriesShape } from "./test-helpers";

const CLOCK = DEFAULT_CLOCK_CONFIG;

/**
 * These tests exercise the direction/relation/label/permission pipeline, not
 * the location and structure detectors — those are separate pure functions in
 * structure.ts with their own responsibility. The deterministic fixture below
 * holds every candle's high/low constant so %K is exactly predictable, which
 * as a side effect makes every candle look identical to the swing detector
 * (no bar's high or low is ever strictly greater/less than its neighbours), so
 * no swing, level or structure confirmation can ever be found in it. Requiring
 * location/structure confirmation here would therefore test the fixture's
 * flatness, not the orchestration logic. Both requirements are covered on
 * real market data by the position-size and level tests once Phase 6 lands.
 */
const TEST_CONFIG: StrategyConfig = {
  ...DEFAULT_STRATEGY_CONFIG,
  location: { ...DEFAULT_STRATEGY_CONFIG.location, requireLocation: false },
  structure: { ...DEFAULT_STRATEGY_CONFIG.structure, requireStructure: false },
};

const RISK: RiskSettings = {
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
};

function quote(mid = 100): Quote {
  return {
    symbol: "XAUUSD",
    bid: mid - 0.05,
    ask: mid + 0.05,
    mid,
    spread: 0.1,
    timestamp: FIXED_NOW,
    provider: "Test",
    kind: "live",
    quality: 100,
  };
}

/** Builds a full nine-timeframe series where every timeframe has the same shape. */
function uniformSeries(shape: SeriesShape): Partial<Record<Timeframe, Candle[]>> {
  const series: Partial<Record<Timeframe, Candle[]>> = {};
  for (const tf of ALL_TIMEFRAMES) series[tf] = buildSeries(tf, shape, FIXED_NOW, CLOCK);
  return series;
}

/** Builds a series where the given timeframes get one shape and the rest another. */
function mixedSeries(
  overrides: Partial<Record<Timeframe, SeriesShape>>,
  fallback: SeriesShape,
): Partial<Record<Timeframe, Candle[]>> {
  const series: Partial<Record<Timeframe, Candle[]>> = {};
  for (const tf of ALL_TIMEFRAMES) {
    series[tf] = buildSeries(tf, overrides[tf] ?? fallback, FIXED_NOW, CLOCK);
  }
  return series;
}

function baseInput(overrides: Partial<EvaluateInput> = {}): EvaluateInput {
  const config: StrategyConfig = overrides.config ?? TEST_CONFIG;
  return {
    symbol: "XAUUSD",
    quote: quote(),
    series: uniformSeries("CONFIRMED_BULLISH"),
    syntheticTimeframes: new Set(),
    provider: "TwelveData",
    config,
    strategyVersion: strategyVersion(config),
    risk: RISK,
    clock: CLOCK,
    now: FIXED_NOW,
    ...overrides,
  };
}

describe("fully aligned", () => {
  it("produces FULLY ALIGNED BUY READY when every timeframe agrees", () => {
    const signal = evaluateSignal(baseInput());
    expect(signal.label).toBe("FULLY ALIGNED BUY READY");
    expect(signal.direction).toBe("BUY");
    expect(signal.readiness).toBe("READY");
    expect(signal.broadContextRelation).toBe("ALIGNED");
    expect(signal.shortTermDirection).toBe("BULLISH");
    expect(signal.higherTimeframeBias).toBe("BULLISH");
  });

  it("produces FULLY ALIGNED SELL READY when every timeframe agrees bearishly", () => {
    const signal = evaluateSignal(baseInput({ series: uniformSeries("CONFIRMED_BEARISH") }));
    expect(signal.label).toBe("FULLY ALIGNED SELL READY");
    expect(signal.direction).toBe("SELL");
  });

  it("includes all nine timeframes in the evidence, not a subset", () => {
    const signal = evaluateSignal(baseInput());
    const seen = signal.timeframes.map((t) => t.timeframe).sort();
    expect(seen).toEqual([...ALL_TIMEFRAMES].sort());
  });

  it("never lets M5 or M1 appear as directional evidence", () => {
    // Even in a fully-aligned fixture, M5 and M1 are ENTRY_CONFIRMATION and
    // EXECUTION_TRIGGER — they must not be counted among the timeframes that
    // decided shortTermDirection or higherTimeframeBias.
    const signal = evaluateSignal(baseInput());
    const m5 = signal.timeframes.find((t) => t.timeframe === "M5")!;
    const m1 = signal.timeframes.find((t) => t.timeframe === "M1")!;
    expect(m5.role).toBe("ENTRY_CONFIRMATION");
    expect(m1.role).toBe("EXECUTION_TRIGGER");
  });

  it("produces a valid, tradeable set of levels", () => {
    const signal = evaluateSignal(baseInput());
    expect(signal.entryPrice).not.toBeNull();
    expect(signal.stopLoss).not.toBeNull();
    expect(signal.takeProfit1).not.toBeNull();
    expect(signal.calculationErrors).toEqual([]);
    expect(signal.riskRewardRatios.tp1).not.toBeNull();
  });
});

describe("THE REGRESSION LOCK — short-term bullish, higher timeframes bearish", () => {
  // This is the exact defect the rewrite exists to fix: a short-term BUY must
  // never be presented as a plain, unqualified BUY when the broader picture
  // disagrees.
  function conflictedInput(config?: StrategyConfig) {
    return baseInput({
      ...(config ? { config, strategyVersion: strategyVersion(config) } : {}),
      series: mixedSeries(
        {
          MN: "CONFIRMED_BEARISH",
          W1: "CONFIRMED_BEARISH",
          D1: "CONFIRMED_BEARISH",
          H4: "CONFIRMED_BEARISH",
        },
        "CONFIRMED_BULLISH",
      ),
    });
  }

  it("never produces a plain BUY label", () => {
    const signal = evaluateSignal(conflictedInput());
    expect(signal.label).not.toBe("BUY");
    expect(signal.label).not.toContain("FULLY ALIGNED");
  });

  it("reports the short-term direction as bullish and the higher-timeframe bias as bearish, separately", () => {
    const signal = evaluateSignal(conflictedInput());
    expect(signal.shortTermDirection).toBe("BULLISH");
    expect(signal.higherTimeframeBias).toBe("BEARISH");
  });

  it("marks MN, W1, D1 and H4 as CONFLICTING rather than hiding them", () => {
    const signal = evaluateSignal(conflictedInput());
    for (const tf of ["MN", "W1", "D1", "H4"] as const) {
      const reading = signal.timeframes.find((t) => t.timeframe === tf)!;
      expect(reading.relation, `${tf} should be CONFLICTING`).toBe("CONFLICTING");
      expect(reading.state).toBe("BEARISH");
    }
  });

  it("blocks progress under TREND_FOLLOWING because D1/H4 (primary context) disagree", () => {
    // The default mode requires agreement with D1/H4 specifically.
    const signal = evaluateSignal(conflictedInput());
    expect(signal.readiness).not.toBe("READY");
    expect(signal.blockReasons).toContain("HTF_CONFLICT");
  });

  it("is held at WAIT under STRICT mode, which refuses any MN/W1 conflict too", () => {
    const strict: StrategyConfig = { ...TEST_CONFIG, permissionMode: "STRICT" };
    const signal = evaluateSignal(conflictedInput(strict));
    expect(signal.readiness).toBe("WATCH");
    expect(signal.label).toBe("WATCH — POTENTIAL BUY");
  });

  it("never shows a HIGH quality score for a conflicted setup", () => {
    const signal = evaluateSignal(conflictedInput());
    expect(signal.score.label).not.toBe("HIGH");
    expect(signal.score.value).toBeLessThanOrEqual(
      DEFAULT_STRATEGY_CONFIG.scoring.conflictScoreCap,
    );
  });

  it("still reports the heuristic score as a heuristic, never a probability", () => {
    const signal = evaluateSignal(conflictedInput());
    expect(signal.score.isHeuristic).toBe(true);
  });
});

describe("BLOCKER FIX — execution trigger requires a confirmed event", () => {
  it("never reaches READY off a bare threshold reclaim with no closed-candle confirmation", () => {
    // M1 gets a real Stochastic event (a genuine reclaim through the oversold
    // level) but the closing candle is red, so it is NOT a CONFIRMED_BULLISH
    // event — only THRESHOLD_RECLAIM_UP, which must never trigger READY.
    const signal = evaluateSignal(
      baseInput({ series: mixedSeries({ M1: "RECLAIM_ONLY_BULLISH" }, "CONFIRMED_BULLISH") }),
    );
    const m1 = signal.timeframes.find((t) => t.timeframe === "M1")!;
    expect(m1.stochastic?.event).toBe("THRESHOLD_RECLAIM_UP");
    expect(signal.readiness).not.toBe("READY");
    expect(signal.label).not.toContain("READY");
  });

  it("still reaches READY when the trigger timeframe is genuinely CONFIRMED (control)", () => {
    const signal = evaluateSignal(baseInput());
    expect(signal.readiness).toBe("READY");
  });
});

describe("BLOCKER FIX — missing M5 entry confirmation blocks READY", () => {
  it("holds at SETUP when the entry-confirmation timeframe has not confirmed", () => {
    const signal = evaluateSignal(
      baseInput({ series: mixedSeries({ M5: "FLAT" }, "CONFIRMED_BULLISH") }),
    );
    expect(signal.readiness).not.toBe("READY");
  });
});

describe("BLOCKER FIX — an open M1 candle blocks READY", () => {
  it("holds at SETUP when the execution-trigger candle has not closed", () => {
    const minBars = timeframeDef("M1").minBars;
    // One bar short of the minimum, so trimming the still-open final candle
    // (below) leaves too little closed history — exactly readTimeframe's
    // CANDLE_OPEN path.
    const closed = buildSeries("M1", "CONFIRMED_BULLISH", FIXED_NOW, CLOCK, minBars - 1);
    const openCandle: Candle = {
      t: bucketStart(FIXED_NOW, "M1", CLOCK),
      o: 100,
      h: 110,
      l: 90,
      c: 109,
    };
    const series = { ...uniformSeries("CONFIRMED_BULLISH"), M1: [...closed, openCandle] };

    const signal = evaluateSignal(baseInput({ series }));
    const m1 = signal.timeframes.find((t) => t.timeframe === "M1")!;
    expect(m1.state).toBe("CANDLE_OPEN");
    expect(signal.readiness).not.toBe("READY");
  });
});

describe("BLOCKER FIX — backtest/live look-ahead: computeLevels never reads an open execution candle", () => {
  it("produces identical levels whether or not an open, extreme candle is appended to the execution timeframe", () => {
    // pickExecutionTimeframe chooses M15 first (fastest OPERATIONAL timeframe
    // with data) under the default role config used by baseInput/TEST_CONFIG.
    const baseline = evaluateSignal(baseInput());

    const spike: Candle = {
      t: bucketStart(FIXED_NOW, "M15", CLOCK),
      o: 100,
      h: 10_000,
      l: -10_000,
      c: 5_000,
    };
    const withOpenSpike = {
      ...uniformSeries("CONFIRMED_BULLISH"),
      M15: [...uniformSeries("CONFIRMED_BULLISH").M15!, spike],
    };
    const withSpike = evaluateSignal(baseInput({ series: withOpenSpike }));

    // If the open spike leaked into computeLevels, ATR/structural high-low
    // would blow out and every one of these would differ from the baseline.
    expect(withSpike.entryZone).toEqual(baseline.entryZone);
    expect(withSpike.stopLoss).toEqual(baseline.stopLoss);
    expect(withSpike.invalidationLevel).toEqual(baseline.invalidationLevel);
    expect(withSpike.takeProfit1).toEqual(baseline.takeProfit1);
    expect(withSpike.takeProfit2).toEqual(baseline.takeProfit2);
    expect(withSpike.takeProfit3).toEqual(baseline.takeProfit3);
    expect(withSpike.readiness).toBe("READY");
  });
});

describe("BLOCKER FIX — a data problem on one sibling must not read as NEUTRAL", () => {
  it("reports UNAVAILABLE, not NEUTRAL, when W1 is stale but MN agrees", () => {
    // MN bullish (AGREEING); W1 present but stale (past its freshness
    // limit) — a real data problem, not a genuine neutral reading.
    const w1Series = buildSeries("W1", "CONFIRMED_BULLISH", FIXED_NOW, CLOCK);
    const staleAgeMs = (timeframeDef("W1").staleAfterMinutes + 60) * 60_000;
    const staleW1 = w1Series.map((c) => ({ ...c, t: c.t - staleAgeMs }));
    const series = { ...uniformSeries("CONFIRMED_BULLISH"), W1: staleW1 };

    const signal = evaluateSignal(baseInput({ series }));
    const w1 = signal.timeframes.find((t) => t.timeframe === "W1")!;
    expect(w1.state).toBe("DATA_STALE");
    expect(signal.broadContextRelation).toBe("UNAVAILABLE");
    expect(signal.broadContextRelation).not.toBe("NEUTRAL");
    expect(signal.notFullyAlignedReason).toContain("unavailable");
  });
});

describe("readiness freshness — separate from, and tighter than, any display/cache bound", () => {
  // config/timeframes.ts's staleAfterMinutes (M1: 5min, M5: 20min) is the
  // ONLY thing that decides whether a candle is fresh enough to feed a READY
  // signal — it is independent of, and much tighter than, the display-only
  // stale-cache-fallback bound in market.server.ts (M1: 30min, M5: 1h). This
  // proves that mechanism actually blocks READY end-to-end.
  it("never reaches READY when M1's last closed candle is past its 5-minute readiness limit", () => {
    const staleAgeMs = (timeframeDef("M1").staleAfterMinutes + 1) * 60_000;
    const m1 = buildSeries("M1", "CONFIRMED_BULLISH", FIXED_NOW, CLOCK).map((c) => ({
      ...c,
      t: c.t - staleAgeMs,
    }));
    const signal = evaluateSignal(
      baseInput({ series: { ...uniformSeries("CONFIRMED_BULLISH"), M1: m1 } }),
    );
    const m1Reading = signal.timeframes.find((t) => t.timeframe === "M1")!;
    expect(m1Reading.state).toBe("DATA_STALE");
    expect(signal.readiness).not.toBe("READY");
  });

  it("never reaches READY when M5's last closed candle is past its 20-minute readiness limit", () => {
    const staleAgeMs = (timeframeDef("M5").staleAfterMinutes + 1) * 60_000;
    const m5 = buildSeries("M5", "CONFIRMED_BULLISH", FIXED_NOW, CLOCK).map((c) => ({
      ...c,
      t: c.t - staleAgeMs,
    }));
    const signal = evaluateSignal(
      baseInput({ series: { ...uniformSeries("CONFIRMED_BULLISH"), M5: m5 } }),
    );
    const m5Reading = signal.timeframes.find((t) => t.timeframe === "M5")!;
    expect(m5Reading.state).toBe("DATA_STALE");
    expect(signal.readiness).not.toBe("READY");
  });
});

describe("market closed", () => {
  /** A Saturday — broker server week is Mon 00:00 to Fri 24:00, so this is closed. */
  const CLOSED_NOW = Date.UTC(2025, 6, 19, 12, 0, 0);

  function closedSeries(shape: SeriesShape): Partial<Record<Timeframe, Candle[]>> {
    const series: Partial<Record<Timeframe, Candle[]>> = {};
    for (const tf of ALL_TIMEFRAMES) series[tf] = buildSeries(tf, shape, CLOSED_NOW, CLOCK);
    return series;
  }

  it("holds an otherwise-fully-aligned setup at WATCH while the market is closed", () => {
    const signal = evaluateSignal(
      baseInput({
        now: CLOSED_NOW,
        series: closedSeries("CONFIRMED_BULLISH"),
        quote: { ...quote(), timestamp: CLOSED_NOW },
      }),
    );
    expect(signal.session).toBe("CLOSED");
    expect(signal.readiness).not.toBe("READY");
    expect(signal.readiness).toBe("WATCH");
    expect(signal.label).not.toContain("READY");
    expect(signal.blockReasons).toContain("MARKET_CLOSED");
  });

  it("still reports direction and higher-timeframe bias while closed — never hides them", () => {
    const signal = evaluateSignal(
      baseInput({
        now: CLOSED_NOW,
        series: closedSeries("CONFIRMED_BULLISH"),
        quote: { ...quote(), timestamp: CLOSED_NOW },
      }),
    );
    expect(signal.direction).toBe("BUY");
    expect(signal.shortTermDirection).toBe("BULLISH");
    expect(signal.higherTimeframeBias).toBe("BULLISH");
  });
});

describe("countertrend labelling when only the broad context disagrees", () => {
  it("labels a READY setup as countertrend when MN/W1 conflict but D1/H4 agree", () => {
    const signal = evaluateSignal(
      baseInput({
        series: mixedSeries(
          { MN: "CONFIRMED_BEARISH", W1: "CONFIRMED_BEARISH" },
          "CONFIRMED_BULLISH",
        ),
      }),
    );
    expect(signal.readiness).toBe("READY");
    expect(signal.broadContextRelation).toBe("CONFLICTING");
    expect(signal.label).toBe("BUY READY — COUNTERTREND WARNING");
    expect(signal.notFullyAlignedReason).toMatch(/countertrend/i);
  });
});

describe("the countertrend hard block", () => {
  it("blocks a trade-ready state when broad and primary context both strongly oppose with no reversal structure", () => {
    // Every higher timeframe opposes and no reversal timeframe is confirming a
    // turn — the "falling knife" case the hard block exists for.
    const signal = evaluateSignal(
      baseInput({
        series: mixedSeries(
          {
            MN: "CONFIRMED_BEARISH",
            W1: "CONFIRMED_BEARISH",
            D1: "CONFIRMED_BEARISH",
            H4: "CONFIRMED_BEARISH",
          },
          "CONFIRMED_BULLISH",
        ),
      }),
    );
    expect(signal.countertrendBlocked).toBe(true);
    expect(signal.countertrendBlockReason).not.toBeNull();
    expect(signal.readiness).not.toBe("READY");
  });

  it("lifts the block when a confirmed reversal shows on D1 or H4", () => {
    // D1 confirms the reversal (agrees with the short-term direction) while
    // MN, W1 and H4 still oppose — the documented exception.
    const signal = evaluateSignal(
      baseInput({
        series: mixedSeries(
          {
            MN: "CONFIRMED_BEARISH",
            W1: "CONFIRMED_BEARISH",
            H4: "CONFIRMED_BEARISH",
            D1: "CONFIRMED_BULLISH",
          },
          "CONFIRMED_BULLISH",
        ),
      }),
    );
    // D1 now agrees, so opposingPrimaryContext drops to 1 (H4 only) — already
    // below the minOpposingPrimaryContext threshold of 2, so the hard block's
    // preconditions are not even met. Confirms the exception path is reachable.
    expect(signal.countertrendBlocked).toBe(false);
  });
});

describe("insufficient data", () => {
  it("reports INSUFFICIENT DATA when too few operational timeframes are usable", () => {
    const config: StrategyConfig = {
      ...TEST_CONFIG,
      dataQuality: { ...TEST_CONFIG.dataQuality, minShortTermTimeframes: 3 },
    };
    const series = uniformSeries("CONFIRMED_BULLISH");
    // Strip two of the three OPERATIONAL timeframes down to nothing usable.
    delete series.H1;
    delete series.M30;
    const signal = evaluateSignal(
      baseInput({ config, strategyVersion: strategyVersion(config), series }),
    );
    expect(signal.label).toBe("INSUFFICIENT DATA");
  });
});

describe("synthetic data", () => {
  it("never reaches READY when the entry or trigger timeframe is synthetic", () => {
    const signal = evaluateSignal(baseInput({ syntheticTimeframes: new Set<Timeframe>(["M5"]) }));
    expect(signal.readiness).not.toBe("READY");
  });

  it("still shows a full nine-timeframe matrix labelled synthetic, not hidden", () => {
    const signal = evaluateSignal(baseInput({ syntheticTimeframes: new Set<Timeframe>(["M5"]) }));
    const m5 = signal.timeframes.find((t) => t.timeframe === "M5")!;
    expect(m5.isSynthetic).toBe(true);
    expect(m5.state).toBe("DATA_MISSING");
  });

  it("blocks a whole-series synthetic fallback from ever producing FULLY ALIGNED", () => {
    const signal = evaluateSignal(
      baseInput({ syntheticTimeframes: new Set<Timeframe>(ALL_TIMEFRAMES) }),
    );
    expect(signal.label).not.toContain("READY");
    expect(signal.direction).toBeNull();
  });
});

describe("no plain BUY or SELL, ever", () => {
  it("never returns the bare word BUY or SELL as the label in any fixture", () => {
    const fixtures: EvaluateInput[] = [
      baseInput(),
      baseInput({ series: uniformSeries("CONFIRMED_BEARISH") }),
      baseInput({ series: uniformSeries("FLAT") }),
      baseInput({
        config: { ...TEST_CONFIG, permissionMode: "STRICT" },
        series: mixedSeries({ MN: "CONFIRMED_BEARISH" }, "CONFIRMED_BULLISH"),
      }),
    ];
    for (const input of fixtures) {
      const signal = evaluateSignal(input);
      expect(signal.label).not.toBe("BUY");
      expect(signal.label).not.toBe("SELL");
    }
  });
});

describe("manual mode", () => {
  it("never issues a READY permission in MANUAL mode", () => {
    const config: StrategyConfig = { ...TEST_CONFIG, permissionMode: "MANUAL" };
    const signal = evaluateSignal(baseInput({ config, strategyVersion: strategyVersion(config) }));
    expect(signal.readiness).not.toBe("READY");
  });
});

describe("audit trail", () => {
  it("stamps every signal with the exact strategy version used to produce it", () => {
    const signal = evaluateSignal(baseInput());
    expect(signal.strategyVersion).toBe(strategyVersion(TEST_CONFIG));
  });

  it("carries a reason for every warning it raises", () => {
    const signal = evaluateSignal(
      baseInput({ series: mixedSeries({ MN: "CONFIRMED_BEARISH" }, "CONFIRMED_BULLISH") }),
    );
    expect(signal.warnings.length).toBeGreaterThan(0);
    for (const warning of signal.warnings) {
      expect(typeof warning).toBe("string");
      expect(warning.length).toBeGreaterThan(0);
    }
  });
});
