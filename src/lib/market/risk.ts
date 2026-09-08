import { specFor } from "./instruments";
import type { RiskSettings } from "./types";

export interface RiskInput {
  symbol: string;
  entry: number;
  stopLoss: number;
  takeProfits: (number | null)[];
  settings: RiskSettings;
  /** override when the broker spec differs from the built-in defaults */
  pipValuePerLotOverride?: number | null;
  contractSizeOverride?: number | null;
}

export interface RiskResult {
  ok: boolean;
  blockedReason: string | null;
  riskAmount: number;
  stopDistance: number;
  stopPips: number;
  pipValuePerLot: number | null;
  suggestedLot: number | null;
  maxAffordableLot: number | null;
  expectedLossAtStop: number | null;
  targets: { price: number; rr: number; expectedGain: number | null }[];
  explanation: string[];
  warnings: string[];
}

export function roundToStep(value: number, step: number): number {
  const rounded = Math.floor(value / step) * step;
  return Number(rounded.toFixed(4));
}

export function calculateRisk(input: RiskInput): RiskResult {
  const spec = specFor(input.symbol);
  const s = input.settings;
  const riskAmount = (s.accountCapital * s.riskPercent) / 100;
  const stopDistance = Math.abs(input.entry - input.stopLoss);
  const stopPips = stopDistance / spec.pipSize;
  const pipValuePerLot = input.pipValuePerLotOverride ?? spec.pipValuePerLot;
  const warnings: string[] = [
    "1.0 lot on a small account can cause rapid loss. Aggressive trading does not remove the need for a stop-loss.",
  ];
  const explanation: string[] = [];

  if (stopDistance <= 0) {
    return {
      ok: false,
      blockedReason: "Stop-loss must be a different price from the entry.",
      riskAmount,
      stopDistance,
      stopPips,
      pipValuePerLot,
      suggestedLot: null,
      maxAffordableLot: null,
      expectedLossAtStop: null,
      targets: [],
      explanation,
      warnings,
    };
  }

  if (!pipValuePerLot || !(input.contractSizeOverride ?? spec.contractSize)) {
    return {
      ok: false,
      blockedReason:
        "Cannot safely calculate lot size until contract size and tick value are supplied.",
      riskAmount,
      stopDistance,
      stopPips,
      pipValuePerLot,
      suggestedLot: null,
      maxAffordableLot: null,
      expectedLossAtStop: null,
      targets: [],
      explanation,
      warnings,
    };
  }

  const rawLot = riskAmount / (stopPips * pipValuePerLot);
  const suggestedLot = Math.max(0, Math.min(roundToStep(rawLot, s.lotStep), s.maxLot));
  const maxAffordableLot = Math.min(s.maxLot, roundToStep(rawLot, s.lotStep));
  const expectedLossAtStop = suggestedLot * stopPips * pipValuePerLot;

  explanation.push(
    `Risk budget: ${s.accountCurrency} ${riskAmount.toFixed(2)} = ${s.riskPercent}% of ${s.accountCurrency} ${s.accountCapital.toFixed(2)}.`,
    `Stop distance: ${stopPips.toFixed(1)} pips (${stopDistance.toFixed(spec.digits)} in price).`,
    `Value per pip at 1.0 lot: ${s.accountCurrency} ${pipValuePerLot.toFixed(2)}.`,
    `Lot = risk ÷ (stop pips × pip value) = ${riskAmount.toFixed(2)} ÷ (${stopPips.toFixed(1)} × ${pipValuePerLot}) = ${rawLot.toFixed(3)}, rounded down to ${suggestedLot} by your ${s.lotStep} lot step.`,
  );

  if (suggestedLot < s.minLot) {
    warnings.push(
      `That is below your minimum lot of ${s.minLot}. Either widen the account, tighten the stop, or skip the trade — do not raise the risk percent to force a fill.`,
    );
  }

  const targets = input.takeProfits
    .filter((t): t is number => typeof t === "number" && Number.isFinite(t))
    .map((price) => {
      const rr = Math.abs(price - input.entry) / stopDistance;
      return {
        price,
        rr: Number(rr.toFixed(2)),
        expectedGain: Number(
          (suggestedLot * (Math.abs(price - input.entry) / spec.pipSize) * pipValuePerLot).toFixed(2),
        ),
      };
    });

  if (spec.typicalSpreadPips) {
    explanation.push(
      `Rough spread cost at ${suggestedLot} lots: ${s.accountCurrency} ${(spec.typicalSpreadPips * pipValuePerLot * suggestedLot).toFixed(2)} (typical spread only — your broker's live spread may differ).`,
    );
  }

  return {
    ok: suggestedLot >= s.minLot,
    blockedReason:
      suggestedLot >= s.minLot ? null : "Suggested size is below your broker's minimum lot.",
    riskAmount,
    stopDistance,
    stopPips,
    pipValuePerLot,
    suggestedLot,
    maxAffordableLot,
    expectedLossAtStop,
    targets,
    explanation,
    warnings,
  };
}
