import { atr, stochastic, type StochPoint } from "./indicators";
import { specFor, toPips } from "./instruments";
import {
  equalLevels,
  fairValueGaps,
  keyLevels,
  liquiditySweep,
  orderBlocks,
  sessionOf,
  structureShift,
  displacementCandles,
} from "./structure";
import {
  ALL_TIMEFRAMES,
  CONFIRMATION_TIMEFRAMES,
  TF_MINUTES,
  roleOf,
  type BiasDirection,
  type Candle,
  type ContextStatus,
  type Direction,
  type HigherContext,
  type Quote,
  type RiskSettings,
  type Signal,
  type SignalState,
  type StochBehaviour,
  type StochZone,
  type Timeframe,
  type TimeframeEvidence,
} from "./types";

export const DISCLAIMER =
  "Educational analysis only. Trading leveraged forex/CFDs can cause rapid losses. No signal is guaranteed.";

export interface EvaluateInput {
  symbol: string;
  quote: Quote;
  /** candles per timeframe; all nine are read when present */
  series: Partial<Record<Timeframe, Candle[]>>;
  confirmationTimeframes: Timeframe[];
  executionTimeframe: Timeframe;
  risk: RiskSettings;
  newsRisk?: string | null;
  now?: number;
}

const LEVELS = { deepLow: 20, low: 30, high: 70, deepHigh: 80 } as const;

interface Reading {
  evidence: TimeframeEvidence;
  points: StochPoint[];
}

function zoneOf(k: number): StochZone {
  if (k <= LEVELS.low) return "OVERSOLD";
  if (k >= LEVELS.high) return "OVERBOUGHT";
  return "NEUTRAL";
}

/** Detects a cross back through 20 / 30 / 70 / 80 on the last two readings. */
function crossOf(k: number, kPrev: number): { level: 20 | 30 | 70 | 80 | null; up: boolean } {
  for (const level of [LEVELS.deepLow, LEVELS.low] as const) {
    if (kPrev <= level && k > level) return { level, up: true };
  }
  for (const level of [LEVELS.deepHigh, LEVELS.high] as const) {
    if (kPrev >= level && k < level) return { level, up: false };
  }
  return { level: null, up: false };
}

function readTimeframe(
  timeframe: Timeframe,
  candles: Candle[] | undefined,
  now: number,
  used: boolean,
): Reading {
  const role = roleOf(timeframe);
  const base: TimeframeEvidence = {
    timeframe,
    role,
    stochasticK: null,
    stochasticD: null,
    zone: "NEUTRAL",
    state: "NO_CONFIRMATION",
    crossLevel: null,
    direction: "NEUTRAL",
    used: false,
    dataStatus: "UNAVAILABLE",
    aligned: false,
    explanation: "No candles available for Stochastic 25,2,4 on this timeframe.",
  };

  if (!candles || candles.length < 30) return { evidence: base, points: [] };

  const points = stochastic(candles, 25, 2, 4);
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const prev2 = points[points.length - 3];
  if (!last || last.k === null) return { evidence: base, points };

  const k = last.k;
  const d = last.d;
  const kPrev = prev?.k ?? k;
  const kPrev2 = prev2?.k ?? kPrev;

  const lastCandle = candles[candles.length - 1]!;
  const ageMinutes = (now - lastCandle.t) / 60_000;
  const dataStatus = ageMinutes > TF_MINUTES[timeframe] * 4 ? "STALE" : "VALID";

  const zone = zoneOf(k);
  const { level: crossLevel, up: crossUp } = crossOf(k, kPrev);
  const curvingUp = k > kPrev && kPrev <= kPrev2;
  const curvingDown = k < kPrev && kPrev >= kPrev2;
  const extreme = k <= LEVELS.deepLow || k >= LEVELS.deepHigh;
  const closedBullish = lastCandle.c > lastCandle.o;

  let direction: BiasDirection = "NEUTRAL";
  if (crossLevel !== null) direction = crossUp ? "BULLISH" : "BEARISH";
  else if (zone === "OVERSOLD") direction = "BULLISH";
  else if (zone === "OVERBOUGHT") direction = "BEARISH";
  else if (curvingUp && k < 50) direction = "BULLISH";
  else if (curvingDown && k > 50) direction = "BEARISH";

  const structureAgrees =
    (direction === "BULLISH" && closedBullish) || (direction === "BEARISH" && !closedBullish);

  let state: StochBehaviour = "NO_CONFIRMATION";
  if (crossLevel !== null && structureAgrees) state = "CONFIRMED";
  else if (crossLevel !== null) state = "CROSSED";
  else if ((curvingUp || curvingDown) && direction !== "NEUTRAL") state = "CURVING";
  else if (extreme) state = "EXTREME";

  return {
    points,
    evidence: {
      timeframe,
      role,
      stochasticK: Number(k.toFixed(2)),
      stochasticD: d === null ? null : Number(d.toFixed(2)),
      zone,
      state,
      crossLevel,
      direction,
      used,
      dataStatus,
      aligned: false,
      explanation: explain(timeframe, k, zone, state, crossLevel, direction, dataStatus),
    },
  };
}

