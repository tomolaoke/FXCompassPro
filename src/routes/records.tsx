import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AppShell, Panel } from "@/components/app-shell";
import { fmtPrice } from "@/lib/market/instruments";
import { checkPaperTradesFn } from "@/lib/market/market.functions";
import { useSignalRecords } from "@/lib/market/store";
import type { SignalRecord } from "@/lib/market/types";

export const Route = createFileRoute("/records")({
  head: () => ({
    meta: [
      { title: "Signal records & win rate — FX Compass Pro" },
      {
        name: "description",
        content:
          "Log whether you took each study signal, mark the outcome, and watch your win rate and average R update live for every pair.",
      },
      { property: "og:title", content: "Signal records & win rate — FX Compass Pro" },
      {
        property: "og:description",
        content:
          "Track taken vs skipped setups, outcomes and running win rate per pair. Educational only — no signal is guaranteed.",
      },
    ],
  }),
  component: RecordsScreen,
});

const OUTCOMES: SignalRecord["outcome"][] = ["PENDING", "WIN", "LOSS", "BREAKEVEN", "SKIPPED"];

interface Tally {
  taken: number;
  wins: number;
  losses: number;
  breakeven: number;
  settled: number;
  rSum: number;
  rCount: number;
}

function emptyTally(): Tally {
  return { taken: 0, wins: 0, losses: 0, breakeven: 0, settled: 0, rSum: 0, rCount: 0 };
}

function tally(records: SignalRecord[]): Tally {
  const t = emptyTally();
  for (const r of records) {
    if (r.taken) t.taken += 1;
    if (r.outcome === "WIN") t.wins += 1;
    if (r.outcome === "LOSS") t.losses += 1;
    if (r.outcome === "BREAKEVEN") t.breakeven += 1;
    if (r.outcome === "WIN" || r.outcome === "LOSS" || r.outcome === "BREAKEVEN") t.settled += 1;
    if (r.rMultiple !== null && Number.isFinite(r.rMultiple)) {
      t.rSum += r.rMultiple;
      t.rCount += 1;
    }
  }
  return t;
}

function winRate(t: Tally): string {
  if (!t.settled) return "—";
  return `${Math.round((t.wins / t.settled) * 100)}%`;
}

function avgR(t: Tally): string {
  if (!t.rCount) return "—";
  return `${(t.rSum / t.rCount).toFixed(2)}R`;
}

