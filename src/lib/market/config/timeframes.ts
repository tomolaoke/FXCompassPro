/**
 * The single source of truth for timeframes.
 *
 * Nothing else in the application may hard-code a timeframe list, a bar
 * duration, a freshness limit, or which provider request a timeframe is rolled
 * up from. Change it here.
 *
 * See docs/data-providers.md for the credit budget these choices produce.
 */

export const TIMEFRAME_IDS = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN"] as const;

export type Timeframe = (typeof TIMEFRAME_IDS)[number];

/** How a timeframe's bucket boundary is derived. */
export type BucketKind = "INTRADAY" | "DAILY" | "WEEKLY" | "MONTHLY";

export interface TimeframeDefinition {
  readonly id: Timeframe;
  readonly label: string;
  /** Nominal duration in minutes. Exact for INTRADAY; nominal for the rest. */
  readonly minutes: number;
  readonly bucket: BucketKind;
  /**
   * Which provider base series this timeframe is rolled up from.
   *
   * H4 comes from the H1 series, not from M5. Rolling M5 up to H4 gives about
   * 31 bars from a 1500-bar request — roughly the minimum a Stochastic(25,2,4)
   * needs to produce its first value — so H4 was previously either dropped or
   * produced one meaningless reading. H4 is one of the two context timeframes
   * that matter most, so it gets real history.
   */
  readonly baseSeries: BaseSeries;
  /**
   * Minimum closed bars required before any state other than DATA_MISSING can
   * be produced. Covers Stochastic(25,2,4) warm-up plus structure lookback.
   */
  readonly minBars: number;
  /**
   * Age past which data is considered stale, in minutes. Generous multiples of
   * the bar duration: a weekly candle that is two hours old is perfectly fresh.
   */
  readonly staleAfterMinutes: number;
  /** How long a signal built on this timeframe stays valid, in minutes. */
  readonly signalExpiryMinutes: number;
}

/** The three provider requests that cover every timeframe. */
export type BaseSeries = "1min" | "5min" | "1h" | "1day";

export const TIMEFRAMES: Record<Timeframe, TimeframeDefinition> = {
  M1: {
    id: "M1",
    label: "1 minute",
    minutes: 1,
    bucket: "INTRADAY",
    baseSeries: "1min",
    minBars: 60,
    staleAfterMinutes: 5,
    signalExpiryMinutes: 15,
  },
  M5: {
    id: "M5",
    label: "5 minutes",
    minutes: 5,
    bucket: "INTRADAY",
    baseSeries: "5min",
    minBars: 60,
    staleAfterMinutes: 20,
    signalExpiryMinutes: 45,
  },
  M15: {
    id: "M15",
    label: "15 minutes",
    minutes: 15,
    bucket: "INTRADAY",
    baseSeries: "5min",
    minBars: 60,
    staleAfterMinutes: 60,
    signalExpiryMinutes: 120,
  },
  M30: {
    id: "M30",
    label: "30 minutes",
    minutes: 30,
    bucket: "INTRADAY",
    baseSeries: "5min",
    minBars: 60,
    staleAfterMinutes: 120,
    signalExpiryMinutes: 240,
  },
  H1: {
    id: "H1",
    label: "1 hour",
    minutes: 60,
    bucket: "INTRADAY",
    baseSeries: "1h",
    minBars: 60,
    staleAfterMinutes: 240,
    signalExpiryMinutes: 480,
  },
  H4: {
    id: "H4",
    label: "4 hours",
    minutes: 240,
    bucket: "INTRADAY",
    baseSeries: "1h",
    minBars: 60,
    staleAfterMinutes: 960,
    signalExpiryMinutes: 1440,
  },
  D1: {
    id: "D1",
    label: "Daily",
    minutes: 1440,
    bucket: "DAILY",
    baseSeries: "1day",
    minBars: 60,
    // Allows for a full weekend plus a public holiday without crying stale.
    staleAfterMinutes: 4320,
    signalExpiryMinutes: 4320,
  },
  W1: {
    id: "W1",
    label: "Weekly",
    minutes: 10080,
    bucket: "WEEKLY",
    baseSeries: "1day",
    minBars: 40,
    staleAfterMinutes: 20160,
    signalExpiryMinutes: 20160,
  },
  MN: {
    id: "MN",
    label: "Monthly",
    minutes: 43200,
    bucket: "MONTHLY",
    baseSeries: "1day",
    minBars: 36,
    staleAfterMinutes: 86400,
    signalExpiryMinutes: 43200,
  },
};

