import { atr, stochastic, stochStateOf, type StochPoint } from "./indicators";
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
import type {
  Candle,
  Direction,
  Quote,
  RiskSettings,
  Signal,
  SignalState,
  StochState,
  Timeframe,
  TimeframeEvidence,
} from "./types";

export const DISCLAIMER =
  "Educational analysis only. Trading leveraged forex/CFDs can cause rapid losses. No signal is guaranteed.";

export interface EvaluateInput {
  symbol: string;
  quote: Quote;
  /** candles per timeframe; the execution timeframe must be present */
  series: Partial<Record<Timeframe, Candle[]>>;
  confirmationTimeframes: Timeframe[];
  executionTimeframe: Timeframe;
  risk: RiskSettings;
  newsRisk?: string | null;
  now?: number;
}

const BULLISH_STATES: StochState[] = ["OVERSOLD", "RECOVERING_FROM_OVERSOLD"];
const BEARISH_STATES: StochState[] = ["OVERBOUGHT", "ROLLING_FROM_OVERBOUGHT"];

function evidenceFor(
  timeframe: Timeframe,
  candles: Candle[] | undefined,
): { evidence: TimeframeEvidence; points: StochPoint[] } {
  if (!candles || candles.length < 30) {
    return {
      evidence: {
        timeframe,
        k: null,
        d: null,
        stochState: "UNKNOWN",
        aligned: false,
        note: "Not enough candles for Stochastic 25,2,4",
      },
      points: [],
    };
  }
  const points = stochastic(candles, 25, 2, 4);
  const last = points[points.length - 1]!;
  const state = stochStateOf(points);
  return {
    evidence: {
      timeframe,
      k: last.k,
      d: last.d,
      stochState: state,
      aligned: false,
      note: describeState(state),
    },
    points,
  };
}

function describeState(state: StochState): string {
  switch (state) {
    case "OVERSOLD":
      return "At or below 20/30 — downside may be overextended. Buys only after price action confirms.";
    case "RECOVERING_FROM_OVERSOLD":
      return "Turning up out of oversold territory.";
    case "OVERBOUGHT":
      return "At or above 70/80 — upside may be overextended. Sells only after price action confirms.";
    case "ROLLING_FROM_OVERBOUGHT":
      return "Rolling down out of overbought territory.";
    case "NEUTRAL":
      return "Mid-range — no stretch either way.";
    default:
      return "No reading available.";
  }
}

