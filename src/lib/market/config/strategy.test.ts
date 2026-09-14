import { describe, expect, it } from "vitest";
import {
  DEFAULT_STRATEGY,
  DEFAULT_STRATEGY_CONFIG,
  allowsCountertrend,
  assertCoherent,
  categoryCap,
  configuredTimeframes,
  isConfigured,
  issuesPermission,
  maxScore,
  parseStrategyConfig,
  roleOf,
  strategyVersion,
  type StrategyConfig,
} from "./strategy";

/** Deep clone so a mutation in one test cannot leak into another. */
const clone = (): StrategyConfig =>
  JSON.parse(JSON.stringify(DEFAULT_STRATEGY_CONFIG)) as StrategyConfig;

describe("the default strategy", () => {
  it("is coherent", () => {
    expect(() => assertCoherent(DEFAULT_STRATEGY_CONFIG)).not.toThrow();
  });

  it("passes its own schema", () => {
    expect(() => parseStrategyConfig(DEFAULT_STRATEGY_CONFIG)).not.toThrow();
  });

  it("defaults to STRICT, not countertrend", () => {
    expect(DEFAULT_STRATEGY_CONFIG.permissionMode).toBe("STRICT");
    expect(allowsCountertrend(DEFAULT_STRATEGY_CONFIG.permissionMode)).toBe(false);
  });

  it("splits execution and context as M5-H1 against H4-MN", () => {
    expect(DEFAULT_STRATEGY_CONFIG.executionTimeframes).toEqual(["M5", "M15", "M30", "H1"]);
    expect(DEFAULT_STRATEGY_CONFIG.contextTimeframes).toEqual(["H4", "D1", "W1", "MN"]);
  });

  it("treats H4 and D1 as the decisive context filters", () => {
    expect(DEFAULT_STRATEGY_CONFIG.primaryContextFilters).toEqual(["H4", "D1"]);
  });

  it("uses the user's Stochastic 25,2,4 at 20/30/70/80", () => {
    const { momentum } = DEFAULT_STRATEGY_CONFIG;
    expect([momentum.kPeriod, momentum.slowing, momentum.dPeriod]).toEqual([25, 2, 4]);
    expect([
      momentum.deepOversold,
      momentum.oversold,
      momentum.overbought,
      momentum.deepOverbought,
    ]).toEqual([20, 30, 70, 80]);
  });

  it("requires a level cross rather than accepting a bare extreme reading", () => {
    // Stochastic stays pinned at an extreme throughout a strong trend.
    expect(DEFAULT_STRATEGY_CONFIG.momentum.requireLevelCross).toBe(true);
  });

  it("requires both location and structure to confirm", () => {
    expect(DEFAULT_STRATEGY_CONFIG.location.requireLocation).toBe(true);
    expect(DEFAULT_STRATEGY_CONFIG.structure.requireStructure).toBe(true);
  });

  it("caps a conflicted setup below the HIGH threshold", () => {
    const { conflictScoreCap, highThreshold } = DEFAULT_STRATEGY_CONFIG.scoring;
    expect(conflictScoreCap).toBeLessThan(highThreshold);
  });

  it("has category caps summing to 100", () => {
    expect(maxScore(DEFAULT_STRATEGY_CONFIG)).toBe(100);
  });

  it("stops any one category carrying the score alone", () => {
    const { categoryCaps, maxSingleCategoryShare } = DEFAULT_STRATEGY_CONFIG.scoring;
    const total = maxScore(DEFAULT_STRATEGY_CONFIG);
    for (const cap of Object.values(categoryCaps)) {
      expect(cap / total).toBeLessThanOrEqual(maxSingleCategoryShare);
    }
  });

  it("refuses synthetic data", () => {
    expect(DEFAULT_STRATEGY_CONFIG.dataQuality.rejectSyntheticData).toBe(true);
  });
});

