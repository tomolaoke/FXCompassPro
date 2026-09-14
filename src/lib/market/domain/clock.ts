/**
 * All time logic. Nothing else in the application may compute a candle
 * boundary, convert a timezone, or decide whether a candle has closed.
 *
 * Three rules:
 *
 *   1. Every timestamp in storage and in memory is epoch milliseconds UTC.
 *   2. Candle boundaries follow the BROKER's server day, not the UTC day.
 *   3. Display conversion happens at the edge, never in the engine.
 *
 * Rule 2 is the one that matters. MetaTrader brokers do not start the day at
 * midnight UTC. HF Markets, like most, runs an EET/EEST server (UTC+2 winter,
 * UTC+3 summer), which puts the daily close around 17:00 New York. Bucketing in
 * UTC instead produces D1, W1 and H4 candles that do not match the charts the
 * user is actually looking at.
 *
 * Note that anchoring to the broker's own timezone is more correct than
 * anchoring to "17:00 New York": European and US daylight-saving transitions
 * are two to three weeks apart, and during those windows the broker's daily
 * close genuinely is not 17:00 New York. The terminal is the reference.
 *
 * Zero dependencies — timezone maths uses the built-in Intl database.
 */

import { TIMEFRAMES, timeframeMs, type Timeframe } from "../config/timeframes";

export interface ClockConfig {
  /** IANA zone of the broker's MT4/MT5 server. Decides candle boundaries. */
  readonly brokerTimeZone: string;
  /** IANA zone used when showing times to the user. */
  readonly displayTimeZone: string;
}

export const DEFAULT_CLOCK_CONFIG: ClockConfig = {
  brokerTimeZone: "Europe/Athens",
  displayTimeZone: "Africa/Lagos",
};

// ─── Timezone primitives ─────────────────────────────────────────────────────

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
  /** 0 = Sunday. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

/** Wall-clock parts in `timeZone` for a UTC instant. */
export function toZonedParts(utcMs: number, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(utcMs));
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map["year"]),
    month: Number(map["month"]),
    day: Number(map["day"]),
    // `hourCycle: h23` should never yield 24, but some engines have; normalise.
    hour: Number(map["hour"]) % 24,
    minute: Number(map["minute"]),
    second: Number(map["second"]),
    weekday: WEEKDAY_INDEX[map["weekday"] ?? "Sun"] ?? 0,
  };
}