function explain(
  tf: Timeframe,
  k: number,
  zone: StochZone,
  state: StochBehaviour,
  crossLevel: number | null,
  direction: BiasDirection,
  dataStatus: "VALID" | "STALE" | "UNAVAILABLE",
): string {
  const role = roleOf(tf);
  const roleText =
    role === "CONTEXT"
      ? "context only"
      : role === "ENTRY"
        ? tf === "M1"
          ? "entry trigger"
          : "entry confirmation"
        : "directional confirmation";
  const stateText =
    state === "CONFIRMED"
      ? `crossed back through ${crossLevel} and the last candle closed the same way`
      : state === "CROSSED"
        ? `crossed back through ${crossLevel}, price has not confirmed yet`
        : state === "CURVING"
          ? `curving ${direction === "BULLISH" ? "up" : "down"} but no level cross yet`
          : state === "EXTREME"
            ? "at an extreme reading, which can persist in a trend"
            : "no usable Stochastic signal";
  const staleText = dataStatus === "STALE" ? " Candles look stale." : "";
  return `${tf} (${roleText}): K ${k.toFixed(1)}, ${zone.toLowerCase()}, ${stateText}.${staleText}`;
}

function contextStatus(ev: TimeframeEvidence | undefined, signal: BiasDirection): ContextStatus {
  if (!ev || ev.dataStatus === "UNAVAILABLE") return "NOT_AVAILABLE";
  if (ev.dataStatus === "STALE") return "STALE";
  if (signal !== "NEUTRAL" && ev.direction !== "NEUTRAL" && ev.direction !== signal)
    return "CONFLICTING";
  return "USED";
}

