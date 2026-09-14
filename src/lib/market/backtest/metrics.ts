/**
 * Pure metric computation over a completed set of backtest trades.
 *
 * Every metric here describes what already happened on one historical
 * sample. None of them is a prediction, and the heuristic setup-quality score
 * used elsewhere in the app is never conflated with a win rate computed here.
 */

import type { BacktestTrade } from "./types";

export interface BacktestMetrics {
  readonly sampleSize: number;
  readonly filledCount: number;
  readonly unfilledCount: number;
  readonly netReturn: number;
  readonly grossProfit: number;
  readonly grossLoss: number;
  readonly profitFactor: number | null;
  readonly winRate: number | null;
  readonly averageWin: number | null;
  readonly averageLoss: number | null;
  readonly expectancyR: number | null;
  readonly maxDrawdown: number;
  readonly maxLosingStreak: number;
  /** Only meaningful above a minimum sample size — see MIN_SAMPLE_FOR_SHARPE. */
  readonly sharpeLike: number | null;
}

const MIN_SAMPLE_FOR_SHARPE = 20;

function settled(trades: readonly BacktestTrade[]): BacktestTrade[] {
  return trades.filter((t) => t.pnl !== null);
}

export function computeMetrics(trades: readonly BacktestTrade[]): BacktestMetrics {
  const filled = settled(trades);
  const unfilledCount = trades.length - filled.length;

  const wins = filled.filter((t) => t.pnl! > 0);
  const losses = filled.filter((t) => t.pnl! < 0);

  const grossProfit = wins.reduce((sum, t) => sum + t.pnl!, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl!, 0));
  const netReturn = grossProfit - grossLoss;

  const winRate = filled.length > 0 ? wins.length / filled.length : null;
  const averageWin = wins.length > 0 ? grossProfit / wins.length : null;
  const averageLoss = losses.length > 0 ? grossLoss / losses.length : null;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : null;

  const rMultiples = filled.map((t) => t.rMultiple).filter((r): r is number => r !== null);
  const expectancyR =
    rMultiples.length > 0 ? rMultiples.reduce((s, r) => s + r, 0) / rMultiples.length : null;

  const { maxDrawdown } = computeDrawdown(filled);
  const maxLosingStreak = computeLosingStreak(filled);

  const sharpeLike =
    rMultiples.length >= MIN_SAMPLE_FOR_SHARPE ? computeSharpeLike(rMultiples) : null;

  return {
    sampleSize: trades.length,
    filledCount: filled.length,
    unfilledCount,
    netReturn,
    grossProfit,
    grossLoss,
    profitFactor,
    winRate,
    averageWin,
    averageLoss,
    expectancyR,
    maxDrawdown,
    maxLosingStreak,
    sharpeLike,
  };
}

function computeDrawdown(filled: readonly BacktestTrade[]): { maxDrawdown: number } {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const t of filled) {
    equity += t.pnl!;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  return { maxDrawdown };
}

function computeLosingStreak(filled: readonly BacktestTrade[]): number {
  let current = 0;
  let max = 0;
  for (const t of filled) {
    if (t.pnl! < 0) {
      current += 1;
      max = Math.max(max, current);
    } else {
      current = 0;
    }
  }
  return max;
}

/**
 * Mean R-multiple divided by its standard deviation, per trade.
 *
 * Explicitly NOT annualised and NOT a real Sharpe ratio — there is no
 * consistent time axis across trades of different durations to annualise
 * against. Labelled "Sharpe-like" everywhere it is shown, and withheld below
 * MIN_SAMPLE_FOR_SHARPE trades because a standard deviation from a handful of
 * samples is close to meaningless.
 */
function computeSharpeLike(rMultiples: readonly number[]): number | null {
  const mean = rMultiples.reduce((s, r) => s + r, 0) / rMultiples.length;
  const variance = rMultiples.reduce((s, r) => s + (r - mean) ** 2, 0) / rMultiples.length;
  const stdDev = Math.sqrt(variance);
  return stdDev > 0 ? mean / stdDev : null;
}

export type SegmentKey = "session" | "higherTimeframeBias" | "broadContextRelation";

export function segmentBy(
  trades: readonly BacktestTrade[],
  key: SegmentKey,
): Record<string, BacktestMetrics> {
  const groups = new Map<string, BacktestTrade[]>();
  for (const trade of trades) {
    const value = trade[key];
    const list = groups.get(value) ?? [];
    list.push(trade);
    groups.set(value, list);
  }
  const result: Record<string, BacktestMetrics> = {};
  for (const [value, list] of groups) result[value] = computeMetrics(list);
  return result;
}
