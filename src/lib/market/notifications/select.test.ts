import { describe, expect, it } from "vitest";
import {
  eligibleForLabelUpdate,
  isQuietHour,
  selectNotifications,
  type NotifiableRow,
} from "./select";

const NO_QUIET_HOURS = {
  mutedSymbols: new Set<string>(),
  quietHoursStart: null,
  quietHoursEnd: null,
};

function row(overrides: Partial<NotifiableRow> = {}): NotifiableRow {
  return { symbol: "XAUUSD", label: "WATCH — POTENTIAL BUY", readiness: "WATCH", ...overrides };
}

describe("isQuietHour", () => {
  it("is never quiet when no window is configured", () => {
    expect(isQuietHour(3, null, null)).toBe(false);
  });

  it("handles a same-day window", () => {
    expect(isQuietHour(10, 9, 17)).toBe(true);
    expect(isQuietHour(8, 9, 17)).toBe(false);
    expect(isQuietHour(17, 9, 17)).toBe(false);
  });

  it("handles a window that wraps past midnight", () => {
    expect(isQuietHour(23, 22, 7)).toBe(true);
    expect(isQuietHour(3, 22, 7)).toBe(true);
    expect(isQuietHour(12, 22, 7)).toBe(false);
  });

  it("treats an identical start and end as never quiet, not always quiet", () => {
    expect(isQuietHour(5, 9, 9)).toBe(false);
  });
});

describe("selectNotifications — first observation", () => {
  it("never notifies on the first poll of a symbol, even if it is already READY", () => {
    const previous = new Map<string, NotifiableRow["label"]>();
    const current = [row({ label: "FULLY ALIGNED BUY READY", readiness: "READY" })];
    expect(selectNotifications(previous, current, NO_QUIET_HOURS, 12)).toEqual([]);
  });
});

describe("selectNotifications — SIGNAL_READY", () => {
  it("fires when a symbol transitions into READY", () => {
    const previous = new Map([["XAUUSD", "WATCH — POTENTIAL BUY" as const]]);
    const current = [row({ label: "FULLY ALIGNED BUY READY", readiness: "READY" })];
    const events = selectNotifications(previous, current, NO_QUIET_HOURS, 12);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("SIGNAL_READY");
  });

  it("does not re-fire when already READY and only the countertrend wording changes", () => {
    // Both labels contain READY; this is not a fresh READY transition.
    const previous = new Map([["XAUUSD", "BUY READY" as const]]);
    const current = [row({ label: "FULLY ALIGNED BUY READY", readiness: "READY" })];
    expect(selectNotifications(previous, current, NO_QUIET_HOURS, 12)).toEqual([]);
  });

  it("does not fire for a transition into WATCH or SETUP", () => {
    const previous = new Map([["XAUUSD", "WAIT — NO VALID SETUP" as const]]);
    const current = [
      row({ label: "BUY SETUP — WAITING FOR M5/M1 CONFIRMATION", readiness: "SETUP" }),
    ];
    expect(selectNotifications(previous, current, NO_QUIET_HOURS, 12)).toEqual([]);
  });

  it("never fires for a signal that reached INSUFFICIENT DATA, by construction", () => {
    // Cannot reach READY and INSUFFICIENT DATA at once, but confirms the
    // filter keys strictly off readiness === READY, not off label content.
    const previous = new Map([["XAUUSD", "WATCH — POTENTIAL BUY" as const]]);
    const current = [row({ label: "INSUFFICIENT DATA", readiness: "NONE" })];
    const events = selectNotifications(previous, current, NO_QUIET_HOURS, 12);
    expect(events.find((e) => e.kind === "SIGNAL_READY")).toBeUndefined();
  });
});

describe("selectNotifications — DATA_PROBLEM", () => {
  it("fires when a working symbol newly becomes INSUFFICIENT DATA", () => {
    const previous = new Map([["XAUUSD", "WATCH — POTENTIAL BUY" as const]]);
    const current = [row({ label: "INSUFFICIENT DATA", readiness: "NONE" })];
    const events = selectNotifications(previous, current, NO_QUIET_HOURS, 12);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("DATA_PROBLEM");
  });

  it("does not fire again while the data problem persists across polls", () => {
    const previous = new Map([["XAUUSD", "INSUFFICIENT DATA" as const]]);
    const current = [row({ label: "DATA QUALITY ERROR", readiness: "NONE" })];
    // Both labels are data-problem labels, so nothing "newly" became a problem.
    expect(selectNotifications(previous, current, NO_QUIET_HOURS, 12)).toEqual([]);
  });
});

