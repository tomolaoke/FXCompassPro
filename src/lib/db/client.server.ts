/**
 * Database client. SQLite over libSQL, which works identically against a
 * local file (development) and a remote Turso database (production) — the
 * same schema and queries run against both.
 *
 * On Vercel's serverless filesystem a local file does not survive between
 * invocations, so DATABASE_URL must point at a real libsql:// URL with
 * DATABASE_AUTH_TOKEN set in production. See docs/environment.md for the
 * five-minute Turso setup.
 *
 * Schema creation is inline `CREATE TABLE IF NOT EXISTS` rather than a
 * drizzle-kit migration pipeline: for a single evolving table set this stays
 * simpler to deploy — no separate migration step to run against a serverless
 * target — at the cost of not tracking schema history. If the schema grows
 * enough to need real migrations, move to drizzle-kit then.
 */

import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

let client: Client | undefined;
let db: LibSQLDatabase<typeof schema> | undefined;
let schemaReady: Promise<void> | undefined;

function databaseUrl(): string {
  return process.env["DATABASE_URL"]?.trim() || "file:./data/fxcompass.db";
}

function authToken(): string | undefined {
  const raw = process.env["DATABASE_AUTH_TOKEN"];
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

function getClient(): Client {
  if (!client) {
    const token = authToken();
    client = createClient({ url: databaseUrl(), ...(token ? { authToken: token } : {}) });
  }
  return client;
}

const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  strategy_version TEXT NOT NULL,
  label TEXT NOT NULL,
  direction TEXT,
  readiness TEXT NOT NULL,
  short_term_direction TEXT NOT NULL,
  higher_timeframe_bias TEXT NOT NULL,
  broad_context_relation TEXT NOT NULL,
  primary_context_relation TEXT NOT NULL,
  not_fully_aligned_reason TEXT,
  countertrend_blocked INTEGER NOT NULL,
  countertrend_block_reason TEXT,
  score_value REAL NOT NULL,
  score_label TEXT NOT NULL,
  entry_price REAL,
  stop_loss REAL,
  invalidation_level REAL,
  take_profit_1 REAL,
  take_profit_2 REAL,
  take_profit_3 REAL,
  rr_tp1 REAL,
  rr_tp2 REAL,
  rr_tp3 REAL,
  data_source TEXT NOT NULL,
  data_kind TEXT NOT NULL,
  session TEXT NOT NULL,
  timeframes_json TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  block_reasons_json TEXT NOT NULL,
  calculation_errors_json TEXT NOT NULL,
  user_decision TEXT,
  user_decision_reason TEXT,
  outcome TEXT,
  r_multiple REAL,
  generated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);
CREATE INDEX IF NOT EXISTS signals_symbol_idx ON signals (symbol);
CREATE INDEX IF NOT EXISTS signals_created_at_idx ON signals (created_at);

CREATE TABLE IF NOT EXISTS app_errors (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  level TEXT NOT NULL,
  area TEXT NOT NULL,
  message TEXT NOT NULL,
  context_json TEXT
);
CREATE INDEX IF NOT EXISTS app_errors_at_idx ON app_errors (at);

CREATE TABLE IF NOT EXISTS news_events (
  id TEXT PRIMARY KEY,
  currency TEXT NOT NULL,
  title TEXT NOT NULL,
  impact TEXT NOT NULL,
  event_time_utc INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);
CREATE INDEX IF NOT EXISTS news_events_currency_idx ON news_events (currency);
CREATE INDEX IF NOT EXISTS news_events_time_idx ON news_events (event_time_utc);

CREATE TABLE IF NOT EXISTS broker_quotes (
  symbol TEXT PRIMARY KEY,
  bid REAL NOT NULL,
  ask REAL NOT NULL,
  entered_at INTEGER NOT NULL
);
`;

async function ensureSchema(target: Client): Promise<void> {
  const statements = CREATE_TABLES_SQL.split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await target.execute(statement);
  }
}

/** The Drizzle database handle. Schema is created on first call, once per process. */
export async function getDb(): Promise<LibSQLDatabase<typeof schema>> {
  const c = getClient();
  if (!schemaReady) schemaReady = ensureSchema(c);
  await schemaReady;
  if (!db) db = drizzle(c, { schema });
  return db;
}

export { schema };
