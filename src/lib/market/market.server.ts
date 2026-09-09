import { specFor } from "./instruments";
import { demoCandles, demoQuote } from "./demo";
import type { Candle, Quote, Timeframe } from "./types";

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
};

export interface SeriesResult {
  symbol: string;
  series: Partial<Record<Timeframe, Candle[]>>;
  provider: string;
  real: boolean;
  notes: string[];
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

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
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

function parseBars(raw: unknown, digits: number): Candle[] {
  const values = (raw as { values?: TdBar[] } | null)?.values;
  if (!Array.isArray(values)) return [];
  const candles = values
    .map((v) => {
      const t = Date.parse(v.datetime.includes(" ") ? `${v.datetime.replace(" ", "T")}Z` : `${v.datetime}T00:00:00Z`);
      return {
        t,
        o: Number(Number(v.open).toFixed(digits)),
        h: Number(Number(v.high).toFixed(digits)),
        l: Number(Number(v.low).toFixed(digits)),
        c: Number(Number(v.close).toFixed(digits)),
      };
    })
    .filter((c) => Number.isFinite(c.t) && Number.isFinite(c.c));
  return candles.sort((a, b) => a.t - b.t);
}

/** Candles per timeframe. Falls back to labelled sample data per timeframe. */
export async function loadSeries(
  symbol: string,
  timeframes: Timeframe[],
): Promise<SeriesResult> {
  const spec = specFor(symbol);
  const key = apiKey();
  const series: Partial<Record<Timeframe, Candle[]>> = {};
  const notes: string[] = [];
  let realCount = 0;

  for (const tf of timeframes) {
    const cacheKey = `td:${symbol}:${tf}`;
    const hit = cached<Candle[]>(cacheKey, 60_000);
    if (hit && hit.length) {
      series[tf] = hit;
      realCount += 1;
      continue;
    }
    if (!key) break;
    try {
      const url =
        `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSymbol(symbol))}` +
        `&interval=${TD_INTERVAL[tf]}&outputsize=220&format=JSON&apikey=${encodeURIComponent(key)}`;
      const raw = await getJson(url);
      const status = (raw as { status?: string; message?: string }).status;
      if (status === "error") throw new Error((raw as { message?: string }).message ?? "provider error");
      const candles = parseBars(raw, spec.digits);
      if (candles.length < 30) throw new Error("not enough history returned");
      series[tf] = candles;
      store(cacheKey, candles);
      realCount += 1;
    } catch (error) {
      notes.push(`${tf}: real candles unavailable (${(error as Error).message}).`);
    }
  }

  for (const tf of timeframes) {
    if (!series[tf]) series[tf] = demoCandles(symbol, tf);
  }

  const real = realCount === timeframes.length && realCount > 0;
  if (!key) notes.unshift("No TwelveData key configured — candles are sample data, not real prices.");
  else if (!real) notes.unshift("Some timeframes fell back to sample data — do not trade those readings.");

  return {
    symbol: spec.symbol,
    series,
    provider: real ? "TwelveData" : key ? "TwelveData + sample fallback" : "Sample dataset (synthetic)",
    real,
    notes,
  };
}

async function twelveDataQuotes(symbols: string[], key: string): Promise<Record<string, Quote>> {
  const list = symbols.map(tdSymbol).join(",");
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(list)}&format=JSON&apikey=${encodeURIComponent(key)}`;
  const raw = (await getJson(url)) as Record<string, unknown>;
  const single = typeof raw["symbol"] === "string";
  const out: Record<string, Quote> = {};
  for (const symbol of symbols) {
    const node = (single ? raw : (raw[tdSymbol(symbol)] as Record<string, unknown> | undefined)) ?? undefined;
    if (!node) continue;
    if ((node as { status?: string }).status === "error") continue;
    const close = Number((node as { close?: string }).close);
    if (!Number.isFinite(close)) continue;
    const spec = specFor(symbol);
    const tsRaw = Number((node as { timestamp?: number }).timestamp);
    const timestamp = Number.isFinite(tsRaw) ? tsRaw * 1000 : Date.now();
    const spread = (spec.typicalSpreadPips ?? 1) * spec.pipSize;
    out[spec.symbol] = {
      symbol: spec.symbol,
      bid: Number((close - spread / 2).toFixed(spec.digits)),
      ask: Number((close + spread / 2).toFixed(spec.digits)),
      mid: Number(close.toFixed(spec.digits)),
      spread: Number(spread.toFixed(spec.digits + 1)),
      timestamp,
      provider: "TwelveData",
      kind: "delayed",
      quality: 82,
      note: "Real market price from TwelveData. Bid/ask are estimated from a typical spread, not your broker's book.",
    };
  }
  return out;
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
    try {
      Object.assign(found, await twelveDataQuotes(wanted, key));
    } catch (error) {
      notes.push(`TwelveData spot prices unavailable (${(error as Error).message}).`);
    }
  }
  if (!key) notes.push("No TwelveData key configured — using the free daily reference source where possible.");

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
