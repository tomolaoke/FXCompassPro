import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell, DataBadge, Panel } from "@/components/app-shell";
import { useEngineSignalRun } from "@/lib/market/hooks";
import { fmtPrice, specFor } from "@/lib/market/instruments";
import { calculateRisk } from "@/lib/market/risk";
import { newId, useSettings, useSignalRecords } from "@/lib/market/store";
import type { Session } from "@/lib/market/types";

/** The engine's CLOSED session has no old-store equivalent; OFF_HOURS is the closest fit for the record. */
function toRecordSession(session: string): Session {
  return session === "CLOSED" ? "OFF_HOURS" : (session as Session);
}

export const Route = createFileRoute("/plan")({
  validateSearch: (search: Record<string, unknown>) => ({
    symbol: typeof search["symbol"] === "string" ? search["symbol"].toUpperCase() : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Trade plan & position size — FX Compass Pro" },
      {
        name: "description",
        content:
          "Enter your account size and risk percent to see the lot size, stop-loss and take-profit levels the deterministic engine derived. Educational only.",
      },
      { property: "og:title", content: "Trade plan & position size — FX Compass Pro" },
      {
        property: "og:description",
        content:
          "Lot size, stop and targets worked out step by step from your own account size and risk percent.",
      },
    ],
  }),
  component: PlanPage,
});

