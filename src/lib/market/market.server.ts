import { specFor } from "./instruments";
import { demoCandles, demoQuote } from "./demo";
import { normalizeCandles } from "./data/normalize";
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

/** UTC bucket start for a timestamp on a given timeframe. */
function bucketStart(t: number, tf: Timeframe): number {
  const d = new Date(t);
  if (tf === "MN") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  if (tf === "W1") {
    const day = (d.getUTCDay() + 6) % 7; // Monday-based
    const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return base - day * 86_400_000;
  }
  const ms = TF_MINUTES[tf] * 60_000;
  return Math.floor(t / ms) * ms;
}

/** Rolls smaller candles up into a larger timeframe. */
function aggregate(base: Candle[], tf: Timeframe): Candle[] {
  const out: Candle[] = [];
  let current: Candle | null = null;
  let currentKey = Number.NaN;
  for (const c of base) {
    const key = bucketStart(c.t, tf);
    if (!current || key !== currentKey) {
      if (current) out.push(current);
      current = { t: key, o: c.o, h: c.h, l: c.l, c: c.c };
      currentKey = key;
      continue;
    }
    current.h = Math.max(current.h, c.h);
    current.l = Math.min(current.l, c.l);
    current.c = c.c;
  }
  if (current) out.push(current);
  return out;
}

/**
 * One provider request per symbol, rolled up into every requested timeframe.
 * Free TwelveData plans allow only a handful of requests per minute, so we
 * never fire one call per timeframe.
 */
/** Just enough bars to roll each base up into its largest timeframe. */
const BASE_SIZE: Partial<Record<Timeframe, number>> = { M1: 400, M5: 1500, D1: 1200 };
/** How long a base series stays fresh; longer timeframes move slowly. */
const BASE_TTL: Partial<Record<Timeframe, number>> = {
  M1: 45_000,
  M5: 120_000,
  D1: 3_600_000,
};

async function loadBase(symbol: string, interval: Timeframe, key: string): Promise<Candle[]> {
  const cacheKey = `td:base:${symbol}:${interval}`;
  const hit = cached<Candle[]>(cacheKey, BASE_TTL[interval] ?? 60_000);
  if (hit && hit.length) return hit;

  if (isQuotaExhausted(Date.now())) {
    const stale = cache.get(cacheKey)?.value as Candle[] | undefined;
    if (stale?.length) return stale;
    throw new TwelveDataQuotaError(
      "daily credit quota exhausted — skipping request until UTC midnight",
    );
  }

  const spec = specFor(symbol);
  const url =
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSymbol(symbol))}` +
    `&interval=${TD_INTERVAL[interval]}&outputsize=${BASE_SIZE[interval] ?? 1500}` +
    `&timezone=UTC&format=JSON&apikey=${encodeURIComponent(key)}`;
  try {
    const raw = await getJson(url);
    const status = (raw as { status?: string; message?: string }).status;
    if (status === "error")
      throw new Error((raw as { message?: string }).message ?? "provider error");
    const candles = parseBars(raw, spec.digits, TF_MINUTES[interval] * 60_000);
    if (candles.length < 30) throw new Error("not enough history returned");
    store(cacheKey, candles);
    return candles;
  } catch (error) {
    // Rate limits and outages must not wipe out prices we already fetched.
    const stale = cache.get(cacheKey)?.value as Candle[] | undefined;
    if (stale?.length) return stale;
    throw error;
  }
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

    await Promise.all(
      [...needed].map(async (base) => {
        try {
          bases[base] = await loadBase(symbol, base, key);
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
      if (rolled.length < 30) {
        notes.push(`${tf}: not enough real history to read reliably.`);
        continue;
      }
      series[tf] = rolled.slice(-320);
      realCount += 1;
    }
  }

  const syntheticTimeframes = new Set<Timeframe>();
  for (const tf of timeframes) {
    if (!series[tf]) {
      series[tf] = demoCandles(symbol, tf);
      syntheticTimeframes.add(tf);
    }
  }

  const real = realCount === timeframes.length && realCount > 0;
  if (!key)
    notes.unshift("No TwelveData key configured — candles are sample data, not real prices.");
  else if (!real)
    notes.unshift("Some timeframes fell back to sample data — do not trade those readings.");

  return {
    symbol: spec.symbol,
    series,
    provider: real
      ? "TwelveData"
      : key
        ? "TwelveData + sample fallback"
        : "Sample dataset (synthetic)",
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
  const candles = await loadBase(symbol, "M1", key);
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
    kind: "delayed",
    quality: 85,
    note: "Real market price from TwelveData (last completed 1-minute candle). Bid/ask are estimated from a typical spread, not your broker's book.",
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

export async function loadQuotes(symbols: string[]): Promise<QuotesResult> {
  const wanted = symbols.map((s) => s.toUpperCase());
  const notes: string[] = [];
  const found: Record<string, Quote> = {};

  const cacheKey = `quotes:${wanted.join(",")}`;
  const hit = cached<Record<string, Quote>>(cacheKey, 30_000);
  if (hit) Object.assign(found, hit);

  const key = apiKey();
  if (!Object.keys(found).length && key) {
    const results = await Promise.all(
      wanted.map(async (symbol) => {
        try {
          return await twelveDataQuote(symbol, key);
        } catch (error) {
          notes.push(`${symbol}: real price unavailable (${(error as Error).message}).`);
          return null;
        }
      }),
    );
    for (const quote of results) if (quote) found[quote.symbol] = quote;
  }
  if (!key)
    notes.push(
      "No TwelveData key configured — using the free daily reference source where possible.",
    );

  for (const symbol of wanted) {
    if (found[symbol]) continue;
    try {
      const fallback = await frankfurterQuote(symbol);
      if (fallback) found[symbol] = fallback;
    } catch {
      // fall through to sample data
    }
  }

  if (Object.keys(found).length) store(cacheKey, found);

  const quotes = wanted.map((symbol) => {
    const real = found[symbol];
    if (real) return real;
    notes.push(`${symbol}: no real price available — showing sample data.`);
    return demoQuote(symbol, demoCandles(symbol, "M15"));
  });

  return { quotes, real: quotes.every((q) => q.kind !== "demo"), notes };
}