function RecordsScreen() {
  const { records, update, remove, clear } = useSignalRecords();
  const checkPaperTrades = useServerFn(checkPaperTradesFn);
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState<string | null>(null);

  const handleCheckOutcomes = async () => {
    setChecking(true);
    setCheckNote(null);
    try {
      const results = await checkPaperTrades();
      let settled = 0;
      for (const r of results) {
        if (r.outcome === "PENDING") continue;
        update(r.id, { outcome: r.outcome, rMultiple: r.rMultiple });
        settled += 1;
      }
      setCheckNote(
        settled > 0
          ? `${settled} of ${results.length} pending trade${results.length === 1 ? "" : "s"} settled from real price action.`
          : results.length > 0
            ? `Checked ${results.length} pending trade${results.length === 1 ? "" : "s"} — still running.`
            : "No accepted signals are pending an outcome.",
      );
    } catch {
      setCheckNote("Could not check outcomes — the database may not be configured yet.");
    } finally {
      setChecking(false);
    }
  };

  const overall = useMemo(() => tally(records), [records]);
  const perPair = useMemo(() => {
    const map = new Map<string, SignalRecord[]>();
    for (const r of records) {
      const list = map.get(r.symbol) ?? [];
      list.push(r);
      map.set(r.symbol, list);
    }
    return Array.from(map.entries())
      .map(([symbol, list]) => ({ symbol, count: list.length, t: tally(list) }))
      .sort((a, b) => b.count - a.count);
  }, [records]);

  return (
    <AppShell>
      <div className="space-y-4">
        <Panel
          title="Live record"
          action={
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleCheckOutcomes()}
                disabled={checking}
                className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
              >
                {checking ? "Checking…" : "Check outcomes"}
              </button>
              {records.length ? (
                <button
                  type="button"
                  onClick={() => clear()}
                  className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-accent"
                >
                  Clear all
                </button>
              ) : null}
            </div>
          }
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Signals logged" value={String(records.length)} />
            <Stat label="Taken" value={String(overall.taken)} />
            <Stat label="Win rate" value={winRate(overall)} tone="bull" />
            <Stat label="Average R" value={avgR(overall)} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Win rate counts only settled results ({overall.wins}W / {overall.losses}L /{" "}
            {overall.breakeven}BE). Past results describe what already happened — they do not
            predict the next trade.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            "Check outcomes" compares each accepted signal's stop and targets against real price
            action since it was recorded — not a guess. It never uses sample data to settle a
            result.
          </p>
          {checkNote && <p className="mt-2 text-xs text-warn">{checkNote}</p>}
        </Panel>

        {perPair.length > 0 && (
          <Panel title="By pair">
            <div className="space-y-2">
              {perPair.map((row) => (
                <div
                  key={row.symbol}
                  className="flex items-center justify-between rounded-md border border-border bg-card/60 px-3 py-2"
                >
                  <div>
                    <p className="font-display text-sm font-semibold">{row.symbol}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {row.count} logged · {row.t.taken} taken · {row.t.settled} settled
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-sm font-semibold tabular-nums text-bull">
                      {winRate(row.t)}
                    </p>
                    <p className="text-[11px] tabular-nums text-muted-foreground">{avgR(row.t)}</p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        <Panel title="Signal log">
          {records.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No signals logged yet. On the dashboard, tap “Log signal” on a setup card and it will
              appear here with a “did I take this position?” checkbox.
            </p>
          ) : (
            <ul className="space-y-3">
              {records.map((r) => (
                <li key={r.id} className="rounded-md border border-border bg-card/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-display text-sm font-semibold">
                        {r.symbol}{" "}
                        <span
                          className={
                            r.direction === "BUY"
                              ? "text-bull"
                              : r.direction === "SELL"
                                ? "text-bear"
                                : "text-muted-foreground"
                          }
                        >
                          {r.direction}
                        </span>
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {new Date(r.createdAt).toLocaleString()} · {r.setupType} · score {r.score} ·{" "}
                        {r.session}
                        {r.dataKind === "demo" ? " · sample data" : ""}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Link
                        to="/chart"
                        search={{ symbol: r.symbol, signalId: r.id }}
                        className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
                      >
                        View snapshot
                      </Link>
                      <button
                        type="button"
                        onClick={() => remove(r.id)}
                        className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <p className="mt-2 text-[11px] tabular-nums text-muted-foreground">
                    Entry{" "}
                    {r.entryZone
                      ? `${fmtPrice(r.entryZone[0], r.symbol)}–${fmtPrice(r.entryZone[1], r.symbol)}`
                      : "—"}{" "}
                    · Stop {fmtPrice(r.stopLoss, r.symbol)} · TP1{" "}
                    {fmtPrice(r.takeProfit1, r.symbol)}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-xs font-medium">
                      <input
                        type="checkbox"
                        checked={r.taken === true}
                        onChange={(e) =>
                          update(r.id, {
                            taken: e.target.checked,
                            ...(e.target.checked
                              ? {}
                              : { outcome: "SKIPPED" as const, rMultiple: null }),
                          })
                        }
                        className="size-4 accent-primary"
                      />
                      Did I take this position?
                    </label>

                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      Outcome
                      <select
                        value={r.outcome}
                        onChange={(e) =>
                          update(r.id, {
                            outcome: e.target.value as SignalRecord["outcome"],
                          })
                        }
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                      >
                        {OUTCOMES.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      R
                      <input
                        type="number"
                        step="0.1"
                        value={r.rMultiple ?? ""}
                        onChange={(e) =>
                          update(r.id, {
                            rMultiple: e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                        className="w-20 rounded-md border border-border bg-background px-2 py-1 text-xs tabular-nums"
                      />
                    </label>
                  </div>

                  <input
                    type="text"
                    value={r.notes}
                    placeholder="Note to self — what did you see, what did you feel?"
                    onChange={(e) => update(r.id, { notes: e.target.value })}
                    className="mt-3 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bull" }) {
  return (
    <div className="rounded-md border border-border bg-card/60 py-2 text-center">
      <p
        className={`font-display text-xl font-semibold tabular-nums ${
          tone === "bull" ? "text-bull" : ""
        }`}
      >
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}
