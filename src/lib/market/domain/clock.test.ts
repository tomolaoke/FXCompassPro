import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLOCK_CONFIG,
  bucketStart,
  candleCloseTime,
  formatAge,
  freshness,
  fromZonedParts,
  isCandleClosed,
  isMarketOpen,
  lastClosedCandleOpen,
  nextBucketStart,
  sessionAt,
  toZonedParts,
  zoneOffsetMs,
  type ClockConfig,
} from "./clock";

const BROKER = DEFAULT_CLOCK_CONFIG;

/** Readable UTC constructor for test data. */
const utc = (y: number, m: number, d: number, h = 0, min = 0, s = 0): number =>
  Date.UTC(y, m - 1, d, h, min, s);

const HOUR = 3_600_000;

describe("zoneOffsetMs", () => {
  it("reports EET (UTC+2) for Athens in winter", () => {
    expect(zoneOffsetMs(utc(2025, 1, 15, 12), "Europe/Athens")).toBe(2 * HOUR);
  });

  it("reports EEST (UTC+3) for Athens in summer", () => {
    expect(zoneOffsetMs(utc(2025, 7, 15, 12), "Europe/Athens")).toBe(3 * HOUR);
  });

  it("reports EST (UTC-5) for New York in winter", () => {
    expect(zoneOffsetMs(utc(2025, 1, 15, 12), "America/New_York")).toBe(-5 * HOUR);
  });

  it("reports EDT (UTC-4) for New York in summer", () => {
    expect(zoneOffsetMs(utc(2025, 7, 15, 12), "America/New_York")).toBe(-4 * HOUR);
  });

  it("reports a constant UTC+1 for Lagos, which has no daylight saving", () => {
    expect(zoneOffsetMs(utc(2025, 1, 15, 12), "Africa/Lagos")).toBe(HOUR);
    expect(zoneOffsetMs(utc(2025, 7, 15, 12), "Africa/Lagos")).toBe(HOUR);
  });
});

describe("toZonedParts / fromZonedParts", () => {
  it("round-trips an instant through a zone", () => {
    const instant = utc(2025, 3, 14, 9, 30);
    const parts = toZonedParts(instant, "Europe/Athens");
    expect(fromZonedParts(parts, "Europe/Athens")).toBe(instant);
  });

  it("round-trips across the spring-forward transition", () => {
    // EU clocks go forward on the last Sunday of March: 30 March 2025.
    const instant = utc(2025, 3, 30, 12, 0);
    const parts = toZonedParts(instant, "Europe/Athens");
    expect(fromZonedParts(parts, "Europe/Athens")).toBe(instant);
  });

  it("round-trips across the autumn fall-back transition", () => {
    // EU clocks go back on the last Sunday of October: 26 October 2025.
    const instant = utc(2025, 10, 26, 12, 0);
    const parts = toZonedParts(instant, "Europe/Athens");
    expect(fromZonedParts(parts, "Europe/Athens")).toBe(instant);
  });

  it("reports the weekday in the target zone, not UTC", () => {
    // 22:00 UTC Sunday is already Monday in Athens (UTC+3 in summer).
    const parts = toZonedParts(utc(2025, 7, 6, 22, 0), "Europe/Athens");
    expect(parts.weekday).toBe(1); // Monday
    expect(parts.hour).toBe(1);
  });
});

describe("bucketStart — daily", () => {
  it("starts the daily candle at broker midnight, not UTC midnight", () => {
    // Summer: Athens is UTC+3, so the broker day starts at 21:00 UTC.
    const midMorning = utc(2025, 7, 15, 10, 30);
    expect(bucketStart(midMorning, "D1", BROKER)).toBe(utc(2025, 7, 14, 21, 0));
  });

  it("uses a UTC+2 boundary in winter", () => {
    const midMorning = utc(2025, 1, 15, 10, 30);
    expect(bucketStart(midMorning, "D1", BROKER)).toBe(utc(2025, 1, 14, 22, 0));
  });

  it("puts 20:00 UTC in summer into the NEXT broker day", () => {
    // 20:00 UTC = 23:00 Athens, still the same broker day.
    expect(bucketStart(utc(2025, 7, 15, 20, 0), "D1", BROKER)).toBe(utc(2025, 7, 14, 21, 0));
    // 21:00 UTC = 00:00 Athens next day — a new daily candle.
    expect(bucketStart(utc(2025, 7, 15, 21, 0), "D1", BROKER)).toBe(utc(2025, 7, 15, 21, 0));
  });

  it("places the daily boundary near 17:00 New York", () => {
    const boundary = bucketStart(utc(2025, 7, 15, 10), "D1", BROKER);
    const ny = toZonedParts(boundary, "America/New_York");
    expect(ny.hour).toBe(17);
  });
});

