/**
 * The vocabulary of the analysis engine.
 *
 * Four layers, deliberately not collapsed into one word:
 *
 *   timeframe state  ->  short-term direction  \
 *                                               ->  alignment  ->  permission
 *   timeframe state  ->  higher-timeframe bias /
 *
 * Collapsing them is what makes retail signal tools misleading, so the types
 * here are built so that collapsing them is a compile error rather than a
 * judgement call. See docs/signal-states.md.
 */

// ─── Layer 1: per-timeframe state ────────────────────────────────────────────

export const TIMEFRAME_STATES = [
  "BULLISH",
  "BEARISH",
  "NEUTRAL",
  "INCONCLUSIVE",
  "DATA_MISSING",
  "DATA_STALE",
  "DATA_DELAYED",
  "CANDLE_OPEN",
  "NOT_CONFIGURED",
] as const;

export type TimeframeState = (typeof TIMEFRAME_STATES)[number];

/**
 * States that mean "the data itself is not usable".
 * These never count as agreement, disagreement, or neutrality — they block
 * confirmation outright.
 */
export const DATA_PROBLEM_STATES = [
  "DATA_MISSING",
  "DATA_STALE",
  "DATA_DELAYED",
] as const satisfies readonly TimeframeState[];

export type DataProblemState = (typeof DATA_PROBLEM_STATES)[number];

export function isDataProblem(state: TimeframeState): state is DataProblemState {
  return (DATA_PROBLEM_STATES as readonly TimeframeState[]).includes(state);
}

/** Only BULLISH and BEARISH may contribute to a direction. */
export type DirectionalState = Extract<TimeframeState, "BULLISH" | "BEARISH">;

export function isDirectional(state: TimeframeState): state is DirectionalState {
  return state === "BULLISH" || state === "BEARISH";
}

/**
 * A timeframe reading that is present and evaluated, as opposed to excluded.
 * `NOT_CONFIGURED` is the only state that means "the strategy does not look
 * here"; everything else means "we looked".
 */
export function wasEvaluated(state: TimeframeState): boolean {
  return state !== "NOT_CONFIGURED";
}

/**
 * `NOT_CONFIGURED` may only be produced by the strategy-config reader.
 *
 * The brand makes that enforceable: engine code cannot construct this value
 * without importing the factory below, which lives beside the config reader and
 * is the only sanctioned source. This is the guard against the original defect,
 * where "not used" was shown for timeframes that actually disagreed or had no
 * data.
 */
declare const ConfigReaderOnly: unique symbol;
export type NotConfiguredToken = { readonly [ConfigReaderOnly]: true };

/**
 * Produces the `NOT_CONFIGURED` state. Call this ONLY when the active strategy
 * configuration deliberately excludes the timeframe.
 *
 * Never call it for a timeframe that disagrees (that is BULLISH/BEARISH plus a
 * conflict in the alignment layer), is unclear (INCONCLUSIVE), has no usable
 * data (DATA_*), or is still forming (CANDLE_OPEN).
 */
export function notConfigured(reason: "excluded-by-strategy"): TimeframeState {
  // The parameter exists to make the caller state why, at the call site.
  void reason;
  return "NOT_CONFIGURED";
}

// ─── Layer 2: group direction ────────────────────────────────────────────────

export const GROUP_DIRECTIONS = [
  "BULLISH",
  "BEARISH",
  "NEUTRAL",
  "INCONCLUSIVE",
  "INSUFFICIENT_DATA",
] as const;

export type GroupDirection = (typeof GROUP_DIRECTIONS)[number];

/** Which half of the analysis a timeframe belongs to. */
export type TimeframeRole = "EXECUTION" | "CONTEXT";

// ─── Layer 3: alignment ──────────────────────────────────────────────────────

export const ALIGNMENT_STATUSES = [
  "FULLY_ALIGNED_BUY",
  "FULLY_ALIGNED_SELL",
  "SHORT_TERM_BUY_HTF_CONFLICT",
  "SHORT_TERM_SELL_HTF_CONFLICT",
  "NEUTRAL_NO_SETUP",
  "INSUFFICIENT_DATA",
  "DATA_QUALITY_ERROR",
] as const;

export type AlignmentStatus = (typeof ALIGNMENT_STATUSES)[number];

export const ALIGNMENT_LABEL: Record<AlignmentStatus, string> = {
  FULLY_ALIGNED_BUY: "FULLY ALIGNED BUY",
  FULLY_ALIGNED_SELL: "FULLY ALIGNED SELL",
  SHORT_TERM_BUY_HTF_CONFLICT: "SHORT-TERM BUY — HIGHER-TIMEFRAME CONFLICT",
  SHORT_TERM_SELL_HTF_CONFLICT: "SHORT-TERM SELL — HIGHER-TIMEFRAME CONFLICT",
  NEUTRAL_NO_SETUP: "NEUTRAL / NO CLEAR SETUP",
  INSUFFICIENT_DATA: "INSUFFICIENT DATA",
  DATA_QUALITY_ERROR: "DATA QUALITY ERROR",
};

export function isConflict(status: AlignmentStatus): boolean {
  return status === "SHORT_TERM_BUY_HTF_CONFLICT" || status === "SHORT_TERM_SELL_HTF_CONFLICT";
}

export function isFullyAligned(status: AlignmentStatus): boolean {
  return status === "FULLY_ALIGNED_BUY" || status === "FULLY_ALIGNED_SELL";
}

// ─── Layer 4: trade permission ───────────────────────────────────────────────

