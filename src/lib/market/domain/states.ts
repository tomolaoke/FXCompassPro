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
  "DATA_INVALID",
  "CANDLE_OPEN",
  "NOT_CONFIGURED",
] as const;

export type TimeframeState = (typeof TIMEFRAME_STATES)[number];

export const TIMEFRAME_STATE_LABEL: Record<TimeframeState, string> = {
  BULLISH: "Bullish",
  BEARISH: "Bearish",
  NEUTRAL: "Neutral",
  INCONCLUSIVE: "Inconclusive",
  DATA_MISSING: "Data unavailable",
  DATA_STALE: "Data stale",
  DATA_DELAYED: "Data delayed",
  DATA_INVALID: "Data invalid",
  CANDLE_OPEN: "Candle still open",
  NOT_CONFIGURED: "Not configured",
};

/**
 * How a timeframe's state stands relative to the proposed direction.
 *
 * Deliberately separate from the state itself. "Conflicting" is a relation, not
 * a reading: a weekly chart is BEARISH, and it is conflicting *relative to a
 * proposed BUY*. Folding that into the state would lose the direction and make
 * a bearish weekly under a SELL unrepresentable.
 *
 * The UI renders the pair, e.g. "CONFLICTING (bearish)".
 */
export type StateRelation = "AGREEING" | "CONFLICTING" | "NOT_APPLICABLE";

export const RELATION_LABEL: Record<StateRelation, string> = {
  AGREEING: "Agreeing",
  CONFLICTING: "Conflicting",
  NOT_APPLICABLE: "—",
};

/**
 * States that mean "the data itself is not usable".
 * These never count as agreement, disagreement, or neutrality — they block
 * confirmation outright.
 */
