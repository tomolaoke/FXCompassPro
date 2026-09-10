import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ALL_TIMEFRAMES, type Timeframe } from "./types";

const symbolSchema = z
  .string()
  .trim()
  .min(3)
  .max(12)
  .regex(/^[A-Za-z]{3,12}$/, "Symbols are letters only, e.g. XAUUSD");

const tfSchema = z.enum(ALL_TIMEFRAMES as [Timeframe, ...Timeframe[]]);

export const getQuotes = createServerFn({ method: "POST" })
  .inputValidator((input: { symbols: string[] }) =>
    z.object({ symbols: z.array(symbolSchema).min(1).max(12) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { loadQuotes } = await import("./market.server");
    return loadQuotes(data.symbols);
  });

export const getSeries = createServerFn({ method: "POST" })
  .inputValidator((input: { symbol: string; timeframes: Timeframe[] }) =>
    z
      .object({ symbol: symbolSchema, timeframes: z.array(tfSchema).min(1).max(8) })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { loadSeries } = await import("./market.server");
    return loadSeries(data.symbol, data.timeframes);
  });

const riskSchema = z.object({
  accountCapital: z.number().positive().max(100_000_000),
  accountCurrency: z.string().min(1).max(8),
  riskPercent: z.number().positive().max(100),
  maxDailyLossPercent: z.number().min(0).max(100),
  maxOpenTrades: z.number().min(0).max(50),
  maxCorrelatedExposure: z.number().min(0).max(50),
  allowStacking: z.boolean(),
  allowPartials: z.boolean(),
  leverage: z.number().min(1).max(5000),
  minLot: z.number().positive(),
  lotStep: z.number().positive(),
  maxLot: z.number().positive(),
  maxSpreadPips: z.number().min(0),
  maxDataAgeMinutes: z.number().min(0),
});

export interface SignalRunInput {
  symbols: string[];
  confirmationTimeframes: Timeframe[];
  executionTimeframe: Timeframe;
  risk: z.infer<typeof riskSchema>;
}

/** Runs the deterministic engine server-side for a whole watchlist. */
export const getSignalRun = createServerFn({ method: "POST" })
  .inputValidator((input: SignalRunInput) =>
    z
      .object({
        symbols: z.array(symbolSchema).min(1).max(12),
        confirmationTimeframes: z.array(tfSchema).min(1).max(8),
        executionTimeframe: tfSchema,
        risk: riskSchema,
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { loadQuotes, loadSeries } = await import("./market.server");
    const { evaluateSignal } = await import("./signal");

    const quoteResult = await loadQuotes(data.symbols);
    const timeframes = Array.from(
      new Set([...data.confirmationTimeframes, data.executionTimeframe]),
    );

    const rows = [];
    for (const quote of quoteResult.quotes) {
      const seriesResult = await loadSeries(quote.symbol, timeframes);
      const signal = evaluateSignal({
        symbol: quote.symbol,
        quote,
        series: seriesResult.series,
        confirmationTimeframes: data.confirmationTimeframes,
        executionTimeframe: data.executionTimeframe,
        risk: data.risk,
      });
      rows.push({
        symbol: quote.symbol,
        quote,
        signal,
        provider: seriesResult.provider,
        real: seriesResult.real && quote.kind !== "demo",
        notes: seriesResult.notes,
      });
    }

    return {
      generatedAt: Date.now(),
      real: quoteResult.real,
      notes: quoteResult.notes,
      rows,
    };
  });
