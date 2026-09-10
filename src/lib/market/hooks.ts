import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getQuotes, getSeries, getSignalRun } from "./market.functions";
import type { AppSettings, Timeframe } from "./types";

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
