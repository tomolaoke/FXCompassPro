# Strategy rules

Every rule here is written as an explicit, testable definition. Loose trading
language is not a specification — if a rule cannot be stated precisely enough to
unit-test, it does not belong in the engine.

All parameters live in [`src/lib/market/config/strategy.ts`](../src/lib/market/config/strategy.ts)
and are content-hashed into a `strategyVersion` stored with every signal, so any
past signal can be reproduced exactly.

---

## Structure of a decision

```
Momentum (Stochastic 25,2,4)   → primary direction gate. No gate, no direction.
  └─ Location                  → must confirm. A stretched oscillator in open
                                 space is not a setup.
      └─ Structure             → must confirm the turn.
          └─ Trend             → context filter. Caps score against the trend.
              └─ Volatility    → practicality filter. Blocks unworkable stops.
```

Each category has its own score cap, so several correlated readings of the same
impulse cannot stack into false confidence.

---

## Categories

### Momentum — primary gate

**Stochastic Oscillator, K 25, slowing 2, D 4**, levels 20 / 30 / 70 / 80.

```
rawK[i]  = (close[i] − min(low, 25)) / (max(high, 25) − min(low, 25)) × 100
           range == 0 → 50
slowK[i] = mean(rawK[i−1 .. i])            (slowing = 2)
D[i]     = mean(slowK[i−3 .. i])           (dPeriod = 4)
```

Valid from bar 25 + 2 + 4 − 2 = **29**. Before that: `DATA_MISSING`.

| Reading | Direction |
| --- | --- |
| K crosses up through 20 or 30 | `BULLISH` |
| K crosses down through 70 or 80 | `BEARISH` |
| K ≤ 30, turning up | `BULLISH` (weaker) |
| K ≥ 70, turning down | `BEARISH` (weaker) |
| K ≤ 20 or ≥ 80, not turning | `NEUTRAL` — extreme readings persist in trends |
| Otherwise | `NEUTRAL` |

**Repaints:** yes, intrabar. Computed on the last *closed* candle for confirmed
signals; using the open candle produces `CANDLE_OPEN` and a provisional signal.

**Known failure:** Stochastic stays overbought throughout an uptrend and oversold
throughout a downtrend. A stretched reading is not a reversal. This is stated on
every signal.

---

### Location — must confirm

Price must be near a mapped level, within `atr × locationToleranceAtr`
(default 1.5).

| Level | Definition | Lookback |
| --- | --- | --- |
| Previous day high/low | Extremes of the last completed broker session | 2 sessions |
| Previous week high/low | Extremes of the last completed broker week | 2 weeks |
| Previous month high/low | Extremes of the last completed month | 2 months |
| Support | Confirmed swing lows below current price | 3-bar fractal, nearest 3 |
| Resistance | Confirmed swing highs above current price | 3-bar fractal, nearest 3 |
| Equal highs/lows | ≥ 2 swings of the same type within `atr × 0.35` | 40 bars |

**Swing definition:** a fractal pivot with `lookback` bars on each side strictly
lower (for a high) or higher (for a low). A swing needs `lookback` bars *after*
it to confirm, so the most recent bars cannot form swings. **Does not repaint
once confirmed.**

Levels are computed from the timeframe's own series, not from the execution
series. *(The original implementation derived previous-week levels from ~3 days
of M15 data, which produced wrong or null values.)*

**No location → no permission.** The setup is reported as lacking a location
edge.

---

### Structure — must confirm the turn

| Rule | Definition | Repaints |
| --- | --- | --- |
| **Liquidity sweep** | Price trades through a confirmed prior swing then closes back inside it within 6 bars. Sell-side = a prior low taken (fuel for buys). | Until the bar closes |
| **Break of structure (BOS)** | A closed candle closes beyond the most recent confirmed swing in the direction of the existing trend | No, once closed |
| **Change of character (CHoCH)** | The first BOS *against* the prevailing swing sequence | No, once closed |
| **Displacement** | `abs(close − open) ≥ atr(14) × 1.5` | No, once closed |
| **Fair value gap** | Three-candle imbalance: `low[i] > high[i−2]` (bullish) or `high[i] < low[i−2]` (bearish) | No |
| **Order block** | Last opposing candle immediately before a displacement move. **An approximation of a discretionary concept, not institutional fact.** | No |

**Invalidation:** an FVG is invalidated when price fully closes through it; an
order block when price closes beyond its far edge; a sweep when the swept level
is reclosed beyond.

**Correlation grouping.** Sweep, CHoCH, displacement, FVG and order block are
usually five descriptions of *one* impulse. They are scored as a single
correlated group with one cap, not as five independent confirmations. *(The
original scoring awarded up to 41 points for a single move.)*

---

### Trend — context filter

