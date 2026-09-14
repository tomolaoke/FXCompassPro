/**
 * Decides whether a symbol has a blocking high-impact news event nearby.
 *
 * The hard rule this exists to enforce: an empty result must never be read as
 * "no news." A calendar nobody has populated and a calendar that genuinely has
 * nothing scheduled look identical from an empty query — so this checks
 * whether the calendar looks maintained at all before trusting an empty
 * window as CLEAR rather than UNAVAILABLE.
 */

import type { NewsEvent, ImpactLevel } from "./types";
import type { NewsStatus } from "../domain/states";

export interface NewsWindowConfig {
  readonly enabled: boolean;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
  readonly blockingImpacts: readonly ImpactLevel[];
}

export interface NewsCheckResult {
  readonly status: NewsStatus;
  /** The nearest blocking event, when status is EVENT_NEARBY. */
  readonly event: NewsEvent | null;
  readonly minutesUntil: number | null;
  readonly reason: string;
}

const UNAVAILABLE: NewsCheckResult = {
  status: "UNAVAILABLE",
  event: null,
  minutesUntil: null,
  reason: "NEWS CHECK UNAVAILABLE — VERIFY ECONOMIC CALENDAR MANUALLY",
};

/**
 * A calendar is treated as maintained when it holds at least one event within
 * a wide window around `now`. An empty table (nobody has ever entered an
 * event) and a quiet week (events exist, just not now) must not look the
 * same — this is the proxy that tells them apart.
 */
const MAINTAINED_WINDOW_DAYS = 30;

function looksMaintained(allEvents: readonly NewsEvent[], now: number): boolean {
  const windowMs = MAINTAINED_WINDOW_DAYS * 24 * 60 * 60_000;
  return allEvents.some((e) => Math.abs(e.eventTimeUtc - now) <= windowMs);
}

/**
 * `allEvents` is the whole calendar (used only for the maintained-calendar
 * check); `relevantEvents` should already be filtered to the currencies the
 * symbol involves — callers extract those from the symbol, not this function,
 * since currency-from-symbol parsing is instrument-specific (XAU has no
 *"quote currency" in the FX sense).
 */
export function checkNewsWindow(
  allEvents: readonly NewsEvent[],
  relevantEvents: readonly NewsEvent[],
  now: number,
  config: NewsWindowConfig,
): NewsCheckResult {
  if (!config.enabled) return UNAVAILABLE;
  if (!looksMaintained(allEvents, now)) return UNAVAILABLE;

  const blocking = relevantEvents
    .filter((e) => config.blockingImpacts.includes(e.impact))
    .filter((e) => {
      const minutesUntil = (e.eventTimeUtc - now) / 60_000;
      return (
        minutesUntil >= -config.bufferAfterMinutes && minutesUntil <= config.bufferBeforeMinutes
      );
    })
    .sort((a, b) => Math.abs(a.eventTimeUtc - now) - Math.abs(b.eventTimeUtc - now));

  const nearest = blocking[0];
  if (!nearest) {
    return {
      status: "CLEAR",
      event: null,
      minutesUntil: null,
      reason: "No blocking high-impact events in the configured buffer window.",
    };
  }

  const minutesUntil = Math.round((nearest.eventTimeUtc - now) / 60_000);
  return {
    status: "EVENT_NEARBY",
    event: nearest,
    minutesUntil,
    reason:
      minutesUntil >= 0
        ? `${nearest.title} (${nearest.currency}, ${nearest.impact}) in ${minutesUntil} minutes.`
        : `${nearest.title} (${nearest.currency}, ${nearest.impact}) was ${-minutesUntil} minutes ago.`,
  };
}

/**
 * Currencies a symbol's news risk depends on. FX pairs split into base/quote;
 * metals and indices are mapped to the currency their price is quoted in,
 * since e.g. XAUUSD news risk tracks USD releases, not a "XAU economy".
 */
const NON_FX_CURRENCY: Record<string, string> = {
  XAUUSD: "USD",
  XAGUSD: "USD",
  US30: "USD",
  NAS100: "USD",
  SPX500: "USD",
};

export function currenciesFor(symbol: string): string[] {
  const s = symbol.toUpperCase();
  const mapped = NON_FX_CURRENCY[s];
  if (mapped) return [mapped];
  if (s.length === 6) return [s.slice(0, 3), s.slice(3)];
  return [];
}
