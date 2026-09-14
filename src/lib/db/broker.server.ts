import { eq } from "drizzle-orm";
import { getDb, schema } from "./client.server";

export interface SetBrokerQuoteInput {
  symbol: string;
  bid: number;
  ask: number;
}

/** One row per symbol — a new entry replaces the previous one. */
export async function setBrokerQuote(input: SetBrokerQuoteInput): Promise<void> {
  const db = await getDb();
  const symbol = input.symbol.toUpperCase();
  await db
    .insert(schema.brokerQuotes)
    .values({ symbol, bid: input.bid, ask: input.ask, enteredAt: Date.now() })
    .onConflictDoUpdate({
      target: schema.brokerQuotes.symbol,
      set: { bid: input.bid, ask: input.ask, enteredAt: Date.now() },
    });
}

export async function getBrokerQuote(symbol: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.brokerQuotes)
    .where(eq(schema.brokerQuotes.symbol, symbol.toUpperCase()))
    .limit(1);
  return rows[0] ?? null;
}
