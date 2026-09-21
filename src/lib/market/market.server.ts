import { specFor } from "./instruments";
import { demoCandles, demoQuote } from "./demo";
import { normalizeCandles } from "./data/normalize";
import { aggregate } from "./data/aggregate";
import { timeframeDef } from "./config/timeframes";
import { TF_MINUTES, type Candle, type Quote, type Timeframe } from "./types";

/**
 * Real market-data adapters.
 *
 * Order of preference:
 *  1. TwelveData (candles + spot) when TWELVEDATA_API_KEY is configured.
 *  2. Frankfurter (free, no key, ECB daily reference rates) for FX spot only.
 *  3. Clearly labelled synthetic sample data — never presented as a real price.
 */

const TD_INTERVAL: Record<Timeframe, string> = {
  MN: "1month",
  W1: "1week",
  D1: "1day",
  H4: "4h",
  H1: "1h",
  M30: "30min",
  M15: "15min",
  M5: "5min",
  M1: "1min",
};

/**
 * Which provider request each timeframe is rolled up from. Three base series
 * per symbol cover all nine timeframes, which keeps us inside free-plan limits.
 */
function baseFor(tf: Timeframe): Timeframe {
  if (tf === "M1") return "M1";
  if (TF_MINUTES[tf] <= TF_MINUTES.H4) return "M5";
  return "D1";
}

export interface SeriesResult {
  symbol: string;
  series: Partial<Record<Timeframe, Candle[]>>;
  provider: string;
  real: boolean;
  notes: string[];
  /**
   * Which requested timeframes are synthetic sample data rather than a real
   * provider series. The engine must never derive a trade-ready state from a
   * timeframe in this set.
   */
  syntheticTimeframes: Set<Timeframe>;
}

