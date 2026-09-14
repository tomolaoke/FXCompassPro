/**
 * Persisted signal audit trail.
 *
 * Every row preserves the exact evidence and strategy version behind one
 * evaluation, so any past signal can be reproduced: "what exactly did the app
 * see, and what rules was it applying, when it said that?" Per-timeframe
 * evidence, reasons, warnings and block reasons are stored as JSON rather than
 * normalised into their own tables — they are read as a unit (the whole "why
 * this signal?" panel) far more often than they are queried piecemeal, and a
 * JSON column keeps the shape free to evolve without a migration each time a
 * field is added to EngineSignal.
 *
 * SQLite (via libSQL/Turso) is used because it embeds a normal Drizzle SQLite
 * dialect and needs no separate database server. On Vercel's serverless
 * filesystem a local file does not persist between invocations, so production
 * always points DATABASE_URL at a remote libsql:// URL — see
 * docs/environment.md.
 */

import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const signals = sqliteTable(
  "signals",
  {
    id: text("id").primaryKey(),
    symbol: text("symbol").notNull(),
    strategyVersion: text("strategy_version").notNull(),

    label: text("label").notNull(),
    direction: text("direction"), // "BUY" | "SELL" | null
    readiness: text("readiness").notNull(),

    shortTermDirection: text("short_term_direction").notNull(),
    higherTimeframeBias: text("higher_timeframe_bias").notNull(),
    broadContextRelation: text("broad_context_relation").notNull(),
    primaryContextRelation: text("primary_context_relation").notNull(),
    notFullyAlignedReason: text("not_fully_aligned_reason"),

    countertrendBlocked: integer("countertrend_blocked", { mode: "boolean" }).notNull(),
    countertrendBlockReason: text("countertrend_block_reason"),

    scoreValue: real("score_value").notNull(),
    scoreLabel: text("score_label").notNull(),

    entryPrice: real("entry_price"),
    stopLoss: real("stop_loss"),
    invalidationLevel: real("invalidation_level"),
    takeProfit1: real("take_profit_1"),
    takeProfit2: real("take_profit_2"),
    takeProfit3: real("take_profit_3"),
    rrTp1: real("rr_tp1"),
    rrTp2: real("rr_tp2"),
    rrTp3: real("rr_tp3"),

    dataSource: text("data_source").notNull(),
    dataKind: text("data_kind").notNull(),
    session: text("session").notNull(),

    /** Full per-timeframe evidence: state, relation, role, Stochastic reading. */
    timeframesJson: text("timeframes_json").notNull(),
    reasonsJson: text("reasons_json").notNull(),
    warningsJson: text("warnings_json").notNull(),
    blockReasonsJson: text("block_reasons_json").notNull(),
    calculationErrorsJson: text("calculation_errors_json").notNull(),

    /** How the user responded, when recorded from the UI. */
    userDecision: text("user_decision"), // "accepted" | "rejected" | "ignored" | null
    userDecisionReason: text("user_decision_reason"),
    outcome: text("outcome"), // "WIN" | "LOSS" | "BREAKEVEN" | "PENDING" | null
    rMultiple: real("r_multiple"),

    generatedAt: integer("generated_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch('now', 'subsec') * 1000)`),
  },
  (table) => [
    index("signals_symbol_idx").on(table.symbol),
    index("signals_created_at_idx").on(table.createdAt),
  ],
);

export type SignalRow = typeof signals.$inferSelect;
export type NewSignalRow = typeof signals.$inferInsert;

/**
 * Application errors worth keeping past the current process — background
 * observability rather than the client-facing warnings already carried on
 * each signal.
 */
export const appErrors = sqliteTable(
  "app_errors",
  {
    id: text("id").primaryKey(),
    at: integer("at").notNull(),
    level: text("level").notNull(), // "error" | "warning"
    area: text("area").notNull(),
    message: text("message").notNull(),
    contextJson: text("context_json"),
  },
  (table) => [index("app_errors_at_idx").on(table.at)],
);

export type AppErrorRow = typeof appErrors.$inferSelect;
export type NewAppErrorRow = typeof appErrors.$inferInsert;

/**
 * Manually entered high-impact news events — see docs/data-providers.md for
 * why: free economic-calendar APIs need a key and are unreliable, so the
 * honest default is a calendar you maintain yourself, with the app refusing
 * to treat an empty or unmaintained calendar as "no news".
 */
export const newsEvents = sqliteTable(
  "news_events",
  {
    id: text("id").primaryKey(),
    currency: text("currency").notNull(),
    title: text("title").notNull(),
    impact: text("impact").notNull(), // "HIGH" | "MEDIUM" | "LOW"
    eventTimeUtc: integer("event_time_utc").notNull(),
    source: text("source").notNull().default("manual"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch('now', 'subsec') * 1000)`),
  },
  (table) => [
    index("news_events_currency_idx").on(table.currency),
    index("news_events_time_idx").on(table.eventTimeUtc),
  ],
);

export type NewsEventRow = typeof newsEvents.$inferSelect;
export type NewNewsEventRow = typeof newsEvents.$inferInsert;
