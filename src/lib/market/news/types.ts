export const IMPACT_LEVELS = ["HIGH", "MEDIUM", "LOW"] as const;
export type ImpactLevel = (typeof IMPACT_LEVELS)[number];

export interface NewsEvent {
  readonly id: string;
  /** ISO 4217 currency code the event affects, e.g. "USD". */
  readonly currency: string;
  readonly title: string;
  readonly impact: ImpactLevel;
  readonly eventTimeUtc: number;
  readonly source: "manual";
  readonly createdAt: number;
}

export type { NewsStatus } from "../domain/states";