describe("bucketStart — weekly", () => {
  it("opens the week at broker Monday midnight", () => {
    // Wednesday 16 July 2025; the week opened Monday 14 July 00:00 Athens.
    const wednesday = utc(2025, 7, 16, 12);
    expect(bucketStart(wednesday, "W1", BROKER)).toBe(utc(2025, 7, 13, 21, 0));
  });

  it("puts the Sunday-evening open into the coming week, not the past one", () => {
    // 21:00 UTC Sunday = Monday 00:00 in Athens. This is the bar that a
    // UTC-based bucket would have filed under the previous week.
    const sundayOpen = utc(2025, 7, 13, 21, 30);
    const mondayMorning = utc(2025, 7, 14, 8, 0);
    expect(bucketStart(sundayOpen, "W1", BROKER)).toBe(bucketStart(mondayMorning, "W1", BROKER));
  });

  it("keeps Friday in the same week as the preceding Monday", () => {
    const monday = utc(2025, 7, 14, 8);
    const friday = utc(2025, 7, 18, 16);
    expect(bucketStart(friday, "W1", BROKER)).toBe(bucketStart(monday, "W1", BROKER));
  });

  it("does not drift when daylight saving changes mid-week", () => {
    // EU clocks go back on Sunday 26 October 2025, so the week of 27 October
    // is entirely in EET — but the week of 20 October spans the change.
    const start = bucketStart(utc(2025, 10, 22, 12), "W1", BROKER);
    const parts = toZonedParts(start, BROKER.brokerTimeZone);
    expect(parts.hour).toBe(0);
    expect(parts.weekday).toBe(1); // Monday
  });
});

describe("bucketStart — monthly", () => {
  it("starts on the first of the month in broker time", () => {
    const midMonth = utc(2025, 7, 15, 12);
    const start = bucketStart(midMonth, "MN", BROKER);
    const parts = toZonedParts(start, BROKER.brokerTimeZone);
    expect(parts.day).toBe(1);
    expect(parts.month).toBe(7);
    expect(parts.hour).toBe(0);
  });

  it("rolls over at the broker month boundary, not the UTC one", () => {
    // 21:30 UTC on 31 July is already 1 August in Athens.
    const lateJuly = utc(2025, 7, 31, 21, 30);
    const parts = toZonedParts(bucketStart(lateJuly, "MN", BROKER), BROKER.brokerTimeZone);
    expect(parts.month).toBe(8);
  });
});

describe("bucketStart — intraday", () => {
  it("aligns H4 to the broker day, not to 00:00 UTC", () => {
    // Broker day starts 21:00 UTC in summer, so H4 boundaries are
    // 21:00, 01:00, 05:00, 09:00, 13:00, 17:00 UTC.
    expect(bucketStart(utc(2025, 7, 15, 10, 30), "H4", BROKER)).toBe(utc(2025, 7, 15, 9, 0));
    expect(bucketStart(utc(2025, 7, 15, 8, 59), "H4", BROKER)).toBe(utc(2025, 7, 15, 5, 0));
  });

  it("puts H4 boundaries on odd UTC hours in summer, which UTC bucketing misses", () => {
    const start = bucketStart(utc(2025, 7, 15, 10, 30), "H4", BROKER);
    // A naive floor(t / 4h) would have produced 08:00 UTC.
    expect(start).not.toBe(utc(2025, 7, 15, 8, 0));
  });

  it("aligns M15 to quarter hours", () => {
    expect(bucketStart(utc(2025, 7, 15, 10, 37, 42), "M15", BROKER)).toBe(utc(2025, 7, 15, 10, 30));
  });

  it("aligns M5 to five-minute marks", () => {
    expect(bucketStart(utc(2025, 7, 15, 10, 37, 42), "M5", BROKER)).toBe(utc(2025, 7, 15, 10, 35));
  });

  it("is idempotent", () => {
    const t = utc(2025, 7, 15, 10, 37);
    for (const tf of ["M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN"] as const) {
      const once = bucketStart(t, tf, BROKER);
      expect(bucketStart(once, tf, BROKER)).toBe(once);
    }
  });
});

