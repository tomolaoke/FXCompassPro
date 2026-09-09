/**
 * In-memory event log + live feed fan-out for the agent-integration endpoints.
 * This resets whenever the server restarts; it is a live feed, not storage.
 */
export interface FeedEvent {
  id: string;
  at: number;
  type: string;
  symbol: string | null;
  source: string;
  payload: Record<string, unknown>;
}

const MAX = 200;
const log: FeedEvent[] = [];
const subscribers = new Set<(event: FeedEvent) => void>();

export function publishEvent(input: {
  type: string;
  symbol?: string | null | undefined;
  source?: string | undefined;
  payload?: Record<string, unknown> | undefined;
}): FeedEvent {
  const event: FeedEvent = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    type: input.type,
    symbol: input.symbol ? input.symbol.toUpperCase() : null,
    source: input.source ?? "app",
    payload: input.payload ?? {},
  };
  log.push(event);
  if (log.length > MAX) log.splice(0, log.length - MAX);
  for (const fn of subscribers) {
    try {
      fn(event);
    } catch {
      // a broken subscriber must not break the publisher
    }
  }
  return event;
}

export function recentEvents(limit = 50, symbol?: string | null): FeedEvent[] {
  const filtered = symbol ? log.filter((e) => e.symbol === symbol.toUpperCase()) : log;
  return filtered.slice(-Math.max(1, Math.min(limit, MAX))).reverse();
}

export function subscribe(fn: (event: FeedEvent) => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
