/**
 * The output of the new engine. Replaces the old flat `Signal` shape in
 * ../types.ts, which merged short-term and higher-timeframe evidence into one
 * vote and could render a plain BUY/SELL.
 */

import type {
  BlockReason,
  BroadContextRelation,
  GroupDirection,
  HeuristicScore,
  Readiness,
  SignalLabel,
  StateRelation,
  StochasticReading,
  TimeframeState,
} from "../domain/states";
import type { MarketSession } from "../domain/clock";
import type { Timeframe, TimeframeRole } from "../config/timeframes";
import type { QuoteKind } from "../types";
import type { BrokerComparison } from "../broker/compare";

export interface TimeframeReading {
  readonly timeframe: Timeframe;
  readonly role: TimeframeRole;
  readonly state: TimeframeState;
  /** How this timeframe's state stands relative to the final direction. */
  readonly relation: StateRelation;
  readonly stochastic: StochasticReading | null;
  readonly dataAgeMs: number | null;
  readonly candleClosed: boolean | null;
  readonly candleOpenTime: number | null;
  readonly isSynthetic: boolean;
  readonly provider: string;
  readonly includedInStrategy: boolean;
  readonly explanation: string;
}

export interface EngineSignal {
  readonly symbol: string;
  readonly strategyVersion: string;

  readonly label: SignalLabel;
  readonly direction: "BUY" | "SELL" | null;
  readonly readiness: Readiness;

  readonly shortTermDirection: GroupDirection;
  readonly higherTimeframeBias: GroupDirection;
  readonly broadContextRelation: BroadContextRelation;
  readonly primaryContextRelation: BroadContextRelation;
  readonly notFullyAlignedReason: string | null;

  readonly countertrendBlocked: boolean;
  readonly countertrendBlockReason: string | null;

  readonly timeframes: readonly TimeframeReading[];

  readonly score: HeuristicScore;
  readonly reasons: readonly string[];
  readonly warnings: readonly string[];
  readonly blockReasons: readonly BlockReason[];
  /** Non-empty means the numbers failed validation and must not be traded. */
  readonly calculationErrors: readonly string[];

  readonly entryZone: readonly [number, number] | null;
  readonly entryPrice: number | null;
  readonly stopLoss: number | null;
  readonly invalidationLevel: number | null;
  readonly takeProfit1: number | null;
  readonly takeProfit2: number | null;
  readonly takeProfit3: number | null;
  readonly riskRewardRatios: { tp1: number | null; tp2: number | null; tp3: number | null };
  readonly triggerCondition: string;
  readonly invalidationCondition: string;

  readonly session: MarketSession;
  readonly newsRisk: string | null;
  readonly brokerComparison: BrokerComparison | null;

  readonly dataTimestamp: number;
  readonly dataSource: string;
  readonly dataKind: QuoteKind;
  readonly generatedAt: number;
  readonly expiresAt: number;
}
