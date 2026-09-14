import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getEngineSignalRun, getQuotes, getSeries, getSignalRun } from "./market.functions";
import type { AppSettings, Timeframe } from "./types";

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

export function useQuotes(symbols: string[]) {
  const fetchQuotes = useServerFn(getQuotes);
  return useQuery({
    queryKey: ["quotes", symbols.join(",")],
    queryFn: () => fetchQuotes({ data: { symbols } }),
    refetchInterval: 60_000,
    enabled: symbols.length > 0,
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