describe("versioning", () => {
  it("is deterministic", () => {
    expect(strategyVersion(DEFAULT_STRATEGY_CONFIG)).toBe(strategyVersion(DEFAULT_STRATEGY_CONFIG));
  });

  it("ignores key order, so a reserialised config keeps its identity", () => {
    // Rebuild the object with every key order reversed, at every depth, while
    // keeping all values. Arrays keep their order: for timeframe lists and
    // R-multiples the order is meaningful, so it must affect the hash.
    const reverseKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reverseKeys);
      if (value === null || typeof value !== "object") return value;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value as Record<string, unknown>).reverse()) {
        out[key] = reverseKeys((value as Record<string, unknown>)[key]);
      }
      return out;
    };

    const reordered = reverseKeys(DEFAULT_STRATEGY_CONFIG) as StrategyConfig;
    expect(Object.keys(reordered)).not.toEqual(Object.keys(DEFAULT_STRATEGY_CONFIG));
    expect(strategyVersion(reordered)).toBe(strategyVersion(DEFAULT_STRATEGY_CONFIG));
  });

  it("changes when any tunable changes", () => {
    const before = strategyVersion(DEFAULT_STRATEGY_CONFIG);
    const config = clone();
    config.momentum.oversold = 29;
    expect(strategyVersion(config)).not.toBe(before);
  });

  it("changes when the permission mode changes", () => {
    const config = clone();
    config.permissionMode = "COUNTERTREND";
    expect(strategyVersion(config)).not.toBe(strategyVersion(DEFAULT_STRATEGY_CONFIG));
  });

  it("distinguishes timeframe order, which is meaningful", () => {
    const config = clone();
    config.contextTimeframes = ["MN", "W1", "D1", "H4"];
    expect(strategyVersion(config)).not.toBe(strategyVersion(DEFAULT_STRATEGY_CONFIG));
  });

  it("is tagged so the hashing scheme can change later without ambiguity", () => {
    expect(DEFAULT_STRATEGY.version).toMatch(/^sv1-[0-9a-f]{8}$/);
  });
});

describe("coherence checks", () => {
  const expectRejected = (mutate: (c: StrategyConfig) => void, fragment: string) => {
    const config = clone();
    mutate(config);
    expect(() => assertCoherent(config)).toThrow(new RegExp(fragment, "i"));
  };

  it("rejects inverted oversold levels", () => {
    expectRejected((c) => {
      c.momentum.deepOversold = 35;
    }, "deepOversold");
  });

  it("rejects oversold above overbought", () => {
    expectRejected((c) => {
      c.momentum.oversold = 75;
      c.momentum.deepOversold = 75;
    }, "below momentum.overbought");
  });

  it("rejects a minimum stop wider than the maximum", () => {
    expectRejected((c) => {
      c.entry.minStopAtr = 5;
      c.entry.maxStopAtr = 4;
    }, "minStopAtr");
  });

  it("rejects non-increasing targets", () => {
    expectRejected((c) => {
      c.entry.targetRMultiples = [2, 2, 4];
    }, "strictly increasing");
  });

  it("rejects a first target below the minimum risk-reward", () => {
    expectRejected((c) => {
      c.entry.targetRMultiples = [1, 2, 3];
    }, "minRiskReward");
  });

  it("rejects a conflict cap at or above the HIGH threshold", () => {
    // This is the guard that keeps a conflicted setup from being presented as
    // high quality — the exact failure the application exists to prevent.
    expectRejected((c) => {
      c.scoring.conflictScoreCap = 85;
    }, "conflictScoreCap");
  });

  it("rejects a timeframe placed in both groups", () => {
    expectRejected((c) => {
      c.contextTimeframes = ["H1", "H4", "D1", "W1"];
    }, "cannot be both execution and context");
  });

  it("rejects a primary filter that is not a context timeframe", () => {
    expectRejected((c) => {
      c.primaryContextFilters = ["M15"];
    }, "subset of contextTimeframes");
  });

  it("rejects a minimum-timeframe requirement that can never be met", () => {
    expectRejected((c) => {
      c.dataQuality.minExecutionTimeframes = 8;
    }, "minExecutionTimeframes");
  });

  it("refuses to let synthetic data be accepted", () => {
    expectRejected((c) => {
      c.dataQuality.rejectSyntheticData = false;
    }, "rejectSyntheticData");
  });

  it("accepts a legitimately different configuration", () => {
    const config = clone();
    config.permissionMode = "TREND_FOLLOWING";
    config.executionTimeframes = ["M15", "H1"];
    config.contextTimeframes = ["H4", "D1"];
    config.primaryContextFilters = ["D1"];
    config.dataQuality.minExecutionTimeframes = 2;
    config.dataQuality.minContextTimeframes = 2;
    expect(() => assertCoherent(config)).not.toThrow();
  });
});

