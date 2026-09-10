import { createFileRoute } from "@tanstack/react-router";
import { AppShell, Panel } from "@/components/app-shell";
import { SignalCard } from "@/components/signal-card";
import { useSignalRun } from "@/lib/market/hooks";
import { newId, useSettings, useSignalRecords } from "@/lib/market/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Caveman Markets — Daily forex & gold study dashboard" },
      {
        name: "description",
        content:
          "Educational multi-timeframe Stochastic 25,2,4 analysis for gold and major FX pairs, with entry zones, stops, targets and honest data labelling.",
      },
      { property: "og:title", content: "Caveman Markets — Daily forex & gold study dashboard" },
      {
        property: "og:description",
        content:
          "Educational multi-timeframe analysis with entry zones, stops and targets. No signal is guaranteed.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { settings } = useSettings();
  const { records, add } = useSignalRecords();
  const { data, isLoading, isError, refetch, isFetching } = useSignalRun(settings);

  const rows = data?.rows ?? [];
  const ready = rows.filter((r) => r.signal.state === "READY").length;
  const watching = rows.filter((r) => r.signal.state === "WATCH").length;

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
            Confirmation timeframes: {settings.confirmationTimeframes.join(" · ")} · execution{" "}
            {settings.executionTimeframe}. Risk {settings.risk.riskPercent}% of{" "}
            {settings.risk.accountCurrency} {settings.risk.accountCapital}.
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
          <p className="py-10 text-center text-sm text-muted-foreground">
            Reading the market…
          </p>
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
                direction: row.signal.direction,
                setupType: row.signal.setupType,
                score: row.signal.confidenceScore,
                entryZone: row.signal.entryZone,
                stopLoss: row.signal.stopLoss,
                takeProfit1: row.signal.takeProfit1,
                taken: null,
                outcome: "PENDING",
                rMultiple: null,
                dataKind: row.quote.kind,
                session: row.signal.session,
                notes: "",
              })
            }
          />
        ))}
      </div>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "bull" | "warn";
}) {
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
