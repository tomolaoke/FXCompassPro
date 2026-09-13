export type Timeframe = "MN" | "W1" | "D1" | "H4" | "H1" | "M30" | "M15" | "M5" | "M1";

export const ALL_TIMEFRAMES: Timeframe[] = [
  "MN",
  "W1",
  "D1",
  "H4",
  "H1",
  "M30",
  "M15",
  "M5",
  "M1",
];

/** MN / W1 give broad context only and can never block a signal. */
export const CONTEXT_TIMEFRAMES: Timeframe[] = ["MN", "W1"];
/** The main directional / confirmation stack. */
export const CONFIRMATION_TIMEFRAMES: Timeframe[] = ["D1", "H4", "H1", "M30", "M15"];
/** Timing only: M5 confirms, M1 triggers. */
export const ENTRY_TIMEFRAMES: Timeframe[] = ["M5", "M1"];

export type TimeframeRole = "CONTEXT" | "CONFIRMATION" | "ENTRY";

export function roleOf(tf: Timeframe): TimeframeRole {
  if (CONTEXT_TIMEFRAMES.includes(tf)) return "CONTEXT";
  if (ENTRY_TIMEFRAMES.includes(tf)) return "ENTRY";
  return "CONFIRMATION";
}

export const TF_MINUTES: Record<Timeframe, number> = {
  MN: 43200,
  W1: 10080,
  D1: 1440,
  H4: 240,
  H1: 60,
  M30: 30,
  M15: 15,
  M5: 5,
  M1: 1,
};

export interface Candle {
  /** epoch ms of candle open */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export type QuoteKind = "live" | "delayed" | "manual" | "stale" | "demo";

export interface Quote {
  symbol: string;
  bid: number | null;
  ask: number | null;
  mid: number;
  spread: number | null;
  timestamp: number;
  provider: string;
  kind: QuoteKind;
  /** 0-100 data quality indicator */
  quality: number;
  note?: string;
}

export interface InstrumentSpec {
  symbol: string;
  label: string;
  digits: number;
  /** price change that equals one pip/tick */
  pipSize: number;
  /** units per 1.0 lot; null when unknown (user must supply) */
  contractSize: number | null;
  /** account-currency value of one pip per 1.0 lot; null when unknown */
  pipValuePerLot: number | null;
  /** typical broker spread in pips, informational only */
  typicalSpreadPips: number | null;
  supported: boolean;
}

export type Direction = "BUY" | "SELL" | "WAIT";
export type ConfidenceLabel = "LOW" | "MEDIUM" | "HIGH";
export type SignalState =
  | "WAIT"
  | "WATCH"
  | "READY"
  | "TRIGGERED"
  | "MISSED"
  | "INVALIDATED"
  | "INVALID"
  | "INSUFFICIENT_DATA"
  | "EXPIRED";

export type StochZone = "OVERSOLD" | "OVERBOUGHT" | "NEUTRAL";
export type StochBehaviour =
  | "EXTREME"
  | "CURVING"
  | "CROSSED"
  | "CONFIRMED"
  | "NO_CONFIRMATION";
export type BiasDirection = "BULLISH" | "BEARISH" | "NEUTRAL";
export type DataStatus = "VALID" | "STALE" | "UNAVAILABLE";
/** How MN / W1 context was treated for this reading. */
export type ContextStatus = "USED" | "NOT_AVAILABLE" | "STALE" | "CONFLICTING";

export interface TimeframeEvidence {
  timeframe: Timeframe;
  role: TimeframeRole;
  stochasticK: number | null;
  stochasticD: number | null;
  zone: StochZone;
  state: StochBehaviour;
  crossLevel: 20 | 30 | 70 | 80 | null;
  direction: BiasDirection;
  used: boolean;
  dataStatus: DataStatus;
  /** agrees with the final signal direction */
  aligned: boolean;
  explanation: string;
}

export type StochState =
  | "OVERSOLD"
  | "RECOVERING_FROM_OVERSOLD"
  | "NEUTRAL"
  | "ROLLING_FROM_OVERBOUGHT"
  | "OVERBOUGHT"
  | "UNKNOWN";

export interface HigherContext {
  monthly: ContextStatus;
  weekly: ContextStatus;
  monthlyDirection: BiasDirection;
  weeklyDirection: BiasDirection;
  used: boolean;
  conflict: boolean;
  /** why the signal was still allowed while MN / W1 disagree */
  allowedDespiteConflict: string | null;
}

export interface Explanations {
  en: string;
  caveman: string;
  pidgin: string;
  source: "groq" | "deterministic";
}

export interface Signal {
  symbol: string;
  direction: Direction;
  state: SignalState;
  /** setup quality score, NOT a win probability */
  confidenceScore: number;
  confidenceLabel: ConfidenceLabel;
  setupType: string;
  entryZone: [number, number] | null;
  /** the exact price every R:R figure below is calculated from */
  entryPrice: number | null;
  invalidationLevel: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  takeProfit3: number | null;
  riskRewardRatios: { tp1: number | null; tp2: number | null; tp3: number | null };
  reasons: string[];
  warnings: string[];
  whyItMayFail: string[];
  /** non-empty means the numbers failed validation and must not be traded */
  calculationErrors: string[];
  triggerCondition: string;
  invalidationCondition: string;
  newsRisk: string | null;
  session: Session;
  timeframeEvidence: TimeframeEvidence[];
  higherContext: HigherContext;
  explanations?: Explanations;
  dataTimestamp: number;
  dataSource: string;
  dataKind: QuoteKind;
  expiresAt: number;
}

export type Session = "ASIA" | "LONDON" | "NEW_YORK" | "LONDON_NY_OVERLAP" | "OFF_HOURS";

export interface RiskSettings {
  accountCapital: number;
  accountCurrency: string;
  riskPercent: number;
  maxDailyLossPercent: number;
  maxOpenTrades: number;
  maxCorrelatedExposure: number;
  allowStacking: boolean;
  allowPartials: boolean;
  leverage: number;
  minLot: number;
  lotStep: number;
  maxLot: number;
  maxSpreadPips: number;
  maxDataAgeMinutes: number;
}

export interface AppSettings {
  risk: RiskSettings;
  watchlist: string[];
  confirmationTimeframes: Timeframe[];
  executionTimeframe: Timeframe;
  language: "en" | "caveman" | "pidgin";
  advancedView: boolean;
  provider: string;
}

export interface JournalEntry {
  id: string;
  createdAt: number;
  symbol: string;
  direction: "BUY" | "SELL";
  plannedEntry: number | null;
  actualEntry: number | null;
  stop: number | null;
  target1: number | null;
  lotSize: number | null;
  riskAmount: number | null;
  setupType: string;
  timeframesAligned: Timeframe[];
  session: Session;
  stochState: StochState;
  newsConditions: string;
  reason: string;
  emotion: string;
  result: "WIN" | "LOSS" | "BREAKEVEN" | "OPEN";
  rMultiple: number | null;
  mistakes: string;
  lessons: string;
  screenshotName?: string;
}

/** A record of a signal the app produced, plus whether the user acted on it. */
export interface SignalRecord {
  id: string;
  createdAt: number;
  symbol: string;
  direction: Direction;
  setupType: string;
  score: number;
  entryZone: [number, number] | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  taken: boolean | null;
  outcome: "WIN" | "LOSS" | "BREAKEVEN" | "PENDING" | "SKIPPED";
  rMultiple: number | null;
  dataKind: QuoteKind;
  session: Session;
  notes: string;
}
