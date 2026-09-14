import { describe, expect, it } from "vitest";
import {
  DATA_PROBLEM_STATES,
  NON_SIGNAL_EVENTS,
  READINESS_LEVELS,
  SIGNAL_LABELS,
  STOCHASTIC_EVENTS,
  TIMEFRAME_STATES,
  allowsDirectionalBadge,
  isDataProblem,
  isDirectional,
  isTradeSignalEvent,
  notConfigured,
  notFullyAlignedReason,
  requiresCountertrendWarning,
  signalLabel,
  type BroadContextRelation,
  type Readiness,
  type SignalLabel,
  type StochasticEvent,
  type TimeframeState,
} from "./states";

const RELATIONS: BroadContextRelation[] = ["ALIGNED", "CONFLICTING", "NEUTRAL", "UNAVAILABLE"];

describe("timeframe states", () => {
  it("covers every state the project rules require", () => {
    expect([...TIMEFRAME_STATES].sort()).toEqual(
      [
        "BULLISH",
        "BEARISH",
        "NEUTRAL",
        "INCONCLUSIVE",
        "DATA_MISSING",
        "DATA_STALE",
        "DATA_DELAYED",
        "DATA_INVALID",
        "CANDLE_OPEN",
        "NOT_CONFIGURED",
      ].sort(),
    );
  });

  it("does not include CONFLICTING, which is a relation rather than a state", () => {
    // A weekly chart is BEARISH; it is *conflicting* relative to a proposed
    // BUY. Folding that into the state would lose the direction and make a
    // bearish weekly under a SELL unrepresentable.
    expect(TIMEFRAME_STATES).not.toContain("CONFLICTING");
  });

  it("treats only BULLISH and BEARISH as directional", () => {
    for (const state of TIMEFRAME_STATES) {
      expect(isDirectional(state)).toBe(state === "BULLISH" || state === "BEARISH");
    }
  });

  it("treats all four data faults as data problems", () => {
    expect([...DATA_PROBLEM_STATES].sort()).toEqual(
      ["DATA_MISSING", "DATA_STALE", "DATA_DELAYED", "DATA_INVALID"].sort(),
    );
  });

  it("never treats a data problem as a direction", () => {
    for (const state of DATA_PROBLEM_STATES) {
      expect(isDirectional(state)).toBe(false);
      expect(isDataProblem(state)).toBe(true);
    }
  });

  it("does not treat CANDLE_OPEN as a data problem — it is a timing state", () => {
    expect(isDataProblem("CANDLE_OPEN")).toBe(false);
    expect(isDirectional("CANDLE_OPEN")).toBe(false);
  });

  it("produces NOT_CONFIGURED only through the sanctioned factory", () => {
    expect(notConfigured("excluded-by-strategy")).toBe("NOT_CONFIGURED");
  });
});

describe("stochastic events", () => {
  it("is orthogonal to timeframe state", () => {
    // A timeframe can be CURLING_UP and DATA_STALE at once. Merging the two
    // vocabularies would make that unrepresentable and would quietly turn a
    // data fault into a momentum reading.
    const overlap = (STOCHASTIC_EVENTS as readonly string[]).filter((event) =>
      (TIMEFRAME_STATES as readonly string[]).includes(event),
    );
    // Only the two generic words may appear in both vocabularies.
    expect(overlap.sort()).toEqual(["INCONCLUSIVE", "NEUTRAL"]);
  });

  it("refuses to call an extreme reading a trade signal", () => {
    // Stochastic stays pinned at an extreme throughout a strong trend.
    expect(isTradeSignalEvent("EXTREME_OVERSOLD")).toBe(false);
    expect(isTradeSignalEvent("EXTREME_OVERBOUGHT")).toBe(false);
  });

  it("refuses to call a K/D cross a trade signal on its own", () => {
    expect(isTradeSignalEvent("K_D_CROSS_UP")).toBe(false);
    expect(isTradeSignalEvent("K_D_CROSS_DOWN")).toBe(false);
  });

  it("refuses to call a threshold reclaim a trade signal on its own", () => {
    expect(isTradeSignalEvent("THRESHOLD_RECLAIM_UP")).toBe(false);
    expect(isTradeSignalEvent("THRESHOLD_RECLAIM_DOWN")).toBe(false);
  });

  it("admits only the confirmed events, which require price action and structure", () => {
    const signalling = STOCHASTIC_EVENTS.filter(isTradeSignalEvent);
    expect(signalling).toEqual(["CONFIRMED_BULLISH", "CONFIRMED_BEARISH"]);
  });

  it("lists every non-signal event explicitly", () => {
    for (const event of NON_SIGNAL_EVENTS as readonly StochasticEvent[]) {
      expect(isTradeSignalEvent(event)).toBe(false);
    }
  });
});