| Rule | Definition |
| --- | --- |
| MA slope | EMA(50) direction over the last 10 bars |
| Swing sequence | Higher highs + higher lows = up; lower highs + lower lows = down |

Trend does not create direction. It caps the score when the setup opposes it and
feeds the higher-timeframe bias.

---

### Volatility — practicality filter

| Rule | Definition |
| --- | --- |
| ATR | Wilder's ATR(14). *(The original used a simple mean of true range, which differs from every charting platform. The deviation is now removed; `atrSimple` is retained separately for comparison.)* |
| Volatility regime | Current ATR vs its own 50-bar mean: `LOW` < 0.7×, `NORMAL`, `HIGH` > 1.5× |
| Spread condition | Live or typical spread against `maxSpreadPips` |

A stop narrower than `minStopAtr × atr` or wider than `maxStopAtr × atr` blocks
permission — the trade is not practical regardless of how good it looks.

---

## Timeframe reading

For each configured timeframe, on the last **closed** candle:

1. Insufficient bars → `DATA_MISSING`.
2. Synthetic series → `DATA_MISSING`. Sample data never votes.
3. Age > `staleAfter` for that timeframe → `DATA_STALE`.
4. Provider reports delayed → `DATA_DELAYED`.
5. Latest candle unclosed and no closed candle usable → `CANDLE_OPEN`.
6. Momentum gate resolves → `BULLISH` / `BEARISH`.
7. Gate resolves but confirmation layers contradict → `INCONCLUSIVE`.
8. Otherwise → `NEUTRAL`.

Timeframes excluded by the active config are `NOT_CONFIGURED` and are never
evaluated. That state is set only by the config reader.

## Aggregation

**Short-term direction** from M5, M15, M30, H1. **Higher-timeframe bias** from
H4, D1, W1, MN. Computed separately, never merged into one vote.

Within each group, timeframes derived from the same base series (M5/M15/M30 from
`5min`; H1/H4 from `1h`; D1/W1/MN from `1day`) are **not treated as independent
evidence**; agreement within a base group counts once plus a diminishing
increment. *(The original counted five correlated timeframes as five independent
votes, which let M15+M30+H1 outvote D1+H4 and produce a plain BUY against the
higher timeframes.)*

## Scoring

A **heuristic setup-quality score**, not a probability. Never labelled as a win
rate or confidence percentage.

| Component | Cap |
| --- | --- |
| Momentum agreement | 25 |
| Location quality | 20 |
| Structure confirmation (correlated group) | 20 |
| Trend agreement | 15 |
| Volatility / practicality | 10 |
| Multi-timeframe agreement (independence-adjusted) | 10 |

Then:

- **Minimum data requirement** — below the configured minimum of valid
  timeframes, no score is produced at all.
- **Conflict penalty** — scaled by which timeframes conflict; H4 and D1 weigh
  more than W1 and MN.
- **Data-quality penalty or block** — any `DATA_*` state blocks confirmation
  outright rather than merely reducing the score.
- **Maximum-confidence cap under conflict** — with any higher-timeframe
  conflict the score is capped at `conflictScoreCap` (default 60), so a
  conflicted setup can never display as high quality.
- **Single-category cap** — no more than `maxSingleCategoryShare` (default 40%)
  of the total may come from one category.

Every point added or removed is recorded with its reason in the audit trail and
shown in the "Why this signal?" panel.

---

## Entry, stop and target

**Entry** — a validated FVG or order block aligned with the direction and
reachable from current price, otherwise a zone around current price. A zone the
wrong side of price, or more than `2 × atr` away, is rejected.

**Stop** — beyond the invalidation point (swept level, or the structural extreme
of the last `structureLookback` bars) plus `stopBufferAtr × atr`, floored at
`minStopAtr × atr`.

**Invalidation** — the price at which the idea is wrong. **If it cannot be
calculated, no BUY or SELL is issued.**

**Targets** — opposing liquidity, support/resistance, or previous session
extremes, floored at 1.5R / 2.5R / 4R and forced monotonic.

**Risk-to-reward** — recalculated from the exact displayed entry and stop, never
from an intermediate value. **If it cannot be calculated, no BUY or SELL is
issued.**

Validation before display: stop on the correct side of entry · targets ordered
correctly for the direction · all R:R values computable · stop distance within
bounds. A failure produces a `DATA QUALITY ERROR`, not a quietly adjusted number.

---

## Look-ahead and repainting

- Confirmed signals use only data at or before `closedThrough`.
- Backtests replay candle by candle and can only see bars up to the current
  index; a deliberately cheating strategy is included in the test suite and the
  guard must catch it.
- Every module declares whether it repaints. Repainting modules cannot produce a
  confirmed signal from an open candle.
- On candle close, affected timeframes are recalculated and the signal
  transitions from `DRAFT` to `CONFIRMED`, or disappears.
