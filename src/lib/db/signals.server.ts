/**
 * Persists and retrieves the signal audit trail.
 *
 * Recording is explicit — called only when the user records a signal from the
 * UI, not on every background poll. A five-pair watchlist re-evaluates every
 * few minutes; writing every evaluation would flood a free-tier database with
 * rows nobody will ever read, for signals that mostly never left WATCH.
 */

import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "./client.server";
import type { EngineSignal, TimeframeReading } from "../market/engine/types";

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface RecordSignalInput {
  signal: EngineSignal;
  userDecision?: "accepted" | "rejected" | "ignored";
  userDecisionReason?: string;
}

/** Inserts one immutable audit row. Returns the row's id. */
export async function recordSignalAudit(input: RecordSignalInput): Promise<string> {
  const { signal } = input;
  const db = await getDb();
  const id = newId();

  await db.insert(schema.signals).values({
    id,
    symbol: signal.symbol,
    strategyVersion: signal.strategyVersion,
    label: signal.label,
    direction: signal.direction,
    readiness: signal.readiness,
    shortTermDirection: signal.shortTermDirection,
    higherTimeframeBias: signal.higherTimeframeBias,
    broadContextRelation: signal.broadContextRelation,
    primaryContextRelation: signal.primaryContextRelation,
    notFullyAlignedReason: signal.notFullyAlignedReason,
    countertrendBlocked: signal.countertrendBlocked,
    countertrendBlockReason: signal.countertrendBlockReason,
    scoreValue: signal.score.value,
    scoreLabel: signal.score.label,
    entryPrice: signal.entryPrice,
    stopLoss: signal.stopLoss,
    invalidationLevel: signal.invalidationLevel,
    takeProfit1: signal.takeProfit1,
    takeProfit2: signal.takeProfit2,
    takeProfit3: signal.takeProfit3,
    rrTp1: signal.riskRewardRatios.tp1,
    rrTp2: signal.riskRewardRatios.tp2,
    rrTp3: signal.riskRewardRatios.tp3,
    dataSource: signal.dataSource,
    dataKind: signal.dataKind,
    session: signal.session,
    timeframesJson: JSON.stringify(signal.timeframes),
    reasonsJson: JSON.stringify(signal.reasons),
    warningsJson: JSON.stringify(signal.warnings),
    blockReasonsJson: JSON.stringify(signal.blockReasons),
    calculationErrorsJson: JSON.stringify(signal.calculationErrors),
    userDecision: input.userDecision ?? null,
    userDecisionReason: input.userDecisionReason ?? null,
    outcome: "PENDING",
    rMultiple: null,
    generatedAt: signal.generatedAt,
    expiresAt: signal.expiresAt,
  });

  return id;
}

export interface UpdateOutcomeInput {
  id: string;
  outcome: "WIN" | "LOSS" | "BREAKEVEN" | "PENDING";
  rMultiple?: number | null;
}

/**
 * Updates only the outcome fields of a previously recorded signal — the
 * result of a user later marking a paper-traded idea as won, lost or
 * abandoned. Every other column is immutable once written; the audit trail
 * itself is never overwritten.
 */
export async function updateSignalOutcome(input: UpdateOutcomeInput): Promise<void> {
  const db = await getDb();
  await db
    .update(schema.signals)
    .set({ outcome: input.outcome, rMultiple: input.rMultiple ?? null })
    .where(eq(schema.signals.id, input.id));
}

export interface SignalHistoryQuery {
  symbol?: string;
  limit?: number;
}

export async function getSignalHistory(query: SignalHistoryQuery = {}) {
  const db = await getDb();
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);

  const rows = query.symbol
    ? await db
        .select()
        .from(schema.signals)
        .where(eq(schema.signals.symbol, query.symbol.toUpperCase()))
        .orderBy(desc(schema.signals.createdAt))
        .limit(limit)
    : await db.select().from(schema.signals).orderBy(desc(schema.signals.createdAt)).limit(limit);

  return rows.map((row) => ({
    ...row,
    timeframes: JSON.parse(row.timeframesJson) as TimeframeReading[],
    reasons: JSON.parse(row.reasonsJson) as string[],
    warnings: JSON.parse(row.warningsJson) as string[],
    blockReasons: JSON.parse(row.blockReasonsJson) as string[],
    calculationErrors: JSON.parse(row.calculationErrorsJson) as string[],
  }));
}

export interface LogAppErrorInput {
  level: "error" | "warning";
  area: string;
  message: string;
  context?: Record<string, unknown>;
}

/** Best-effort observability log. Never throws — a logging failure must not break the caller. */
export async function logAppError(input: LogAppErrorInput): Promise<void> {
  try {
    const db = await getDb();
    await db.insert(schema.appErrors).values({
      id: newId(),
      at: Date.now(),
      level: input.level,
      area: input.area,
      message: input.message,
      contextJson: input.context ? JSON.stringify(input.context) : null,
    });
  } catch {
    // Observability must never take down the feature it is observing.
  }
}