describe("signalLabel", () => {
  it("never produces a bare BUY or SELL", () => {
    for (const readiness of READINESS_LEVELS) {
      for (const broadContext of RELATIONS) {
        for (const direction of ["BUY", "SELL"] as const) {
          const label = signalLabel({ direction, readiness, broadContext });
          expect(label).not.toBe("BUY");
          expect(label).not.toBe("SELL");
          expect(SIGNAL_LABELS).toContain(label);
        }
      }
    }
  });

  it("calls a READY setup fully aligned only when MN and W1 agree", () => {
    expect(signalLabel({ direction: "BUY", readiness: "READY", broadContext: "ALIGNED" })).toBe(
      "FULLY ALIGNED BUY READY",
    );
    expect(signalLabel({ direction: "SELL", readiness: "READY", broadContext: "ALIGNED" })).toBe(
      "FULLY ALIGNED SELL READY",
    );
  });

  it("never calls a conflicted setup fully aligned", () => {
    for (const readiness of READINESS_LEVELS) {
      for (const direction of ["BUY", "SELL"] as const) {
        const label = signalLabel({ direction, readiness, broadContext: "CONFLICTING" });
        expect(label).not.toContain("FULLY ALIGNED");
      }
    }
  });

  it("labels a conflicted READY setup as countertrend", () => {
    expect(signalLabel({ direction: "BUY", readiness: "READY", broadContext: "CONFLICTING" })).toBe(
      "BUY READY — COUNTERTREND WARNING",
    );
    expect(
      signalLabel({ direction: "SELL", readiness: "READY", broadContext: "CONFLICTING" }),
    ).toBe("SELL READY — COUNTERTREND WARNING");
  });

  it("uses plain READY for the third case: MN/W1 neutral or unavailable", () => {
    // This is the case the label list would otherwise have no word for. It is
    // neither aligned nor conflicted, and pretending it is either would be a
    // lie in one direction or the other.
    for (const relation of ["NEUTRAL", "UNAVAILABLE"] as const) {
      expect(signalLabel({ direction: "BUY", readiness: "READY", broadContext: relation })).toBe(
        "BUY READY",
      );
    }
  });

  it("explains why a plain READY is not fully aligned", () => {
    expect(notFullyAlignedReason("NEUTRAL")).toMatch(/no clear direction/i);
    expect(notFullyAlignedReason("UNAVAILABLE")).toMatch(/unavailable/i);
    expect(notFullyAlignedReason("CONFLICTING")).toMatch(/countertrend/i);
    expect(notFullyAlignedReason("ALIGNED")).toBeNull();
  });

  it("labels a SETUP as waiting for M5/M1 regardless of broad context", () => {
    for (const broadContext of RELATIONS) {
      expect(signalLabel({ direction: "BUY", readiness: "SETUP", broadContext })).toBe(
        "BUY SETUP — WAITING FOR M5/M1 CONFIRMATION",
      );
    }
  });

  it("labels a WATCH as potential, not as a setup", () => {
    expect(signalLabel({ direction: "BUY", readiness: "WATCH", broadContext: "ALIGNED" })).toBe(
      "WATCH — POTENTIAL BUY",
    );
    expect(signalLabel({ direction: "SELL", readiness: "WATCH", broadContext: "ALIGNED" })).toBe(
      "WATCH — POTENTIAL SELL",
    );
  });

  it("falls back to WAIT when there is no direction or no readiness", () => {
    expect(signalLabel({ direction: null, readiness: "READY", broadContext: "ALIGNED" })).toBe(
      "WAIT — NO VALID SETUP",
    );
    expect(signalLabel({ direction: "BUY", readiness: "NONE", broadContext: "ALIGNED" })).toBe(
      "WAIT — NO VALID SETUP",
    );
  });

  it("lets a terminal state override everything, including a READY ladder", () => {
    const cases = [
      ["INSUFFICIENT_DATA", "INSUFFICIENT DATA"],
      ["DATA_QUALITY_ERROR", "DATA QUALITY ERROR"],
      ["INVALID", "INVALID"],
      ["EXPIRED", "EXPIRED"],
    ] as const;
    for (const [terminal, expected] of cases) {
      expect(
        signalLabel({
          direction: "BUY",
          readiness: "READY",
          broadContext: "ALIGNED",
          terminal,
        }),
      ).toBe(expected);
    }
  });
});