function apiKey(): string | undefined {
  const raw = process.env["TWELVEDATA_API_KEY"];
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Synthetic candles exist so the interface can be built and reviewed without
 * a provider key. They must never stand in for a real market in production:
 * `ALLOW_DEMO_DATA` is ignored outright when `NODE_ENV === "production"`, so a
 * misconfigured deploy cannot silently start showing sample data as if it were
 * live. Without this, a quota exhaustion or provider outage on a live
 * deployment would fall back to a seeded random walk and keep evaluating
 * signals against it — the exact failure this application exists to prevent.
 */
function demoDataAllowed(): boolean {
  if (process.env["NODE_ENV"] === "production") return false;
  return process.env["ALLOW_DEMO_DATA"] === "true";
}

function tdSymbol(symbol: string): string {
  const s = symbol.toUpperCase();
  return s.length === 6 ? `${s.slice(0, 3)}/${s.slice(3)}` : s;
}

const cache = new Map<string, { at: number; value: unknown }>();

function cached<T>(key: string, ttlMs: number): T | undefined {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  return undefined;
}

function store(key: string, value: unknown) {
  cache.set(key, { at: Date.now(), value });
}

/**
 * Once Twelve Data reports the daily credit quota exhausted, every further
 * request today will fail the same way — so stop sending them. Without this,
 * a six-pair watchlist keeps re-attempting three requests per symbol on every
 * refresh, timing out slowly against an account that cannot possibly succeed
 * again before the quota resets at UTC midnight.
 */
let quotaExhaustedUntil: number | null = null;

function nextUtcMidnight(from: number): number {
  const d = new Date(from);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

function isQuotaExhausted(now: number): boolean {
  if (quotaExhaustedUntil === null) return false;
  if (now >= quotaExhaustedUntil) {
    quotaExhaustedUntil = null;
    return false;
  }
  return true;
}

const REQUEST_TIMEOUT_MS = 15_000;

class TwelveDataQuotaError extends Error {}
class TwelveDataBudgetError extends Error {}

/**
 * Paces our own outgoing requests against the free-tier per-minute credit
 * limit, so a watchlist scan cannot burst past it and draw a 429 that a
 * moment's spacing would have avoided.
 *
 * This is in-memory and per-process: on Vercel's serverless model a cold
 * start resets it, same limitation the response cache and quota-exhaustion
 * flag above already have. It still helps within a warm instance, which is
 * where most of a session's requests land.
 */
const requestTimestamps: number[] = [];

function creditsPerMinute(): number {
  const raw = Number(process.env["TWELVEDATA_CREDITS_PER_MIN"]);
  return Number.isFinite(raw) && raw > 0 ? raw : 8;
}

function withinBudget(now: number): boolean {
  const windowStart = now - 60_000;
  while (requestTimestamps.length > 0 && requestTimestamps[0]! < windowStart) {
    requestTimestamps.shift();
  }
  return requestTimestamps.length < creditsPerMinute();
}

function recordRequest(now: number): void {
  requestTimestamps.push(now);
}

async function getJson(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(`request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw error;
  }
  if (res.status === 429) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    const message = body?.message ?? "rate limited";
    if (/run out of api credits for the day/i.test(message)) {
      quotaExhaustedUntil = nextUtcMidnight(Date.now());
      throw new TwelveDataQuotaError(message);
    }
    throw new Error(`HTTP 429: ${message}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as unknown;
}

interface TdBar {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
}

/**
 * Parses the provider response into candles and normalises them.
 *
 * The request explicitly asks for `&timezone=UTC` (see loadBase), which is
 * what makes appending "Z" to the returned datetime correct — without that
 * parameter, TwelveData returns times in the exchange's local timezone, and
 * appending "Z" would silently mislabel them as UTC when they are not.
 *
 * `expectedGapMs` is the base series' own bar spacing, used only to size the
 * gap-detection tolerance — it is unrelated to the target timeframe a caller
 * may later roll these bars up into.
 */
function parseBars(raw: unknown, digits: number, expectedGapMs: number): Candle[] {
  const values = (raw as { values?: TdBar[] } | null)?.values;
  if (!Array.isArray(values)) return [];
  const candles = values
    .map((v) => {
      const t = Date.parse(
        v.datetime.includes(" ") ? `${v.datetime.replace(" ", "T")}Z` : `${v.datetime}T00:00:00Z`,
      );
      return {
        t,
        o: Number(Number(v.open).toFixed(digits)),
        h: Number(Number(v.high).toFixed(digits)),
        l: Number(Number(v.low).toFixed(digits)),
        c: Number(Number(v.close).toFixed(digits)),
      };
    })
    .filter((c) => Number.isFinite(c.t) && Number.isFinite(c.c));
  // Weekend and holiday closures are expected and far exceed any bar's normal
  // spacing; normalizeCandles only needs to catch duplicates, disorder and
  // OHLC faults here; gap classification happens where display context exists.
  return normalizeCandles(candles, expectedGapMs).candles;
}

// aggregate() now lives in ./data/aggregate.ts, shared with the backtester so
// live and replayed candles bucket identically.

/**
 * One provider request per symbol, rolled up into every requested timeframe.
 * Free TwelveData plans allow only a handful of requests per minute, so we
 * never fire one call per timeframe.
 */
/**
 * Just enough bars to roll each base up into its largest timeframe.
 *
 * The M5 base must cover enough history for H4, its largest derived
 * timeframe, to clear Stochastic(25,2,4)'s 60-bar minimum
 * (config/timeframes.ts). 1500 5-minute bars is only ~5 days — about 31 H4
 * candles — which is structurally short of 60 no matter how healthy the API
 * connection is: H4 would read DATA_MISSING on every single run. 4000 bars is
 * ~14 days, giving H4 roughly 83 candles. Outputsize does not cost extra
 * Twelve Data credits — the request itself is metered, not its size — so
 * this is free to raise.
 */
const BASE_SIZE: Partial<Record<Timeframe, number>> = { M1: 400, M5: 4000, D1: 1200 };
/**
 * How long a base series stays fresh.
 *
 * A 6-symbol watchlist needs 18 requests to fully refresh (3 bases per
 * symbol) but Twelve Data's free tier allows 8/minute — a cold cache cannot
 * fill in one burst regardless of pacing. Longer TTLs reduce how often that
 * burst has to happen at all: M1 and M5 still refresh well inside the
 * staleness limit their derived timeframes actually enforce
 * (config/timeframes.ts: M1 stale at 5min, M5 at 20min, M15 at 60min), so
 * this trades a little freshness on the fastest timeframes for the watchlist
 * actually finishing a refresh cycle.
 */
const BASE_TTL: Partial<Record<Timeframe, number>> = {
  M1: 90_000,
  M5: 270_000,
  D1: 3_600_000,
};

/** Errors worth a couple of retries: transient network/server faults, not data or quota problems. */
function isRetryable(error: unknown): boolean {
  if (error instanceof TwelveDataQuotaError || error instanceof TwelveDataBudgetError) return false;
  if (!(error instanceof Error)) return false;
  return (
    /timed out/i.test(error.message) ||
    /^HTTP 5\d\d/.test(error.message) ||
    /fetch failed|network|ECONNRESET|ETIMEDOUT/i.test(error.message)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_RETRIES = 2;

/**
 * How old a stale-cache fallback may be before it is refused outright rather
 * than served silently. Without a bound, a quota/budget exhaustion could
 * serve candles hours old while the rest of the pipeline treats them as a
 * normal fetch — "Never serve cached data after a failure without marking it
 * stale" (CLAUDE.md).
 *
 * This is deliberately a much LOOSER bound than what actually gates a READY
 * signal — it only answers "is there anything at all worth displaying when
 * the provider can't be reached," never "is this fresh enough to trade on."
 * The tight, per-timeframe readiness bound already exists independently in
 * config/timeframes.ts's `staleAfterMinutes` (M1: 5min, M5: 20min, D1: 3
 * days, ...), enforced by `freshness()` in domain/clock.ts against the
 * CANDLE'S OWN timestamp — not by anything here, and not affected by whether
 * that candle came from a fresh fetch or this fallback. A candle can pass
 * this loose display bound and still be correctly rejected as DATA_STALE by
 * that tighter, trade-readiness-relevant check moments later. See
 * evaluate.test.ts's "stale M1/M5 data cannot produce READY" tests.
 */
const STALE_FALLBACK_MAX_AGE_MS: Partial<Record<Timeframe, number>> = {
  M1: 30 * 60_000,
  M5: 60 * 60_000,
  D1: 24 * 60 * 60_000,
};

interface BaseResult {
  candles: Candle[];
  /** True when these candles came from a bounded stale-cache fallback rather than a fresh provider pull. */
  stale: boolean;
}

function boundedStaleFallback(
  cacheKey: string,
  interval: Timeframe,
  now: number,
): Candle[] | undefined {
  const hit = cache.get(cacheKey);
  const value = hit?.value as Candle[] | undefined;
  if (!value?.length) return undefined;
  const maxAge = STALE_FALLBACK_MAX_AGE_MS[interval] ?? 60 * 60_000;
  if (now - hit!.at > maxAge) return undefined;
  return value;
}

async function loadBase(symbol: string, interval: Timeframe, key: string): Promise<BaseResult> {
  const cacheKey = `td:base:${symbol}:${interval}`;
  const hit = cached<Candle[]>(cacheKey, BASE_TTL[interval] ?? 60_000);
  if (hit && hit.length) return { candles: hit, stale: false };

  if (isQuotaExhausted(Date.now())) {
    const stale = boundedStaleFallback(cacheKey, interval, Date.now());
    if (stale?.length) return { candles: stale, stale: true };
    throw new TwelveDataQuotaError(
      "daily credit quota exhausted — skipping request until UTC midnight",
    );
  }

  const spec = specFor(symbol);
  const url =
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSymbol(symbol))}` +
    `&interval=${TD_INTERVAL[interval]}&outputsize=${BASE_SIZE[interval] ?? 1500}` +
    `&timezone=UTC&format=JSON&apikey=${encodeURIComponent(key)}`;

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Re-checked on every attempt, including retries — checking only once
    // before the loop let a retry record a request without ever confirming
    // budget remained, which could push the real outgoing count past the
    // configured per-minute limit exactly during provider instability.
    if (!withinBudget(Date.now())) {
      const stale = boundedStaleFallback(cacheKey, interval, Date.now());
      if (stale?.length) return { candles: stale, stale: true };
      throw new TwelveDataBudgetError(
        `local request budget (${creditsPerMinute()}/min) reached — skipping this cycle`,
      );
    }
    try {
      recordRequest(Date.now());
      const raw = await getJson(url);
      const status = (raw as { status?: string; message?: string }).status;
      if (status === "error")
        throw new Error((raw as { message?: string }).message ?? "provider error");
      const candles = parseBars(raw, spec.digits, TF_MINUTES[interval] * 60_000);
      if (candles.length < 30) throw new Error("not enough history returned");
      store(cacheKey, candles);
      return { candles, stale: false };
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === MAX_RETRIES) break;
      // Exponential backoff with jitter: 300ms, then 900ms, roughly.
      await sleep(300 * 3 ** attempt + Math.random() * 200);
    }
  }

  // Rate limits and outages must not wipe out prices we already fetched —
  // but only within the bounded fallback window above.
  const stale = boundedStaleFallback(cacheKey, interval, Date.now());
  if (stale?.length) return { candles: stale, stale: true };
  throw lastError;
}

/** Candles per timeframe. Falls back to labelled sample data per timeframe. */
export async function loadSeries(symbol: string, timeframes: Timeframe[]): Promise<SeriesResult> {
  const spec = specFor(symbol);
  const key = apiKey();
  const series: Partial<Record<Timeframe, Candle[]>> = {};
  const notes: string[] = [];
  let realCount = 0;

  if (key) {
    // At most three provider requests per symbol cover all nine timeframes:
    // M1 for the trigger, M5 for M5–H4, and D1 for D1–MN.
    const needed = new Set<Timeframe>(timeframes.map(baseFor));
    const bases: Partial<Record<Timeframe, Candle[]>> = {};
    const staleBases = new Set<Timeframe>();

    await Promise.all(
      [...needed].map(async (base) => {
        try {
          const result = await loadBase(symbol, base, key);
          bases[base] = result.candles;
          if (result.stale) staleBases.add(base);
        } catch (error) {
          notes.push(`${base} candles unavailable (${(error as Error).message}).`);
        }
      }),
    );

    for (const tf of timeframes) {
      const base = baseFor(tf);
      const source = bases[base];
      if (!source?.length) continue;
      const rolled = tf === base ? source : aggregate(source, tf);
      // Matches the engine's own per-timeframe minimum (config/timeframes.ts)
      // rather than a separate hardcoded threshold. A mismatch here used to
      // mean this gate could mark a series "real" with, say, 45 H4 candles,
      // while the engine's own Stochastic(25,2,4) warm-up (60 bars) rejected
      // it as DATA_MISSING anyway — two different opinions about the same
      // data, with no way for the UI to tell which one to trust.
      if (rolled.length < timeframeDef(tf).minBars) {
        notes.push(
          `${tf}: only ${rolled.length} of the required ${timeframeDef(tf).minBars} candles available.`,
        );
        continue;
      }
      series[tf] = rolled.slice(-320);
      if (staleBases.has(base)) {
        // Bounded stale-cache fallback (quota/budget exhaustion) — real
        // candles, but not a fresh pull, so this must not count toward
        // `realCount`/`real` the way a genuine fetch would.
        notes.push(`${tf}: served from a cached fallback (provider quota/budget exhausted).`);
      } else {
        realCount += 1;
      }
    }
  }

  const syntheticTimeframes = new Set<Timeframe>();
  const missingTimeframes: Timeframe[] = [];
  const allowDemo = demoDataAllowed();
  for (const tf of timeframes) {
    if (series[tf]) continue;
    if (allowDemo) {
      series[tf] = demoCandles(symbol, tf);
      syntheticTimeframes.add(tf);
    } else {
      missingTimeframes.push(tf);
    }
  }

  const real = realCount === timeframes.length && realCount > 0;
  if (!key)
    notes.unshift(
      allowDemo
        ? "No TwelveData key configured — candles are sample data, not real prices."
        : "No TwelveData key configured — no candles are available.",
    );
  else if (!real && syntheticTimeframes.size > 0)
    notes.unshift("Some timeframes fell back to sample data — do not trade those readings.");
  if (missingTimeframes.length > 0) {
    notes.unshift(
      `${missingTimeframes.join(", ")}: no verified data available. Sample data is disabled ` +
        `(set ALLOW_DEMO_DATA=true outside production to review the interface without a key).`,
    );
  }

  return {
    symbol: spec.symbol,
    series,
    provider: real
      ? "TwelveData"
      : key
        ? syntheticTimeframes.size > 0
          ? "TwelveData + sample fallback"
          : "TwelveData (partial)"
        : allowDemo
          ? "Sample dataset (synthetic)"
          : "No provider configured",
    real,
    notes,
    syntheticTimeframes,
  };
}

/**
 * Latest price taken from the last real candle. Reuses the cached candle
 * request, so a whole watchlist costs one provider call per symbol.
 */
async function twelveDataQuote(symbol: string, key: string): Promise<Quote | null> {
  const { candles, stale } = await loadBase(symbol, "M1", key);
  const last = candles[candles.length - 1];
  if (!last) return null;
  const spec = specFor(symbol);
  const close = last.c;
  const spread = (spec.typicalSpreadPips ?? 1) * spec.pipSize;
  return {
    symbol: spec.symbol,
    bid: Number((close - spread / 2).toFixed(spec.digits)),
    ask: Number((close + spread / 2).toFixed(spec.digits)),
    mid: Number(close.toFixed(spec.digits)),
    spread: Number(spread.toFixed(spec.digits + 1)),
    timestamp: last.t + TF_MINUTES.M1 * 60_000,
    provider: "TwelveData",
    kind: stale ? "stale" : "delayed",
    quality: stale ? 50 : 85,
    note: stale
      ? "Cached fallback price (provider quota/budget exhausted) — may be older than usual. Bid/ask are estimated from a typical spread, not your broker's book."
      : "Real market price from TwelveData (last completed 1-minute candle). Bid/ask are estimated from a typical spread, not your broker's book.",
  };
}

async function frankfurterQuote(symbol: string): Promise<Quote | null> {
  const s = symbol.toUpperCase();
  if (s.length !== 6) return null;
  const base = s.slice(0, 3);
  const quote = s.slice(3);
  if (base === "XAU" || quote === "XAU") return null;
  const raw = (await getJson(
    `https://api.frankfurter.dev/v1/latest?base=${base}&symbols=${quote}`,
  )) as { rates?: Record<string, number>; date?: string };
  const rate = raw.rates?.[quote];
  if (!Number.isFinite(rate)) return null;
  const spec = specFor(s);
  const spread = (spec.typicalSpreadPips ?? 1) * spec.pipSize;
  const timestamp = raw.date ? Date.parse(`${raw.date}T16:00:00Z`) : Date.now();
  return {
    symbol: spec.symbol,
    bid: Number((rate! - spread / 2).toFixed(spec.digits)),
    ask: Number((rate! + spread / 2).toFixed(spec.digits)),
    mid: Number(rate!.toFixed(spec.digits)),
    spread: Number(spread.toFixed(spec.digits + 1)),
    timestamp,
    provider: "Frankfurter (ECB daily reference)",
    kind: "delayed",
    quality: 45,
    note: "Free daily reference rate — a real price, but end-of-day. Not suitable for execution.",
  };
}

export interface QuotesResult {
  quotes: Quote[];
  real: boolean;
  notes: string[];
}

/**
 * Cached per symbol, not per requested batch.
 *
 * The previous cache key joined the whole requested symbol list, so any
 * change to the watchlist — reordering it, adding one pair, viewing a single
 * chart instead of the full list — was a total cache miss even for symbols
 * fetched moments ago, and a single cached symbol in one batch was never
 * reusable from another. Worse, the old short-circuit skipped the TwelveData
 * fetch for the *entire* batch the moment `found` was non-empty from cache,
 * so one cache hit could suppress fresh data for every other symbol in the
 * same call.
 */
export async function loadQuotes(symbols: string[]): Promise<QuotesResult> {
  const wanted = symbols.map((s) => s.toUpperCase());
  const notes: string[] = [];
  const found: Record<string, Quote> = {};

  for (const symbol of wanted) {
    const hit = cached<Quote>(`quote:${symbol}`, 30_000);
    if (hit) found[symbol] = hit;
  }

  const key = apiKey();
  const needsFetch = wanted.filter((s) => !found[s]);
  if (key && needsFetch.length > 0) {
    const results = await Promise.all(
      needsFetch.map(async (symbol) => {
        try {
          return await twelveDataQuote(symbol, key);
        } catch (error) {
          notes.push(`${symbol}: real price unavailable (${(error as Error).message}).`);
          return null;
        }
      }),
    );
    for (const quote of results) {
      if (quote) {
        found[quote.symbol] = quote;
        store(`quote:${quote.symbol}`, quote);
      }
    }
  }
  if (!key)
    notes.push(
      "No TwelveData key configured — using the free daily reference source where possible.",
    );

  for (const symbol of wanted) {
    if (found[symbol]) continue;
    try {
      const fallback = await frankfurterQuote(symbol);
      if (fallback) {
        found[symbol] = fallback;
        store(`quote:${symbol}`, fallback);
      }
    } catch {
      // fall through to sample data
    }
  }

  // A quote is a single scalar used to anchor "current price" for display and
  // for zone calculations — unlike the candle series, it never by itself
  // produces a directional state, so it stays a labelled last-resort estimate
  // here rather than an absent value. The engine's synthetic-data protection
  // is keyed on syntheticTimeframes from loadSeries, which does hard-gate.
  const quotes = wanted.map((symbol) => {
    const real = found[symbol];
    if (real) return real;
    notes.push(`${symbol}: no real price available — showing sample data.`);
    return demoQuote(symbol, demoCandles(symbol, "M15"));
  });

  return { quotes, real: quotes.every((q) => q.kind !== "demo"), notes };
}
