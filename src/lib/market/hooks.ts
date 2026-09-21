import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  getEngineSignalRun,
  getQuotes,
  getSeries,
  getSignalByIdFn,
  getSignalRun,
} from "./market.functions";
import type { AppSettings, Quote, Timeframe } from "./types";
import type { EngineSignal } from "./engine/types";

/** @deprecated Use useEngineSignalRun. Kept only until every caller has migrated. */
export function useSignalRun(settings: AppSettings, symbols?: string[]) {
  const run = useServerFn(getSignalRun);
  const list = symbols ?? settings.watchlist;
  return useQuery({
    queryKey: [
      "signal-run",
      list.join(","),
      settings.confirmationTimeframes.join(","),
      settings.executionTimeframe,
      settings.risk.accountCapital,
      settings.risk.riskPercent,
      settings.risk.maxSpreadPips,
      settings.risk.maxDataAgeMinutes,
    ],
    queryFn: () =>
      run({
        data: {
          symbols: list,
          confirmationTimeframes: settings.confirmationTimeframes,
          executionTimeframe: settings.executionTimeframe,
          risk: settings.risk,
        },
      }),
    refetchInterval: 120_000,
    enabled: list.length > 0,
  });
}

/**
 * Runs the five-tier engine (all nine timeframes, short-term direction and
 * higher-timeframe bias computed separately, never merged into one vote).
 * This is what every page should call.
 */
export function useEngineSignalRun(settings: AppSettings, symbols?: string[]) {
  const run = useServerFn(getEngineSignalRun);
  const list = symbols ?? settings.watchlist;
  return useQuery({
    queryKey: [
      "engine-signal-run",
      list.join(","),
      settings.risk.accountCapital,
      settings.risk.riskPercent,
      settings.risk.maxSpreadPips,
      settings.risk.maxDataAgeMinutes,
    ],
    queryFn: () => run({ data: { symbols: list, risk: settings.risk } }),
    // Background scan runs slower than the old poll: the engine reads all
    // nine timeframes per symbol, and the free Twelve Data tier cannot sustain
    // a fast refresh across a watchlist. See docs/data-providers.md.
    refetchInterval: 5 * 60_000,
    enabled: list.length > 0,
  });
}

/**
 * Splits a watchlist into fixed-size groups, in order. Pure and exported for
 * direct testing — the group size is the one number that decides whether a
 * scan cycle fits inside the free Twelve Data tier's per-minute budget.
 */
export function chunkWatchlist(watchlist: readonly string[], size: number): string[][] {
  if (size <= 0) return watchlist.length ? [[...watchlist]] : [];
  const chunks: string[][] = [];
  for (let i = 0; i < watchlist.length; i += size) {
    chunks.push(watchlist.slice(i, i + size));
  }
  return chunks;
}

export interface EngineSignalRow {
  symbol: string;
  quote: Quote;
  signal: EngineSignal;
  provider: string;
  real: boolean;
  notes: string[];
}

export interface RotatingSignalRunResult {
  /** One entry per watchlist symbol, in watchlist order. Null until that symbol's first turn completes. */
  rows: (EngineSignalRow | null)[];
  notes: string[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * A 6-symbol × 9-timeframe watchlist needs 18 provider requests to fully
 * refresh — Twelve Data's free tier allows 8 per minute. Trying to refresh
 * the whole watchlist in one request always loses most of it to the budget
 * (see docs/data-providers.md and market.server.ts's local request budget).
 *
 * Scanning two symbols per cycle (6 requests) instead keeps every cycle
 * safely inside budget, and cycling through the watchlist means every symbol
 * still gets refreshed every few minutes rather than most of them never
 * getting through at all. Results accumulate across cycles rather than
 * flashing back to "not scanned yet" every time a different chunk is active.
 */
export function useRotatingEngineSignalRun(
  settings: AppSettings,
  chunkSize = 2,
  cycleMs = 45_000,
): RotatingSignalRunResult {
  const chunks = chunkWatchlist(settings.watchlist, chunkSize);
  const [chunkIndex, setChunkIndex] = useState(0);
  const safeIndex = chunks.length > 0 ? chunkIndex % chunks.length : 0;
  const activeChunk = chunks[safeIndex] ?? [];

  useEffect(() => {
    if (chunks.length <= 1) return;
    const timer = setInterval(() => setChunkIndex((i) => (i + 1) % chunks.length), cycleMs);
    return () => clearInterval(timer);
    // chunks.length and cycleMs come from settings/props that rarely change;
    // re-deriving `chunks` itself on every render would restart the timer.
  }, [chunks.length, cycleMs]);

  const query = useEngineSignalRun(settings, activeChunk);
  // A plain useState, not a ref: merging into a ref inside an effect would
  // update the map one render late, since a ref mutation alone never
  // schedules a re-render — the just-arrived chunk would only show up after
  // whatever *next* re-render happened to occur for an unrelated reason.
  const [accumulated, setAccumulated] = useState(new Map<string, EngineSignalRow>());

  useEffect(() => {
    if (!query.data) return;
    setAccumulated((prev) => {
      const next = new Map(prev);
      for (const row of query.data.rows) next.set(row.symbol, row);
      return next;
    });
  }, [query.data]);

  const rows = settings.watchlist.map((symbol) => accumulated.get(symbol) ?? null);

  return {
    rows,
    notes: query.data?.notes ?? [],
    isLoading: query.isLoading && accumulated.size === 0,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: () => void query.refetch(),
  };
}

export function useQuotes(symbols: string[]) {
  const fetchQuotes = useServerFn(getQuotes);
  return useQuery({
    queryKey: ["quotes", symbols.join(",")],
    queryFn: () => fetchQuotes({ data: { symbols } }),
    refetchInterval: 60_000,
    enabled: symbols.length > 0,
  });
}

/**
 * The exact evidence and levels stored for one previously recorded signal —
 * not recomputed. A chart pinned to a signalId must show what actually
 * produced that recorded plan, not whatever the live engine says right now
 * (price, indicators and even the strategy version can all have moved on).
 */
export function useSignalById(id: string | undefined) {
  const fetchSignal = useServerFn(getSignalByIdFn);
  return useQuery({
    queryKey: ["signal-by-id", id],
    queryFn: () => fetchSignal({ data: { id: id! } }),
    enabled: Boolean(id),
  });
}

export function useSeries(symbol: string, timeframes: Timeframe[]) {
  const fetchSeries = useServerFn(getSeries);
  return useQuery({
    queryKey: ["series", symbol, timeframes.join(",")],
    queryFn: () => fetchSeries({ data: { symbol, timeframes } }),
    refetchInterval: 120_000,
    enabled: Boolean(symbol),
  });
}

/** Fire-and-forget notification to the app's own live event feed. */
export async function pushEvent(body: {
  type: string;
  symbol?: string;
  payload?: Record<string, unknown>;
}) {
  try {
    await fetch("/api/public/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "app", ...body }),
    });
  } catch {
    // the feed is informational; never block the UI on it
  }
}
