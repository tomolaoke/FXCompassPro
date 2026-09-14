/**
 * The versioned strategy configuration.
 *
 * Every tunable number the engine uses lives here. Nothing else may hard-code a
 * threshold, a lookback, a weight or a cap.
 *
 * The config is content-hashed into a `version` string that is stored with
 * every signal. Together with the candle snapshot, that makes any past signal
 * reproducible: you can always answer "what exactly did the app see, and what
 * rules was it applying, when it said that?"
 *
 * It also makes over-fitting visible. If you have thirty versions and kept the
 * one with the best backtest, the version history says so.
 */

import { z } from "zod";
import {
  DEFAULT_CONTEXT_TIMEFRAMES,
  DEFAULT_EXECUTION_TIMEFRAMES,
  DEFAULT_PRIMARY_CONTEXT_FILTERS,
  TIMEFRAME_IDS,
  type Timeframe,
} from "./timeframes";
import { PERMISSION_MODES, type PermissionMode, type ScoreCategory } from "../domain/states";

// ─── Schema ──────────────────────────────────────────────────────────────────

const timeframeSchema = z.enum(TIMEFRAME_IDS);

/**
 * Stochastic 25,2,4 at the 20/30/70/80 levels — the primary directional gate.
 * No timeframe resolves to BULLISH or BEARISH without it.
 */
const momentumSchema = z.object({
  kPeriod: z.number().int().min(2).max(200),
  slowing: z.number().int().min(1).max(50),
  dPeriod: z.number().int().min(1).max(50),
  deepOversold: z.number().min(0).max(50),
  oversold: z.number().min(0).max(50),
  overbought: z.number().min(50).max(100),
  deepOverbought: z.number().min(50).max(100),
  /**
   * Require a cross back through a level, rather than accepting a bare extreme
   * reading. Stochastic stays pinned at an extreme throughout a strong trend,
   * so "it is oversold" is not by itself a reason to buy.
   */
  requireLevelCross: z.boolean(),
});

/**
 * Location — price must be at something. A stretched oscillator in open space
 * is not a setup, so this layer can veto.
 */
const locationSchema = z.object({
  /** Maximum distance from a mapped level, in ATR. */
  toleranceAtr: z.number().min(0.1).max(10),
  /** Bars each side of a fractal pivot. Higher = fewer, more significant swings. */
  swingLookback: z.number().int().min(1).max(10),
  /** How close two swings must be to count as an equal high/low, in ATR. */
  equalLevelToleranceAtr: z.number().min(0.01).max(2),
  /** Minimum swings before a level is treated as equal highs/lows. */
  equalLevelMinTouches: z.number().int().min(2).max(10),
  /** Nearest N support and resistance levels to consider. */
  levelsPerSide: z.number().int().min(1).max(10),
  /** Refuse permission when price is not at a mapped level. */
  requireLocation: z.boolean(),
});

/**
 * Structure — price action must confirm the turn.
 *
 * Sweep, change of character, displacement, fair value gap and order block are
 * usually five descriptions of ONE impulse, so they are scored as a single
 * correlated group rather than as five independent confirmations.
 */
const structureSchema = z.object({
  sweepLookbackBars: z.number().int().min(5).max(200),
  /** How recently the sweep must have happened, in bars. */
  sweepRecencyBars: z.number().int().min(1).max(20),
  /** Body size for a displacement candle, in ATR. */
  displacementAtr: z.number().min(0.5).max(5),
  /** Bars to search back for the structural extreme used as invalidation. */
  structureLookbackBars: z.number().int().min(3).max(100),
  maxFairValueGaps: z.number().int().min(1).max(50),
  maxOrderBlocks: z.number().int().min(1).max(50),
  /** Refuse permission when nothing has confirmed the turn. */
  requireStructure: z.boolean(),
});

const trendSchema = z.object({
  maPeriod: z.number().int().min(2).max(400),
  /** Bars over which the moving average's slope is measured. */
  slopeLookbackBars: z.number().int().min(2).max(100),
});

const volatilitySchema = z.object({
  atrPeriod: z.number().int().min(2).max(100),
  /** Bars used for the ATR baseline that defines the volatility regime. */
  regimeLookbackBars: z.number().int().min(10).max(500),
  lowRegimeRatio: z.number().min(0.1).max(1),
  highRegimeRatio: z.number().min(1).max(5),
});

