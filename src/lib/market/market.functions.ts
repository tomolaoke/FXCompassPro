import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ALL_TIMEFRAMES, type Timeframe } from "./types";
import { ALL_TIMEFRAMES as ENGINE_TIMEFRAMES } from "./config/timeframes";
import { DEFAULT_STRATEGY } from "./config/strategy";
import type { EngineSignal } from "./engine/types";

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
    z.object({ symbol: symbolSchema, timeframes: z.array(tfSchema).min(1).max(8) }).parse(input),
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
    // The strategy reads all nine timeframes; three cached provider requests
    // per symbol cover them, so this stays inside free-plan limits.
    const timeframes = Array.from(
      new Set<Timeframe>([
        ...ALL_TIMEFRAMES,
        ...data.confirmationTimeframes,
        data.executionTimeframe,
      ]),
    );

    // Symbols run in parallel: one provider request each, so a full watchlist
    // scan finishes in seconds instead of one round trip per pair.
    const rows = await Promise.all(
      quoteResult.quotes.map(async (quote) => {
        const seriesResult = await loadSeries(quote.symbol, timeframes);
        const signal = evaluateSignal({
          symbol: quote.symbol,
          quote,
          series: seriesResult.series,
          confirmationTimeframes: data.confirmationTimeframes,
          executionTimeframe: data.executionTimeframe,
          risk: data.risk,
        });
        return {
          symbol: quote.symbol,
          quote,
          signal,
          provider: seriesResult.provider,
          real: seriesResult.real && quote.kind !== "demo",
          notes: seriesResult.notes,
        };
      }),
    );

    return {
      generatedAt: Date.now(),
      real: quoteResult.real,
      notes: quoteResult.notes,
      rows,
    };
  });

export interface EngineSignalRunInput {
  symbols: string[];
  risk: z.infer<typeof riskSchema>;
}

/**
 * Runs the new five-tier engine server-side for a whole watchlist.
 *
 * All nine timeframes are always requested — the active strategy decides which
 * ones are configured, not the caller. Confirmation-timeframe selection from
 * the old flat model has no equivalent here: it is superseded by
 * config/strategy.ts's role assignment.
 */
export const getEngineSignalRun = createServerFn({ method: "POST" })
  .inputValidator((input: EngineSignalRunInput) =>
    z
      .object({
        symbols: z.array(symbolSchema).min(1).max(12),
        risk: riskSchema,
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { loadQuotes, loadSeries } = await import("./market.server");
    const { evaluateSignal } = await import("./engine/evaluate");
    const { checkNewsWindow, currenciesFor } = await import("./news/check");

    const quoteResult = await loadQuotes(data.symbols);
    const notes = [...quoteResult.notes];

    // One calendar-wide fetch covers every symbol in the watchlist; the news
    // check itself is per-symbol only in which currencies it filters to.
    let allEvents: import("./news/types").NewsEvent[] = [];
    try {
      const { getAllNewsEvents } = await import("../db/news.server");
      allEvents = await getAllNewsEvents();
    } catch {
      // No database configured yet, or unreachable — the check below already
      // treats an empty calendar as UNAVAILABLE, which is the correct default.
    }
    if (allEvents.length === 0) {
      notes.push(
        "NEWS CHECK UNAVAILABLE — VERIFY ECONOMIC CALENDAR MANUALLY. No events are configured.",
      );
    }

    const rows = await Promise.all(
      quoteResult.quotes.map(async (quote) => {
        const seriesResult = await loadSeries(quote.symbol, [...ENGINE_TIMEFRAMES]);
        const relevantCurrencies = new Set(currenciesFor(quote.symbol));
        const relevantEvents = allEvents.filter((e) => relevantCurrencies.has(e.currency));
        const newsCheck = checkNewsWindow(allEvents, relevantEvents, Date.now(), {
          enabled: DEFAULT_STRATEGY.config.news.enabled,
          bufferBeforeMinutes: DEFAULT_STRATEGY.config.news.bufferBeforeMinutes,
          bufferAfterMinutes: DEFAULT_STRATEGY.config.news.bufferAfterMinutes,
          blockingImpacts: DEFAULT_STRATEGY.config.news.blockingImpacts,
        });

        const signal = evaluateSignal({
          symbol: quote.symbol,
          quote,
          series: seriesResult.series,
          syntheticTimeframes: seriesResult.syntheticTimeframes,
          provider: seriesResult.provider,
          config: DEFAULT_STRATEGY.config,
          strategyVersion: DEFAULT_STRATEGY.version,
          risk: data.risk,
          newsRisk: newsCheck.status === "EVENT_NEARBY" ? newsCheck.reason : null,
        });
        return {
          symbol: quote.symbol,
          quote,
          signal,
          provider: seriesResult.provider,
          real: seriesResult.real && quote.kind !== "demo",
          notes: seriesResult.notes,
          newsStatus: newsCheck.status,
        };
      }),
    );

    return {
      generatedAt: Date.now(),
      real: quoteResult.real,
      notes,
      strategyVersion: DEFAULT_STRATEGY.version,
      rows,
    };
  });

const recordDecisionSchema = z.enum(["accepted", "rejected", "ignored"]);

/**
 * Persists one signal's full audit trail. Called explicitly from the UI when
 * the user records a signal — not on every background poll, which would
 * flood a free-tier database with rows for setups that never left WATCH.
 */
export const recordSignal = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      signal: unknown;
      userDecision?: "accepted" | "rejected" | "ignored";
      userDecisionReason?: string;
      id?: string;
    }) =>
      z
        .object({
          // The full EngineSignal is produced server-side moments earlier and
          // round-tripped through the client unmodified; validating its exact
          // shape here would duplicate the engine's own types for no benefit,
          // so it is trusted as opaque JSON and only the envelope is checked.
          signal: z.record(z.unknown()),
          userDecision: recordDecisionSchema.optional(),
          userDecisionReason: z.string().max(500).optional(),
          id: z.string().min(1).max(64).optional(),
        })
        .parse(input),
  )
  .handler(async ({ data }) => {
    const { recordSignalAudit } = await import("../db/signals.server");
    const id = await recordSignalAudit({
      signal: data.signal as unknown as EngineSignal,
      ...(data.userDecision ? { userDecision: data.userDecision } : {}),
      ...(data.userDecisionReason ? { userDecisionReason: data.userDecisionReason } : {}),
      ...(data.id ? { id: data.id } : {}),
    });
    return { id };
  });