export const DATA_PROBLEM_STATES = [
  "DATA_MISSING",
  "DATA_STALE",
  "DATA_DELAYED",
  "DATA_INVALID",
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

// ─── Stochastic events ───────────────────────────────────────────────────────

/**
 * What the oscillator did, as opposed to whether the data is usable.
 *
 * Orthogonal to TimeframeState on purpose. A timeframe can be CURLING_UP *and*
 * DATA_STALE; merging the two vocabularies into one enum would make that
 * unrepresentable and would quietly turn a data fault into a momentum reading.
 */
export const STOCHASTIC_EVENTS = [
  "EXTREME_OVERSOLD",
  "EXTREME_OVERBOUGHT",
  "CURLING_UP",
  "CURLING_DOWN",
  "K_D_CROSS_UP",
  "K_D_CROSS_DOWN",
  "THRESHOLD_RECLAIM_UP",
  "THRESHOLD_RECLAIM_DOWN",
  "CONFIRMED_BULLISH",
  "CONFIRMED_BEARISH",
  "NEUTRAL",
  "INCONCLUSIVE",
] as const;

export type StochasticEvent = (typeof STOCHASTIC_EVENTS)[number];

export const STOCHASTIC_EVENT_LABEL: Record<StochasticEvent, string> = {
  EXTREME_OVERSOLD: "Deeply oversold",
  EXTREME_OVERBOUGHT: "Deeply overbought",
  CURLING_UP: "Turning up from a low reading",
  CURLING_DOWN: "Turning down from a high reading",
  K_D_CROSS_UP: "%K crossed above %D",
  K_D_CROSS_DOWN: "%K crossed below %D",
  THRESHOLD_RECLAIM_UP: "%K closed back above the oversold level",
  THRESHOLD_RECLAIM_DOWN: "%K closed back below the overbought level",
  CONFIRMED_BULLISH: "Bullish, confirmed by price action and structure",
  CONFIRMED_BEARISH: "Bearish, confirmed by price action and structure",
  NEUTRAL: "No usable reading",
  INCONCLUSIVE: "Mixed reading",
};

/**
 * Events that are NOT on their own a trade signal.
 *
 * An extreme reading persists for months in a strong trend; a %K/%D cross and a
 * threshold reclaim happen constantly. Only CONFIRMED_BULLISH and
 * CONFIRMED_BEARISH — which additionally require price action and structure —
 * may contribute to a trade-ready state.
 */
export const NON_SIGNAL_EVENTS = [
  "EXTREME_OVERSOLD",
  "EXTREME_OVERBOUGHT",
  "CURLING_UP",
  "CURLING_DOWN",
  "K_D_CROSS_UP",
  "K_D_CROSS_DOWN",
  "THRESHOLD_RECLAIM_UP",
  "THRESHOLD_RECLAIM_DOWN",
] as const satisfies readonly StochasticEvent[];

export function isTradeSignalEvent(event: StochasticEvent): boolean {
  return event === "CONFIRMED_BULLISH" || event === "CONFIRMED_BEARISH";
}

/** The raw numbers behind an event, kept so any reading can be re-derived. */
export interface StochasticReading {
  readonly k: number | null;
  readonly d: number | null;
  readonly previousK: number | null;
  readonly previousD: number | null;
  readonly kSlope: number | null;
  readonly dSlope: number | null;
  readonly crossDirection: "UP" | "DOWN" | "NONE";
  readonly thresholdCross: "RECLAIM_UP" | "BREAK_DOWN" | "NONE";
  /** The level crossed, when one was. */
  readonly crossedLevel: number | null;
  readonly candleClosed: boolean;
  readonly candleOpenTime: number;
  readonly calculatedAt: number;
  readonly event: StochasticEvent;
}

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

// ─── Readiness and the user-facing label ─────────────────────────────────────

/**
 * How far along the validation ladder a setup has got. Each rung has its own
 * gate; see docs/signal-states.md.
 */
export const READINESS_LEVELS = ["NONE", "WATCH", "SETUP", "READY"] as const;
export type Readiness = (typeof READINESS_LEVELS)[number];

/** How broad context (MN, W1) stands relative to the proposed direction. */
export type BroadContextRelation = "ALIGNED" | "CONFLICTING" | "NEUTRAL" | "UNAVAILABLE";

/**
 * The exact strings shown to the user. There is no plain "BUY" or "SELL".
 *
 * A direction word never appears on its own, because on its own it is what
 * makes a beginner assume every chart agrees.
 */
export const SIGNAL_LABELS = [
  "WATCH — POTENTIAL BUY",
  "WATCH — POTENTIAL SELL",
  "BUY SETUP — WAITING FOR M5/M1 CONFIRMATION",
  "SELL SETUP — WAITING FOR M5/M1 CONFIRMATION",
  "BUY READY",
  "SELL READY",
  "BUY READY — COUNTERTREND WARNING",
  "SELL READY — COUNTERTREND WARNING",
  "FULLY ALIGNED BUY READY",
  "FULLY ALIGNED SELL READY",
  "WAIT — NO VALID SETUP",
  "INSUFFICIENT DATA",
  "DATA QUALITY ERROR",
  "INVALID",
  "EXPIRED",
] as const;

export type SignalLabel = (typeof SIGNAL_LABELS)[number];

export interface LabelInput {
  readonly direction: "BUY" | "SELL" | null;
  readonly readiness: Readiness;
  readonly broadContext: BroadContextRelation;
  /** Overrides everything below it. */
  readonly terminal?: "INSUFFICIENT_DATA" | "DATA_QUALITY_ERROR" | "INVALID" | "EXPIRED";
}

/**
 * The single place a user-facing label is produced.
 *
 * Plain "BUY READY" means specifically: entry conditions pass, but MN/W1 are
 * neutral or unavailable, so the setup cannot honestly be called fully aligned.
 * That third case is real and needs its own label — without it, a setup with no
 * weekly data would have to masquerade as either aligned or conflicted.
 */
export function signalLabel(input: LabelInput): SignalLabel {
  switch (input.terminal) {
    case "INSUFFICIENT_DATA":
      return "INSUFFICIENT DATA";
    case "DATA_QUALITY_ERROR":
      return "DATA QUALITY ERROR";
    case "INVALID":
      return "INVALID";
    case "EXPIRED":
      return "EXPIRED";
    default:
      break;
  }

  if (input.direction === null || input.readiness === "NONE") return "WAIT — NO VALID SETUP";

  const buy = input.direction === "BUY";

  switch (input.readiness) {
    case "WATCH":
      return buy ? "WATCH — POTENTIAL BUY" : "WATCH — POTENTIAL SELL";
    case "SETUP":
      return buy
        ? "BUY SETUP — WAITING FOR M5/M1 CONFIRMATION"
        : "SELL SETUP — WAITING FOR M5/M1 CONFIRMATION";
    case "READY":
      switch (input.broadContext) {
        case "ALIGNED":
          return buy ? "FULLY ALIGNED BUY READY" : "FULLY ALIGNED SELL READY";
        case "CONFLICTING":
          return buy ? "BUY READY — COUNTERTREND WARNING" : "SELL READY — COUNTERTREND WARNING";
        case "NEUTRAL":
        case "UNAVAILABLE":
          return buy ? "BUY READY" : "SELL READY";
      }
  }
}

/**
 * Why a READY setup is not FULLY ALIGNED. Shown next to a plain BUY/SELL READY
 * so the absence of the "fully aligned" wording is explained rather than left
 * for the user to notice.
 */
export function notFullyAlignedReason(relation: BroadContextRelation): string | null {
  switch (relation) {
    case "NEUTRAL":
      return "Monthly and weekly charts show no clear direction, so this cannot be called fully aligned.";
    case "UNAVAILABLE":
      return "Monthly and/or weekly data is unavailable, so alignment with the bigger picture is unverified.";
    case "CONFLICTING":
      return "Monthly and/or weekly charts disagree with this direction. This is a countertrend setup and carries higher risk.";
    case "ALIGNED":
      return null;
  }
}

/**
 * Whether a label may be rendered with a bullish/bearish colour badge.
 *
 * Only the READY rungs qualify. WATCH, SETUP and every terminal state render
 * neutral or amber, so a developing or broken setup can never look like a green
 * go-ahead.
 */
export function allowsDirectionalBadge(label: SignalLabel): boolean {
  return label.includes("READY");
}

/** READY labels that must additionally carry a prominent risk warning. */
export function requiresCountertrendWarning(label: SignalLabel): boolean {
  return label.includes("COUNTERTREND");
}

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