describe("parseStrategyConfig", () => {
  it("rejects an unknown permission mode", () => {
    const config = clone() as unknown as Record<string, unknown>;
    config["permissionMode"] = "YOLO";
    expect(() => parseStrategyConfig(config)).toThrow();
  });

  it("rejects an unknown timeframe", () => {
    const config = clone() as unknown as Record<string, unknown>;
    config["executionTimeframes"] = ["M7"];
    expect(() => parseStrategyConfig(config)).toThrow();
  });

  it("rejects a missing section", () => {
    const config = clone() as unknown as Record<string, unknown>;
    delete config["momentum"];
    expect(() => parseStrategyConfig(config)).toThrow();
  });

  it("rejects an out-of-range threshold", () => {
    const config = clone();
    config.momentum.kPeriod = 0;
    expect(() => parseStrategyConfig(config)).toThrow();
  });

  it("returns a versioned strategy for valid input", () => {
    const result = parseStrategyConfig(DEFAULT_STRATEGY_CONFIG);
    expect(result.version).toBe(DEFAULT_STRATEGY.version);
    expect(result.config.permissionMode).toBe("STRICT");
  });

  it("catches an incoherent config that nonetheless satisfies the schema", () => {
    const config = clone();
    config.scoring.conflictScoreCap = 95;
    expect(() => parseStrategyConfig(config)).toThrow(/conflictScoreCap/i);
  });
});

describe("reading the config", () => {
  const config = DEFAULT_STRATEGY_CONFIG;

  it("reports configured timeframes as configured", () => {
    for (const tf of ["M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN"] as const) {
      expect(isConfigured(tf, config)).toBe(true);
    }
  });

  it("reports M1 as not configured by default", () => {
    // M1 exists so it can be charted or deliberately enabled. Outside the
    // active config it is NOT_CONFIGURED — which is what that state is for.
    expect(isConfigured("M1", config)).toBe(false);
    expect(roleOf("M1", config)).toBe("NOT_CONFIGURED");
  });

  it("assigns roles from the two groups", () => {
    expect(roleOf("M15", config)).toBe("EXECUTION");
    expect(roleOf("D1", config)).toBe("CONTEXT");
  });

  it("lists execution timeframes before context ones", () => {
    expect(configuredTimeframes(config)).toEqual([
      "M5",
      "M15",
      "M30",
      "H1",
      "H4",
      "D1",
      "W1",
      "MN",
    ]);
  });

  it("exposes per-category caps", () => {
    expect(categoryCap("MOMENTUM", config)).toBe(25);
    expect(categoryCap("VOLATILITY", config)).toBe(10);
  });
});

describe("permission modes", () => {
  it("permits countertrend only in COUNTERTREND mode", () => {
    expect(allowsCountertrend("COUNTERTREND")).toBe(true);
    for (const mode of ["STRICT", "TREND_FOLLOWING", "MANUAL"] as const) {
      expect(allowsCountertrend(mode)).toBe(false);
    }
  });

  it("issues no permission in MANUAL mode", () => {
    expect(issuesPermission("MANUAL")).toBe(false);
    for (const mode of ["STRICT", "TREND_FOLLOWING", "COUNTERTREND"] as const) {
      expect(issuesPermission(mode)).toBe(true);
    }
  });
});