const entrySchema = z.object({
  /** Buffer beyond the invalidation point when placing the stop, in ATR. */
  stopBufferAtr: z.number().min(0).max(3),
  /** Floor and ceiling on stop distance, in ATR. Outside these, no permission. */
  minStopAtr: z.number().min(0.05).max(5),
  maxStopAtr: z.number().min(0.5).max(20),
  /** A zone further than this from price is unreachable and is rejected. */
  maxEntryDistanceAtr: z.number().min(0.5).max(10),
  /** Fallback zone width when no gap or order block is available, in ATR. */
  fallbackZoneAtr: z.number().min(0.05).max(2),
  /** Minimum acceptable reward-to-risk at the first target. */
  minRiskReward: z.number().min(0.5).max(10),
  targetRMultiples: z.array(z.number().min(0.1).max(50)).min(1).max(5),
});

/**
 * Scoring. Per-category caps stop several correlated readings of one move from
 * stacking into false confidence.
 *
 * The result is a HEURISTIC setup-quality score. It is not calibrated against
 * outcomes and must never be presented as a probability or a win rate.
 */
const scoringSchema = z.object({
  categoryCaps: z.object({
    MOMENTUM: z.number().min(0).max(100),
    LOCATION: z.number().min(0).max(100),
    STRUCTURE: z.number().min(0).max(100),
    TREND: z.number().min(0).max(100),
    VOLATILITY: z.number().min(0).max(100),
    MTF_AGREEMENT: z.number().min(0).max(100),
  }),
  /**
   * Maximum share of the total a single category may contribute. Stops one
   * strong signal in one dimension from producing high overall confidence.
   */
  maxSingleCategoryShare: z.number().min(0.1).max(1),
  /**
   * Hard ceiling on the score whenever any higher timeframe conflicts. A
   * conflicted setup can never display as high quality, however good it looks
   * on the lower timeframes.
   */
  conflictScoreCap: z.number().min(0).max(100),
  /** Thresholds for the LOW / MEDIUM / HIGH label. */
  mediumThreshold: z.number().min(0).max(100),
  highThreshold: z.number().min(0).max(100),
  /**
   * Timeframes sharing a base series are not independent evidence. The first
   * agreeing timeframe in a group counts fully; each additional one counts at
   * this fraction of the previous.
   */
  correlatedAgreementDecay: z.number().min(0).max(1),
});

const dataQualitySchema = z.object({
  /** Minimum execution timeframes with a usable reading before judging direction. */
  minExecutionTimeframes: z.number().int().min(1).max(8),
  /** Minimum context timeframes with a usable reading before judging bias. */
  minContextTimeframes: z.number().int().min(1).max(8),
  /** Refuse to produce any signal from synthetic sample data. Never disable. */
  rejectSyntheticData: z.boolean(),
  /** Maximum acceptable divergence between provider and broker price, in pips. */
  maxBrokerDivergencePips: z.number().min(0).max(500),
});

const newsSchema = z.object({
  enabled: z.boolean(),
  bufferBeforeMinutes: z.number().int().min(0).max(1440),
  bufferAfterMinutes: z.number().int().min(0).max(1440),
  /** Impact levels that block a signal rather than merely warning. */
  blockingImpacts: z.array(z.enum(["HIGH", "MEDIUM", "LOW"])),
  /**
   * When the calendar cannot be reached, block new signals rather than assume
   * the coast is clear. A failed lookup is not an all-clear.
   */
  blockWhenUnavailable: z.boolean(),
});

export const strategyConfigSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(400),
  permissionMode: z.enum(PERMISSION_MODES),
  executionTimeframes: z.array(timeframeSchema).min(1).max(8),
  contextTimeframes: z.array(timeframeSchema).min(1).max(8),
  /** Context timeframes treated as decisive in TREND_FOLLOWING mode. */
  primaryContextFilters: z.array(timeframeSchema).max(8),
  momentum: momentumSchema,
  location: locationSchema,
  structure: structureSchema,
  trend: trendSchema,
  volatility: volatilitySchema,
  entry: entrySchema,
  scoring: scoringSchema,
  dataQuality: dataQualitySchema,
  news: newsSchema,
});

export type StrategyConfig = z.infer<typeof strategyConfigSchema>;

/** A config plus its content hash. This is what the engine and storage use. */
export interface VersionedStrategy {
  readonly config: StrategyConfig;
  /** Deterministic content hash, e.g. "sv1-7f3a91c2". */
  readonly version: string;
}

// ─── The default strategy ────────────────────────────────────────────────────

