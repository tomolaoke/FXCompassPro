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

// ─── Default groups ──────────────────────────────────────────────────────────

/**
 * Execution / short-term: what price is doing now.
 * Context / higher-timeframe: what it is doing in the larger picture.
 *
 * These two are analysed separately and never merged into a single vote. That
 * separation is the point of the application.
 */
export const DEFAULT_EXECUTION_TIMEFRAMES: readonly Timeframe[] = ["M5", "M15", "M30", "H1"];

export const DEFAULT_CONTEXT_TIMEFRAMES: readonly Timeframe[] = ["H4", "D1", "W1", "MN"];

/**
 * Context timeframes whose conflict is treated as decisive in TREND_FOLLOWING
 * mode, and rendered most prominently everywhere.
 *
 * H4 and D1 are the timeframes that most often decide whether an intraday idea
 * survives the session, and the ones a beginner is most likely to overlook.
 */
export const DEFAULT_PRIMARY_CONTEXT_FILTERS: readonly Timeframe[] = ["H4", "D1"];

/**
 * Relative weight of a conflict on each context timeframe. Used for the
 * conflict penalty and for display prominence — not for voting, because
 * context timeframes do not vote.
 */
export const CONTEXT_CONFLICT_WEIGHT: Partial<Record<Timeframe, number>> = {
  H4: 1.0,
  D1: 1.0,
  W1: 0.6,
  MN: 0.4,
};

/**
 * M1 is defined so it can be charted and enabled deliberately, but it is not in
 * either default group. A timeframe outside the active configuration reports
 * NOT_CONFIGURED — which is exactly what that state is for.
 */
export const DEFAULT_UNCONFIGURED: readonly Timeframe[] = ["M1"];

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