export const getSignalHistoryFn = createServerFn({ method: "POST" })
  .inputValidator((input: { symbol?: string; limit?: number }) =>
    z
      .object({
        symbol: symbolSchema.optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { getSignalHistory } = await import("../db/signals.server");
    return getSignalHistory({
      ...(data.symbol ? { symbol: data.symbol } : {}),
      ...(data.limit !== undefined ? { limit: data.limit } : {}),
    });
  });

export const updateSignalOutcomeFn = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      id: string;
      outcome: "WIN" | "LOSS" | "BREAKEVEN" | "PENDING";
      rMultiple?: number;
    }) =>
      z
        .object({
          id: z.string().min(1).max(64),
          outcome: z.enum(["WIN", "LOSS", "BREAKEVEN", "PENDING"]),
          rMultiple: z.number().optional(),
        })
        .parse(input),
  )
  .handler(async ({ data }) => {
    const { updateSignalOutcome } = await import("../db/signals.server");
    await updateSignalOutcome({
      id: data.id,
      outcome: data.outcome,
      rMultiple: data.rMultiple ?? null,
    });
    return { ok: true };
  });

/**
 * Checks every pending, accepted paper trade against real price action since
 * it was recorded. Called on demand from the Records page — there is no
 * scheduler in this deployment to run it automatically.
 */
export const checkPaperTradesFn = createServerFn({ method: "POST" }).handler(async () => {
  const { checkPendingPaperTrades } = await import("./paper/check.server");
  return checkPendingPaperTrades();
});

const impactSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);

/**
 * Manually maintained economic calendar — see docs/data-providers.md for why
 * this exists instead of a paid API. An empty calendar is treated as
 * UNAVAILABLE, never as "no news"; see news/check.ts.
 */
export const addNewsEventFn = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      currency: string;
      title: string;
      impact: "HIGH" | "MEDIUM" | "LOW";
      eventTimeUtc: number;
    }) =>
      z
        .object({
          currency: z.string().trim().length(3),
          title: z.string().trim().min(1).max(120),
          impact: impactSchema,
          eventTimeUtc: z.number().int().positive(),
        })
        .parse(input),
  )
  .handler(async ({ data }) => {
    const { addNewsEvent } = await import("../db/news.server");
    return addNewsEvent(data);
  });

export const removeNewsEventFn = createServerFn({ method: "POST" })
  .inputValidator((input: { id: string }) =>
    z.object({ id: z.string().min(1).max(64) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { removeNewsEvent } = await import("../db/news.server");
    await removeNewsEvent(data.id);
    return { ok: true };
  });

export const getUpcomingNewsEventsFn = createServerFn({ method: "POST" }).handler(async () => {
  const { getUpcomingNewsEvents } = await import("../db/news.server");
  return getUpcomingNewsEvents();
});