export const PERMISSION_MODES = ["STRICT", "TREND_FOLLOWING", "COUNTERTREND", "MANUAL"] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const PERMISSION_MODE_LABEL: Record<PermissionMode, string> = {
  STRICT: "Strict — any conflict blocks the trade",
  TREND_FOLLOWING: "Trend-following — must agree with the higher-timeframe filters",
  COUNTERTREND: "Countertrend — high risk, explicitly enabled",
  MANUAL: "Manual — analysis only, no trade permission is issued",
};

export type TradePermission = "BUY" | "SELL" | "NO_TRADE";

/**
 * Why a trade permission was refused. Every refusal names a reason; there is no
 * unexplained NO_TRADE.
 */
export const BLOCK_REASONS = [
  "HTF_CONFLICT",
  "NOT_FULLY_ALIGNED",
  "INCONCLUSIVE_TIMEFRAME",
  "DATA_QUALITY",
  "SYNTHETIC_DATA",
  "PROVISIONAL_CANDLE",
  "INSUFFICIENT_DATA",
  "NO_INVALIDATION",
  "NO_RISK_REWARD",
  "STOP_OUT_OF_BOUNDS",
  "SPREAD_TOO_WIDE",
  "BROKER_PRICE_MISMATCH",
  "NEWS_WINDOW",
  "NO_LOCATION_EDGE",
  "NO_STRUCTURE_CONFIRMATION",
  "DAILY_RISK_LIMIT",
  "MANUAL_MODE",
] as const;

export type BlockReason = (typeof BLOCK_REASONS)[number];

export const BLOCK_REASON_LABEL: Record<BlockReason, string> = {
  HTF_CONFLICT: "Higher timeframes disagree with the short-term direction",
  NOT_FULLY_ALIGNED: "Not every configured timeframe agrees",
  INCONCLUSIVE_TIMEFRAME: "At least one configured timeframe gave no clear reading",
  DATA_QUALITY: "Data is missing, stale or delayed",
  SYNTHETIC_DATA: "Sample data — not a real market price",
  PROVISIONAL_CANDLE: "The candle has not closed yet",
  INSUFFICIENT_DATA: "Not enough valid timeframes to judge",
  NO_INVALIDATION: "No valid invalidation price could be calculated",
  NO_RISK_REWARD: "No valid risk-to-reward ratio could be calculated",
  STOP_OUT_OF_BOUNDS: "The required stop is too tight or too wide to be practical",
  SPREAD_TOO_WIDE: "Spread is above your configured limit",
  BROKER_PRICE_MISMATCH: "Provider and broker prices disagree beyond tolerance",
  NEWS_WINDOW: "A high-impact news event is inside the configured buffer",
  NO_LOCATION_EDGE: "Price is not at a mapped support or resistance level",
  NO_STRUCTURE_CONFIRMATION: "Price action has not confirmed the turn",
  DAILY_RISK_LIMIT: "Your maximum daily risk has already been committed",
  MANUAL_MODE: "Manual mode never issues a trade permission",
};

// ─── Signal lifecycle ────────────────────────────────────────────────────────

export const LIFECYCLE_STATES = [
  "DRAFT",
  "CONFIRMED",
  "ACTIVE",
  "TRIGGERED",
  "INVALIDATED",
  "EXPIRED",
  "COMPLETED",
  "CANCELLED",
] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/** Terminal states: a signal in one of these never changes again. */
export const TERMINAL_LIFECYCLE_STATES = [
  "INVALIDATED",
  "EXPIRED",
  "COMPLETED",
  "CANCELLED",
] as const satisfies readonly LifecycleState[];

export function isTerminal(state: LifecycleState): boolean {
  return (TERMINAL_LIFECYCLE_STATES as readonly LifecycleState[]).includes(state);
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

/**
 * Score categories. Each carries its own cap so that several correlated
 * readings of one impulse cannot stack into false confidence.
 */
export const SCORE_CATEGORIES = [
  "MOMENTUM",
  "LOCATION",
  "STRUCTURE",
  "TREND",
  "VOLATILITY",
  "MTF_AGREEMENT",
] as const;

export type ScoreCategory = (typeof SCORE_CATEGORIES)[number];

/**
 * The score is a heuristic, never a probability. The type carries that so the
 * UI cannot accidentally render it as a percentage chance of anything.
 */
export interface HeuristicScore {
  readonly value: number;
  readonly max: number;
  readonly label: "LOW" | "MEDIUM" | "HIGH";
  /** Always true until the score is statistically calibrated against outcomes. */
  readonly isHeuristic: true;
  /** Set when a cap was applied, e.g. a higher-timeframe conflict. */
  readonly cappedBy: string | null;
  readonly byCategory: Record<ScoreCategory, number>;
}

// ─── Data provenance ─────────────────────────────────────────────────────────

export type DataQuality = "VERIFIED" | "DELAYED" | "STALE" | "MISSING" | "SYNTHETIC";

export const DATA_QUALITY_LABEL: Record<DataQuality, string> = {
  VERIFIED: "Verified",
  DELAYED: "Delayed",
  STALE: "Stale",
  MISSING: "Unavailable",
  SYNTHETIC: "Sample data — not a real price",
};

/** News lookups distinguish "no events" from "we could not check". */
export type NewsStatus = "CLEAR" | "EVENT_NEARBY" | "UNAVAILABLE";

export const NEWS_STATUS_LABEL: Record<NewsStatus, string> = {
  CLEAR: "No high-impact events in the buffer window",
  EVENT_NEARBY: "High-impact event nearby",
  UNAVAILABLE: "NEWS CHECK UNAVAILABLE — VERIFY ECONOMIC CALENDAR MANUALLY",
};