export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  name: "Stochastic 25,2,4 with price-action confirmation",
  description:
    "Stochastic 25,2,4 is the primary directional gate. Location and market structure must confirm before any trade permission is issued. Trend and volatility act as filters. Short-term direction and higher-timeframe bias are computed separately and never merged.",

  // STRICT by default: any conflict, unclear reading or data problem on any
  // configured timeframe produces NO TRADE. This is the stricter superset of
  // TREND_FOLLOWING, not a combination of the two.
  permissionMode: "STRICT",

  executionTimeframes: [...DEFAULT_EXECUTION_TIMEFRAMES],
  contextTimeframes: [...DEFAULT_CONTEXT_TIMEFRAMES],
  primaryContextFilters: [...DEFAULT_PRIMARY_CONTEXT_FILTERS],

  momentum: {
    kPeriod: 25,
    slowing: 2,
    dPeriod: 4,
    deepOversold: 20,
    oversold: 30,
    overbought: 70,
    deepOverbought: 80,
    requireLevelCross: true,
  },

  location: {
    toleranceAtr: 1.5,
    swingLookback: 3,
    equalLevelToleranceAtr: 0.35,
    equalLevelMinTouches: 2,
    levelsPerSide: 3,
    requireLocation: true,
  },

  structure: {
    sweepLookbackBars: 40,
    sweepRecencyBars: 6,
    displacementAtr: 1.5,
    structureLookbackBars: 12,
    maxFairValueGaps: 8,
    maxOrderBlocks: 6,
    requireStructure: true,
  },

  trend: {
    maPeriod: 50,
    slopeLookbackBars: 10,
  },

  volatility: {
    atrPeriod: 14,
    regimeLookbackBars: 50,
    lowRegimeRatio: 0.7,
    highRegimeRatio: 1.5,
  },

  entry: {
    stopBufferAtr: 0.25,
    minStopAtr: 0.5,
    maxStopAtr: 4,
    maxEntryDistanceAtr: 2,
    fallbackZoneAtr: 0.3,
    minRiskReward: 1.5,
    targetRMultiples: [1.5, 2.5, 4],
  },

  scoring: {
    // Caps total 100. No category can carry the score alone.
    categoryCaps: {
      MOMENTUM: 25,
      LOCATION: 20,
      STRUCTURE: 20,
      TREND: 15,
      VOLATILITY: 10,
      MTF_AGREEMENT: 10,
    },
    maxSingleCategoryShare: 0.4,
    conflictScoreCap: 60,
    mediumThreshold: 45,
    highThreshold: 70,
    correlatedAgreementDecay: 0.4,
  },

  dataQuality: {
    minExecutionTimeframes: 3,
    minContextTimeframes: 2,
    rejectSyntheticData: true,
    maxBrokerDivergencePips: 5,
  },

  news: {
    enabled: true,
    bufferBeforeMinutes: 30,
    bufferAfterMinutes: 15,
    blockingImpacts: ["HIGH"],
    blockWhenUnavailable: false,
  },
};

// ─── Versioning ──────────────────────────────────────────────────────────────

/**
 * Canonical JSON: object keys sorted recursively, so two configs that differ
 * only in key order hash identically. Array order is preserved, because for
 * timeframe lists and R-multiples the order is meaningful.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

/**
 * FNV-1a, 32-bit. Not cryptographic — this identifies a configuration, it does
 * not protect one. Chosen because it is dependency-free and stable across
 * runtimes, which matters when a hash is stored alongside years of signals.
 */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Deterministic content hash of a strategy configuration. */
export function strategyVersion(config: StrategyConfig): string {
  return `sv1-${fnv1a(canonicalize(config))}`;
}

export function versioned(config: StrategyConfig): VersionedStrategy {
  return { config, version: strategyVersion(config) };
}

/** Validate an untrusted config (stored JSON, user edit) before use. */
export function parseStrategyConfig(input: unknown): VersionedStrategy {
  const config = strategyConfigSchema.parse(input);
  assertCoherent(config);
  return versioned(config);
}

export const DEFAULT_STRATEGY: VersionedStrategy = versioned(DEFAULT_STRATEGY_CONFIG);

// ─── Coherence ───────────────────────────────────────────────────────────────

/**
 * Checks the schema cannot express: relationships between fields.
 *
 * A config that passes the schema but is internally contradictory would
 * silently produce nonsense signals, so this throws rather than warns.
 */