describe("nextBucketStart", () => {
  it("advances exactly one bar for intraday timeframes", () => {
    const start = bucketStart(utc(2025, 7, 15, 10, 30), "M15", BROKER);
    expect(nextBucketStart(start, "M15", BROKER)).toBe(start + 15 * 60_000);
  });

  it("advances one broker day", () => {
    const start = bucketStart(utc(2025, 7, 15, 10), "D1", BROKER);
    expect(nextBucketStart(start, "D1", BROKER)).toBe(start + 86_400_000);
  });

  it("advances one calendar month, not thirty days", () => {
    const start = bucketStart(utc(2025, 1, 15), "MN", BROKER);
    const next = nextBucketStart(start, "MN", BROKER);
    const parts = toZonedParts(next, BROKER.brokerTimeZone);
    expect(parts.month).toBe(2);
    expect(parts.day).toBe(1);
  });

  it("rolls December into January of the next year", () => {
    const start = bucketStart(utc(2025, 12, 15), "MN", BROKER);
    const parts = toZonedParts(nextBucketStart(start, "MN", BROKER), BROKER.brokerTimeZone);
    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(1);
  });

  it("advances a week to the following Monday", () => {
    const start = bucketStart(utc(2025, 7, 16), "W1", BROKER);
    const parts = toZonedParts(nextBucketStart(start, "W1", BROKER), BROKER.brokerTimeZone);
    expect(parts.weekday).toBe(1);
    expect(parts.hour).toBe(0);
  });

  it("stays a whole week across the autumn transition, in wall-clock terms", () => {
    // The week containing the fall-back is 25 hours longer in absolute time,
    // but must still end on the following Monday at midnight.
    const start = bucketStart(utc(2025, 10, 22, 12), "W1", BROKER);
    const next = nextBucketStart(start, "W1", BROKER);
    expect(next).toBeGreaterThan(start);
    const parts = toZonedParts(next, BROKER.brokerTimeZone);
    expect(parts.weekday).toBe(1);
    expect(parts.hour).toBe(0);
  });

  it("always moves strictly forward", () => {
    for (const tf of ["M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN"] as const) {
      // Probe across both DST transitions.
      for (const t of [
        utc(2025, 3, 30, 0, 30),
        utc(2025, 3, 30, 2, 30),
        utc(2025, 10, 26, 0, 30),
        utc(2025, 10, 26, 2, 30),
        utc(2025, 7, 15, 12),
      ]) {
        const start = bucketStart(t, tf, BROKER);
        expect(nextBucketStart(start, tf, BROKER)).toBeGreaterThan(start);
      }
    }
  });
});

describe("isCandleClosed", () => {
  const open = bucketStart(utc(2025, 7, 15, 10, 30), "M15", BROKER);
  const close = candleCloseTime(open, "M15", BROKER);

  it("is open one millisecond before the close", () => {
    expect(isCandleClosed(open, "M15", close - 1, BROKER)).toBe(false);
  });

  it("is closed exactly at the close", () => {
    expect(isCandleClosed(open, "M15", close, BROKER)).toBe(true);
  });

  it("is closed after the close", () => {
    expect(isCandleClosed(open, "M15", close + 1, BROKER)).toBe(true);
  });

  it("treats the candle containing now as open", () => {
    const now = utc(2025, 7, 15, 10, 37);
    expect(isCandleClosed(bucketStart(now, "M15", BROKER), "M15", now, BROKER)).toBe(false);
  });
});

describe("lastClosedCandleOpen", () => {
  it("returns the bar before the one in progress", () => {
    const now = utc(2025, 7, 15, 10, 37);
    const lastClosed = lastClosedCandleOpen("M15", now, BROKER);
    expect(lastClosed).toBe(utc(2025, 7, 15, 10, 15));
    expect(isCandleClosed(lastClosed, "M15", now, BROKER)).toBe(true);
  });

  it("never returns a candle that is still open, on any timeframe", () => {
    const now = utc(2025, 7, 15, 10, 37, 13);
    for (const tf of ["M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN"] as const) {
      expect(isCandleClosed(lastClosedCandleOpen(tf, now, BROKER), tf, now, BROKER)).toBe(true);
    }
  });
});

