import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, DataBadge, Panel } from "@/components/app-shell";
import { CandleChart, type ChartOverlay } from "@/components/candle-chart";
import { ALL_TIMEFRAMES, type Timeframe } from "@/lib/market/config/timeframes";
import { useEngineSignalRun, useSeries, useSignalById } from "@/lib/market/hooks";
import { fmtPrice } from "@/lib/market/instruments";
import { useSettings } from "@/lib/market/store";
import type { Timeframe as LegacyTimeframe } from "@/lib/market/types";

export const Route = createFileRoute("/chart")({
  validateSearch: (search: Record<string, unknown>) => ({
    symbol: typeof search["symbol"] === "string" ? search["symbol"].toUpperCase() : undefined,
    // Present only when arriving from a previously recorded signal (e.g. the
    // Records page) — pins the overlay to that signal's own stored evidence
    // instead of whatever the live engine says about the symbol right now.
    signalId: typeof search["signalId"] === "string" ? search["signalId"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Chart & Stochastic 25,2,4 — FX Compass Pro" },
      {
        name: "description",
        content:
          "Candlestick chart with Stochastic 25,2,4, entry zone, stop-loss and target overlays for gold and major FX pairs. Educational only.",
      },
      { property: "og:title", content: "Chart & Stochastic 25,2,4 — FX Compass Pro" },
      {
        property: "og:description",
        content: "Candles, Stochastic 25,2,4 and level overlays for study, not advice.",
      },
    ],
  }),
  component: ChartPage,
});

function ChartPage() {
  const { symbol: fromSearch, signalId } = Route.useSearch();
  const { settings } = useSettings();
  const [symbol, setSymbol] = useState(fromSearch ?? settings.watchlist[0] ?? "XAUUSD");
  const [timeframe, setTimeframe] = useState<Timeframe>("M15");

  // useSeries still speaks the old Timeframe type; the two are the same nine
  // string literals, just declared in two modules during the migration.
  const series = useSeries(symbol, [timeframe as unknown as LegacyTimeframe]);
  const run = useEngineSignalRun(settings, [symbol]);
  const row = run.data?.rows[0];
  const liveSignal = row?.signal;
  const candles = series.data?.series?.[timeframe as unknown as LegacyTimeframe] ?? [];

  // A signalId pins this chart to exactly what was recorded — price and every
  // indicator can have moved on since, so re-deriving "current" levels would
  // silently show a different plan than the one the card/notification/records
  // entry actually refers to. See the "canonical trade plan" limitation this
  // closes: chart, dashboard, notifications and paper trades must never
  // silently disagree about what a given recorded signal's levels were.
  const snapshotQuery = useSignalById(signalId);
  const snapshot = snapshotQuery.data;
  const isSnapshotMode = Boolean(signalId);

  const overlays: ChartOverlay[] = [];
  if (isSnapshotMode && snapshot) {
    if (snapshot.entryPrice !== null)
      overlays.push({ label: "Entry", price: snapshot.entryPrice, tone: "warn" });
    if (snapshot.stopLoss !== null)
      overlays.push({ label: "SL", price: snapshot.stopLoss, tone: "bear" });
    if (snapshot.takeProfit1 !== null)
      overlays.push({ label: "TP1", price: snapshot.takeProfit1, tone: "bull" });
    if (snapshot.takeProfit2 !== null)
      overlays.push({ label: "TP2", price: snapshot.takeProfit2, tone: "bull" });
    if (snapshot.invalidationLevel !== null)
      overlays.push({ label: "Invalid", price: snapshot.invalidationLevel, tone: "warn" });
  } else if (!isSnapshotMode && liveSignal) {
    if (liveSignal.stopLoss !== null)
      overlays.push({ label: "SL", price: liveSignal.stopLoss, tone: "bear" });
    if (liveSignal.takeProfit1 !== null)
      overlays.push({ label: "TP1", price: liveSignal.takeProfit1, tone: "bull" });
    if (liveSignal.takeProfit2 !== null)
      overlays.push({ label: "TP2", price: liveSignal.takeProfit2, tone: "bull" });
    if (liveSignal.invalidationLevel !== null)
      overlays.push({ label: "Invalid", price: liveSignal.invalidationLevel, tone: "warn" });
  }
  // The displayed "Levels on this chart" panel and overlay must agree on
  // which signal they describe — never mix a snapshot's levels with the live
  // label, or vice versa.
  const displaySignal = isSnapshotMode ? snapshot : liveSignal;

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

        {isSnapshotMode && (
          <Panel title="Signal snapshot — not a live chart">
            {snapshotQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading the recorded signal…</p>
            ) : snapshot ? (
              <p className="text-xs text-warn">
                Showing the exact levels recorded on{" "}
                {new Date(snapshot.generatedAt).toLocaleString()} — strategy version{" "}
                {snapshot.strategyVersion}. Candles below are today's live chart for context; they
                are not recalculated to match this snapshot, and price has likely moved since.
              </p>
            ) : (
              <p className="text-xs text-warn">
                This recorded signal could not be found — it may not have saved to the database.
                Showing the live chart instead.
              </p>
            )}
          </Panel>
        )}

        <Panel title={`${symbol} · ${timeframe}${isSnapshotMode ? " (live candles)" : ""}`}>
          {series.isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading candles…</p>
          ) : (
            <CandleChart
              candles={candles}
              symbol={symbol}
              overlays={overlays}
              zone={!isSnapshotMode && liveSignal?.entryZone ? [...liveSignal.entryZone] : null}
            />
          )}
        </Panel>

        {displaySignal && (
          <Panel title={isSnapshotMode ? "Levels in this snapshot" : "Levels on this chart"}>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>
                Label: <span className="text-foreground">{displaySignal.label}</span>
              </li>
              <li>
                Entry{isSnapshotMode ? "" : " zone"}:{" "}
                {isSnapshotMode
                  ? snapshot?.entryPrice !== null && snapshot?.entryPrice !== undefined
                    ? fmtPrice(snapshot.entryPrice, symbol)
                    : "none"
                  : liveSignal?.entryZone
                    ? `${fmtPrice(liveSignal.entryZone[0], symbol)} – ${fmtPrice(liveSignal.entryZone[1], symbol)}`
                    : "none"}
              </li>
              <li>Stop-loss: {fmtPrice(displaySignal.stopLoss, symbol)}</li>
              <li>
                Targets: {fmtPrice(displaySignal.takeProfit1, symbol)} ·{" "}
                {fmtPrice(displaySignal.takeProfit2, symbol)} ·{" "}
                {fmtPrice(displaySignal.takeProfit3, symbol)}
              </li>
            </ul>
          </Panel>
        )}
      </div>
    </AppShell>
  );
}
