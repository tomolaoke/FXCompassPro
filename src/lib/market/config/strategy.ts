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
  DEFAULT_ROLE_ASSIGNMENT,
  HIGHER_TIMEFRAME_ROLES,
  SHORT_TERM_ROLES,
  TIMEFRAME_IDS,
  TIMEFRAME_ROLES,
  type Timeframe,
  type TimeframeRole,
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
  /** Minimum short-term timeframes with a usable reading before judging direction. */
  minShortTermTimeframes: z.number().int().min(1).max(9),
  /** Minimum higher timeframes with a usable reading before judging bias. */
  minHigherTimeframes: z.number().int().min(1).max(9),
  /** Refuse to produce any signal from synthetic sample data. Never disable. */
  rejectSyntheticData: z.boolean(),
  /** Maximum acceptable divergence between provider and broker price, in pips. */
  maxBrokerDivergencePips: z.number().min(0).max(500),
});

/**
 * The countertrend hard block.
 *
 * MN/W1 disagreement alone does not cancel an intraday setup — it lowers
 * quality, warns, and blocks the FULLY ALIGNED label. But when the broad
 * context, the primary directional context AND market structure are all
 * strongly against the direction, and the only bullish argument is a stretched
 * oscillator on a fast chart, that is catching a falling knife. This rule stops
 * M1 and M5 from talking the engine into it.
 */
