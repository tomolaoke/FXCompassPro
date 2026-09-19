import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { AppShell, Panel } from "@/components/app-shell";
import { SignalCard } from "@/components/signal-card";
import { useRotatingEngineSignalRun } from "@/lib/market/hooks";
import { recordSignal } from "@/lib/market/market.functions";
import {
  getNotificationPermission,
  requestNotificationPermission,
  useSignalNotifications,
  type NotificationPermissionState,
} from "@/lib/market/notifications/use-notifications";
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
  const { settings, update } = useSettings();
  const { records, add } = useSignalRecords();
  const {
    rows: slots,
    notes,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useRotatingEngineSignalRun(settings);
  const persistSignal = useServerFn(recordSignal);
  // Server and first client render must agree, so this starts at "unsupported"
  // on both sides — same reason as DataBadge's age in app-shell.tsx — and the
  // real permission (which depends on `window`/`Notification`, unavailable
  // during SSR) is read only after mount.
  const [permission, setPermission] = useState<NotificationPermissionState>("unsupported");
  useEffect(() => {
    setPermission(getNotificationPermission());
  }, []);

  const rows = useMemo(() => slots.filter((r) => r !== null), [slots]);
  const ready = rows.filter((r) => r.signal.readiness === "READY").length;
  const watching = rows.filter((r) => r.signal.readiness === "WATCH").length;
  const notScannedCount = slots.length - rows.length;

  const notifiableRows = useMemo(
    () =>
      rows.map((r) => ({ symbol: r.symbol, label: r.signal.label, readiness: r.signal.readiness })),
    [rows],
  );
  useSignalNotifications(
    notifiableRows,
    { mutedSymbols: new Set(), quietHoursStart: null, quietHoursEnd: null },
    settings.notificationsEnabled && permission === "granted",
  );

  const handleEnableNotifications = async () => {
    const result = await requestNotificationPermission();
    setPermission(result);
    if (result === "granted") update({ notificationsEnabled: true });
  };

  return (
    <AppShell>
      <div className="space-y-4">
        <Panel
          title="Today"
          action={
            <div className="flex gap-2">
              {permission !== "unsupported" && !settings.notificationsEnabled && (
                <button
                  type="button"
                  onClick={() => void handleEnableNotifications()}
                  className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-accent"
                >
                  {permission === "denied" ? "Notifications blocked" : "Enable notifications"}
                </button>
              )}
              <button
                type="button"
                onClick={() => void refetch()}
                className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-accent"
              >
                {isFetching ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          }
        >
          <div className="grid grid-cols-4 gap-2 text-center">
            <Stat label="Ready" value={ready} tone="bull" />
            <Stat label="Watching" value={watching} tone="warn" />
            <Stat label="Pairs scanned" value={rows.length} />
            <Stat label="Awaiting turn" value={notScannedCount} />
          </div>
          {settings.notificationsEnabled && permission === "granted" && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Notifications on — fires only while this tab is open, not a real push. See
              docs/limitations.md.
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            All nine timeframes are requested for every pair — MN, W1, D1, H4, H1, M30, M15, M5, M1
            — but a free-tier data plan cannot always return all nine at once; each card below
            states exactly how many actually came back valid. Risk {settings.risk.riskPercent}% of{" "}
            {settings.risk.accountCurrency} {settings.risk.accountCapital}.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Two pairs are scanned per cycle — 18 provider requests for a full watchlist would exceed
            the free plan's 8-per-minute limit in one burst. The watchlist rotates through every
            pair over a few minutes; results build up rather than resetting each cycle.
          </p>
          {notes.length ? (
            <ul className="mt-2 space-y-1 text-[11px] text-warn">
              {notes.slice(0, 4).map((n) => (
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

        {settings.watchlist.map((symbol, i) => {
          const row = slots[i];
          if (!row) {
            return (
              <div
                key={symbol}
                className="panel flex items-center justify-between p-4 text-sm text-muted-foreground"
              >
                <span className="font-medium text-foreground">{symbol}</span>
                <span>Not scanned this cycle — waiting its turn</span>
              </div>
            );
          }
          return (
            <SignalCard
              key={row.symbol}
              signal={row.signal}
              quote={row.quote}
              notes={row.notes}
              logged={records.some(
                (r) => r.symbol === row.symbol && Date.now() - r.createdAt < 1000 * 60 * 60 * 6,
              )}
              onLog={() => {
                // The database id becomes the local record's id too, so a later
                // outcome check (real price action against the recorded stop
                // and targets) can write back to the right local row by id
                // instead of needing a separate correlation table.
                const localId = newId();
                add({
                  id: localId,
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
                });
                // The full audit trail — every timeframe's state, relation and
                // Stochastic reading, plus the exact strategy version — is kept
                // server-side so this signal can be reproduced later.
                void persistSignal({
                  data: { signal: row.signal, userDecision: "accepted", id: localId },
                }).catch(() => {
                  // Best-effort: the local record above already captured the
                  // decision, so a database hiccup here must not block the UI.
                });
              }}
            />
          );
        })}
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
