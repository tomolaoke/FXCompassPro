import { Link } from "@tanstack/react-router";
import { DataBadge } from "@/components/app-shell";
import { ROLE_LABEL } from "@/lib/market/config/timeframes";
import {
  allowsDirectionalBadge,
  isDataProblem,
  requiresCountertrendWarning,
  TIMEFRAME_STATE_LABEL,
} from "@/lib/market/domain/states";
import { formatAge, SESSION_LABEL } from "@/lib/market/domain/clock";
import { fmtPrice } from "@/lib/market/instruments";
import type { EngineSignal, TimeframeReading } from "@/lib/market/engine/types";
import type { Quote } from "@/lib/market/types";

/**
 * Renders an EngineSignal — never a bare direction. The badge tone is driven
 * by `allowsDirectionalBadge(label)`, which is only true for a READY label, so
 * a developing or conflicted setup can never render green or red.
 */
function labelTone(label: EngineSignal["label"], direction: EngineSignal["direction"]): string {
  if (!allowsDirectionalBadge(label)) {
    if (label === "INSUFFICIENT DATA" || label === "WAIT — NO VALID SETUP") {
      return "border-border bg-card text-muted-foreground";
    }
    if (label === "INVALID" || label === "DATA QUALITY ERROR" || label === "EXPIRED") {
      return "border-bear/50 bg-bear/10 text-bear";
    }
    return "border-warn/50 bg-warn/10 text-warn"; // WATCH / SETUP — developing
  }
  if (requiresCountertrendWarning(label)) return "border-warn/50 bg-warn/10 text-warn";
  return direction === "BUY"
    ? "border-bull/50 bg-bull/10 text-bull"
    : "border-bear/50 bg-bear/10 text-bear";
}

const ROLE_ORDER = [
  "BROAD_CONTEXT",
  "PRIMARY_CONTEXT",
  "OPERATIONAL",
  "ENTRY_CONFIRMATION",
  "EXECUTION_TRIGGER",
] as const;

