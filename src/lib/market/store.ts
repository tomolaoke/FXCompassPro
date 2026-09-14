import { useCallback, useEffect, useState } from "react";
import { DEFAULT_WATCHLIST } from "./instruments";
import type {
  AppSettings,
  JournalEntry,
  Quote,
  SignalRecord,
  Timeframe,
} from "./types";

export const DEFAULT_SETTINGS: AppSettings = {
  risk: {
    accountCapital: 1000,
    accountCurrency: "USD",
    riskPercent: 1,
    maxDailyLossPercent: 2,
    maxOpenTrades: 1,
    maxCorrelatedExposure: 1,
    allowStacking: false,
    allowPartials: true,
    leverage: 500,
    minLot: 0.01,
    lotStep: 0.01,
    maxLot: 10,
    maxSpreadPips: 4,
    maxDataAgeMinutes: 20,
  },
  watchlist: DEFAULT_WATCHLIST,
  confirmationTimeframes: ["D1", "H4", "H1", "M30", "M15"] as Timeframe[],
  executionTimeframe: "M15",
  language: "en",
  advancedView: false,
  provider: "demo",
};

const KEYS = {
  settings: "cm.settings.v1",
  journal: "cm.journal.v1",
  records: "cm.records.v1",
  quotes: "cm.manualQuotes.v1",
};

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as object) } as T;
  } catch {
    return fallback;
  }
}

function readArray<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function write(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent("cm-store", { detail: key }));
}

/**
 * Server and first client render always use `initial`, so the HTML matches.
 * Stored values are applied after hydration.
 */
function useStoreValue<T>(
  key: string,
  loader: () => T,
  initial: T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    setValue(loader());
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail === key) setValue(loader());
    };
    window.addEventListener("cm-store", onChange);
    return () => window.removeEventListener("cm-store", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback(
    (next: T) => {
      setValue(next);
      write(key, next);
    },
    [key],
  );

  return [value, set];
}

export function useSettings() {
  const [settings, setSettings] = useStoreValue<AppSettings>(
    KEYS.settings,
    () => read(KEYS.settings, DEFAULT_SETTINGS),
    DEFAULT_SETTINGS,
  );
  const update = useCallback(
    (patch: Partial<AppSettings>) => setSettings({ ...settings, ...patch }),
    [settings, setSettings],
  );
  const updateRisk = useCallback(
    (patch: Partial<AppSettings["risk"]>) =>
      setSettings({ ...settings, risk: { ...settings.risk, ...patch } }),
    [settings, setSettings],
  );
  return { settings, update, updateRisk, reset: () => setSettings(DEFAULT_SETTINGS) };
}

export function useJournal() {
  const [entries, setEntries] = useStoreValue<JournalEntry[]>(KEYS.journal, () =>
    readArray<JournalEntry>(KEYS.journal),
  );
  return {
    entries,
    add: (entry: JournalEntry) => setEntries([entry, ...entries]),
    update: (id: string, patch: Partial<JournalEntry>) =>
      setEntries(entries.map((e) => (e.id === id ? { ...e, ...patch } : e))),
    remove: (id: string) => setEntries(entries.filter((e) => e.id !== id)),
  };
}

export function useSignalRecords() {
  const [records, setRecords] = useStoreValue<SignalRecord[]>(KEYS.records, () =>
    readArray<SignalRecord>(KEYS.records),
  );
  return {
    records,
    add: (record: SignalRecord) => setRecords([record, ...records]),
    update: (id: string, patch: Partial<SignalRecord>) =>
      setRecords(records.map((r) => (r.id === id ? { ...r, ...patch } : r))),
    remove: (id: string) => setRecords(records.filter((r) => r.id !== id)),
    clear: () => setRecords([]),
  };
}

export function useManualQuotes() {
  const [quotes, setQuotes] = useStoreValue<Record<string, Quote>>(KEYS.quotes, () =>
    read<Record<string, Quote>>(KEYS.quotes, {}),
  );
  return {
    quotes,
    set: (quote: Quote) => setQuotes({ ...quotes, [quote.symbol]: quote }),
    clear: (symbol: string) => {
      const next = { ...quotes };
      delete next[symbol];
      setQuotes(next);
    },
  };
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
