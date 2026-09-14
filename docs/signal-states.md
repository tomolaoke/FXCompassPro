# Signal states

Five separate layers, each with its own vocabulary. They are deliberately not
collapsed into one word, because collapsing them is what makes retail signal
tools misleading.

```
  timeframe state × relation
        ↓
  role tier (5)  →  short-term direction  ┐
                                          ├→ readiness → label → permission
                 →  higher-timeframe bias ┘
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
| `DATA_MISSING` | No candles, or not enough history | No — blocks confirmation |
| `DATA_STALE` | Older than this timeframe's freshness limit | No — blocks confirmation |
| `DATA_DELAYED` | Provider explicitly reports delayed data | No — blocks confirmation |
| `DATA_INVALID` | Malformed OHLC, or failed schema validation | No — blocks confirmation |
| `CANDLE_OPEN` | Latest candle has not closed | Provisional only |
| `NOT_CONFIGURED` | **Deliberately excluded by the active strategy** | N/A |

### `NOT_CONFIGURED` is special

It means exactly one thing: *the strategy you have selected does not look at
this timeframe.* It is set only by the strategy-config reader (`isConfigured` /
`roleOf`), never by the analysis engine.

**By default all nine timeframes are configured, so this state does not appear
at all.** It exists for when you deliberately switch one off.

It must **never** be used for a timeframe that disagrees, produced no clear
reading, has no usable data, or is still forming. Those each have their own
state.

The phrase "not used" does not appear anywhere in this application.

### `CONFLICTING` is a relation, not a state

A weekly chart is `BEARISH`. It is *conflicting* **relative to a proposed BUY**.
Storing "conflicting" as the state would throw away the direction, and would
leave a bearish weekly under a SELL with nothing to be.

Each timeframe therefore carries two values:

| Field | Values |
| --- | --- |
| `state` | one of the ten above |
| `relation` | `AGREEING` · `CONFLICTING` · `NOT_APPLICABLE` |

and the interface renders the pair: **"CONFLICTING (bearish)"**.

### Displayed per timeframe

Timeframe · role · state · relation · candle status · latest candle timestamp ·
data age · data provider · included in strategy · Stochastic detail ·
price-action and structure conditions · score contribution · and, for
`INCONCLUSIVE` or any `DATA_*` state, the specific reason.

---

## 2. Role tiers

All nine timeframes are analysed. They do not carry equal authority, because
they do not answer the same question — a 1-minute chart agreeing with a monthly
chart is not evidence of anything.

| Tier | Timeframes | Authority |
| --- | --- | --- |
| Broad context | MN, W1 | Gates the FULLY ALIGNED label. Conflict warns and caps the score; it does not on its own cancel a setup. |
| Primary directional context | D1, H4 | Strongest weight. Strong conflict normally means WATCH or WAIT. |
| Operational confirmation | H1, M30, M15 | Confirms direction, momentum, structure, location. |
| Entry confirmation | M5 | Confirms an entry that already exists. **Cannot create one. Cannot affect bias.** |
| Execution trigger | M1 | Times the entry. **Cannot affect bias, quality or higher-timeframe direction.** |

Only the first three tiers appear in `directionalTimeframes()`. That is how
"M5 and M1 must never determine market direction" is enforced — they are not in
the list the engine reads from, so a bug cannot let them vote.

### Two summary groups

- **Higher-timeframe bias** — broad + primary context (MN, W1, D1, H4)
- **Short-term direction** — operational + entry + trigger (H1, M30, M15, M5, M1)

Computed separately, never averaged together. A bullish short-term reading does
not become "less bullish" because the weekly disagrees — it stays bullish, and
the conflict is reported as a conflict.

---

## 3. Stochastic events

Orthogonal to timeframe state. A timeframe can be `CURLING_UP` **and**
`DATA_STALE`; one enum for both would make that unrepresentable and would
quietly turn a data fault into a momentum reading.

| Event | Meaning |
| --- | --- |
| `EXTREME_OVERSOLD` / `EXTREME_OVERBOUGHT` | %K and/or %D beyond 20/30 or 70/80 |
| `CURLING_UP` / `CURLING_DOWN` | Direction turning after an extreme |
| `K_D_CROSS_UP` / `K_D_CROSS_DOWN` | %K crossed %D |
| `THRESHOLD_RECLAIM_UP` / `THRESHOLD_RECLAIM_DOWN` | %K closed back through a level |
| `CONFIRMED_BULLISH` / `CONFIRMED_BEARISH` | Stochastic evidence **plus** price action and structure, on closed candles |
| `NEUTRAL` / `INCONCLUSIVE` | No usable or mixed reading |

**Only `CONFIRMED_*` may contribute to a trade-ready state.** An extreme reading
persists for months in a strong trend. A %K/%D cross and a threshold reclaim
happen constantly. None of them is a trade signal on its own.

Stored per timeframe: current %K, %D, previous %K, %D, %K slope, %D slope,
crossover direction, threshold cross direction, the level crossed, candle-close
status, and calculation timestamp.

**Timeframes are not required to be extreme simultaneously.** A monthly
Stochastic can stay pinned for months; demanding that all nine line up at one
instant produces almost no signals, and those it does produce arrive late. The
engine detects a **sequence** through the role hierarchy instead.

---

## 4. Readiness and the user-facing label

Readiness is the rung reached on the validation ladder:
`NONE` → `WATCH` → `SETUP` → `READY`.

The label is derived from readiness, direction and how broad context stands:

| Readiness | MN/W1 relation | Label |
| --- | --- | --- |
| READY | both aligned | `FULLY ALIGNED BUY READY` |
| READY | either conflicting | `BUY READY — COUNTERTREND WARNING` |
| READY | neutral or unavailable | `BUY READY` + stated reason it is not "fully aligned" |
| SETUP | any | `BUY SETUP — WAITING FOR M5/M1 CONFIRMATION` |
| WATCH | any | `WATCH — POTENTIAL BUY` |
| NONE | any | `WAIT — NO VALID SETUP` |

Mirror for SELL. Terminal states — `INSUFFICIENT DATA`, `DATA QUALITY ERROR`,
`INVALID`, `EXPIRED` — override everything above them.

**There is no plain `BUY` or `SELL` label.** A direction word never appears
alone, because alone it is exactly what makes a beginner assume every chart
agrees.

Plain `BUY READY` is not a weaker "fully aligned". It means something specific:
*entry conditions pass, but MN/W1 are neutral or their data is unavailable, so
this cannot honestly be called fully aligned* — and it says so on the card.
Without that third label, a setup with no weekly data would have to masquerade
as either aligned or conflicted, and both would be false.

### What each rung means

- **WATCH** — conditions developing. No entry permission.
- **SETUP** — main directional conditions exist; entry confirmation incomplete.
- **READY** — all configured entry conditions currently pass. **Not a
  guarantee.** Cancelled automatically when price leaves the entry zone, the
  stop is breached, the M1 trigger expires, spread exceeds maximum, news enters
  the blocking window, broker/provider divergence exceeds tolerance, or a newly
  closed candle negates the setup.
- **INVALID** — a calculation, validation or data error occurred.
- **EXPIRED** — previously valid, no longer.
- **INSUFFICIENT DATA** — required data unavailable or insufficient.

A green or red directional badge may render **only** for a `READY` label. The
badge component takes a readiness value, not a direction string, so a developing
or broken setup cannot be made to look like a go-ahead.

---

## 5. Trade permission

The label describes the situation. Permission decides whether the app is willing
to present a tradeable idea.

| Mode | Rule |
| --- | --- |
| **`TREND_FOLLOWING`** *(default)* | Requires agreement with the primary directional context (D1, H4). MN/W1 conflict warns, caps the score and blocks the FULLY ALIGNED label, but does not cancel the setup. |
| `STRICT` | The stricter superset. Additionally refuses on any MN/W1 conflict, any `INCONCLUSIVE` reading, any `DATA_*` state, and any provisional candle. |
| `COUNTERTREND` | Off by default; must be explicitly enabled. Permits setups against D1/H4 with a prominent high-risk warning. |
| `MANUAL` | Analysis is shown; permission is never issued. |

`STRICT` and `TREND_FOLLOWING` are **separate modes, not a combination**.
Everything `TREND_FOLLOWING` blocks, `STRICT` also blocks, plus more.

### The countertrend hard block

MN/W1 disagreement alone does not cancel a setup. But when **both** broad
context timeframes **and both** primary context timeframes oppose the direction,
and the only argument for the trade is a stretched oscillator on a fast chart,
the app refuses regardless of mode. That is catching a falling knife.

The documented exception: a confirmed reversal structure — a liquidity sweep
followed by a change of character — on D1 or H4 lifts the block, and the setup
is shown with the countertrend warning instead. Configurable in
`config/strategy.ts`.

### Refused in every mode when

No valid invalidation price · no valid risk-to-reward · spread above maximum ·
broker/provider divergence beyond tolerance · high-impact news inside the buffer
· required data missing, stale, delayed, invalid or synthetic · position size
uncomputable.

---

## 6. Signal lifecycle

Separate from the analysis layers above.

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
timeframe — short for M1 and M5, long for H4 and D1.

---

## Provisional signals

Any reading derived from a candle that has not closed:

> **PROVISIONAL — CANDLE NOT CLOSED**

Provisional signals are visibly labelled everywhere, cannot reach `CONFIRMED` or
`ACTIVE`, cannot obtain permission under `STRICT`, are recalculated on candle
close — where they may change or disappear — and are never sent as
notifications.

This is what stops repainting from being presented as a settled result.