export function SignalCard({
  signal,
  quote,
  notes,
  onLog,
  logged,
}: {
  signal: EngineSignal;
  quote: Quote;
  /** Data-pipeline notes for this symbol — rate limits, short history, provider fallbacks. */
  notes?: readonly string[];
  onLog?: () => void;
  logged?: boolean;
}) {
  const tradable = signal.readiness === "READY" && signal.calculationErrors.length === 0;
  const validCount = signal.timeframes.filter((t) => !isDataProblem(t.state)).length;
  const totalCount = signal.timeframes.length;

  return (
    <section className="panel space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-display text-lg font-semibold tracking-tight">{signal.symbol}</p>
          <p className="text-xs text-muted-foreground">
            Setup quality {signal.score.value}/{signal.score.max} · {signal.score.label}
            <span className="ml-1 text-[10px]">(heuristic, not a win probability)</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span
            className={`rounded-md border px-2 py-0.5 text-right text-[11px] font-semibold uppercase tracking-wide ${labelTone(signal.label, signal.direction)}`}
          >
            {signal.label}
          </span>
          <DataBadge quote={quote} />
        </div>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm tabular-nums text-muted-foreground">
          price {fmtPrice(quote.mid, signal.symbol)}
        </p>
        <p
          className={`text-[11px] font-medium tabular-nums ${validCount === totalCount ? "text-muted-foreground" : "text-warn"}`}
        >
          {validCount}/{totalCount} timeframes valid
        </p>
      </div>

      {signal.session === "CLOSED" && (
        <p className="rounded-md border border-warn/40 bg-warn/10 p-2 text-[11px] font-medium text-warn">
          Market closed — no new trade-ready signal is issued until it reopens. Anything shown here
          is context, not an active entry.
        </p>
      )}

      {notes && notes.length > 0 && (
        <ul className="space-y-1 rounded-md border border-warn/40 bg-warn/10 p-2 text-[11px] text-warn">
          {notes.map((n) => (
            <li key={n}>! {n}</li>
          ))}
        </ul>
      )}

      {/* short-term vs higher-timeframe, always shown separately */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md border border-border bg-card/60 px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Short-term direction
          </p>
          <p className="font-medium">
            {signal.shortTermDirection.replace(/_/g, " ").toLowerCase()}
          </p>
        </div>
        <div className="rounded-md border border-border bg-card/60 px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Higher-timeframe bias
          </p>
          <p className="font-medium">
            {signal.higherTimeframeBias.replace(/_/g, " ").toLowerCase()}
          </p>
        </div>
      </div>

      {signal.notFullyAlignedReason && (
        <p className="rounded-md border border-warn/40 bg-warn/10 p-2 text-[11px] text-warn">
          {signal.notFullyAlignedReason}
        </p>
      )}
      {signal.countertrendBlocked && signal.countertrendBlockReason && (
        <p className="rounded-md border border-bear/40 bg-bear/10 p-2 text-[11px] text-bear">
          Countertrend blocked: {signal.countertrendBlockReason}
        </p>
      )}

      {tradable && (
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

      {/* all nine timeframes, grouped by role tier, never hidden */}
      <div className="space-y-2">
        {ROLE_ORDER.map((role) => {
          const group = signal.timeframes.filter((t) => t.role === role);
          if (group.length === 0) return null;
          return (
            <div key={role} className="space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {ROLE_LABEL[role]}
              </p>
              <div className="flex flex-wrap gap-1">
                {group.map((tf) => (
                  <TimeframeChip key={tf.timeframe} reading={tf} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Why this signal?</summary>
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
        <p className="mt-2 text-muted-foreground">Trigger: {signal.triggerCondition}</p>
        <p className="text-muted-foreground">Invalidation: {signal.invalidationCondition}</p>
        <p className="text-muted-foreground">Session: {SESSION_LABEL[signal.session]}</p>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Strategy version: {signal.strategyVersion}
        </p>
      </details>

      <div className="flex flex-wrap gap-2">
        <Link
          to="/chart"
          search={{ symbol: signal.symbol, signalId: undefined }}
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

/** Short chip text for a data-problem state — distinct per problem, never a bare dash. */
const PROBLEM_CODE: Record<string, string> = {
  DATA_MISSING: "MISS",
  DATA_STALE: "STALE",
  DATA_DELAYED: "DELAY",
  DATA_INVALID: "BAD",
  CANDLE_OPEN: "OPEN",
};

function TimeframeChip({ reading }: { reading: TimeframeReading }) {
  const stateLabel = TIMEFRAME_STATE_LABEL[reading.state];
  const problem = isDataProblem(reading.state);
  const tone = problem
    ? "border-warn/50 bg-warn/10 text-warn"
    : reading.relation === "AGREEING"
      ? "border-bull/50 bg-bull/10 text-bull"
      : reading.relation === "CONFLICTING"
        ? "border-bear/50 bg-bear/10 text-bear"
        : "border-border bg-card text-muted-foreground";
  const k = reading.stochastic?.k;
  // A stale/delayed reading must show its exact age inline, not just on
  // hover — "STALE" alone tells you something is wrong but not how wrong.
  const showsAge =
    (reading.state === "DATA_STALE" || reading.state === "DATA_DELAYED") &&
    reading.dataAgeMs !== null;
  const ageText = showsAge ? formatAge(reading.dataAgeMs!) : null;
  const title = [
    stateLabel,
    reading.relation !== "NOT_APPLICABLE" ? reading.relation.toLowerCase() : null,
    reading.isSynthetic ? "sample data — not real" : null,
    k !== null && k !== undefined ? `K ${k.toFixed(1)}` : null,
    ageText ? `${ageText} old` : null,
    reading.explanation,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${tone} ${reading.isSynthetic ? "opacity-60" : ""}`}
      title={title}
      aria-label={`${reading.timeframe}: ${stateLabel}${reading.relation === "CONFLICTING" ? " (conflicting)" : ""}${ageText ? `, ${ageText} old` : ""}`}
    >
      {reading.timeframe}{" "}
      {problem
        ? `${PROBLEM_CODE[reading.state]}${ageText ? ` ${ageText}` : ""}`
        : (k?.toFixed(0) ?? "—")}
    </span>
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
