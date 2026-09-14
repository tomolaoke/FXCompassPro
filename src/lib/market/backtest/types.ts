import type { Candle, RiskSettings } from "../types";
import type { StrategyConfig } from "../config/strategy";
import type { Timeframe } from "../config/timeframes";
import type { EngineSignal } from "../engine/types";

/** How to resolve a candle whose range touches both the stop and a target. */
export const SAME_CANDLE_RULES = ["STOP_FIRST", "TARGET_FIRST", "EXCLUDE"] as const;
export type SameCandleRule = (typeof SAME_CANDLE_RULES)[number];

export interface BacktestCosts {
  /** Spread in price units (not pips), applied against the trade on entry and exit. */
  readonly spread: number;
  /** Slippage in price units, applied against the trade on entry and exit. */
  readonly slippage: number;
  /**
   * Commission per side, expressed directly in price units rather than
   * account-currency-per-lot. A currency-denominated figure needs a lot size,
   * which depends on account risk settings and pip value — wiring that
   * through is real position-sizing integration, not a backtest concern, so
   * this stays a documented simplification until that lands.
   */
  readonly commissionPriceUnitsPerSide: number;
}

export interface BacktestConfig {
  readonly symbol: string;
  /**
   * Historical base-timeframe candles spanning the whole run. Every other
   * configured timeframe is derived from these by the same broker-session
   * aggregation the live engine uses — see docs/backtesting.md.
   */
  readonly baseTimeframe: Timeframe;
  readonly baseCandles: readonly Candle[];
  readonly strategy: StrategyConfig;
  readonly strategyVersion: string;
  readonly risk: RiskSettings;
  readonly costs: BacktestCosts;
  readonly sameCandleRule: SameCandleRule;
  /** Bars a READY signal stays valid waiting for price to reach the entry zone. */
  readonly maxBarsToFill: number;
}

export type TradeExitReason =
  | "STOP"
  | "TAKE_PROFIT_1"
  | "TAKE_PROFIT_2"
  | "TAKE_PROFIT_3"
  | "EXPIRED_UNFILLED"
  | "SAME_CANDLE_EXCLUDED"
  | "END_OF_DATA";

export interface BacktestTrade {
  readonly direction: "BUY" | "SELL";
  readonly signalGeneratedAt: number;
  readonly signalLabel: string;
  /** Null when the signal expired before price reached the entry zone. */
  readonly entryAt: number | null;
  readonly entryPrice: number | null;
  readonly stopLoss: number;
  readonly takeProfits: readonly [number, number, number];
  readonly exitAt: number | null;
  readonly exitPrice: number | null;
  readonly exitReason: TradeExitReason;
  /** Net of spread, slippage and commission. Null for an unfilled signal. */
  readonly pnl: number | null;
  /** In units of initial risk. Null for an unfilled signal. */
  readonly rMultiple: number | null;
  readonly session: string;
  readonly higherTimeframeBias: string;
  readonly broadContextRelation: string;
}

export interface BacktestRun {
  readonly symbol: string;
  readonly strategyVersion: string;
  readonly fromT: number;
  readonly toT: number;
  readonly trades: readonly BacktestTrade[];
  /** Signals the replay produced that never became a trade — no fill, or blocked. */
  readonly candidateCount: number;
}