export function assertCoherent(config: StrategyConfig): void {
  const problems: string[] = [];
  const { momentum, entry, scoring, executionTimeframes, contextTimeframes } = config;

  if (momentum.deepOversold > momentum.oversold) {
    problems.push("momentum.deepOversold must be at or below momentum.oversold");
  }
  if (momentum.overbought > momentum.deepOverbought) {
    problems.push("momentum.overbought must be at or below momentum.deepOverbought");
  }
  if (momentum.oversold >= momentum.overbought) {
    problems.push("momentum.oversold must be below momentum.overbought");
  }

  if (entry.minStopAtr >= entry.maxStopAtr) {
    problems.push("entry.minStopAtr must be below entry.maxStopAtr");
  }
  if (entry.targetRMultiples.some((r, i, all) => i > 0 && r <= all[i - 1]!)) {
    problems.push("entry.targetRMultiples must be strictly increasing");
  }
  if (entry.targetRMultiples[0]! < entry.minRiskReward) {
    problems.push("entry.targetRMultiples[0] must be at least entry.minRiskReward");
  }

  if (scoring.mediumThreshold >= scoring.highThreshold) {
    problems.push("scoring.mediumThreshold must be below scoring.highThreshold");
  }

  // A conflict cap at or above the HIGH threshold would let a conflicted setup
  // display as high quality, which is the exact failure this app exists to fix.
  if (scoring.conflictScoreCap >= scoring.highThreshold) {
    problems.push(
      "scoring.conflictScoreCap must be below scoring.highThreshold, otherwise a " +
        "higher-timeframe conflict could still be presented as a high-quality setup",
    );
  }

  const overlap = executionTimeframes.filter((tf) => contextTimeframes.includes(tf));
  if (overlap.length > 0) {
    problems.push(
      `a timeframe cannot be both execution and context: ${overlap.join(", ")}. ` +
        "The two groups are analysed separately and must be disjoint.",
    );
  }

  const strayFilters = config.primaryContextFilters.filter((tf) => !contextTimeframes.includes(tf));
  if (strayFilters.length > 0) {
    problems.push(
      `primaryContextFilters must be a subset of contextTimeframes: ${strayFilters.join(", ")}`,
    );
  }

  if (config.dataQuality.minExecutionTimeframes > executionTimeframes.length) {
    problems.push(
      "dataQuality.minExecutionTimeframes exceeds the number of configured execution timeframes, " +
        "so no signal could ever be produced",
    );
  }
  if (config.dataQuality.minContextTimeframes > contextTimeframes.length) {
    problems.push(
      "dataQuality.minContextTimeframes exceeds the number of configured context timeframes, " +
        "so no signal could ever be produced",
    );
  }

  if (!config.dataQuality.rejectSyntheticData) {
    problems.push(
      "dataQuality.rejectSyntheticData must stay true: synthetic sample data must never " +
        "produce a trade permission",
    );
  }

  if (problems.length > 0) {
    throw new Error(`Incoherent strategy configuration:\n- ${problems.join("\n- ")}`);
  }
}

// ─── Reading the config ──────────────────────────────────────────────────────

/**
 * Whether the active strategy looks at a timeframe at all.
 *
 * This is the ONLY sanctioned source of the NOT_CONFIGURED state. If this
 * returns false the timeframe is excluded by choice; if it returns true, the
 * engine must produce a real state for it, including when that state disagrees
 * with everything else.
 */
export function isConfigured(tf: Timeframe, config: StrategyConfig): boolean {
  return config.executionTimeframes.includes(tf) || config.contextTimeframes.includes(tf);
}

export function roleOf(
  tf: Timeframe,
  config: StrategyConfig,
): "EXECUTION" | "CONTEXT" | "NOT_CONFIGURED" {
  if (config.executionTimeframes.includes(tf)) return "EXECUTION";
  if (config.contextTimeframes.includes(tf)) return "CONTEXT";
  return "NOT_CONFIGURED";
}

/** Every configured timeframe, execution first, then context. */
export function configuredTimeframes(config: StrategyConfig): Timeframe[] {
  return [...config.executionTimeframes, ...config.contextTimeframes];
}

export function categoryCap(category: ScoreCategory, config: StrategyConfig): number {
  return config.scoring.categoryCaps[category];
}

/** Sum of all category caps — the maximum attainable score. */
export function maxScore(config: StrategyConfig): number {
  return Object.values(config.scoring.categoryCaps).reduce((sum, cap) => sum + cap, 0);
}

/**
 * Countertrend setups are only permitted when the mode explicitly says so.
 * The default mode does not.
 */
export function allowsCountertrend(mode: PermissionMode): boolean {
  return mode === "COUNTERTREND";
}

/** MANUAL never issues a permission; it only ever displays analysis. */
export function issuesPermission(mode: PermissionMode): boolean {
  return mode !== "MANUAL";
}
