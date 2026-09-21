/**
 * Decides which state transitions are worth a notification, and which are
 * not — kept pure and separate from the browser Notification API so the
 * decision logic can be tested without a DOM.
 *
 * "Never send notifications for invalid or stale signals" is enforced by
 * construction here, not by a separate check: SIGNAL_READY only fires on a
 * transition TO the `READY` readiness, and the engine can only reach `READY`
 * once every data-quality gate has already passed — a stale or invalid
 * reading cannot produce a READY signal to notify about in the first place.
 */

import type { Readiness, SignalLabel } from "../domain/states";

export interface NotifiableRow {
  readonly symbol: string;
  readonly label: SignalLabel;
  readonly readiness: Readiness;
}

export type NotificationKind = "SIGNAL_READY" | "DATA_PROBLEM";

export interface NotificationEvent {
  readonly kind: NotificationKind;
  readonly symbol: string;
  readonly title: string;
  readonly body: string;
}

export interface NotificationSettings {
  readonly mutedSymbols: ReadonlySet<string>;
  /** Quiet-hours window in the user's local hour-of-day, e.g. 22 to 7. Wraps past midnight. */
  readonly quietHoursStart: number | null;
  readonly quietHoursEnd: number | null;
}

const DATA_PROBLEM_LABELS: readonly SignalLabel[] = ["INSUFFICIENT DATA", "DATA QUALITY ERROR"];

/** Whether `hour` (0-23, local time) falls inside a quiet-hours window that may wrap past midnight. */
export function isQuietHour(hour: number, start: number | null, end: number | null): boolean {
  if (start === null || end === null) return false;
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end; // wraps past midnight, e.g. 22 -> 7
}

/**
 * Compares the previous poll's labels against the current one and returns
 * only the transitions worth surfacing. `previousLabels` is keyed by symbol;
 * a symbol absent from it is treated as having no prior state (first poll),
 * which never fires a notification — there is nothing to have "changed" from.
 */
export function selectNotifications(
  previousLabels: ReadonlyMap<string, SignalLabel>,
  current: readonly NotifiableRow[],
  settings: NotificationSettings,
  localHour: number,
): NotificationEvent[] {
  if (isQuietHour(localHour, settings.quietHoursStart, settings.quietHoursEnd)) return [];

  const events: NotificationEvent[] = [];
  for (const row of current) {
    if (settings.mutedSymbols.has(row.symbol)) continue;
    const previous = previousLabels.get(row.symbol);
    if (previous === undefined) continue; // first observation — nothing changed yet
    if (previous === row.label) continue; // no transition

    if (row.readiness === "READY" && previous !== row.label) {
      const wasAlreadyReady = previous.includes("READY");
      if (!wasAlreadyReady) {
        events.push({
          kind: "SIGNAL_READY",
          symbol: row.symbol,
          title: `${row.symbol}: ${row.label}`,
          body: "Entry conditions currently pass. Not a guarantee — check the app before acting.",
        });
      }
      continue;
    }

    const becameDataProblem =
      DATA_PROBLEM_LABELS.includes(row.label) && !DATA_PROBLEM_LABELS.includes(previous);
    if (becameDataProblem) {
      events.push({
        kind: "DATA_PROBLEM",
        symbol: row.symbol,
        title: `${row.symbol}: data problem`,
        body: `Analysis is unavailable (${row.label}). Any earlier signal for this pair should be treated as stale.`,
      });
    }
  }
  return events;
}

/**
 * Symbols whose "previous label" bookkeeping may advance after this poll.
 *
 * A symbol suppressed this poll (quiet hours globally, or an individual
 * mute) must NOT have its stored label advanced to the current one — doing
 * so would make a transition that occurred while suppressed permanently
 * invisible, since the next eligible poll would then see "no change" (or,
 * for a READY label, `wasAlreadyReady`) instead of the real transition into
 * it. Leaving the old label in place means that transition is still
 * detected as new once quiet hours end or the symbol is unmuted.
 */
export function eligibleForLabelUpdate(
  rows: readonly NotifiableRow[],
  settings: NotificationSettings,
  localHour: number,
): string[] {
  if (isQuietHour(localHour, settings.quietHoursStart, settings.quietHoursEnd)) return [];
  return rows.filter((row) => !settings.mutedSymbols.has(row.symbol)).map((row) => row.symbol);
}
