import { describe, expect, it } from "vitest";
import {
  DEFAULT_STRATEGY,
  DEFAULT_STRATEGY_CONFIG,
  allowsCountertrend,
  assertCoherent,
  broadContextTimeframes,
  categoryCap,
  configuredTimeframes,
  directionalTimeframes,
  higherTimeframes,
  isConfigured,
  isDirectionalRole,
  issuesPermission,
  maxScore,
  parseStrategyConfig,
  primaryContextTimeframes,
  roleOf,
  shortTermTimeframes,
  strategyVersion,
  timeframesInRole,
  type StrategyConfig,
} from "./strategy";
import { ALL_TIMEFRAMES } from "./timeframes";

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

  it("analyses and uses all nine timeframes", () => {
    const configured = configuredTimeframes(DEFAULT_STRATEGY_CONFIG);
    expect(configured).toHaveLength(9);
    for (const tf of ALL_TIMEFRAMES) {
      expect(isConfigured(tf, DEFAULT_STRATEGY_CONFIG)).toBe(true);
    }
  });

  it("leaves no timeframe NOT_CONFIGURED by default", () => {
    for (const tf of ALL_TIMEFRAMES) {
      expect(roleOf(tf, DEFAULT_STRATEGY_CONFIG)).not.toBeNull();
    }
  });

  it("assigns the five roles as specified", () => {
    const c = DEFAULT_STRATEGY_CONFIG;
    expect(timeframesInRole("BROAD_CONTEXT", c)).toEqual(["MN", "W1"]);
    expect(timeframesInRole("PRIMARY_CONTEXT", c)).toEqual(["D1", "H4"]);
    expect(timeframesInRole("OPERATIONAL", c)).toEqual(["H1", "M30", "M15"]);
    expect(timeframesInRole("ENTRY_CONFIRMATION", c)).toEqual(["M5"]);
    expect(timeframesInRole("EXECUTION_TRIGGER", c)).toEqual(["M1"]);
  });

  it("defaults to TREND_FOLLOWING, not countertrend", () => {
    // MN/W1 conflict warns and caps the score rather than cancelling the setup;
    // D1/H4 must still agree. STRICT is available as the stricter superset.
    expect(DEFAULT_STRATEGY_CONFIG.permissionMode).toBe("TREND_FOLLOWING");
    expect(allowsCountertrend(DEFAULT_STRATEGY_CONFIG.permissionMode)).toBe(false);
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

  it("enables the countertrend hard block with a reversal exception", () => {
    const { countertrendBlock } = DEFAULT_STRATEGY_CONFIG;
    expect(countertrendBlock.enabled).toBe(true);
    expect(countertrendBlock.minOpposingBroadContext).toBe(2);
    expect(countertrendBlock.minOpposingPrimaryContext).toBe(2);
    expect(countertrendBlock.reversalExceptionEnabled).toBe(true);
    expect(countertrendBlock.reversalExceptionTimeframes).toEqual(["D1", "H4"]);
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

describe("who may decide direction", () => {
  const c = DEFAULT_STRATEGY_CONFIG;

  it("excludes M5 and M1 from the directional timeframes", () => {
    // The rule "M5 and M1 must never determine market direction" is enforced by
    // construction: they are not in the list an engine could read from.
    const directional = directionalTimeframes(c);
    expect(directional).not.toContain("M5");
    expect(directional).not.toContain("M1");
  });

  it("lets broad, primary and operational tiers decide direction", () => {
    expect(directionalTimeframes(c)).toEqual(["MN", "W1", "D1", "H4", "H1", "M30", "M15"]);
  });

  it("classifies only the first three roles as directional", () => {
    expect(isDirectionalRole("BROAD_CONTEXT")).toBe(true);
    expect(isDirectionalRole("PRIMARY_CONTEXT")).toBe(true);
    expect(isDirectionalRole("OPERATIONAL")).toBe(true);
    expect(isDirectionalRole("ENTRY_CONFIRMATION")).toBe(false);
    expect(isDirectionalRole("EXECUTION_TRIGGER")).toBe(false);
  });

  it("still includes M5 and M1 on the short-term side, where they do their jobs", () => {
    // Not directional, but not ignored either: they confirm and time entries.
    expect(shortTermTimeframes(c)).toEqual(["H1", "M30", "M15", "M5", "M1"]);
  });

  it("splits the two summary groups without overlap and without loss", () => {
    const higher = higherTimeframes(c);
    const short = shortTermTimeframes(c);
    expect(higher).toEqual(["MN", "W1", "D1", "H4"]);
    expect(higher.filter((tf) => short.includes(tf))).toEqual([]);
    expect([...higher, ...short].sort()).toEqual([...configuredTimeframes(c)].sort());
  });

  it("gates FULLY ALIGNED on MN and W1", () => {
    expect(broadContextTimeframes(c)).toEqual(["MN", "W1"]);
  });

  it("treats D1 and H4 as the primary directional filters", () => {
    expect(primaryContextTimeframes(c)).toEqual(["D1", "H4"]);
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

  it("changes when a timeframe moves role", () => {
    const config = clone();
    config.roles.PRIMARY_CONTEXT = ["D1", "H4", "H1"];
    config.roles.OPERATIONAL = ["M30", "M15"];
    expect(strategyVersion(config)).not.toBe(strategyVersion(DEFAULT_STRATEGY_CONFIG));
  });

  it("distinguishes timeframe order, which is meaningful", () => {
    const config = clone();
    config.roles.BROAD_CONTEXT = ["W1", "MN"];
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

  it("rejects a timeframe assigned to two roles", () => {
    expectRejected((c) => {
      c.roles.OPERATIONAL = ["H1", "M30", "M15", "H4"];
    }, "assigned to both");
  });

  it("rejects a strategy with nothing able to decide direction", () => {
    expectRejected((c) => {
      c.roles.OPERATIONAL = [];
      c.dataQuality.minShortTermTimeframes = 1;
    }, "no OPERATIONAL timeframes");
  });

  it("rejects a strategy with no higher-timeframe context at all", () => {
    expectRejected((c) => {
      c.roles.BROAD_CONTEXT = [];
      c.roles.PRIMARY_CONTEXT = [];
      c.countertrendBlock.reversalExceptionTimeframes = [];
      c.countertrendBlock.reversalExceptionEnabled = false;
      c.dataQuality.minHigherTimeframes = 1;
    }, "no higher-timeframe bias");
  });

  it("rejects a minimum-timeframe requirement that can never be met", () => {
    expectRejected((c) => {
      c.dataQuality.minShortTermTimeframes = 9;
    }, "minShortTermTimeframes");
  });

  it("rejects a reversal exception pointing at an unconfigured timeframe", () => {
    expectRejected((c) => {
      c.roles.PRIMARY_CONTEXT = ["D1"];
      c.roles.OPERATIONAL = ["H4", "H1", "M30", "M15"];
      c.countertrendBlock.reversalExceptionTimeframes = ["D1", "W1", "H4"];
      // H4 is still configured; use a genuinely absent one instead.
      c.roles.EXECUTION_TRIGGER = [];
      c.countertrendBlock.reversalExceptionTimeframes = ["M1"];
    }, "not configured");
  });

  it("rejects an unsatisfiable reversal exception", () => {
    expectRejected((c) => {
      c.countertrendBlock.reversalExceptionTimeframes = [];
    }, "could never be satisfied");
  });

  it("refuses to let synthetic data be accepted", () => {
    expectRejected((c) => {
      c.dataQuality.rejectSyntheticData = false;
    }, "rejectSyntheticData");
  });

  it("accepts a legitimately reduced configuration", () => {
    const config = clone();
    config.permissionMode = "STRICT";
    config.roles.BROAD_CONTEXT = ["W1"];
    config.roles.PRIMARY_CONTEXT = ["D1", "H4"];
    config.roles.OPERATIONAL = ["H1", "M15"];
    config.roles.ENTRY_CONFIRMATION = ["M5"];
    config.roles.EXECUTION_TRIGGER = [];
    config.dataQuality.minShortTermTimeframes = 2;
    config.dataQuality.minHigherTimeframes = 2;
    expect(() => assertCoherent(config)).not.toThrow();
    // MN and M30 are now genuinely excluded — the one meaning NOT_CONFIGURED
    // is allowed to carry.
    expect(isConfigured("MN", config)).toBe(false);
    expect(isConfigured("M30", config)).toBe(false);
  });
});

describe("parseStrategyConfig", () => {
  it("rejects an unknown permission mode", () => {
    const config = clone() as unknown as Record<string, unknown>;
    config["permissionMode"] = "YOLO";
    expect(() => parseStrategyConfig(config)).toThrow();
  });

  it("rejects an unknown timeframe", () => {
    const config = clone();
    (config.roles as unknown as Record<string, string[]>)["OPERATIONAL"] = ["M7"];
    expect(() => parseStrategyConfig(config)).toThrow();
  });

  it("rejects an unknown role", () => {
    const config = clone() as unknown as Record<string, unknown>;
    config["roles"] = { EVERYTHING: ["M5"] };
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
    expect(result.config.permissionMode).toBe("TREND_FOLLOWING");
  });

  it("catches an incoherent config that nonetheless satisfies the schema", () => {
    const config = clone();
    config.scoring.conflictScoreCap = 95;
    expect(() => parseStrategyConfig(config)).toThrow(/conflictScoreCap/i);
  });
});

describe("reading the config", () => {
  const config = DEFAULT_STRATEGY_CONFIG;

  it("assigns a role to every timeframe", () => {
    expect(roleOf("MN", config)).toBe("BROAD_CONTEXT");
    expect(roleOf("W1", config)).toBe("BROAD_CONTEXT");
    expect(roleOf("D1", config)).toBe("PRIMARY_CONTEXT");
    expect(roleOf("H4", config)).toBe("PRIMARY_CONTEXT");
    expect(roleOf("H1", config)).toBe("OPERATIONAL");
    expect(roleOf("M30", config)).toBe("OPERATIONAL");
    expect(roleOf("M15", config)).toBe("OPERATIONAL");
    expect(roleOf("M5", config)).toBe("ENTRY_CONFIRMATION");
    expect(roleOf("M1", config)).toBe("EXECUTION_TRIGGER");
  });

  it("lists timeframes slowest first, in role order", () => {
    expect(configuredTimeframes(config)).toEqual([
      "MN",
      "W1",
      "D1",
      "H4",
      "H1",
      "M30",
      "M15",
      "M5",
      "M1",
    ]);
  });

  it("returns null for a timeframe the strategy excludes", () => {
    const reduced = clone();
    reduced.roles.EXECUTION_TRIGGER = [];
    expect(roleOf("M1", reduced)).toBeNull();
    expect(isConfigured("M1", reduced)).toBe(false);
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
