/**
 * Compares a provider price against a manually entered broker price.
 *
 * Forex is decentralised — there is no single "true" price, and a provider's
 * aggregate can genuinely differ from what a specific broker quotes,
 * especially around news or thin liquidity. When a broker price is present it
 * is the source of truth for execution; the provider price becomes a
 * cross-check, and a large divergence is a reason to stop, not a rounding
 * error to average away.
 */

export interface BrokerQuoteInput {
  readonly bid: number;
  readonly ask: number;
  /** When the broker price was entered — used to judge its own freshness. */
  readonly enteredAt: number;
}

export interface BrokerComparison {
  readonly providerMid: number;
  readonly brokerBid: number;
  readonly brokerAsk: number;
  readonly brokerMid: number;
  readonly brokerSpread: number;
  readonly absoluteDifference: number;
  readonly differencePips: number;
  readonly toleranceExceeded: boolean;
  readonly brokerAgeMs: number;
}

export function compareBrokerPrice(
  providerMid: number,
  broker: BrokerQuoteInput,
  pipSize: number,
  toleranceInPips: number,
  now: number,
): BrokerComparison {
  const brokerMid = (broker.bid + broker.ask) / 2;
  const absoluteDifference = Math.abs(providerMid - brokerMid);
  const differencePips = absoluteDifference / pipSize;

  return {
    providerMid,
    brokerBid: broker.bid,
    brokerAsk: broker.ask,
    brokerMid,
    brokerSpread: broker.ask - broker.bid,
    absoluteDifference,
    differencePips,
    toleranceExceeded: differencePips > toleranceInPips,
    brokerAgeMs: now - broker.enteredAt,
  };
}

export const PRICE_MISMATCH_MESSAGE = "PRICE SOURCE MISMATCH — DO NOT TRADE UNTIL VERIFIED";