/** Ordered fastest to slowest. */
export const ALL_TIMEFRAMES: readonly Timeframe[] = TIMEFRAME_IDS;

/** Ordered slowest to fastest — the order charts are usually read in. */
export const ALL_TIMEFRAMES_DESC: readonly Timeframe[] = [...TIMEFRAME_IDS].reverse();

// ─── Roles ───────────────────────────────────────────────────────────────────

/**
 * Five tiers, each with a different authority over the result.
 *
 * The tiers exist because "which timeframes agree" is the wrong question. A
 * 1-minute chart agreeing with a monthly chart is not evidence of anything —
 * they answer different questions. M1 times an entry; it must never be able to
 * argue about direction. M5 confirms a setup that already exists; it must never
 * create one.
 */
export const TIMEFRAME_ROLES = [
  "BROAD_CONTEXT",
  "PRIMARY_CONTEXT",
  "OPERATIONAL",
  "ENTRY_CONFIRMATION",
  "EXECUTION_TRIGGER",
] as const;

export type TimeframeRole = (typeof TIMEFRAME_ROLES)[number];

export const ROLE_LABEL: Record<TimeframeRole, string> = {
  BROAD_CONTEXT: "Broad context",
  PRIMARY_CONTEXT: "Primary directional context",
  OPERATIONAL: "Operational confirmation",
  ENTRY_CONFIRMATION: "Entry confirmation",
  EXECUTION_TRIGGER: "Execution trigger",
};

export const ROLE_DESCRIPTION: Record<TimeframeRole, string> = {
  BROAD_CONTEXT:
    "The bigger picture. Always shown. Disagreement blocks the FULLY ALIGNED label and lowers setup quality, but does not by itself cancel an intraday setup.",
  PRIMARY_CONTEXT:
    "The strongest directional authority. Strong disagreement here normally means WAIT or WATCH.",
  OPERATIONAL: "Confirms direction, momentum, structure and location.",
  ENTRY_CONFIRMATION:
    "Confirms an entry after a setup already exists. Cannot create a setup and cannot influence bias.",
  EXECUTION_TRIGGER:
    "Times the entry. Cannot influence bias, setup quality or higher-timeframe direction.",
};

/**
 * All nine timeframes are analysed and used by default.
 *
 * M1 included: it is the final execution trigger. Leaving it out would make it
 * NOT_CONFIGURED, which would be honest but would also discard the timing layer
 * the strategy depends on.
 */
export const DEFAULT_ROLE_ASSIGNMENT: Record<TimeframeRole, readonly Timeframe[]> = {
  BROAD_CONTEXT: ["MN", "W1"],
  PRIMARY_CONTEXT: ["D1", "H4"],
  OPERATIONAL: ["H1", "M30", "M15"],
  ENTRY_CONFIRMATION: ["M5"],
  EXECUTION_TRIGGER: ["M1"],
};

/**
 * Roles that may contribute to the directional reading.
 *
 * M5 and M1 are deliberately absent. This is the type-level expression of
 * "M5 and M1 must never determine market direction" — a bug in the engine
 * cannot let them vote, because they are not in this list.
 */
export const DIRECTIONAL_ROLES: readonly TimeframeRole[] = [
  "BROAD_CONTEXT",
  "PRIMARY_CONTEXT",
  "OPERATIONAL",
];

/**
 * The two summary groups, derived from the tiers.
 *
 * Higher-timeframe bias = broad + primary context (MN, W1, D1, H4).
 * Short-term direction  = operational + entry + trigger (H1, M30, M15, M5, M1).
 *
 * These are computed separately and never merged into one vote, which is what
 * makes "short-term bullish, higher timeframes bearish" expressible rather than
 * silently averaged away.
 */
export const HIGHER_TIMEFRAME_ROLES: readonly TimeframeRole[] = [
  "BROAD_CONTEXT",
  "PRIMARY_CONTEXT",
];

export const SHORT_TERM_ROLES: readonly TimeframeRole[] = [
  "OPERATIONAL",
  "ENTRY_CONFIRMATION",
  "EXECUTION_TRIGGER",
];