const countertrendBlockSchema = z.object({
  enabled: z.boolean(),
  /** Block when at least this many broad-context timeframes oppose. */
  minOpposingBroadContext: z.number().int().min(0).max(2),
  /** Block when at least this many primary-context timeframes oppose. */
  minOpposingPrimaryContext: z.number().int().min(0).max(2),
  /**
   * The documented exception. When a confirmed reversal structure is present
   * (a liquidity sweep followed by a change of character on a primary-context
   * timeframe), the block is lifted and the setup is shown with the
   * countertrend warning instead.
   */
  reversalExceptionEnabled: z.boolean(),
  /** Timeframe on which the reversal structure must appear for the exception. */
  reversalExceptionTimeframes: z.array(timeframeSchema).max(9),
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

/**
 * Which timeframes sit in which role. All nine are assigned by default.
 *
 * A timeframe absent from every role is NOT_CONFIGURED — the only meaning that
 * state is ever allowed to carry.
 */
const rolesSchema = z.object({
  BROAD_CONTEXT: z.array(timeframeSchema).max(9),
  PRIMARY_CONTEXT: z.array(timeframeSchema).max(9),
  OPERATIONAL: z.array(timeframeSchema).max(9),
  ENTRY_CONFIRMATION: z.array(timeframeSchema).max(9),
  EXECUTION_TRIGGER: z.array(timeframeSchema).max(9),
});

export const strategyConfigSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(400),
  permissionMode: z.enum(PERMISSION_MODES),
  roles: rolesSchema,
  momentum: momentumSchema,
  location: locationSchema,
  structure: structureSchema,
  trend: trendSchema,
  volatility: volatilitySchema,
  entry: entrySchema,
  scoring: scoringSchema,
  dataQuality: dataQualitySchema,
  countertrendBlock: countertrendBlockSchema,
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

  /**
   * TREND_FOLLOWING by default.
   *
   * Permission requires agreement with the primary directional context (D1 and
   * H4). A broad-context conflict on MN or W1 warns, caps the score, and blocks
   * the FULLY ALIGNED label — but does not on its own cancel the setup.
   *
   * STRICT is available and is a stricter superset: it additionally refuses on
   * any MN/W1 conflict, any inconclusive reading, any data problem, and any
   * provisional candle. The two are separate modes, not a combination.
   */
  permissionMode: "TREND_FOLLOWING",

  // All nine timeframes are analysed and used.
  roles: {
    BROAD_CONTEXT: [...DEFAULT_ROLE_ASSIGNMENT.BROAD_CONTEXT],
    PRIMARY_CONTEXT: [...DEFAULT_ROLE_ASSIGNMENT.PRIMARY_CONTEXT],
    OPERATIONAL: [...DEFAULT_ROLE_ASSIGNMENT.OPERATIONAL],
    ENTRY_CONFIRMATION: [...DEFAULT_ROLE_ASSIGNMENT.ENTRY_CONFIRMATION],
    EXECUTION_TRIGGER: [...DEFAULT_ROLE_ASSIGNMENT.EXECUTION_TRIGGER],
  },

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
    minShortTermTimeframes: 3,
    minHigherTimeframes: 2,
    rejectSyntheticData: true,
    maxBrokerDivergencePips: 5,
  },

  countertrendBlock: {
    enabled: true,
    // Both MN and W1 opposing, plus both D1 and H4 opposing, is the "falling
    // knife" case. Anything less warns and caps the score instead.
    minOpposingBroadContext: 2,
    minOpposingPrimaryContext: 2,
    reversalExceptionEnabled: true,
    reversalExceptionTimeframes: ["D1", "H4"],
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
  const { momentum, entry, scoring } = config;

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

  // A timeframe in two roles would be counted twice and would have two
  // different authorities over the result.
  const seen = new Map<Timeframe, TimeframeRole>();
  for (const role of TIMEFRAME_ROLES) {
    for (const tf of config.roles[role]) {
      const existing = seen.get(tf);
      if (existing) {
        problems.push(
          `${tf} is assigned to both ${existing} and ${role}. Each timeframe has exactly one role.`,
        );
      } else {
        seen.set(tf, role);
      }
    }
  }

  // Direction has to come from somewhere, and it may not come from M5 or M1.
  if (shortTermTimeframes(config).length === 0) {
    problems.push(
      "no timeframes assigned to OPERATIONAL, ENTRY_CONFIRMATION or EXECUTION_TRIGGER, " +
        "so there is nothing to read a short-term direction from",
    );
  }
  if (higherTimeframes(config).length === 0) {
    problems.push(
      "no timeframes assigned to BROAD_CONTEXT or PRIMARY_CONTEXT, so there is no " +
        "higher-timeframe bias to check a setup against",
    );
  }
  if (config.roles.OPERATIONAL.length === 0) {
    problems.push(
      "no OPERATIONAL timeframes: M5 confirms entries and M1 times them, so neither " +
        "may determine direction. Without an operational tier nothing can.",
    );
  }

  if (config.dataQuality.minShortTermTimeframes > shortTermTimeframes(config).length) {
    problems.push(
      "dataQuality.minShortTermTimeframes exceeds the number of configured short-term " +
        "timeframes, so no signal could ever be produced",
    );
  }
  if (config.dataQuality.minHigherTimeframes > higherTimeframes(config).length) {
    problems.push(
      "dataQuality.minHigherTimeframes exceeds the number of configured higher " +
        "timeframes, so no signal could ever be produced",
    );
  }

  const strayReversal = config.countertrendBlock.reversalExceptionTimeframes.filter(
    (tf) => !isConfigured(tf, config),
  );
  if (strayReversal.length > 0) {
    problems.push(
      "countertrendBlock.reversalExceptionTimeframes references timeframes that are not " +
        `configured: ${strayReversal.join(", ")}`,
    );
  }
  if (
    config.countertrendBlock.reversalExceptionEnabled &&
    config.countertrendBlock.reversalExceptionTimeframes.length === 0
  ) {
    problems.push(
      "countertrendBlock.reversalExceptionEnabled is true but no reversalExceptionTimeframes " +
        "are set, so the exception could never be satisfied",
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
  return roleOf(tf, config) !== null;
}

/** The role a timeframe holds, or null when the strategy excludes it. */
export function roleOf(tf: Timeframe, config: StrategyConfig): TimeframeRole | null {
  for (const role of TIMEFRAME_ROLES) {
    if (config.roles[role].includes(tf)) return role;
  }
  return null;
}

/** Every configured timeframe, in role order: broad context first, trigger last. */
export function configuredTimeframes(config: StrategyConfig): Timeframe[] {
  return TIMEFRAME_ROLES.flatMap((role) => config.roles[role]);
}

export function timeframesInRole(role: TimeframeRole, config: StrategyConfig): Timeframe[] {
  return [...config.roles[role]];
}

/**
 * Timeframes that may contribute to the higher-timeframe bias: MN, W1, D1, H4.
 */
export function higherTimeframes(config: StrategyConfig): Timeframe[] {
  return HIGHER_TIMEFRAME_ROLES.flatMap((role) => config.roles[role]);
}

/**
 * Timeframes on the short-term side: H1, M30, M15, M5, M1.
 *
 * Note this is not the same as "timeframes that vote on direction" — see
 * directionalTimeframes. M5 and M1 are on the short-term side but confirm and
 * time an entry rather than deciding which way the market is going.
 */
export function shortTermTimeframes(config: StrategyConfig): Timeframe[] {
  return SHORT_TERM_ROLES.flatMap((role) => config.roles[role]);
}

/**
 * The only timeframes allowed to contribute to a directional reading.
 *
 * ENTRY_CONFIRMATION and EXECUTION_TRIGGER are excluded by construction, which
 * is how "M5 and M1 must never determine market direction" is enforced: an
 * engine bug cannot let them vote, because they are never in this list.
 */
export function directionalTimeframes(config: StrategyConfig): Timeframe[] {
  return [
    ...config.roles.BROAD_CONTEXT,
    ...config.roles.PRIMARY_CONTEXT,
    ...config.roles.OPERATIONAL,
  ];
}

export function isDirectionalRole(role: TimeframeRole): boolean {
  return role === "BROAD_CONTEXT" || role === "PRIMARY_CONTEXT" || role === "OPERATIONAL";
}

/**
 * Broad context (MN, W1) gates the FULLY ALIGNED label: alignment there is
 * required before a setup may be called fully aligned, and conflict there
 * produces the countertrend warning.
 */
export function broadContextTimeframes(config: StrategyConfig): Timeframe[] {
  return [...config.roles.BROAD_CONTEXT];
}

/**
 * Primary directional context (D1, H4) carries the most weight. In
 * TREND_FOLLOWING mode these must agree before permission is issued.
 */
export function primaryContextTimeframes(config: StrategyConfig): Timeframe[] {
  return [...config.roles.PRIMARY_CONTEXT];
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