describe("selectNotifications — muting and quiet hours", () => {
  it("respects a per-symbol mute", () => {
    const previous = new Map([["XAUUSD", "WATCH — POTENTIAL BUY" as const]]);
    const current = [row({ label: "FULLY ALIGNED BUY READY", readiness: "READY" })];
    const muted = { ...NO_QUIET_HOURS, mutedSymbols: new Set(["XAUUSD"]) };
    expect(selectNotifications(previous, current, muted, 12)).toEqual([]);
  });

  it("suppresses everything during quiet hours", () => {
    const previous = new Map([["XAUUSD", "WATCH — POTENTIAL BUY" as const]]);
    const current = [row({ label: "FULLY ALIGNED BUY READY", readiness: "READY" })];
    const quiet = { mutedSymbols: new Set<string>(), quietHoursStart: 22, quietHoursEnd: 7 };
    expect(selectNotifications(previous, current, quiet, 23)).toEqual([]);
  });

  it("still fires just outside the quiet-hours window", () => {
    const previous = new Map([["XAUUSD", "WATCH — POTENTIAL BUY" as const]]);
    const current = [row({ label: "FULLY ALIGNED BUY READY", readiness: "READY" })];
    const quiet = { mutedSymbols: new Set<string>(), quietHoursStart: 22, quietHoursEnd: 7 };
    expect(selectNotifications(previous, current, quiet, 8)).toHaveLength(1);
  });
});

describe("eligibleForLabelUpdate — the fix for the quiet-hours/mute permanent-loss bug", () => {
  it("returns no symbols during quiet hours, so a suppressed transition is not forgotten", () => {
    const quiet = { mutedSymbols: new Set<string>(), quietHoursStart: 22, quietHoursEnd: 7 };
    const current = [row({ symbol: "XAUUSD" })];
    expect(eligibleForLabelUpdate(current, quiet, 23)).toEqual([]);
  });

  it("excludes an individually muted symbol but not the rest", () => {
    const muted = { ...NO_QUIET_HOURS, mutedSymbols: new Set(["XAUUSD"]) };
    const current = [row({ symbol: "XAUUSD" }), row({ symbol: "EURUSD" })];
    expect(eligibleForLabelUpdate(current, muted, 12)).toEqual(["EURUSD"]);
  });

  it("returns every symbol outside quiet hours with no mutes", () => {
    const current = [row({ symbol: "XAUUSD" }), row({ symbol: "EURUSD" })];
    expect(eligibleForLabelUpdate(current, NO_QUIET_HOURS, 12)).toEqual(["XAUUSD", "EURUSD"]);
  });

  it("demonstrates the fix end-to-end: a READY transition during quiet hours is still notified once eligible again", () => {
    // Poll 1 (12:00, not quiet): baseline WATCH.
    const previous = new Map<string, NotifiableRow["label"]>([["XAUUSD", "WATCH — POTENTIAL BUY"]]);
    const quiet = { mutedSymbols: new Set<string>(), quietHoursStart: 22, quietHoursEnd: 7 };

    // Poll 2 (23:00, quiet hours): symbol reaches READY. No event fires...
    const readyRow = [row({ label: "FULLY ALIGNED BUY READY", readiness: "READY" })];
    expect(selectNotifications(previous, readyRow, quiet, 23)).toEqual([]);
    // ...and the caller must not advance `previous` for a suppressed symbol.
    const eligibleAt23 = new Set(eligibleForLabelUpdate(readyRow, quiet, 23));
    expect(eligibleAt23.has("XAUUSD")).toBe(false);
    // previous stays WATCH, exactly as if the buggy unconditional update had not run.

    // Poll 3 (08:00, quiet hours over): the signal is still READY. Because
    // `previous` was never advanced during the suppressed poll, this still
    // reads as a genuine transition into READY and fires.
    const events = selectNotifications(previous, readyRow, quiet, 8);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("SIGNAL_READY");
  });
});

describe("selectNotifications — multiple symbols", () => {
  it("evaluates each symbol independently", () => {
    const previous = new Map([
      ["XAUUSD", "WATCH — POTENTIAL BUY" as const],
      ["EURUSD", "WAIT — NO VALID SETUP" as const],
    ]);
    const current = [
      row({ symbol: "XAUUSD", label: "FULLY ALIGNED BUY READY", readiness: "READY" }),
      row({ symbol: "EURUSD", label: "WAIT — NO VALID SETUP", readiness: "NONE" }),
    ];
    const events = selectNotifications(previous, current, NO_QUIET_HOURS, 12);
    expect(events).toHaveLength(1);
    expect(events[0]!.symbol).toBe("XAUUSD");
  });
});
