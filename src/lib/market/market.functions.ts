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