describe("badge rendering", () => {
  it("allows a directional badge only for READY labels", () => {
    for (const label of SIGNAL_LABELS) {
      expect(allowsDirectionalBadge(label)).toBe(label.includes("READY"));
    }
  });

  it("never allows a green badge for a developing or broken state", () => {
    const mustBeNeutral: SignalLabel[] = [
      "WATCH — POTENTIAL BUY",
      "WATCH — POTENTIAL SELL",
      "BUY SETUP — WAITING FOR M5/M1 CONFIRMATION",
      "SELL SETUP — WAITING FOR M5/M1 CONFIRMATION",
      "WAIT — NO VALID SETUP",
      "INSUFFICIENT DATA",
      "DATA QUALITY ERROR",
      "INVALID",
      "EXPIRED",
    ];
    for (const label of mustBeNeutral) {
      expect(allowsDirectionalBadge(label)).toBe(false);
    }
  });

  it("requires a countertrend warning on exactly the countertrend labels", () => {
    for (const label of SIGNAL_LABELS) {
      expect(requiresCountertrendWarning(label)).toBe(label.includes("COUNTERTREND"));
    }
  });
});

describe("the regression lock", () => {
  it("never produces a plain BUY when the higher timeframes disagree", () => {
    // Short-term bullish, MN/W1 bearish. Whatever the readiness, the label must
    // say so. This is the defect the application exists to fix.
    for (const readiness of READINESS_LEVELS) {
      const label = signalLabel({
        direction: "BUY",
        readiness: readiness as Readiness,
        broadContext: "CONFLICTING",
      });
      expect(label).not.toBe("BUY");
      expect(label).not.toContain("FULLY ALIGNED");
      if (readiness === "READY") {
        expect(requiresCountertrendWarning(label)).toBe(true);
      }
    }
  });

  it("never hides a conflict behind a missing-data label", () => {
    // A conflicting weekly and an unavailable weekly must not look the same.
    const conflicting = signalLabel({
      direction: "BUY",
      readiness: "READY",
      broadContext: "CONFLICTING",
    });
    const unavailable = signalLabel({
      direction: "BUY",
      readiness: "READY",
      broadContext: "UNAVAILABLE",
    });
    expect(conflicting).not.toBe(unavailable);
  });

  it("keeps every state in the label vocabulary reachable", () => {
    const produced = new Set<SignalLabel>();
    for (const readiness of READINESS_LEVELS) {
      for (const broadContext of RELATIONS) {
        for (const direction of ["BUY", "SELL", null] as const) {
          produced.add(signalLabel({ direction, readiness, broadContext }));
        }
      }
    }
    for (const terminal of [
      "INSUFFICIENT_DATA",
      "DATA_QUALITY_ERROR",
      "INVALID",
      "EXPIRED",
    ] as const) {
      produced.add(
        signalLabel({ direction: "BUY", readiness: "READY", broadContext: "ALIGNED", terminal }),
      );
    }
    // Every declared label must be producible; an unreachable label is a label
    // the UI would render from somewhere other than this function.
    expect([...produced].sort()).toEqual([...SIGNAL_LABELS].sort());
  });
});