/** Offset of `timeZone` from UTC at a UTC instant, in ms east of UTC. */
export function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const p = toZonedParts(utcMs, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Round to the second: formatToParts drops sub-second precision.
  return asIfUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * The UTC instant at which `timeZone`'s wall clock reads the given parts.
 *
 * Guess-and-correct: apply the offset that holds at the naive instant, then
 * re-check it at the corrected instant. Two passes resolve every ordinary DST
 * boundary. Ambiguous times (the repeated hour when clocks go back) resolve to
 * the first occurrence; non-existent times (the skipped hour when clocks go
 * forward) resolve forward. Candle boundaries are chosen to avoid both.
 */
export function fromZonedParts(
  parts: {
    year: number;
    month: number;
    day: number;
    hour?: number;
    minute?: number;
    second?: number;
  },
  timeZone: string,
): number {
  const naive = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  const firstPass = naive - zoneOffsetMs(naive, timeZone);
  const secondOffset = zoneOffsetMs(firstPass, timeZone);
  return naive - secondOffset;
}

// ─── Candle boundaries ───────────────────────────────────────────────────────

/**
 * Start of the candle containing `utcMs`, aligned to the broker's session.
 *
 * Returned value is the candle's OPEN time in UTC, which is how candles are
 * keyed throughout the application.
 */
export function bucketStart(
  utcMs: number,
  timeframe: Timeframe,
  config: ClockConfig = DEFAULT_CLOCK_CONFIG,
): number {
  const tz = config.brokerTimeZone;
  const def = TIMEFRAMES[timeframe];

  switch (def.bucket) {
    case "MONTHLY": {
      const p = toZonedParts(utcMs, tz);
      return fromZonedParts({ year: p.year, month: p.month, day: 1 }, tz);
    }

    case "WEEKLY": {
      // Broker weeks start on Monday in server time; the Sunday-evening open
      // bar already falls on Monday there, which is why bucketing in the
      // broker's zone rather than UTC is what makes the Sunday open land in
      // the correct week.
      const p = toZonedParts(utcMs, tz);
      const dayOfWeek = (p.weekday + 6) % 7; // 0 = Monday
      const midnightThisDay = fromZonedParts({ year: p.year, month: p.month, day: p.day }, tz);
      // Step back whole days via wall clock, so a DST shift inside the week
      // cannot drift the boundary by an hour.
      const backTo = toZonedParts(midnightThisDay - dayOfWeek * 86_400_000, tz);
      return fromZonedParts({ year: backTo.year, month: backTo.month, day: backTo.day }, tz);
    }

    case "DAILY": {
      const p = toZonedParts(utcMs, tz);
      return fromZonedParts({ year: p.year, month: p.month, day: p.day }, tz);
    }

    case "INTRADAY": {
      // Align within the broker's day so H4 boundaries match the terminal
      // (00:00, 04:00, ... server time) rather than 00:00 UTC.
      const p = toZonedParts(utcMs, tz);
      const dayStart = fromZonedParts({ year: p.year, month: p.month, day: p.day }, tz);
      const size = timeframeMs(timeframe);
      const sinceDayStart = utcMs - dayStart;
      return dayStart + Math.floor(sinceDayStart / size) * size;
    }
  }
}

/**
 * Start of the candle after the one containing `utcMs`. This is also the
 * containing candle's CLOSE time — a candle closes exactly when the next opens.
 */
export function nextBucketStart(
  utcMs: number,
  timeframe: Timeframe,
  config: ClockConfig = DEFAULT_CLOCK_CONFIG,
): number {
  const tz = config.brokerTimeZone;
  const def = TIMEFRAMES[timeframe];
  const start = bucketStart(utcMs, timeframe, config);

  switch (def.bucket) {
    case "MONTHLY": {
      const p = toZonedParts(start, tz);
      const nextMonth = p.month === 12 ? 1 : p.month + 1;
      const nextYear = p.month === 12 ? p.year + 1 : p.year;
      return fromZonedParts({ year: nextYear, month: nextMonth, day: 1 }, tz);
    }
    case "WEEKLY":
      // Re-bucket from a point safely inside the next week so a DST shift
      // cannot land us back in the same bucket.
      return bucketStart(start + 7 * 86_400_000 + 43_200_000, timeframe, config);
    case "DAILY":
      return bucketStart(start + 86_400_000 + 43_200_000, timeframe, config);
    case "INTRADAY": {
      const candidate = start + timeframeMs(timeframe);
      // A DST shift inside the day can make the naive step land in the wrong
      // bucket; re-bucketing normalises it.
      const rebucketed = bucketStart(candidate, timeframe, config);
      return rebucketed > start ? rebucketed : candidate;
    }
  }
}

/** Close time of the candle that opened at `openUtcMs`. */
export function candleCloseTime(
  openUtcMs: number,
  timeframe: Timeframe,
  config: ClockConfig = DEFAULT_CLOCK_CONFIG,
): number {
  return nextBucketStart(openUtcMs, timeframe, config);
}

/**
 * Whether the candle that opened at `openUtcMs` has closed as of `now`.
 *
 * This is the gate between a provisional reading and a confirmed one. A signal
 * derived from a candle for which this returns false is CANDLE_OPEN and may
 * never be confirmed.
 */
export function isCandleClosed(
  openUtcMs: number,
  timeframe: Timeframe,
  now: number,
  config: ClockConfig = DEFAULT_CLOCK_CONFIG,
): boolean {
  return now >= candleCloseTime(openUtcMs, timeframe, config);
}

/**
 * Open time of the most recent candle that has definitely closed.
 * Confirmed signals may only read data at or before this instant.
 */
export function lastClosedCandleOpen(
  timeframe: Timeframe,
  now: number,
  config: ClockConfig = DEFAULT_CLOCK_CONFIG,
): number {
  const currentOpen = bucketStart(now, timeframe, config);
  // Step back into the previous bucket. Half a bar is enough for INTRADAY and
  // safe for the calendar buckets, which re-derive their own start.
  return bucketStart(currentOpen - 1, timeframe, config);
}

// ─── Freshness ───────────────────────────────────────────────────────────────

export interface FreshnessResult {
  ageMs: number;
  isStale: boolean;
  /**
   * True when the timestamp is in the future by more than a small tolerance —
   * which means a fabricated or misparsed timestamp, not fresh data.
   */
  isImplausible: boolean;
}

/** Tolerance for clock skew between us and the provider. */
const FUTURE_TOLERANCE_MS = 2 * 60_000;

/**
 * Data age, and whether it is past this timeframe's limit.
 *
 * `isImplausible` exists because the previous implementation stamped quotes
 * with the END of the last one-minute bar — which, since that bar was still
 * open, put the timestamp in the future and made `age` negative. A negative
 * age silently passed every staleness check. Future timestamps are now treated
 * as a data fault rather than as maximum freshness.
 */
export function freshness(
  timestampUtcMs: number,
  timeframe: Timeframe,
  now: number,
): FreshnessResult {
  const ageMs = now - timestampUtcMs;
  const limitMs = TIMEFRAMES[timeframe].staleAfterMinutes * 60_000;
  return {
    ageMs,
    isStale: ageMs > limitMs,
    isImplausible: ageMs < -FUTURE_TOLERANCE_MS,
  };
}

// ─── Market sessions ─────────────────────────────────────────────────────────

export type MarketSession = "ASIA" | "LONDON" | "NEW_YORK" | "LONDON_NY_OVERLAP" | "CLOSED";

export const SESSION_LABEL: Record<MarketSession, string> = {
  ASIA: "Asia",
  LONDON: "London",
  NEW_YORK: "New York",
  LONDON_NY_OVERLAP: "London / New York overlap",
  CLOSED: "Market closed",
};

/**
 * Session windows in each centre's own timezone, so they track daylight saving
 * in the place the session actually happens rather than drifting an hour twice
 * a year.
 */
const SESSION_WINDOWS = [
  { session: "ASIA" as const, zone: "Asia/Tokyo", startHour: 9, endHour: 18 },
  { session: "LONDON" as const, zone: "Europe/London", startHour: 8, endHour: 17 },
  { session: "NEW_YORK" as const, zone: "America/New_York", startHour: 8, endHour: 17 },
];

/**
 * Whether the FX market is open. The week runs from the Sunday evening open to
 * the Friday evening close in broker server time.
 */
export function isMarketOpen(utcMs: number, config: ClockConfig = DEFAULT_CLOCK_CONFIG): boolean {
  const p = toZonedParts(utcMs, config.brokerTimeZone);
  // In an EET/EEST server, the week opens at Monday 00:00 and closes Friday
  // 24:00 server time, so Saturday and Sunday are closed.
  return p.weekday !== 6 && p.weekday !== 0;
}

/** Which session(s) are active. Overlap is reported explicitly. */
export function sessionAt(
  utcMs: number,
  config: ClockConfig = DEFAULT_CLOCK_CONFIG,
): MarketSession {
  if (!isMarketOpen(utcMs, config)) return "CLOSED";

  const active = new Set<string>();
  for (const window of SESSION_WINDOWS) {
    const { hour } = toZonedParts(utcMs, window.zone);
    if (hour >= window.startHour && hour < window.endHour) active.add(window.session);
  }

  if (active.has("LONDON") && active.has("NEW_YORK")) return "LONDON_NY_OVERLAP";
  if (active.has("LONDON")) return "LONDON";
  if (active.has("NEW_YORK")) return "NEW_YORK";
  if (active.has("ASIA")) return "ASIA";
  // Between the New York close and the Tokyo open the market is open but no
  // major centre is: thin liquidity, which is information, not "closed".
  return "ASIA";
}

// ─── Display ─────────────────────────────────────────────────────────────────

/**
 * Format a UTC instant in the user's timezone. Engine code must never call
 * this; formatting belongs at the UI edge.
 */
export function formatInZone(
  utcMs: number,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  }).format(new Date(utcMs));
}

/** Compact human age, e.g. "4s", "12m", "3h 20m", "2d". */
export function formatAge(ageMs: number): string {
  if (ageMs < 0) return "future";
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remainder = minutes % 60;
    return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