export function evaluateSignal(input: EvaluateInput): Signal {
  const now = input.now ?? Date.now();
  const spec = specFor(input.symbol);
  const reasons: string[] = [];
  const warnings: string[] = [];
  const whyItMayFail: string[] = [
    "Stochastic can stay overbought in an uptrend and oversold in a downtrend — a stretched reading is not a reversal.",
    "Levels can be swept a second time; the invalidation point can be traded through.",
  ];

  const evidence: TimeframeEvidence[] = [];
  let bullVotes = 0;
  let bearVotes = 0;
  let unknown = 0;

  for (const tf of input.confirmationTimeframes) {
    const { evidence: ev } = evidenceFor(tf, input.series[tf]);
    if (BULLISH_STATES.includes(ev.stochState)) bullVotes += 1;
    else if (BEARISH_STATES.includes(ev.stochState)) bearVotes += 1;
    else if (ev.stochState === "UNKNOWN") unknown += 1;
    evidence.push(ev);
  }

  const exec = input.series[input.executionTimeframe] ?? [];
  const execPoints = exec.length >= 30 ? stochastic(exec, 25, 2, 4) : [];
  const execState = execPoints.length ? stochStateOf(execPoints) : "UNKNOWN";
  const price = input.quote.mid;

  // --- gates -------------------------------------------------------------
  const ageMinutes = (now - input.quote.timestamp) / 60000;
  const stale = ageMinutes > input.risk.maxDataAgeMinutes || input.quote.kind === "stale";
  if (stale) warnings.push(`Price is ${ageMinutes.toFixed(0)} min old — treated as stale.`);
  if (input.quote.kind === "demo")
    warnings.push("Demo candles: shapes are synthetic and must not be traded.");

  const spreadPips =
    input.quote.spread !== null ? toPips(input.quote.spread, input.symbol) : null;
  const spreadTooWide = spreadPips !== null && spreadPips > input.risk.maxSpreadPips;
  if (spreadTooWide)
    warnings.push(
      `Spread ${spreadPips!.toFixed(1)} pips is above your ${input.risk.maxSpreadPips} pip limit.`,
    );

  if (!spec.supported)
    warnings.push(`${spec.symbol} has no verified specification — contract size unknown.`);

  const conflicting = bullVotes > 0 && bearVotes > 0;
  if (conflicting)
    warnings.push("Higher-timeframe evidence conflicts: some timeframes stretched each way.");
  if (unknown > 0) warnings.push(`${unknown} required timeframe(s) have no Stochastic reading.`);

  // --- direction candidate ----------------------------------------------
  const required = input.confirmationTimeframes.length;
  let direction: Direction = "WAIT";
  if (bullVotes >= Math.ceil(required / 2) && bullVotes > bearVotes) direction = "BUY";
  else if (bearVotes >= Math.ceil(required / 2) && bearVotes > bullVotes) direction = "SELL";

  for (const ev of evidence) {
    ev.aligned =
      direction === "BUY"
        ? BULLISH_STATES.includes(ev.stochState)
        : direction === "SELL"
          ? BEARISH_STATES.includes(ev.stochState)
          : false;
  }

  const levels = keyLevels(exec.length ? exec : []);
  const atrSeries = atr(exec, 14);
  const atrValue = atrSeries[atrSeries.length - 1] ?? spec.pipSize * 20;
  const tolerance = atrValue * 0.35;
  const sweep = exec.length ? liquiditySweep(exec) : { detected: false, side: null, level: null, index: null };
  const shift = exec.length ? structureShift(exec) : { detected: false, direction: null, level: null };
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
  let invalidation: number | null = null;
  let stopLoss: number | null = null;
  let tps: (number | null)[] = [null, null, null];
  let trigger = "Waiting for required timeframes to line up.";
  let invalidationCondition = "No setup, so nothing to invalidate yet.";

  if (direction !== "WAIT" && lastCandle) {
    const isBuy = direction === "BUY";
    score = 25 + Math.round((isBuy ? bullVotes : bearVotes) * (35 / Math.max(required, 1)));
    reasons.push(
      `${isBuy ? bullVotes : bearVotes} of ${required} required timeframes read ${isBuy ? "oversold / recovering" : "overbought / rolling over"} on Stochastic 25,2,4.`,
    );

    const zoneCandidates = isBuy
      ? [levels.prevDayLow, levels.prevWeekLow, ...levels.support, ...equal.filter((e) => e.type === "LOW").map((e) => e.price)]
      : [levels.prevDayHigh, levels.prevWeekHigh, ...levels.resistance, ...equal.filter((e) => e.type === "HIGH").map((e) => e.price)];
    const nearLevel = zoneCandidates
      .filter((v): v is number => typeof v === "number")
      .find((v) => Math.abs(v - price) <= atrValue * 1.5);
    if (nearLevel !== undefined) {
      score += 12;
      reasons.push(
        `Price is within ~${(Math.abs(nearLevel - price) / spec.pipSize).toFixed(0)} pips of a ${isBuy ? "support / prior low" : "resistance / prior high"} at ${nearLevel.toFixed(spec.digits)}.`,
      );
    } else {
      warnings.push("Price is not near a mapped level — the setup lacks a location edge.");
    }

    const alignedGap = gaps.find((g) => (isBuy ? g.direction === "BULLISH" : g.direction === "BEARISH"));
    if (alignedGap) {
      score += 8;
      entryZone = [Math.min(alignedGap.from, alignedGap.to), Math.max(alignedGap.from, alignedGap.to)];
      reasons.push(
        `${isBuy ? "Bullish" : "Bearish"} fair value gap between ${alignedGap.from.toFixed(spec.digits)} and ${alignedGap.to.toFixed(spec.digits)} available as a limit zone.`,
      );
    }
    const alignedBlock = blocks.find((b) => (isBuy ? b.direction === "BULLISH" : b.direction === "BEARISH"));
    if (alignedBlock) {
      score += 6;
      entryZone = entryZone ?? [alignedBlock.from, alignedBlock.to];
      reasons.push("Order-block approximation aligned with the direction (discretionary, not institutional fact).");
    }

    const sweepAligned = sweep.detected && (isBuy ? sweep.side === "SELL_SIDE" : sweep.side === "BUY_SIDE");
    if (sweepAligned) {
      score += 12;
      reasons.push(
        `${isBuy ? "Sell-side" : "Buy-side"} liquidity sweep of ${sweep.level!.toFixed(spec.digits)} then close back inside.`,
      );
    }
    const shiftAligned = shift.detected && (isBuy ? shift.direction === "BULLISH" : shift.direction === "BEARISH");
    if (shiftAligned) {
      score += 10;
      reasons.push(`${isBuy ? "Bullish" : "Bearish"} market-structure shift confirmed on ${input.executionTimeframe}.`);
    }
    if (lastDisplacement) {
      score += 5;
      reasons.push("Displacement candle present (body ≥ 1.5× ATR).");
    }
    const execClosedRight = isBuy ? closeBullish : !closeBullish;
    if (execClosedRight) {
      score += 8;
      reasons.push(`${input.executionTimeframe} closed ${isBuy ? "bullish" : "bearish"}.`);
    } else {
      warnings.push(`${input.executionTimeframe} has not closed ${isBuy ? "bullish" : "bearish"} yet — no execution trigger.`);
    }

    setupType = sweepAligned
      ? `${isBuy ? "Sell-side" : "Buy-side"} sweep + Stochastic stretch`
      : alignedGap
        ? `${isBuy ? "Bullish" : "Bearish"} FVG retest + Stochastic stretch`
        : `Multi-timeframe Stochastic stretch at ${isBuy ? "support" : "resistance"}`;

    const structuralLow = Math.min(...exec.slice(-12).map((c) => c.l));
    const structuralHigh = Math.max(...exec.slice(-12).map((c) => c.h));
    invalidation = isBuy ? (sweep.level ?? structuralLow) : (sweep.level ?? structuralHigh);
    const buffer = atrValue * 0.25;
    stopLoss = isBuy ? Math.min(structuralLow, invalidation) - buffer : Math.max(structuralHigh, invalidation) + buffer;

    const targets = isBuy
      ? [levels.resistance[0], levels.prevDayHigh, levels.prevWeekHigh]
      : [levels.support[0], levels.prevDayLow, levels.prevWeekLow];
    const risk = Math.abs(price - stopLoss);
    tps = targets.map((t, i) => {
      if (typeof t === "number" && (isBuy ? t > price : t < price)) return t;
      const mult = [1.5, 2.5, 4][i]!;
      return isBuy ? price + risk * mult : price - risk * mult;
    });

    entryZone = entryZone ?? [
      isBuy ? price - atrValue * 0.3 : price,
      isBuy ? price : price + atrValue * 0.3,
    ];

    trigger = isBuy
      ? `Bullish ${input.executionTimeframe} close or structure shift while price is inside ${entryZone[0].toFixed(spec.digits)}–${entryZone[1].toFixed(spec.digits)}.`
      : `Bearish ${input.executionTimeframe} close or structure shift while price is inside ${entryZone[0].toFixed(spec.digits)}–${entryZone[1].toFixed(spec.digits)}.`;
    invalidationCondition = isBuy
      ? `A close below ${invalidation.toFixed(spec.digits)} kills the idea.`
      : `A close above ${invalidation.toFixed(spec.digits)} kills the idea.`;

    // risk sizing gate
    const riskAmount = (input.risk.accountCapital * input.risk.riskPercent) / 100;
    if (spec.pipValuePerLot && risk > 0) {
      const stopPips = risk / spec.pipSize;
      const lots = riskAmount / (stopPips * spec.pipValuePerLot);
      if (lots < input.risk.minLot) {
        warnings.push(
          `Stop of ${stopPips.toFixed(0)} pips is too wide for ${input.risk.riskPercent}% of your capital at the minimum lot size.`,
        );
        score -= 20;
      }
    }

    if (conflicting) score -= 15;
    if (stale) score -= 25;
    if (spreadTooWide) score -= 20;
    if (input.newsRisk) {
      score -= 10;
      whyItMayFail.push(`Event risk noted: ${input.newsRisk}.`);
    }
  }

  score = Math.max(0, Math.min(100, score));

  // --- state ------------------------------------------------------------
  let state: SignalState = "WAIT";
  if (direction === "WAIT" || stale || spreadTooWide || score < 35) {
    if (direction !== "WAIT" && (stale || spreadTooWide)) state = "WAIT";
    else if (direction !== "WAIT") state = "WATCH";
    else state = "WAIT";
  } else if (entryZone && (price < entryZone[0] || price > entryZone[1])) {
    const beyond =
      direction === "BUY" ? price > entryZone[1] * 1.002 : price < entryZone[0] * 0.998;
    state = beyond ? "MISSED" : "WATCH";
    if (beyond) warnings.push("MISSED — DO NOT CHASE. Price already left the entry zone.");
  } else if (score >= 60) {
    state = "READY";
  } else {
    state = "WATCH";
  }

  if (stale || spreadTooWide) direction = direction === "WAIT" ? "WAIT" : direction;

  const finalDirection: Direction = state === "WAIT" ? "WAIT" : direction;
  const risk = stopLoss !== null ? Math.abs(price - stopLoss) : null;
  const rr = (tp: number | null) =>
    tp !== null && risk && risk > 0 ? Number((Math.abs(tp - price) / risk).toFixed(2)) : null;

  return {
    symbol: input.symbol,
    direction: finalDirection,
    state,
    confidenceScore: score,
    confidenceLabel: score >= 70 ? "HIGH" : score >= 45 ? "MEDIUM" : "LOW",
    setupType,
    entryZone: finalDirection === "WAIT" ? null : entryZone,
    invalidationLevel: finalDirection === "WAIT" ? null : invalidation,
    stopLoss: finalDirection === "WAIT" ? null : stopLoss,
    takeProfit1: finalDirection === "WAIT" ? null : (tps[0] ?? null),
    takeProfit2: finalDirection === "WAIT" ? null : (tps[1] ?? null),
    takeProfit3: finalDirection === "WAIT" ? null : (tps[2] ?? null),
    riskRewardRatios: {
      tp1: finalDirection === "WAIT" ? null : rr(tps[0] ?? null),
      tp2: finalDirection === "WAIT" ? null : rr(tps[1] ?? null),
      tp3: finalDirection === "WAIT" ? null : rr(tps[2] ?? null),
    },
    reasons: reasons.length ? reasons : ["No timeframe majority in either direction."],
    warnings,
    whyItMayFail,
    triggerCondition: trigger,
    invalidationCondition,
    newsRisk: input.newsRisk ?? null,
    session: sessionOf(now),
    timeframeEvidence: [
      ...evidence,
      {
        timeframe: input.executionTimeframe,
        k: execPoints[execPoints.length - 1]?.k ?? null,
        d: execPoints[execPoints.length - 1]?.d ?? null,
        stochState: execState,
        aligned:
          finalDirection === "BUY"
            ? BULLISH_STATES.includes(execState)
            : finalDirection === "SELL"
              ? BEARISH_STATES.includes(execState)
              : false,
        note: `Execution timeframe — ${describeState(execState)}`,
      },
    ],
    dataTimestamp: input.quote.timestamp,
    dataSource: input.quote.provider,
    dataKind: input.quote.kind,
    expiresAt: now + 1000 * 60 * 90,
  };
}