function PlanPage() {
  const { symbol: fromSearch } = Route.useSearch();
  const { settings, updateRisk } = useSettings();
  const { add } = useSignalRecords();
  const [symbol, setSymbol] = useState(fromSearch ?? settings.watchlist[0] ?? "XAUUSD");
  const spec = specFor(symbol);

  const run = useEngineSignalRun(settings, [symbol]);
  const row = run.data?.rows[0];
  const signal = row?.signal;

  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [tp1, setTp1] = useState("");
  const [tp2, setTp2] = useState("");
  const [tp3, setTp3] = useState("");
  const [pipValue, setPipValue] = useState("");
  const [touched, setTouched] = useState(false);

  // prefill from the engine until the user edits something
  useEffect(() => {
    if (touched || !signal) return;
    const zoneMid = signal.entryZone
      ? (signal.entryZone[0] + signal.entryZone[1]) / 2
      : (row?.quote.mid ?? null);
    setEntry(zoneMid !== null ? zoneMid.toFixed(spec.digits) : "");
    setStop(signal.stopLoss !== null ? signal.stopLoss.toFixed(spec.digits) : "");
    setTp1(signal.takeProfit1 !== null ? signal.takeProfit1.toFixed(spec.digits) : "");
    setTp2(signal.takeProfit2 !== null ? signal.takeProfit2.toFixed(spec.digits) : "");
    setTp3(signal.takeProfit3 !== null ? signal.takeProfit3.toFixed(spec.digits) : "");
  }, [signal, row, spec.digits, touched]);

  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const result = useMemo(() => {
    const e = num(entry);
    const s = num(stop);
    if (e === null || s === null || !Number.isFinite(e) || !Number.isFinite(s)) return null;
    return calculateRisk({
      symbol,
      entry: e,
      stopLoss: s,
      takeProfits: [num(tp1), num(tp2), num(tp3)],
      settings: settings.risk,
      pipValuePerLotOverride: num(pipValue),
    });
  }, [entry, stop, tp1, tp2, tp3, pipValue, symbol, settings.risk]);

  const currency = settings.risk.accountCurrency;

  return (
    <AppShell>
      <div className="space-y-4">
        <Panel title="Instrument" action={<DataBadge quote={row?.quote} />}>
          <div className="flex flex-wrap gap-1">
            {settings.watchlist.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setSymbol(s);
                  setTouched(false);
                }}
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
          {signal && (
            <p className="mt-2 text-xs text-muted-foreground">
              Engine reading: {signal.label}. Levels below are pre-filled from it; change any of
              them and the maths follows your numbers.
            </p>
          )}
        </Panel>

        <Panel title="Your account">
          <div className="grid grid-cols-2 gap-3">
            <NumField
              label={`Account capital (${currency})`}
              value={settings.risk.accountCapital}
              step={10}
              onChange={(v) => updateRisk({ accountCapital: v })}
            />
            <NumField
              label="Risk per trade (%)"
              value={settings.risk.riskPercent}
              step={0.1}
              onChange={(v) => updateRisk({ riskPercent: v })}
            />
            <NumField
              label="Minimum lot"
              value={settings.risk.minLot}
              step={0.01}
              onChange={(v) => updateRisk({ minLot: v })}
            />
            <NumField
              label="Lot step"
              value={settings.risk.lotStep}
              step={0.01}
              onChange={(v) => updateRisk({ lotStep: v })}
            />
          </div>
        </Panel>

        <Panel title="Levels">
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Entry"
              value={entry}
              onChange={(v) => {
                setTouched(true);
                setEntry(v);
              }}
            />
            <TextField
              label="Stop-loss"
              value={stop}
              onChange={(v) => {
                setTouched(true);
                setStop(v);
              }}
            />
            <TextField
              label="Take profit 1"
              value={tp1}
              onChange={(v) => {
                setTouched(true);
                setTp1(v);
              }}
            />
            <TextField
              label="Take profit 2"
              value={tp2}
              onChange={(v) => {
                setTouched(true);
                setTp2(v);
              }}
            />
            <TextField
              label="Take profit 3"
              value={tp3}
              onChange={(v) => {
                setTouched(true);
                setTp3(v);
              }}
            />
            <TextField
              label={`Value per pip at 1 lot (${currency})`}
              value={pipValue}
              placeholder={spec.pipValuePerLot ? String(spec.pipValuePerLot) : "ask your broker"}
              onChange={setPipValue}
            />
          </div>
        </Panel>

        {result && (
          <Panel title="Position size">
            {result.blockedReason ? (
              <p className="rounded-md border border-bear/40 bg-bear/10 p-3 text-sm text-bear">
                {result.blockedReason}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <Cell label="Lot size" value={String(result.suggestedLot ?? "—")} tone="bull" />
                <Cell label="Risk budget" value={`${currency} ${result.riskAmount.toFixed(2)}`} />
                <Cell label="Stop distance" value={`${result.stopPips.toFixed(1)} pips`} />
                <Cell
                  label="Loss if stopped"
                  value={
                    result.expectedLossAtStop !== null
                      ? `${currency} ${result.expectedLossAtStop.toFixed(2)}`
                      : "—"
                  }
                  tone="bear"
                />
              </div>
            )}

            {result.targets.length > 0 && (
              <div className="mt-3 space-y-1 text-xs">
                {result.targets.map((t, i) => {
                  // While the user hasn't edited anything, these targets are
                  // exactly the engine's own prefilled values — show the
                  // engine's own unrounded R:R rather than one re-derived
                  // from the rounded display strings, so this page can never
                  // silently disagree with the dashboard card for the same
                  // untouched setup.
                  const canonicalRR = !touched
                    ? [
                        signal?.riskRewardRatios.tp1,
                        signal?.riskRewardRatios.tp2,
                        signal?.riskRewardRatios.tp3,
                      ][i]
                    : null;
                  const rr = canonicalRR ?? t.rr;
                  return (
                    <p key={t.price} className="tabular-nums text-muted-foreground">
                      TP{i + 1} {fmtPrice(t.price, symbol)} · {rr}R ·{" "}
                      <span className="text-bull">
                        +{currency} {t.expectedGain?.toFixed(2) ?? "—"}
                      </span>{" "}
                      if it reaches there
                    </p>
                  );
                })}
              </div>
            )}

            <details className="mt-3 text-xs" open>
              <summary className="cursor-pointer text-muted-foreground">Why this size?</summary>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {result.explanation.map((line) => (
                  <li key={line}>• {line}</li>
                ))}
              </ul>
            </details>

            <ul className="mt-3 space-y-1 text-xs text-warn">
              {result.warnings.map((w) => (
                <li key={w}>! {w}</li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() =>
                add({
                  id: newId(),
                  createdAt: Date.now(),
                  symbol,
                  direction: signal?.direction ?? "WAIT",
                  setupType: signal?.label ?? "Manual plan",
                  score: signal?.score.value ?? 0,
                  entryZone: signal?.entryZone ? [...signal.entryZone] : null,
                  stopLoss: num(stop),
                  takeProfit1: num(tp1),
                  taken: null,
                  outcome: "PENDING",
                  rMultiple: null,
                  dataKind: row?.quote.kind ?? "demo",
                  session: signal ? toRecordSession(signal.session) : "OFF_HOURS",
                  notes: `Lot ${result.suggestedLot ?? "—"} · risk ${currency} ${result.riskAmount.toFixed(2)}`,
                })
              }
              className="mt-3 w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Save this plan to records
            </button>
          </Panel>
        )}
      </div>
    </AppShell>
  );
}

function NumField({
  label,
  value,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        value={value}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next) && next > 0) onChange(next);
        }}
        className="mt-1 w-full rounded-md border border-border bg-card px-2 py-2 text-sm tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-border bg-card px-2 py-2 text-sm tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </label>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" }) {
  return (
    <div className="rounded-md border border-border bg-card/60 px-2 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`font-display text-base font-semibold tabular-nums ${
          tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
