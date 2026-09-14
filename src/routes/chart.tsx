import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, DataBadge, Panel } from "@/components/app-shell";
import { CandleChart, type ChartOverlay } from "@/components/candle-chart";
import { useSeries, useSignalRun } from "@/lib/market/hooks";
import { fmtPrice } from "@/lib/market/instruments";
import { useSettings } from "@/lib/market/store";
import { ALL_TIMEFRAMES, type Timeframe } from "@/lib/market/types";

export const Route = createFileRoute("/chart")({
  validateSearch: (search: Record<string, unknown>) => ({
    symbol: typeof search["symbol"] === "string" ? search["symbol"].toUpperCase() : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Chart & Stochastic 25,2,4 — Caveman Markets" },
      {
        name: "description",
        content:
          "Candlestick chart with Stochastic 25,2,4, entry zone, stop-loss and target overlays for gold and major FX pairs. Educational only.",
      },
      { property: "og:title", content: "Chart & Stochastic 25,2,4 — Caveman Markets" },
      {
        property: "og:description",
        content: "Candles, Stochastic 25,2,4 and level overlays for study, not advice.",
      },
    ],
  }),
  component: ChartPage,
});

function ChartPage() {
  const { symbol: fromSearch } = Route.useSearch();
  const { settings } = useSettings();
  const [symbol, setSymbol] = useState(fromSearch ?? settings.watchlist[0] ?? "XAUUSD");
  const [timeframe, setTimeframe] = useState<Timeframe>(settings.executionTimeframe);

  const series = useSeries(symbol, [timeframe]);
  const run = useSignalRun(settings, [symbol]);
  const row = run.data?.rows[0];
  const signal = row?.signal;
  const candles = series.data?.series?.[timeframe] ?? [];

  const overlays: ChartOverlay[] = [];
  if (signal) {
    if (signal.stopLoss !== null)
      overlays.push({ label: "SL", price: signal.stopLoss, tone: "bear" });
    if (signal.takeProfit1 !== null)
      overlays.push({ label: "TP1", price: signal.takeProfit1, tone: "bull" });
    if (signal.takeProfit2 !== null)
      overlays.push({ label: "TP2", price: signal.takeProfit2, tone: "bull" });
    if (signal.invalidationLevel !== null)
      overlays.push({ label: "Invalid", price: signal.invalidationLevel, tone: "warn" });
  }

  return (
    <AppShell>
      <div className="space-y-4">
        <Panel title="Instrument" action={<DataBadge quote={row?.quote} />}>
          <div className="flex flex-wrap gap-1">
            {settings.watchlist.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSymbol(s)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                  s === symbol
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {ALL_TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={`rounded-md border px-2 py-1 text-[11px] font-medium ${
                  tf === timeframe
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent"
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
          {series.data?.notes?.length ? (
            <ul className="mt-2 space-y-1 text-[11px] text-warn">
              {series.data.notes.slice(0, 3).map((n) => (
                <li key={n}>! {n}</li>
              ))}
            </ul>
          ) : null}
        </Panel>

        <Panel title={`${symbol} · ${timeframe}`}>
          {series.isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading candles…</p>
          ) : (
            <CandleChart
              candles={candles}
              symbol={symbol}
              overlays={overlays}
              zone={signal?.entryZone ?? null}
            />
          )}
        </Panel>

        {signal && (
          <Panel title="Levels on this chart">
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>
                Direction: <span className="text-foreground">{signal.direction}</span> ·{" "}
                {signal.state}
              </li>
              <li>
                Entry zone:{" "}
                {signal.entryZone
                  ? `${fmtPrice(signal.entryZone[0], symbol)} – ${fmtPrice(signal.entryZone[1], symbol)}`
                  : "none"}
              </li>
              <li>Stop-loss: {fmtPrice(signal.stopLoss, symbol)}</li>
              <li>
                Targets: {fmtPrice(signal.takeProfit1, symbol)} ·{" "}
                {fmtPrice(signal.takeProfit2, symbol)} · {fmtPrice(signal.takeProfit3, symbol)}
              </li>
            </ul>
          </Panel>
        )}
      </div>
    </AppShell>
  );
}
