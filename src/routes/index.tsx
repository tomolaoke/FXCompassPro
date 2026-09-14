import { createFileRoute } from "@tanstack/react-router";
import { AppShell, Panel } from "@/components/app-shell";
import { SignalCard } from "@/components/signal-card";
import { useEngineSignalRun } from "@/lib/market/hooks";
import { newId, useSettings, useSignalRecords } from "@/lib/market/store";
import type { Session } from "@/lib/market/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FX Compass Pro — daily forex & gold study dashboard" },
      {
        name: "description",
        content:
          "Educational multi-timeframe Stochastic 25,2,4 analysis for gold and major FX pairs. Short-term direction and higher-timeframe bias are shown separately, and never hidden when they disagree.",
      },
      { property: "og:title", content: "FX Compass Pro — daily forex & gold study dashboard" },
      {
        property: "og:description",
        content:
          "Multi-timeframe analysis with entry zones, stops and targets. Conflicts are labelled, never hidden. No signal is guaranteed.",
      },
    ],
  }),
  component: Dashboard,
});

/** The engine's CLOSED session has no old-store equivalent; OFF_HOURS is the closest fit for the record. */
function toRecordSession(session: string): Session {
  return session === "CLOSED" ? "OFF_HOURS" : (session as Session);
}

function Dashboard() {
  const { settings } = useSettings();
  const { records, add } = useSignalRecords();
  const { data, isLoading, isError, refetch, isFetching } = useEngineSignalRun(settings);

  const rows = data?.rows ?? [];
  const ready = rows.filter((r) => r.signal.readiness === "READY").length;
  const watching = rows.filter((r) => r.signal.readiness === "WATCH").length;

  return (
    <AppShell>
      <div className="space-y-4">
        <Panel
          title="Today"
          action={
            <button
              type="button"
              onClick={() => void refetch()}
              className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-accent"
            >
              {isFetching ? "Refreshing…" : "Refresh"}
            </button>
          }
        >
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Ready" value={ready} tone="bull" />
            <Stat label="Watching" value={watching} tone="warn" />
            <Stat label="Pairs scanned" value={rows.length} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            All nine timeframes analysed — MN, W1, D1, H4, H1, M30, M15, M5, M1. Risk{" "}
            {settings.risk.riskPercent}% of {settings.risk.accountCurrency}{" "}
            {settings.risk.accountCapital}.
          </p>
          {data?.notes?.length ? (
            <ul className="mt-2 space-y-1 text-[11px] text-warn">
              {data.notes.slice(0, 4).map((n) => (
                <li key={n}>! {n}</li>
              ))}
            </ul>
          ) : null}
        </Panel>

        {isLoading && (
          <p className="py-10 text-center text-sm text-muted-foreground">Reading the market…</p>
        )}
        {isError && (
          <Panel title="Could not read prices">
            <p className="text-sm text-muted-foreground">
              No price source answered. Nothing is shown rather than guessing a price.
            </p>
          </Panel>
        )}

        {rows.map((row) => (
          <SignalCard
            key={row.symbol}
            signal={row.signal}
            quote={row.quote}
            logged={records.some(
              (r) => r.symbol === row.symbol && Date.now() - r.createdAt < 1000 * 60 * 60 * 6,
            )}
            onLog={() =>
              add({
                id: newId(),
                createdAt: Date.now(),
                symbol: row.symbol,
                direction: row.signal.direction ?? "WAIT",
                setupType: row.signal.label,
                score: row.signal.score.value,
                entryZone: row.signal.entryZone ? [...row.signal.entryZone] : null,
                stopLoss: row.signal.stopLoss,
                takeProfit1: row.signal.takeProfit1,
                taken: null,
                outcome: "PENDING",
                rMultiple: null,
                dataKind: row.quote.kind,
                session: toRecordSession(row.signal.session),
                notes: "",
              })
            }
          />
        ))}
      </div>
    </AppShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "bull" | "warn" }) {
  return (
    <div className="rounded-md border border-border bg-card/60 py-2">
      <p
        className={`font-display text-xl font-semibold tabular-nums ${
          tone === "bull" ? "text-bull" : tone === "warn" ? "text-warn" : ""
        }`}
      >
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}