/**
 * Relative weight of a conflict on each timeframe, for the conflict penalty and
 * for display prominence.
 *
 * D1 and H4 weigh most: they most often decide whether an intraday idea
 * survives the session, and a beginner is most likely to overlook them. MN and
 * W1 weigh less per timeframe but gate the FULLY ALIGNED label outright, which
 * no score can substitute for.
 */
export const CONFLICT_WEIGHT: Record<Timeframe, number> = {
  MN: 0.5,
  W1: 0.7,
  D1: 1.0,
  H4: 1.0,
  H1: 0.6,
  M30: 0.4,
  M15: 0.4,
  M5: 0.2,
  M1: 0.1,
};

export function timeframesForRole(
  role: TimeframeRole,
  assignment: Record<TimeframeRole, readonly Timeframe[]> = DEFAULT_ROLE_ASSIGNMENT,
): readonly Timeframe[] {
  return assignment[role];
}

export function roleForTimeframe(
  tf: Timeframe,
  assignment: Record<TimeframeRole, readonly Timeframe[]> = DEFAULT_ROLE_ASSIGNMENT,
): TimeframeRole | null {
  for (const role of TIMEFRAME_ROLES) {
    if (assignment[role].includes(tf)) return role;
  }
  return null;
}

/** Flattened, slowest first — the order a chart stack is read in. */
export function timeframesInRoleOrder(
  assignment: Record<TimeframeRole, readonly Timeframe[]> = DEFAULT_ROLE_ASSIGNMENT,
): Timeframe[] {
  return TIMEFRAME_ROLES.flatMap((role) => [...assignment[role]]);
}

// ─── Derived helpers ─────────────────────────────────────────────────────────

export function timeframeDef(tf: Timeframe): TimeframeDefinition {
  return TIMEFRAMES[tf];
}

export function isTimeframe(value: string): value is Timeframe {
  return (TIMEFRAME_IDS as readonly string[]).includes(value);
}

/** Bar duration in milliseconds. Nominal for W1 and MN — use the clock instead. */
export function timeframeMs(tf: Timeframe): number {
  return TIMEFRAMES[tf].minutes * 60_000;
}

/** Slowest-first ordering, so context reads top-down like a chart stack. */
export function sortBySlowest(timeframes: readonly Timeframe[]): Timeframe[] {
  return [...timeframes].sort((a, b) => TIMEFRAMES[b].minutes - TIMEFRAMES[a].minutes);
}

export function sortByFastest(timeframes: readonly Timeframe[]): Timeframe[] {
  return [...timeframes].sort((a, b) => TIMEFRAMES[a].minutes - TIMEFRAMES[b].minutes);
}

/**
 * The distinct provider requests needed to serve a set of timeframes.
 * Three requests cover all eight analysed timeframes.
 */
export function baseSeriesFor(timeframes: readonly Timeframe[]): BaseSeries[] {
  return [...new Set(timeframes.map((tf) => TIMEFRAMES[tf].baseSeries))];
}

/**
 * Timeframes grouped by the provider request they share.
 *
 * Timeframes in the same group are derived from the same candles, so they are
 * NOT independent evidence. The scoring engine uses this to avoid counting one
 * move as several confirmations.
 */
export function groupByBaseSeries(timeframes: readonly Timeframe[]): Map<BaseSeries, Timeframe[]> {
  const groups = new Map<BaseSeries, Timeframe[]>();
  for (const tf of timeframes) {
    const base = TIMEFRAMES[tf].baseSeries;
    const existing = groups.get(base);
    if (existing) existing.push(tf);
    else groups.set(base, [tf]);
  }
  return groups;
}

/** Provider request parameters per base series. */
export const BASE_SERIES_REQUEST: Record<
  BaseSeries,
  { interval: string; outputsize: number; ttlMs: number }
> = {
  "1min": { interval: "1min", outputsize: 400, ttlMs: 60_000 },
  "5min": { interval: "5min", outputsize: 1500, ttlMs: 30 * 60_000 },
  "1h": { interval: "1h", outputsize: 2000, ttlMs: 2 * 60 * 60_000 },
  "1day": { interval: "1day", outputsize: 1200, ttlMs: 12 * 60 * 60_000 },
};
