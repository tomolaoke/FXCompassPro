/**
 * Checks every pending, accepted paper trade against real price action since
 * it was recorded, and persists whichever outcome it finds.
 *
 * Run on demand (called from the Records page) rather than on a schedule —
 * there is no cron in this deployment, and checking on view is sufficient for
 * a single-user tool.
 */

import { determinePaperOutcome } from "./outcome";
import type { Timeframe } from "../config/timeframes";

const CHECK_TIMEFRAME: Timeframe = "M15";

export interface PaperCheckResult {
  readonly id: string;
  readonly symbol: string;
  readonly outcome: "WIN" | "LOSS" | "BREAKEVEN" | "PENDING";
  readonly rMultiple: number | null;
}

export async function checkPendingPaperTrades(): Promise<PaperCheckResult[]> {
  const { getPendingPaperTrades, updateSignalOutcome } = await import("../../db/signals.server");
  const { loadSeries } = await import("../market.server");

  const pending = await getPendingPaperTrades();
  const results: PaperCheckResult[] = [];

  for (const row of pending) {
    const seriesResult = await loadSeries(row.symbol, [CHECK_TIMEFRAME]);
    const candles = seriesResult.series[CHECK_TIMEFRAME];
    if (!candles || seriesResult.syntheticTimeframes.has(CHECK_TIMEFRAME)) {
      // Never determine a paper-trade outcome from sample data — the same
      // rule that keeps synthetic candles out of live signal generation.
      results.push({ id: row.id, symbol: row.symbol, outcome: "PENDING", rMultiple: null });
      continue;
    }

    const outcome = determinePaperOutcome(
      {
        direction: row.direction as "BUY" | "SELL",
        entryPrice: row.entryPrice!,
        stopLoss: row.stopLoss!,
        takeProfits: [row.takeProfit1!, row.takeProfit2!, row.takeProfit3!],
      },
      row.generatedAt,
      candles,
    );

    if (outcome.outcome !== "PENDING") {
      await updateSignalOutcome({
        id: row.id,
        outcome: outcome.outcome,
        rMultiple: outcome.rMultiple,
      });
    }

    results.push({
      id: row.id,
      symbol: row.symbol,
      outcome: outcome.outcome,
      rMultiple: outcome.rMultiple,
    });
  }

  return results;
}
