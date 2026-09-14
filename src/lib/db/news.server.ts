import { eq, gte, lte } from "drizzle-orm";
import { getDb, schema } from "./client.server";
import type { ImpactLevel, NewsEvent } from "../market/news/types";

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function toDomain(row: typeof schema.newsEvents.$inferSelect): NewsEvent {
  return {
    id: row.id,
    currency: row.currency,
    title: row.title,
    impact: row.impact as ImpactLevel,
    eventTimeUtc: row.eventTimeUtc,
    source: "manual",
    createdAt: row.createdAt,
  };
}

export interface AddNewsEventInput {
  currency: string;
  title: string;
  impact: ImpactLevel;
  eventTimeUtc: number;
}

export async function addNewsEvent(input: AddNewsEventInput): Promise<NewsEvent> {
  const db = await getDb();
  const id = newId();
  await db.insert(schema.newsEvents).values({
    id,
    currency: input.currency.toUpperCase(),
    title: input.title,
    impact: input.impact,
    eventTimeUtc: input.eventTimeUtc,
    source: "manual",
  });
  return {
    id,
    currency: input.currency.toUpperCase(),
    title: input.title,
    impact: input.impact,
    eventTimeUtc: input.eventTimeUtc,
    source: "manual",
    createdAt: Date.now(),
  };
}

export async function removeNewsEvent(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(schema.newsEvents).where(eq(schema.newsEvents.id, id));
}

/** The whole calendar within a wide window — used for the "is this maintained" check. */
export async function getAllNewsEvents(windowDays = 60): Promise<NewsEvent[]> {
  const db = await getDb();
  const windowMs = windowDays * 24 * 60 * 60_000;
  const now = Date.now();
  const rows = await db
    .select()
    .from(schema.newsEvents)
    .where(gte(schema.newsEvents.eventTimeUtc, now - windowMs))
    .orderBy(schema.newsEvents.eventTimeUtc);
  return rows.filter((r) => r.eventTimeUtc <= now + windowMs).map(toDomain);
}

export async function getUpcomingNewsEvents(hoursAhead = 48): Promise<NewsEvent[]> {
  const db = await getDb();
  const now = Date.now();
  const rows = await db
    .select()
    .from(schema.newsEvents)
    .where(lte(schema.newsEvents.eventTimeUtc, now + hoursAhead * 60 * 60_000))
    .orderBy(schema.newsEvents.eventTimeUtc);
  return rows.filter((r) => r.eventTimeUtc >= now - 24 * 60 * 60_000).map(toDomain);
}