describe("freshness", () => {
  const now = utc(2025, 7, 15, 12, 0);

  it("measures age from the timestamp", () => {
    expect(freshness(now - 90_000, "M5", now).ageMs).toBe(90_000);
  });

  it("marks data past the timeframe limit as stale", () => {
    expect(freshness(now - 25 * 60_000, "M5", now).isStale).toBe(true);
    expect(freshness(now - 5 * 60_000, "M5", now).isStale).toBe(false);
  });

  it("does not call a two-hour-old weekly candle stale", () => {
    expect(freshness(now - 2 * HOUR, "W1", now).isStale).toBe(false);
  });

  it("flags a future timestamp as implausible rather than maximally fresh", () => {
    // This is the defect that made quote ages negative: the quote was stamped
    // with the END of a bar that was still open.
    const result = freshness(now + 10 * 60_000, "M5", now);
    expect(result.isImplausible).toBe(true);
    expect(result.isStale).toBe(false);
  });

  it("tolerates small clock skew without crying foul", () => {
    expect(freshness(now + 30_000, "M5", now).isImplausible).toBe(false);
  });
});

describe("isMarketOpen", () => {
  it("is open midweek", () => {
    expect(isMarketOpen(utc(2025, 7, 16, 12), BROKER)).toBe(true);
  });

  it("is closed on Saturday", () => {
    expect(isMarketOpen(utc(2025, 7, 19, 12), BROKER)).toBe(false);
  });

  it("is open on Sunday evening once the broker week has started", () => {
    // 21:00 UTC Sunday = Monday 00:00 in Athens.
    expect(isMarketOpen(utc(2025, 7, 13, 21, 30), BROKER)).toBe(true);
  });

  it("is closed on Sunday afternoon, before the open", () => {
    expect(isMarketOpen(utc(2025, 7, 13, 12), BROKER)).toBe(false);
  });
});

describe("sessionAt", () => {
  it("reports the market as closed at the weekend", () => {
    expect(sessionAt(utc(2025, 7, 19, 12), BROKER)).toBe("CLOSED");
  });

  it("reports the London/New York overlap in the early afternoon UTC", () => {
    // 14:00 UTC in July: London 15:00, New York 10:00 — both open.
    expect(sessionAt(utc(2025, 7, 16, 14), BROKER)).toBe("LONDON_NY_OVERLAP");
  });

  it("reports London alone in the morning", () => {
    // 09:00 UTC in July: London 10:00 open, New York 05:00 closed.
    expect(sessionAt(utc(2025, 7, 16, 9), BROKER)).toBe("LONDON");
  });

  it("reports Asia overnight", () => {
    // 02:00 UTC in July: Tokyo 11:00 open, London and New York closed.
    expect(sessionAt(utc(2025, 7, 16, 2), BROKER)).toBe("ASIA");
  });

  it("tracks each centre's own daylight saving", () => {
    // London and New York both shift, but not on the same dates. The overlap
    // must hold in winter too.
    expect(sessionAt(utc(2025, 1, 15, 15), BROKER)).toBe("LONDON_NY_OVERLAP");
  });
});

describe("formatAge", () => {
  it("formats seconds, minutes, hours and days", () => {
    expect(formatAge(4_000)).toBe("4s");
    expect(formatAge(12 * 60_000)).toBe("12m");
    expect(formatAge(3 * HOUR + 20 * 60_000)).toBe("3h 20m");
    expect(formatAge(2 * HOUR)).toBe("2h");
    expect(formatAge(3 * 86_400_000)).toBe("3d");
  });

  it("says so when a timestamp is in the future, rather than showing 0s", () => {
    expect(formatAge(-5000)).toBe("future");
  });
});

describe("configurability", () => {
  it("honours a different broker timezone", () => {
    const utcBroker: ClockConfig = {
      brokerTimeZone: "UTC",
      displayTimeZone: "Africa/Lagos",
    };
    // With a UTC server, the daily candle does start at midnight UTC.
    expect(bucketStart(utc(2025, 7, 15, 10), "D1", utcBroker)).toBe(utc(2025, 7, 15, 0));
    // With the default EET/EEST server, it does not.
    expect(bucketStart(utc(2025, 7, 15, 10), "D1", BROKER)).not.toBe(utc(2025, 7, 15, 0));
  });
});
