# Risk management

The app does not only ask *which direction*. It asks *is this trade practical*,
and refuses to answer when it cannot.

## Defaults

Conservative, and fully configurable.

| Setting | Default |
| --- | --- |
| Risk per trade | **1%** of account capital |
| Maximum daily loss | **2%** |
| Maximum open trades | **1** |
| Maximum correlated exposure | **1** position per correlated group |
| Position stacking | **Disabled** |
| Maximum spread | 4 pips |
| Maximum data age | 20 minutes |
| Minimum stop distance | 0.5 × ATR |
| Maximum stop distance | 4 × ATR |

Account capital, currency, lot step, minimum and maximum lot, leverage and
slippage allowance are all user-set.

## Position sizing

```
riskAmount   = accountCapital × riskPercent / 100
stopDistance = |entry − stopLoss|
stopPips     = stopDistance / pipSize
lot          = riskAmount / (stopPips × pipValuePerLot)
```

The result is rounded **down** to the broker's lot step, then clamped to the
maximum lot. Rounding down is deliberate: rounding up would exceed the risk
budget you set.

Every step is shown in the **"Why this size?"** panel with real numbers, not
just the result.

### When sizing is refused

**No lot size is suggested when contract size, pip value or current price is
unavailable.** The app shows:

> Cannot safely calculate lot size until contract size and tick value are
> supplied.

This is not a fallback to a guess. JPY pairs are the common case — pip value for
`EURJPY` and `USDJPY` depends on the current USD/JPY rate and is not a constant,
so it is left `null` in the instrument table and must be supplied from your
broker's contract specification or derived from a live rate.

Sizing is also refused when:

- stop and entry are the same price
- the stop is on the wrong side of the entry
- the stop distance falls outside the configured minimum/maximum
- the resulting lot is below the broker's minimum lot

That last case produces an explicit instruction: widen the account, tighten the
stop, or skip the trade — **do not raise the risk percent to force a fill.**

## Costs

Included in every calculation where the data exists, and labelled as assumptions
where it does not:

| Cost | Source |
| --- | --- |
| Spread | Live broker spread if entered, otherwise the instrument's typical spread, marked as an estimate |
| Slippage | Configurable allowance, applied to entry and stop |
| Commission | Configurable per lot, where your account charges it |

Spread cost at the suggested size is shown alongside the lot size, because on a
small account it is often a meaningful share of the risk budget.

## Exposure limits

- **Maximum daily risk** — once the day's realised and open risk reaches
  `maxDailyLossPercent`, new signals are marked as exceeding the daily limit.
- **Maximum simultaneous risk** — total open risk across positions is tracked
  against `maxOpenTrades` and `maxCorrelatedExposure`.
- **Correlation** — EURUSD, GBPUSD and AUDUSD move together against the dollar;
  EURJPY and USDJPY share yen exposure; XAUUSD carries its own dollar
  sensitivity. Taking several at once is one larger bet, not several small ones,
  and the app says so.

## Warnings

A standing warning accompanies every sizing result:

> 1.0 lot on a small account can cause rapid loss. Aggressive trading does not
> remove the need for a stop-loss.

An oversized-position warning appears whenever the suggested size would risk more
than the configured percentage, when leverage would be near-fully used, or when
the position exceeds the correlated-exposure limit.

Leverage is displayed as **information only**. It is not used in sizing.
Available leverage is not a risk limit — your stop distance and risk percentage
are.

## What this does not do

- It does not place, modify or close orders.
- It does not know your actual account balance, open positions or margin. It
  knows what you tell it.
- It does not guarantee that a stop will fill at its price. Gaps and slippage are
  real, and around news they can be large.
