import { describe, expect, it } from "vitest";
import { checkNewsWindow, currenciesFor } from "./check";
import type { NewsEvent } from "./types";

const NOW = Date.UTC(2025, 6, 15, 12, 0, 0);
const MIN = 60_000;

function event(overrides: Partial<NewsEvent> = {}): NewsEvent {
  return {
    id: "1",
    currency: "USD",
    title: "Non-Farm Payrolls",
    impact: "HIGH",
    eventTimeUtc: NOW,
    source: "manual",
    createdAt: NOW,
    ...overrides,
  };
}

const CONFIG = {
  enabled: true,
  bufferBeforeMinutes: 30,
  bufferAfterMinutes: 15,
  blockingImpacts: ["HIGH"] as const,
};

describe("checkNewsWindow — never assumes 'no news' from an empty calendar", () => {
  it("reports UNAVAILABLE when the calendar has never been populated", () => {
    const result = checkNewsWindow([], [], NOW, CONFIG);
    expect(result.status).toBe("UNAVAILABLE");
  });

  it("reports UNAVAILABLE when the calendar is disabled entirely", () => {
    const events = [event()];
    const result = checkNewsWindow(events, events, NOW, { ...CONFIG, enabled: false });
    expect(result.status).toBe("UNAVAILABLE");
  });

  it("reports UNAVAILABLE when every entry is far outside the maintained window", () => {
    const staleEvent = event({ eventTimeUtc: NOW - 200 * 24 * 60 * MIN });
    const result = checkNewsWindow([staleEvent], [], NOW, CONFIG);
    expect(result.status).toBe("UNAVAILABLE");
  });

  it("distinguishes a genuinely quiet week from an unmaintained calendar", () => {
    // The calendar has a recent-ish entry (proving someone maintains it), but
    // nothing relevant to THIS symbol right now.
    const maintained = event({ eventTimeUtc: NOW + 10 * 24 * 60 * MIN });
    const result = checkNewsWindow([maintained], [], NOW, CONFIG);
    expect(result.status).toBe("CLEAR");
  });
});

describe("checkNewsWindow — the buffer window", () => {
  const allEvents = [event()];

  it("blocks when a high-impact event falls inside the before-buffer", () => {
    const soon = event({ eventTimeUtc: NOW + 20 * MIN });
    const result = checkNewsWindow(allEvents, [soon], NOW, CONFIG);
    expect(result.status).toBe("EVENT_NEARBY");
    expect(result.minutesUntil).toBe(20);
  });

  it("blocks when a high-impact event falls inside the after-buffer", () => {
    const justPassed = event({ eventTimeUtc: NOW - 10 * MIN });
    const result = checkNewsWindow(allEvents, [justPassed], NOW, CONFIG);
    expect(result.status).toBe("EVENT_NEARBY");
    expect(result.minutesUntil).toBe(-10);
  });

  it("clears once the event is outside both buffers", () => {
    const farFuture = event({ eventTimeUtc: NOW + 60 * MIN });
    const result = checkNewsWindow(allEvents, [farFuture], NOW, CONFIG);
    expect(result.status).toBe("CLEAR");
  });

  it("does not block on an impact level the config does not treat as blocking", () => {
    const lowImpact = event({ eventTimeUtc: NOW + 5 * MIN, impact: "LOW" });
    const result = checkNewsWindow(allEvents, [lowImpact], NOW, CONFIG);
    expect(result.status).toBe("CLEAR");
  });

  it("reports the nearest blocking event when several are in range", () => {
    const far = event({ id: "far", eventTimeUtc: NOW + 25 * MIN });
    const near = event({ id: "near", eventTimeUtc: NOW + 5 * MIN });
    const result = checkNewsWindow(allEvents, [far, near], NOW, CONFIG);
    expect(result.event?.id).toBe("near");
  });
});

describe("currenciesFor", () => {
  it("splits a six-letter FX pair into base and quote", () => {
    expect(currenciesFor("EURUSD")).toEqual(["EUR", "USD"]);
  });

  it("maps gold to USD, not to a literal 'XAU economy'", () => {
    expect(currenciesFor("XAUUSD")).toEqual(["USD"]);
  });

  it("returns nothing for an unrecognised symbol shape", () => {
    expect(currenciesFor("BTC")).toEqual([]);
  });
});
