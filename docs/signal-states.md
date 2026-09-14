# Signal states

Four separate layers, each with its own vocabulary. They are deliberately not
collapsed into one word, because collapsing them is what makes retail signal
tools misleading.

```
  timeframe state  →  short-term direction  ┐
                                            ├→  alignment  →  trade permission
  timeframe state  →  higher-timeframe bias ┘
```

---

## 1. Timeframe state

Every configured timeframe has exactly one. There is no blank or implicit state.

| State | Meaning | Can contribute to a direction? |
| --- | --- | --- |
| `BULLISH` | Rules resolved upward on closed data | Yes |
| `BEARISH` | Rules resolved downward on closed data | Yes |
| `NEUTRAL` | Rules resolved; no directional edge | No |
| `INCONCLUSIVE` | Rules ran but produced no clear reading | No |
| `DATA_MISSING` | No candles, or not enough history for the lookback | No — blocks confirmation |
| `DATA_STALE` | Candles older than this timeframe's freshness limit | No — blocks confirmation |
| `DATA_DELAYED` | Provider explicitly reports delayed data | No — blocks confirmation |
| `CANDLE_OPEN` | Latest candle has not closed | Provisional only |
| `NOT_CONFIGURED` | **Deliberately excluded by the active strategy config** | N/A |

### `NOT_CONFIGURED` is special

It means exactly one thing: *the strategy you have selected does not look at this
timeframe.* It is set only by the strategy-config reader, never by the analysis
engine.

It must **never** be used for a timeframe that:

- disagrees with the signal → that is a normal `BULLISH`/`BEARISH` state, and
  the disagreement surfaces in the **alignment** layer
- produced no clear reading → `INCONCLUSIVE`
- has no usable data → `DATA_MISSING` / `DATA_STALE` / `DATA_DELAYED`
- is still forming → `CANDLE_OPEN`

The phrase "not used" does not appear anywhere in this application. It was the
original defect: it made a disagreeing weekly chart look irrelevant.

### What is displayed alongside each state

Timeframe name · state · role (execution or context) · included in strategy
(yes/no) · latest candle timestamp · whether that candle is closed · data age ·
data provider · the exact conditions that produced the state · score
contribution · and, for `INCONCLUSIVE` or any `DATA_*` state, the specific
reason.

---

## 2. Short-term direction and higher-timeframe bias

Computed independently from two disjoint groups:

- **Short-term** — M5, M15, M30, H1
- **Higher-timeframe** — H4, D1, W1, MN

Each resolves to `BULLISH`, `BEARISH`, `NEUTRAL`, `INCONCLUSIVE`, or
`INSUFFICIENT_DATA`, with the per-timeframe breakdown always available.

They are never averaged together. A bullish short-term reading does not become
"less bullish" because the weekly disagrees — it stays bullish, and the conflict
is reported as a conflict.

---

## 3. Alignment

| Label | Condition |
| --- | --- |
| `FULLY ALIGNED BUY` | Short-term bullish and every configured context timeframe bullish |
| `FULLY ALIGNED SELL` | Short-term bearish and every configured context timeframe bearish |
| `SHORT-TERM BUY WITH HIGHER-TIMEFRAME CONFLICT` | Short-term bullish, at least one context timeframe bearish |
| `SHORT-TERM SELL WITH HIGHER-TIMEFRAME CONFLICT` | Short-term bearish, at least one context timeframe bullish |
| `NEUTRAL / NO CLEAR SETUP` | Nothing resolved directionally |
| `INSUFFICIENT DATA` | Too few valid timeframes to judge |
| `DATA QUALITY ERROR` | A data problem prevents any conclusion |

H4 and D1 conflicts are rendered more prominently than W1/MN conflicts. They are
the timeframes most likely to decide whether an intraday idea survives the
session, and a beginner is most likely to overlook them.

---

## 4. Trade permission

Alignment describes the market. Permission decides whether the app is willing to
present a tradeable idea.

| Mode | Rule |
| --- | --- |
| **`STRICT`** *(default)* | Permission only when alignment is `FULLY ALIGNED *`, no configured timeframe is `INCONCLUSIVE` or `DATA_*`, and nothing is provisional. Any conflict anywhere → `NO_TRADE`. |
| `TREND_FOLLOWING` | Permission requires agreement with the configured higher-timeframe filters (default H4 + D1). W1/MN conflict warns and caps the score instead of blocking. |
| `COUNTERTREND` | Off by default; must be explicitly enabled. Countertrend setups are permitted but carry a prominent high-risk warning. |
| `MANUAL` | Analysis is shown; permission is never issued. |

`STRICT` and `TREND_FOLLOWING` are separate modes, not a combination.
`STRICT` is the stricter superset: everything `TREND_FOLLOWING` blocks,
`STRICT` also blocks, plus W1/MN conflicts, unclear readings, data problems and
provisional signals.

Permission values: `BUY`, `SELL`, `NO_TRADE`.

**Permission is additionally refused — in every mode — when:**

- no valid invalidation price can be calculated
- no valid risk-to-reward ratio can be calculated
- the spread exceeds the configured maximum
- provider and broker prices diverge beyond tolerance
- a high-impact news event falls inside the configured buffer
- the required data is missing, stale, delayed or synthetic

---

## 5. Signal lifecycle

Separate from the analysis layers above. A signal moves through:

| State | Meaning |
| --- | --- |
| `DRAFT` | Built from an open candle. Labelled `PROVISIONAL — CANDLE NOT CLOSED`. |
| `CONFIRMED` | The candle closed and the rules still hold. |
| `ACTIVE` | Confirmed and within its validity window. |
| `TRIGGERED` | Price entered the entry zone. |
| `INVALIDATED` | Price broke the invalidation level. |
| `EXPIRED` | Validity window elapsed without triggering. |
| `COMPLETED` | Closed at stop or target (paper trading). |
| `CANCELLED` | Manually dismissed. |

A signal never stays `ACTIVE` indefinitely. Expiry is configurable per
timeframe in `config/strategy.ts` — shorter for M5/M15, longer for H4/D1.

---

## Provisional signals

Any reading derived from a candle that has not closed is provisional:

> **PROVISIONAL — CANDLE NOT CLOSED**

Provisional signals:

- are visibly labelled everywhere they appear
- cannot reach `CONFIRMED`, `ACTIVE`, or any trade permission under `STRICT`
- are recalculated when the candle closes, and may change or disappear
- are never sent as notifications

This is what prevents repainting from being presented as a settled result.
