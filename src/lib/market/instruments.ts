import type { InstrumentSpec } from "./types";

export const INSTRUMENTS: Record<string, InstrumentSpec> = {
  XAUUSD: {
    symbol: "XAUUSD",
    label: "Gold / US Dollar",
    digits: 2,
    pipSize: 0.1,
    contractSize: 100,
    pipValuePerLot: 10,
    typicalSpreadPips: 3,
    supported: true,
  },
  EURJPY: {
    symbol: "EURJPY",
    label: "Euro / Japanese Yen",
    digits: 3,
    pipSize: 0.01,
    contractSize: 100000,
    pipValuePerLot: null,
    typicalSpreadPips: 1.6,
    supported: true,
  },
  USDJPY: {
    symbol: "USDJPY",
    label: "US Dollar / Japanese Yen",
    digits: 3,
    pipSize: 0.01,
    contractSize: 100000,
    pipValuePerLot: null,
    typicalSpreadPips: 1.2,
    supported: true,
  },
  EURUSD: {
    symbol: "EURUSD",
    label: "Euro / US Dollar",
    digits: 5,
    pipSize: 0.0001,
    contractSize: 100000,
    pipValuePerLot: 10,
    typicalSpreadPips: 1,
    supported: true,
  },
  GBPUSD: {
    symbol: "GBPUSD",
    label: "British Pound / US Dollar",
    digits: 5,
    pipSize: 0.0001,
    contractSize: 100000,
    pipValuePerLot: 10,
    typicalSpreadPips: 1.3,
    supported: true,
  },
  AUDUSD: {
    symbol: "AUDUSD",
    label: "Australian Dollar / US Dollar",
    digits: 5,
    pipSize: 0.0001,
    contractSize: 100000,
    pipValuePerLot: 10,
    typicalSpreadPips: 1.2,
    supported: true,
  },
};

export const DEFAULT_WATCHLIST = ["XAUUSD", "EURJPY", "USDJPY", "EURUSD", "GBPUSD", "AUDUSD"];

export function specFor(symbol: string): InstrumentSpec {
  const known = INSTRUMENTS[symbol.toUpperCase()];
  if (known) return known;
  return {
    symbol: symbol.toUpperCase(),
    label: symbol.toUpperCase(),
    digits: 5,
    pipSize: 0.0001,
    contractSize: null,
    pipValuePerLot: null,
    typicalSpreadPips: null,
    supported: false,
  };
}

export function fmtPrice(value: number | null | undefined, symbol: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(specFor(symbol).digits);
}

export function toPips(priceDistance: number, symbol: string): number {
  return priceDistance / specFor(symbol).pipSize;
}