export function evaluateSignal(input: EvaluateInput): Signal {
  const now = input.now ?? Date.now();
  const spec = specFor(input.symbol);
  const price = input.quote.mid;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const calculationErrors: string[] = [];
  const whyItMayFail: string[] = [
    "Stochastic can stay overbought in an uptrend and oversold in a downtrend — a stretched reading is not a reversal.",
    "Levels can be swept a second time; the invalidation point can be traded through.",
  ];

  // --- read every timeframe ---------------------------------------------
  const confirmationSet = new Set<Timeframe>(
    input.confirmationTimeframes.length ? input.confirmationTimeframes : CONFIRMATION_TIMEFRAMES,
  );
  const readings = new Map<Timeframe, Reading>();
  for (const tf of ALL_TIMEFRAMES) {
    const role = roleOf(tf);
    const used = role === "CONFIRMATION" ? confirmationSet.has(tf) : true;
    readings.set(tf, readTimeframe(tf, input.series[tf], now, used));
  }
  const evidence = ALL_TIMEFRAMES.map((tf) => readings.get(tf)!.evidence);
  const evOf = (tf: Timeframe) => readings.get(tf)!.evidence;

  const confirmations = evidence.filter(
    (ev) => ev.role === "CONFIRMATION" && ev.used && ev.dataStatus !== "UNAVAILABLE",
  );
  const bullVotes = confirmations.filter((ev) => ev.direction === "BULLISH").length;
  const bearVotes = confirmations.filter((ev) => ev.direction === "BEARISH").length;
  const available = confirmations.length;

  // --- gates -------------------------------------------------------------
  const ageMinutes = (now - input.quote.timestamp) / 60000;
  const stale = ageMinutes > input.risk.maxDataAgeMinutes || input.quote.kind === "stale";
  if (stale) warnings.push(`Price is ${ageMinutes.toFixed(0)} min old — treated as stale.`);
  if (input.quote.kind === "demo")
    warnings.push("Sample candles: shapes are synthetic and must not be traded.");

  const spreadPips = input.quote.spread !== null ? toPips(input.quote.spread, input.symbol) : null;
  const spreadTooWide = spreadPips !== null && spreadPips > input.risk.maxSpreadPips;
  if (spreadTooWide)
    warnings.push(
      `Spread ${spreadPips!.toFixed(1)} pips is above your ${input.risk.maxSpreadPips} pip limit.`,
    );
  if (!spec.supported)
    warnings.push(`${spec.symbol} has no verified specification — contract size unknown.`);

  const conflicting = bullVotes > 0 && bearVotes > 0;
  if (conflicting)
    warnings.push("Confirmation timeframes disagree: some are stretched each way.");

  // --- direction candidate ----------------------------------------------
  const needed = Math.max(2, Math.ceil(available / 2));
  let direction: Direction = "WAIT";
  if (bullVotes >= needed && bullVotes > bearVotes) direction = "BUY";
  else if (bearVotes >= needed && bearVotes > bullVotes) direction = "SELL";

  const bias: BiasDirection =
    direction === "BUY" ? "BULLISH" : direction === "SELL" ? "BEARISH" : "NEUTRAL";
  for (const ev of evidence) ev.aligned = bias !== "NEUTRAL" && ev.direction === bias;

  // --- MN / W1 context (never blocks) -----------------------------------
  const mnEv = evOf("MN");
  const w1Ev = evOf("W1");
  const monthly = contextStatus(mnEv, bias);
  const weekly = contextStatus(w1Ev, bias);
  const contextConflict = monthly === "CONFLICTING" || weekly === "CONFLICTING";
  const higherContext: HigherContext = {
    monthly,
    weekly,
    monthlyDirection: mnEv.direction,
    weeklyDirection: w1Ev.direction,
    used: monthly === "USED" || weekly === "USED" || contextConflict,
    conflict: contextConflict,
    allowedDespiteConflict:
      contextConflict && direction !== "WAIT"
        ? "Monthly/weekly are context only in this strategy, so they lower the setup quality and raise a warning instead of cancelling the reading. The trade idea still comes from the D1–M15 stack with M5/M1 timing."
        : null,
  };
  if (contextConflict)
    warnings.push(
      `Higher context disagrees (MN ${monthly}, W1 ${weekly}) — counter-trend against the bigger picture.`,
    );
  if (monthly === "NOT_AVAILABLE" || weekly === "NOT_AVAILABLE")
    warnings.push("Monthly and/or weekly context is unavailable — broad picture unverified.");

  // --- execution / entry timing ------------------------------------------
  const execTf = input.executionTimeframe;
  const exec = input.series[execTf] ?? input.series["M15"] ?? [];
  const m5 = evOf("M5");
  const m1 = evOf("M1");
  const m15 = evOf("M15");

  const levels = keyLevels(exec);
  const atrSeries = atr(exec, 14);
  const atrValue = atrSeries[atrSeries.length - 1] ?? spec.pipSize * 20;
  const tolerance = atrValue * 0.35;
  const sweep = exec.length
    ? liquiditySweep(exec)
    : { detected: false, side: null, level: null, index: null };
  const shift = exec.length
    ? structureShift(exec)
    : { detected: false, direction: null, level: null };
  const gaps = exec.length ? fairValueGaps(exec) : [];
  const blocks = exec.length ? orderBlocks(exec) : [];
  const equal = exec.length ? equalLevels(exec, tolerance) : [];
  const displacement = exec.length ? displacementCandles(exec) : [];
  const lastDisplacement = displacement.length
    ? displacement[displacement.length - 1] === exec.length - 1 ||
      displacement[displacement.length - 1] === exec.length - 2
    : false;
  const lastCandle = exec[exec.length - 1];
  const closeBullish = lastCandle ? lastCandle.c > lastCandle.o : false;

  let score = 0;
  let setupType = "No qualified setup";
  let entryZone: [number, number] | null = null;
  let entryPrice: number | null = null;
  let invalidation: number | null = null;
  let stopLoss: number | null = null;
  let tps: (number | null)[] = [null, null, null];
  let trigger = "Waiting for the D1–M15 stack to line up.";
  let invalidationCondition = "No setup, so nothing to invalidate yet.";
  let m5Confirms = false;
  let m1Triggers = false;

  if (direction !== "WAIT" && lastCandle) {
    const isBuy = direction === "BUY";
    score = 20 + Math.round(((isBuy ? bullVotes : bearVotes) / Math.max(available, 1)) * 30);
    reasons.push(
      `${isBuy ? bullVotes : bearVotes} of ${available} confirmation timeframes read ${
        isBuy ? "oversold / recovering" : "overbought / rolling over"
      } on Stochastic 25,2,4.`,
    );

    const crossed = confirmations.filter(
      (ev) => ev.direction === bias && (ev.state === "CROSSED" || ev.state === "CONFIRMED"),
    );
    if (crossed.length) {
      score += Math.min(12, crossed.length * 4);
      reasons.push(
        `Stochastic crossed back through ${crossed
          .map((ev) => `${ev.timeframe} @ ${ev.crossLevel}`)
          .join(", ")}.`,
      );
    }

    const zoneCandidates = isBuy
      ? [
          levels.prevDayLow,
          levels.prevWeekLow,
          ...levels.support,
          ...equal.filter((e) => e.type === "LOW").map((e) => e.price),
        ]
      : [
          levels.prevDayHigh,
          levels.prevWeekHigh,
          ...levels.resistance,
          ...equal.filter((e) => e.type === "HIGH").map((e) => e.price),
        ];
    const nearLevel = zoneCandidates
      .filter((v): v is number => typeof v === "number")
      .find((v) => Math.abs(v - price) <= atrValue * 1.5);
    if (nearLevel !== undefined) {
      score += 12;
      reasons.push(
        `Price is within ~${(Math.abs(nearLevel - price) / spec.pipSize).toFixed(0)} pips of a ${
          isBuy ? "support / prior low" : "resistance / prior high"
        } at ${nearLevel.toFixed(spec.digits)}.`,
      );
    } else {
      warnings.push("Price is not near a mapped level — the setup lacks a location edge.");
    }

    const alignedGap = gaps.find((g) =>
      isBuy ? g.direction === "BULLISH" : g.direction === "BEARISH",
    );
    if (alignedGap) {
      score += 8;
      entryZone = [
        Math.min(alignedGap.from, alignedGap.to),
        Math.max(alignedGap.from, alignedGap.to),
      ];
      reasons.push(
        `${isBuy ? "Bullish" : "Bearish"} fair value gap between ${alignedGap.from.toFixed(spec.digits)} and ${alignedGap.to.toFixed(spec.digits)} available as a limit zone.`,
      );
    }
    const alignedBlock = blocks.find((b) =>
      isBuy ? b.direction === "BULLISH" : b.direction === "BEARISH",
    );
    if (alignedBlock) {
      score += 6;
      entryZone = entryZone ?? [
        Math.min(alignedBlock.from, alignedBlock.to),
        Math.max(alignedBlock.from, alignedBlock.to),
      ];
      reasons.push(
        "Order-block approximation aligned with the direction (discretionary, not institutional fact).",
      );
    }

    const sweepAligned =
      sweep.detected && (isBuy ? sweep.side === "SELL_SIDE" : sweep.side === "BUY_SIDE");
    if (sweepAligned) {
      score += 12;
      reasons.push(
        `${isBuy ? "Sell-side" : "Buy-side"} liquidity sweep of ${sweep.level!.toFixed(spec.digits)} then close back inside.`,
      );
    }
    const shiftAligned =
      shift.detected && (isBuy ? shift.direction === "BULLISH" : shift.direction === "BEARISH");
    if (shiftAligned) {
      score += 10;
      reasons.push(`${isBuy ? "Bullish" : "Bearish"} market-structure shift confirmed on ${execTf}.`);
    }
    if (lastDisplacement) {
      score += 5;
      reasons.push("Displacement candle present (body ≥ 1.5× ATR).");
    }

    // M15 structure, then M5 confirmation, then M1 trigger — timing only.
    const m15Confirms =
      m15.dataStatus !== "UNAVAILABLE" ? m15.direction === bias : closeBullish === isBuy;
    if (m15Confirms) {
      score += 6;
      reasons.push("M15 structure agrees with the direction.");
    } else {
      warnings.push("M15 has not confirmed the direction yet.");
    }

    m5Confirms = m5.dataStatus !== "UNAVAILABLE" && m5.direction === bias;
    if (m5Confirms) {
      score += 7;
      reasons.push(`M5 confirms the ${isBuy ? "bullish" : "bearish"} setup.`);
    } else if (m5.dataStatus === "UNAVAILABLE") {
      warnings.push("M5 candles unavailable — entry confirmation missing.");
    } else {
      warnings.push("M5 has not confirmed yet — no entry confirmation.");
    }

    m1Triggers =
      m1.dataStatus !== "UNAVAILABLE" &&
      m1.direction === bias &&
      (m1.state === "CROSSED" || m1.state === "CONFIRMED" || m1.state === "CURVING");
    if (m1Triggers) {
      score += 5;
      reasons.push("M1 gives the final entry trigger.");
    } else if (m1.dataStatus === "UNAVAILABLE") {
      warnings.push("M1 candles unavailable — precise trigger missing.");
    } else {
      warnings.push("M1 has not triggered yet — wait for the trigger candle.");
    }
    if ((m5Confirms || m1Triggers) && bullVotes + bearVotes === 0) {
      warnings.push("M1/M5 alone never create a signal against the higher-timeframe stack.");
    }

    setupType = sweepAligned
      ? `${isBuy ? "Sell-side" : "Buy-side"} sweep + Stochastic stretch`
      : alignedGap
        ? `${isBuy ? "Bullish" : "Bearish"} FVG retest + Stochastic stretch`
        : `Multi-timeframe Stochastic stretch at ${isBuy ? "support" : "resistance"}`;

    // --- levels ---------------------------------------------------------
    entryZone = entryZone ?? [
      isBuy ? price - atrValue * 0.3 : price,
      isBuy ? price : price + atrValue * 0.3,
    ];
    // the entry every number below is calculated from
    const inZone = price >= entryZone[0] && price <= entryZone[1];
    entryPrice = Number((inZone ? price : (entryZone[0] + entryZone[1]) / 2).toFixed(spec.digits));

    const structuralLow = Math.min(...exec.slice(-12).map((c) => c.l));
    const structuralHigh = Math.max(...exec.slice(-12).map((c) => c.h));
    invalidation = isBuy ? (sweep.level ?? structuralLow) : (sweep.level ?? structuralHigh);
    const buffer = atrValue * 0.25;
    const rawStop = isBuy
      ? Math.min(structuralLow, invalidation) - buffer
      : Math.max(structuralHigh, invalidation) + buffer;
    // guarantee the stop sits on the correct side of the displayed entry
    const minRisk = Math.max(atrValue * 0.5, spec.pipSize * 5);
    stopLoss = Number(
      (isBuy
        ? Math.min(rawStop, entryPrice - minRisk)
        : Math.max(rawStop, entryPrice + minRisk)
      ).toFixed(spec.digits),
    );

    const riskDistance = Math.abs(entryPrice - stopLoss);
    const candidateTargets = (
      isBuy
        ? [levels.resistance[0], levels.prevDayHigh, levels.prevWeekHigh]
        : [levels.support[0], levels.prevDayLow, levels.prevWeekLow]
    )
      .filter((t): t is number => typeof t === "number")
      .filter((t) => (isBuy ? t > entryPrice! : t < entryPrice!))
      .sort((a, b) => (isBuy ? a - b : b - a));

    const multiples = [1.5, 2.5, 4];
    const chosen: number[] = [];
    for (let i = 0; i < 3; i++) {
      const floorDist = riskDistance * multiples[i]!;
      const minDist = chosen.length
        ? Math.abs(chosen[chosen.length - 1]! - entryPrice) + riskDistance * 0.5
        : riskDistance;
      const fromLevel = candidateTargets.find(
        (t) => Math.abs(t - entryPrice!) >= Math.max(minDist, riskDistance),
      );
      const dist = Math.max(
        floorDist,
        minDist,
        fromLevel !== undefined ? Math.abs(fromLevel - entryPrice) : 0,
      );
      const target = Number((isBuy ? entryPrice + dist : entryPrice - dist).toFixed(spec.digits));
      chosen.push(target);
      if (fromLevel !== undefined) candidateTargets.splice(candidateTargets.indexOf(fromLevel), 1);
    }
    tps = chosen;

    trigger = `${isBuy ? "Bullish" : "Bearish"} M5 confirmation then an M1 trigger while price is inside ${entryZone[0].toFixed(spec.digits)}–${entryZone[1].toFixed(spec.digits)}.`;
    invalidationCondition = isBuy
      ? `A close below ${invalidation.toFixed(spec.digits)} kills the idea.`
      : `A close above ${invalidation.toFixed(spec.digits)} kills the idea.`;

    // risk sizing gate
    const riskAmount = (input.risk.accountCapital * input.risk.riskPercent) / 100;
    if (spec.pipValuePerLot && riskDistance > 0) {
      const stopPips = riskDistance / spec.pipSize;
      const lots = riskAmount / (stopPips * spec.pipValuePerLot);
      if (lots < input.risk.minLot) {
        warnings.push(
          `Stop of ${stopPips.toFixed(0)} pips is too wide for ${input.risk.riskPercent}% of your capital at the minimum lot size.`,
        );
        score -= 20;
      }
    }

    if (conflicting) score -= 15;
    if (contextConflict) score -= 12;
    if (stale) score -= 25;
    if (spreadTooWide) score -= 20;
    if (input.newsRisk) {
      score -= 10;
      whyItMayFail.push(`Event risk noted: ${input.newsRisk}.`);
    }
  }

  score = Math.max(0, Math.min(100, score));

  // --- R:R recalculated from the exact displayed values -------------------
  const riskPerUnit =
    entryPrice !== null && stopLoss !== null
      ? direction === "BUY"
        ? entryPrice - stopLoss
        : stopLoss - entryPrice
      : null;
  const rr = (tp: number | null) => {
    if (tp === null || entryPrice === null || riskPerUnit === null || riskPerUnit <= 0) return null;
    const reward = direction === "BUY" ? tp - entryPrice : entryPrice - tp;
    if (reward <= 0) return null;
    return Number((reward / riskPerUnit).toFixed(2));
  };
  const ratios = { tp1: rr(tps[0] ?? null), tp2: rr(tps[1] ?? null), tp3: rr(tps[2] ?? null) };

  // --- validation --------------------------------------------------------
  if (direction !== "WAIT") {
    const t1 = tps[0] ?? null;
    const t2 = tps[1] ?? null;
    const t3 = tps[2] ?? null;
    if (entryPrice === null || stopLoss === null || t1 === null || t2 === null || t3 === null) {
      calculationErrors.push("Entry, stop or targets are missing — the reading cannot be shown.");
    } else if (riskPerUnit === null || riskPerUnit <= 0) {
      calculationErrors.push(
        direction === "BUY"
          ? `Stop-loss ${stopLoss} is not below the entry ${entryPrice}.`
          : `Stop-loss ${stopLoss} is not above the entry ${entryPrice}.`,
      );
    } else {
      const ordered =
        direction === "BUY"
          ? entryPrice < t1 && t1 < t2 && t2 < t3
          : entryPrice > t1 && t1 > t2 && t2 > t3;
      if (!ordered)
        calculationErrors.push(
          `Target order is invalid for a ${direction}: entry ${entryPrice}, TP1 ${t1}, TP2 ${t2}, TP3 ${t3}.`,
        );
      if (ratios.tp1 === null || ratios.tp2 === null || ratios.tp3 === null)
        calculationErrors.push("Reward-to-risk could not be calculated from the displayed prices.");
    }
  }

  // --- state ------------------------------------------------------------
  let state: SignalState;
  if (available < 3) {
    state = "INSUFFICIENT_DATA";
    warnings.push(
      `Only ${available} of the D1–M15 confirmation timeframes have valid candles — not enough to read.`,
    );
  } else if (calculationErrors.length) {
    state = "INVALID";
  } else if (direction === "WAIT") {
    state = "WAIT";
  } else if (stale || spreadTooWide) {
    state = "WAIT";
  } else if (
    entryZone &&
    (direction === "BUY" ? price > entryZone[1] * 1.002 : price < entryZone[0] * 0.998)
  ) {
    state = "MISSED";
    warnings.push("MISSED — DO NOT CHASE. Price already left the entry zone.");
  } else if (score >= 60 && m5Confirms && m1Triggers) {
    state = "READY";
  } else if (score >= 35) {
    state = "WATCH";
  } else {
    state = "WATCH";
  }

  const showLevels = state !== "WAIT" && state !== "INSUFFICIENT_DATA" && direction !== "WAIT";
  const finalDirection: Direction = state === "INSUFFICIENT_DATA" ? "WAIT" : direction;

  return {
    symbol: input.symbol,
    direction: finalDirection,
    state,
    confidenceScore: score,
    confidenceLabel: score >= 70 ? "HIGH" : score >= 45 ? "MEDIUM" : "LOW",
    setupType,
    entryZone: showLevels ? entryZone : null,
    entryPrice: showLevels ? entryPrice : null,
    invalidationLevel: showLevels ? invalidation : null,
    stopLoss: showLevels ? stopLoss : null,
    takeProfit1: showLevels ? (tps[0] ?? null) : null,
    takeProfit2: showLevels ? (tps[1] ?? null) : null,
    takeProfit3: showLevels ? (tps[2] ?? null) : null,
    riskRewardRatios: showLevels ? ratios : { tp1: null, tp2: null, tp3: null },
    reasons: reasons.length ? reasons : ["No confirmation majority in either direction."],
    warnings,
    whyItMayFail,
    calculationErrors,
    triggerCondition: trigger,
    invalidationCondition,
    newsRisk: input.newsRisk ?? null,
    session: sessionOf(now),
    timeframeEvidence: evidence,
    higherContext,
    dataTimestamp: input.quote.timestamp,
    dataSource: input.quote.provider,
    dataKind: input.quote.kind,
    expiresAt: now + 1000 * 60 * 90,
  };
}
