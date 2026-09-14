import { Link } from "@tanstack/react-router";
import { DataBadge } from "@/components/app-shell";
import { fmtPrice } from "@/lib/market/instruments";
import type { Quote, Signal } from "@/lib/market/types";

const STATE_TONE: Record<string, string> = {
  READY: "border-bull/50 bg-bull/10 text-bull",
  WATCH: "border-warn/50 bg-warn/10 text-warn",
  WAIT: "border-border bg-card text-muted-foreground",
  MISSED: "border-bear/50 bg-bear/10 text-bear",
  INVALIDATED: "border-bear/50 bg-bear/10 text-bear",
  INVALID: "border-bear/50 bg-bear/10 text-bear",
  INSUFFICIENT_DATA: "border-border bg-card text-muted-foreground",
  TRIGGERED: "border-primary/50 bg-primary/10 text-primary",
  EXPIRED: "border-border bg-card text-muted-foreground",
};

const STATE_LABEL: Record<string, string> = {
  MISSED: "Missed — do not chase",
  INSUFFICIENT_DATA: "Not enough data",
  INVALID: "Invalid — do not trade",
};

export function SignalCard({
  signal,
  quote,
  onLog,
  logged,
}: {
  signal: Signal;
  quote: Quote;
  onLog?: () => void;
  logged?: boolean;
}) {
  const dirTone =
    signal.direction === "BUY"
      ? "text-bull"
      : signal.direction === "SELL"
        ? "text-bear"
        : "text-muted-foreground";

  const tradable =
    signal.direction !== "WAIT" &&
    signal.calculationErrors.length === 0 &&
    signal.state !== "INVALID" &&
    signal.state !== "INSUFFICIENT_DATA";

  return (
    <section className="panel space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-display text-lg font-semibold tracking-tight">{signal.symbol}</p>
          <p className="text-xs text-muted-foreground">{signal.setupType}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span
            className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
              STATE_TONE[signal.state] ?? STATE_TONE["WAIT"]
            }`}
          >
            {STATE_LABEL[signal.state] ?? signal.state}
          </span>
          <DataBadge quote={quote} />
        </div>
      </div>

      <div className="flex items-baseline gap-3">
        <span className={`font-display text-2xl font-semibold tabular-nums ${dirTone}`}>
          {signal.direction}
        </span>
        <span className="text-sm tabular-nums text-muted-foreground">
          price {fmtPrice(quote.mid, signal.symbol)}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          setup quality {signal.confidenceScore}/100 · {signal.confidenceLabel}
          <span className="block text-[10px]">not a win probability</span>
        </span>
      </div>

      {signal.direction !== "WAIT" && (
        <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          <Field
            label="Entry zone"
            value={
              signal.entryZone
                ? `${fmtPrice(signal.entryZone[0], signal.symbol)} – ${fmtPrice(signal.entryZone[1], signal.symbol)}`
                : "—"
            }
          />
          <Field label="Stop-loss" value={fmtPrice(signal.stopLoss, signal.symbol)} tone="bear" />
          <Field label="Invalidation" value={fmtPrice(signal.invalidationLevel, signal.symbol)} />
          <Field
            label="TP1"
            value={`${fmtPrice(signal.takeProfit1, signal.symbol)}${signal.riskRewardRatios.tp1 ? ` · ${signal.riskRewardRatios.tp1}R` : ""}`}
            tone="bull"
          />
          <Field
            label="TP2"
            value={`${fmtPrice(signal.takeProfit2, signal.symbol)}${signal.riskRewardRatios.tp2 ? ` · ${signal.riskRewardRatios.tp2}R` : ""}`}
            tone="bull"
          />
          <Field
            label="TP3"
            value={`${fmtPrice(signal.takeProfit3, signal.symbol)}${signal.riskRewardRatios.tp3 ? ` · ${signal.riskRewardRatios.tp3}R` : ""}`}
            tone="bull"
          />
        </dl>
      )}

      {signal.calculationErrors.length > 0 && (
        <ul className="space-y-1 rounded-md border border-bear/50 bg-bear/10 p-2 text-[11px] text-bear">
          {signal.calculationErrors.map((e) => (
            <li key={e}>× {e}</li>
          ))}
        </ul>
      )}

      <div className="space-y-2">
        {(["CONTEXT", "CONFIRMATION", "ENTRY"] as const).map((role) => {
          const group = signal.timeframeEvidence.filter((ev) => ev.role === role);
          if (group.length === 0) return null;
          return (
            <div key={role} className="space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {role === "CONTEXT"
                  ? "Big picture (never blocks)"
                  : role === "CONFIRMATION"
                    ? "Direction & confirmation"
                    : "Timing"}
              </p>
              <div className="flex flex-wrap gap-1">
                {group.map((ev) => (
                  <span
                    key={ev.timeframe}
                    title={`${ev.zone} · ${ev.state}${ev.crossLevel ? ` through ${ev.crossLevel}` : ""} · K ${ev.stochasticK?.toFixed(1) ?? "—"} / D ${ev.stochasticD?.toFixed(1) ?? "—"} · ${ev.dataStatus}${ev.used ? "" : " · not used"} — ${ev.explanation}`}
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                      ev.dataStatus !== "VALID"
                        ? "border-border bg-card text-muted-foreground opacity-60"
                        : ev.aligned
                          ? "border-bull/50 bg-bull/10 text-bull"
                          : ev.direction === "NEUTRAL"
                            ? "border-border bg-card text-muted-foreground"
                            : "border-bear/50 bg-bear/10 text-bear"
                    }`}
                  >
                    {ev.timeframe} {ev.stochasticK === null ? "—" : ev.stochasticK.toFixed(0)}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Monthly {signal.higherContext.monthly.replace(/_/g, " ").toLowerCase()} (
        {signal.higherContext.monthlyDirection.toLowerCase()}) · weekly{" "}
        {signal.higherContext.weekly.replace(/_/g, " ").toLowerCase()} (
        {signal.higherContext.weeklyDirection.toLowerCase()}) ·{" "}
        {signal.higherContext.used ? "used" : "not used"}
        {signal.higherContext.conflict ? " · conflicts with this reading" : ""}
      </p>
      {signal.higherContext.allowedDespiteConflict && (
        <p className="text-[11px] text-warn">
          Allowed anyway: {signal.higherContext.allowedDespiteConflict}
        </p>
      )}

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">
          Why this reading, and why it may fail
        </summary>
        <ul className="mt-2 space-y-1 text-muted-foreground">
          {signal.reasons.map((r) => (
            <li key={r}>• {r}</li>
          ))}
        </ul>
        {signal.warnings.length > 0 && (
          <ul className="mt-2 space-y-1 text-warn">
            {signal.warnings.map((w) => (
              <li key={w}>! {w}</li>
            ))}
          </ul>
        )}
        <ul className="mt-2 space-y-1 text-muted-foreground">
          {signal.whyItMayFail.map((w) => (
            <li key={w}>× {w}</li>
          ))}
        </ul>
        <p className="mt-2 text-muted-foreground">Trigger: {signal.triggerCondition}</p>
        <p className="text-muted-foreground">Invalidation: {signal.invalidationCondition}</p>
        <p className="text-muted-foreground">Session: {signal.session.replace(/_/g, " ")}</p>
      </details>

      <div className="flex flex-wrap gap-2">
        <Link
          to="/chart"
          search={{ symbol: signal.symbol }}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
        >
          Chart
        </Link>
        {tradable && (
          <Link
            to="/plan"
            search={{ symbol: signal.symbol }}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Trade plan
          </Link>
        )}
        {onLog && (
          <button
            type="button"
            onClick={onLog}
            disabled={logged}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            {logged ? "Recorded" : "Record signal"}
          </button>
        )}
      </div>
    </section>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" }) {
  return (
    <div className="rounded-md border border-border bg-card/60 px-2 py-1.5">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={`tabular-nums ${tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
