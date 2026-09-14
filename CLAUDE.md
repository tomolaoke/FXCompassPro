# FX Compass Pro — project rules

Authoritative rules for this repository. If implementation behaviour conflicts
with this file, stop and explain the conflict before proceeding.

Detailed designs live in `docs/`: [strategy-rules](docs/strategy-rules.md) ·
[signal-states](docs/signal-states.md) · [data-providers](docs/data-providers.md)
· [risk-management](docs/risk-management.md) · [backtesting](docs/backtesting.md)
· [testing](docs/testing.md) · [environment](docs/environment.md) ·
[limitations](docs/limitations.md) · [deployment](docs/deployment.md)

## Commands

```bash
bun run dev         # development server
bun run build       # production build
bun run test        # vitest run
bun run typecheck   # tsc --noEmit
bun run lint        # eslint
bun run check       # typecheck + lint + test — must pass before any change is done
```

Stack: React 19 · TypeScript (strict) · TanStack Start (SSR + server functions) ·
Tailwind v4 · shadcn/ui · Zod · Vitest · Drizzle on SQLite/D1. Bun is the package
manager. Everything used here is free; the project requires no paid
infrastructure.

---

## Purpose

Educational market analysis for forex, metals and indices. Multi-timeframe
technical analysis, market context, trade planning, backtesting and paper
trading.

It is not financial advice, not brokerage software, and not a guaranteed-profit
system.

Default instruments: EURUSD, EURJPY, XAUUSD, USDJPY, GBPUSD, AUDUSD, USDCHF,
US30. More via configuration.

---

## Non-negotiable safety rules

- Never claim or imply a guaranteed win, "sure win", certain profit, safe trade,
  or guaranteed accuracy. Never use "risk-free" or "cannot fail".
- Never hide timeframe conflict.
- Never hide missing, stale, delayed, malformed or incomplete data.
- Never treat unavailable data as neutral, bullish, bearish, or confirmation.
- Never generate a confirmed trade-ready signal from an open candle.
- Never allow M1 or M5 alone to determine overall market direction.
- Never expose API keys, broker credentials, database secrets or private account
  information in frontend code, logs or client responses.
- Never connect to or place real broker orders. Real execution requires a
  separate, explicitly approved task.
- Keep analysis, backtesting, paper trading and real execution strictly separate.
- When uncertain, return WAIT, WATCH, INSUFFICIENT DATA, INVALID or
  DATA QUALITY ERROR rather than inventing confidence.
- The setup-quality score is a heuristic, never a probability or win rate, unless
  it has been statistically calibrated against recorded outcomes.

---

## Timeframe stack

Analyse all nine whenever data is available:

**MN · W1 · D1 · H4 · H1 · M30 · M15 · M5 · M1**

All nine are **enabled by default**. Timeframes are centrally configurable in
`src/lib/market/config/timeframes.ts` — never hard-code a timeframe list
anywhere else.

Every timeframe must be fetched, validated, calculated, timestamped, displayed,
and included in the signal audit trail. **Do not silently ignore a timeframe.**

`NOT_CONFIGURED` is permitted only when the active strategy intentionally
disables a timeframe. It must never mean "this timeframe disagrees". It is
produced only by the strategy-config reader (`isConfigured` / `roleOf` in
`config/strategy.ts`).

### Roles

| Tier | Timeframes | Role |
| --- | --- | --- |
| 1 | MN, W1 | Broad context |
| 2 | D1, H4 | Primary directional context — highest weight |
| 3 | H1, M30, M15 | Main operational confirmation |
| 4 | M5 | Entry confirmation only |
| 5 | M1 | Final execution trigger only |

**MN and W1 — broad context.** Always fetched, validated, calculated and
displayed. They do **not** automatically block an intraday BUY READY or SELL
READY merely because they disagree. Their disagreement must be prominently
visible, prevent the FULLY ALIGNED label, reduce setup quality, trigger a
countertrend warning, and be stored in the audit trail. MN/W1 alignment is
required for FULLY ALIGNED. A configurable hard block may reject a countertrend
trade-ready state when MN and W1 strongly oppose the direction **and** D1 and H4
also strongly oppose it **and** no documented reversal structure is present.

**D1 and H4 — primary directional context.** Highest weight in the confirmation
layer. Strong conflict with the proposed direction normally produces WATCH or
WAIT. A trade-ready signal against both requires an explicit, documented, tested
reversal exception. A lower-timeframe Stochastic extreme is never on its own
enough to override D1/H4.

**H1, M30, M15 — operational confirmation.** Confirm direction, momentum,
structure and location. Should generally support D1/H4 for trend-following
setups. Strong disagreement across D1–M15 normally produces WATCH or WAIT.

**M5 — entry confirmation only.** Confirms the intended direction after a valid
setup already exists. **Cannot independently create BUY READY or SELL READY**,
and cannot contribute to overall bias.

**M1 — execution trigger only.** Entry timing only. Must not determine bias or
override higher-timeframe structure. Requires closed-candle validation unless
explicitly marked PROVISIONAL. M1 triggers expire quickly, per config.

---

## Timeframe state

Each timeframe carries exactly one state:

`BULLISH` · `BEARISH` · `NEUTRAL` · `INCONCLUSIVE` · `DATA_MISSING` ·
`DATA_STALE` · `DATA_DELAYED` · `DATA_INVALID` · `CANDLE_OPEN` ·
`NOT_CONFIGURED`

**`CONFLICTING` is a relation, not a state.** A weekly chart is `BEARISH`; it is
*conflicting* relative to a proposed BUY. Storing "conflicting" as the state
would lose the direction and make a bearish W1 under a SELL unrepresentable.
Each timeframe therefore carries both:

- `state` — one of the values above
- `relation` — `AGREEING` | `CONFLICTING` | `NOT_APPLICABLE`

and the UI renders the pair, e.g. **"CONFLICTING (bearish)"**.

Display per timeframe: timeframe · role · state · relation · candle status
(open/closed) · latest candle timestamp · data age · data source · included in
strategy (yes/no) · Stochastic detail · price-action and structure conditions ·
score contribution · reason for any warning, conflict or failure to calculate.

---

## Stochastic

Stochastic Oscillator on all nine timeframes: **%K 25, slowing 2, %D 4**, levels
**20, 30, 70, 80**.

Calculate and store per timeframe: current %K, current %D, previous %K,
previous %D, %K slope, %D slope, %K/%D crossover direction, threshold
cross/reclaim direction, candle-close status, calculation timestamp, Stochastic
event.

### Stochastic events

Separate from — and orthogonal to — timeframe state. A timeframe can be
`CURLING_UP` *and* `DATA_STALE`; conflating the two into one enum loses that.

`EXTREME_OVERSOLD` · `EXTREME_OVERBOUGHT` · `CURLING_UP` · `CURLING_DOWN` ·
`K_D_CROSS_UP` · `K_D_CROSS_DOWN` · `THRESHOLD_RECLAIM_UP` ·
`THRESHOLD_RECLAIM_DOWN` · `CONFIRMED_BULLISH` · `CONFIRMED_BEARISH` ·
`NEUTRAL` · `INCONCLUSIVE`

**BUY reading:** oversold context (%K and/or %D below 20 or 30) → curling upward
→ %K crosses above %D → %K closes back above 20 or 30 → confirmed by valid
bullish price action, structure, location and closed candles.

**SELL reading:** mirror.

### Critical rules

- An oversold reading is not automatically a BUY. An overbought reading is not
  automatically a SELL. Stochastic stays pinned at an extreme throughout a strong
  trend.
- A K/D cross alone is not a trade signal.
- A threshold reclaim or break alone is not a trade signal.
- `CONFIRMED_BULLISH` / `CONFIRMED_BEARISH` require closed-candle Stochastic
  evidence **plus** defined price-action and market-structure evidence.
- **Do not require all nine timeframes to be oversold or overbought at the same
  moment.** A monthly Stochastic can stay extreme for months; demanding
  simultaneity produces almost no signals, and those it does produce arrive late.
  Detect a multi-timeframe **sequence** according to the role hierarchy instead.

---

## Signal decision model

Calculate separately, never merged into one vote:

1. **Broad context** — MN, W1, and their alignment or conflict.
2. **Main confirmation** — D1, H4, H1, M30, M15.
3. **Entry confirmation** — M5.
4. **Execution trigger** — M1.
5. **Final result** — label, alignment, setup quality, risk status, data-quality
   status, explanation.

Distinguish: fully aligned · trend-following · countertrend · developing ·
invalid · expired · no setup.

**Never call a signal "fully aligned" when MN or W1 conflicts with the final
direction.**

---

## User-facing labels

**Never display a standalone BUY or SELL badge.** Use exactly these:

- `WATCH — POTENTIAL BUY` / `WATCH — POTENTIAL SELL`
- `BUY SETUP — WAITING FOR M5/M1 CONFIRMATION` / `SELL SETUP — …`
- `BUY READY` / `SELL READY`
- `BUY READY — COUNTERTREND WARNING` / `SELL READY — COUNTERTREND WARNING`
- `FULLY ALIGNED BUY READY` / `FULLY ALIGNED SELL READY`
- `WAIT — NO VALID SETUP`
- `INSUFFICIENT DATA` · `DATA QUALITY ERROR` · `INVALID` · `EXPIRED`

### Derivation

`label = f(direction, readiness, broadContextRelation)`

| Readiness | MN/W1 relation | Label |
| --- | --- | --- |
| READY | both aligned | `FULLY ALIGNED BUY READY` |
| READY | either conflicting | `BUY READY — COUNTERTREND WARNING` |
| READY | neutral, or data unavailable | `BUY READY` + stated reason it is not "fully aligned" |
| SETUP | any | `BUY SETUP — WAITING FOR M5/M1 CONFIRMATION` |
| WATCH | any | `WATCH — POTENTIAL BUY` |
| NONE | any | `WAIT — NO VALID SETUP` |

Plain `BUY READY` therefore means "entry conditions pass, but MN/W1 are neutral
or unavailable, so this cannot be called fully aligned" — and it must say so.

### Meaning

- **WATCH** — conditions developing. No entry permission.
- **SETUP** — main directional conditions exist; entry confirmation incomplete.
- **READY** — all configured entry conditions currently pass. **Not a
  guarantee.** It is cancelled automatically when price leaves the entry zone,
  the stop level is breached, the M1 trigger expires, spread exceeds maximum,
  news enters the blocking window, broker/provider divergence exceeds tolerance,
  or a newly closed candle negates the setup.
- **INVALID** — a calculation, validation or data error occurred.
- **EXPIRED** — previously valid, no longer.
- **INSUFFICIENT DATA** — required data unavailable or insufficient.

Never use a green BUY or red SELL badge for WATCH, SETUP, INVALID, EXPIRED,
DATA QUALITY ERROR or INSUFFICIENT DATA. The badge component accepts a readiness
value, not a direction string.

The phrase **"not used" must not appear anywhere in the codebase.**

---

## Validation gate

Runs after every calculation, before rendering, notifying, recording a paper
trade, or allowing trade planning.

**WATCH** — may show partial information, but must explicitly identify missing,
delayed, stale or invalid data, open candles, unconfirmed indicators,
conflicting timeframes and incomplete entry conditions.

**BUY/SELL SETUP** — requires valid D1, H4, H1, M30, M15 data; no blocking
data-quality error; valid price-action and market-structure conditions; valid
Stochastic conditions; valid, unexpired trade location.

**BUY/SELL READY** — requires the SETUP conditions, plus: valid M5 entry
confirmation · valid M1 execution trigger · closed candles for every required
confirmation rule · valid entry price or zone · valid stop-loss · valid
invalidation level · correct target ordering · correct risk-to-reward ·
acceptable spread · no active high-impact-news block · acceptable
provider-versus-broker divergence where broker data exists · signal not expired ·
price still within the entry acceptance rule.

**FULLY ALIGNED** — requires all READY conditions, plus valid MN and W1 data
aligned with the final direction.

**On any failure:** do not render a trade-ready result, do not notify. Render
WAIT, INVALID, INSUFFICIENT DATA, DATA QUALITY ERROR or EXPIRED as appropriate,
and log the exact rejection reason to the audit trail.

---

## Market data

Twelve Data is an **analysis** provider. It must never be assumed to equal a
broker's executable price.

Store all timestamps in UTC; convert only for display. Candle buckets follow the
**broker's server day**, not the UTC day — see `docs/data-providers.md`.

Track per request: source timestamp · local receipt timestamp · data age ·
provider name · request time · response time · HTTP/WebSocket status · fallback
source. Validate schema and required fields. Safely handle null fields, missing
candles, duplicate candles, out-of-order candles, malformed OHLC and incomplete
candles. Handle rate limits, timeouts, provider errors, reconnects and stale
caches.

Never treat a failed provider response as neutral or confirmed analysis. Never
create a confirmed signal from an unclosed candle. Never serve cached data after
a failure without marking it stale.

Streaming, when enabled: track connection state, prevent duplicate
subscriptions, reconnect safely, clean up on unmount, fall back to REST only
when logged and validated.

API keys stay server-side. **Never prefix a secret with `VITE_`** — Vite inlines
those into the browser bundle.

### Broker comparison

With a broker feed: use broker bid, ask and spread as the execution source of
truth. Display provider price, broker bid/ask/mid, spread, absolute difference,
difference in pips, and each source's timestamp, against a configurable
tolerance. Beyond tolerance:

> PRICE SOURCE MISMATCH — DO NOT TRADE UNTIL VERIFIED

Without a broker feed: label entry calculations as provider-based or manually
entered. Never claim Twelve Data equals broker price. **Never invent bid, ask or
spread values.**

### News and session context

A risk layer, not a prediction engine. Display high-impact events affecting
either currency, event name, currency, time in user-local timezone, impact
level, countdown, and configurable pre/post-news buffers. Also current session
(Asian, London, New York, overlaps), weekend/closed status, spread condition and
volatility condition.

When calendar data is unavailable:

> NEWS CHECK UNAVAILABLE — VERIFY ECONOMIC CALENDAR MANUALLY

**Never assume "no news" because the provider is unavailable.**

---

## Trade planning and risk

A trade-ready setup shows: instrument · direction · current price · entry price
or zone · entry trigger · stop-loss · invalidation · TP1/TP2/TP3 · correct R:R
per target · spread assumption · slippage assumption · commission assumption ·
creation timestamp · expiry timestamp · countertrend warning where applicable ·
news status · data freshness · price-source status.

Configurable: account balance, account currency, risk percentage, maximum
monetary risk, pip value, contract size, lot size, maximum daily risk, maximum
simultaneous exposure. Defaults are conservative.

**Never calculate a position size unless every required input is valid and
available.** Missing contract size or pip value means no size is suggested.

Block READY when: stop-loss invalid · target ordering invalid · R:R
incalculable · price outside allowed entry conditions · spread above maximum ·
required risk inputs missing.

---

## Backtesting and paper trading

Backtests replay strictly candle by candle in chronological order, using only
information available at that moment. Prevent look-ahead bias and indicator
repainting. Use the same validation gate as live analysis. Include realistic
spread, slippage and commission. Resolve same-candle stop/target ambiguity with
a documented conservative rule. Store the strategy version and every signal,
entry, exit, invalidation, expiry and rejection reason.

Report: trades · win rate · gross profit · gross loss · net return · profit
factor · average win · average loss · expectancy · max drawdown · max losing
streak · results by session, by day, around high-impact news, when MN/W1 agree,
when MN/W1 conflict, by final state, by instrument, by strategy version. Show
sample size with every metric.

**Never describe backtest results as a guarantee of future results.**

Paper trading places no real orders, stays separate from backtests and live,
records simulated entry/stop/targets and spread/slippage/commission assumptions,
tracks expiry and invalidation, lets the user accept/reject/ignore with an
optional recorded reason, and labels everything simulated.

---

## Audit trail

Every signal preserves immutable evidence sufficient to reproduce it: signal ID ·
strategy version · instrument · state · creation time · expiry · all timeframe
states and relations · candle snapshots or references · Stochastic values and
events · market-structure results · price-action results · provider status ·
broker comparison · news status · spread status · entry/stop/targets/
invalidation/R:R · validation results · rejection reasons · user decision.

**Do not overwrite historical signal evidence after creation.**

---

## Interface

**Beginner view:** instrument · current price · final label · broad MN/W1
context · main D1–M15 confirmation · M5 entry confirmation · M1 execution
trigger · alignment or conflict · data freshness · candle status · news warning ·
spread warning · price-source mismatch warning · entry/stop/targets/
invalidation/R:R when available · a plain English explanation · a Nigerian
Pidgin explanation.

**Advanced view:** full timeframe matrix · Stochastic %K/%D detail · cross
detail · price-action and structure reasoning · data timestamps and age ·
strategy version · full validation results · audit trail.

Colour is a secondary cue only — green bullish, red bearish, gray neutral, amber
warning/conflict/waiting, blue or purple informational. **Always include text
labels and accessible icon labels.** Never convey state by colour alone.

---

## Testing

Maintain tests for: timeframe configuration and inclusion/exclusion · MN/W1
conflict · D1/H4 conflict · fully aligned BUY/SELL READY · countertrend BUY/SELL
READY · WATCH · WAIT · missing, stale, delayed and invalid data · open,
incomplete, duplicate and out-of-order candles · Stochastic calculation · K/D
crossover · threshold reclaim · price-action confirmation · state transitions ·
entry expiry · invalid stop-loss, targets and R:R · spread blocking · news
blocking · broker/provider mismatch · API errors · rate limits · WebSocket
reconnect · position sizing · backtest look-ahead prevention · no repainting ·
paper-trading separation.

**Do not mark a feature complete unless the relevant tests pass.** Report exact
results, including failures.

Regression locks that must never be weakened: a short-term-bullish /
higher-timeframe-bearish fixture must never produce a plain BUY or a FULLY
ALIGNED label; and the deliberately cheating backtest strategy must be caught by
the look-ahead guard.

---

## Workflow

Before a significant change: inspect the relevant code · state the intended
change · identify affected components, data models, APIs and tests · identify
risks and assumptions · create or update tests · implement the smallest safe
change · run tests, lint, typecheck and build · report exact results. Do not
claim completion if tests fail or requirements remain partial.

**Ask for approval before:** changing core strategy rules · changing Stochastic
parameters · adding or changing database migrations · enabling real broker
connections · enabling real order execution · deleting data · rotating
production secrets · changing authentication or authorisation · replacing a
market-data provider.

Keep changes focused. Do not refactor unrelated code unless necessary, and
explain it when you do.

Keep current: README · setup instructions · environment variables ·
data-provider guide · strategy rules · signal states · backtest assumptions and
limitations · paper-trading docs · risk-management docs · deployment checklist ·
known limitations.

Never commit secrets. API keys belong in `.env` or the host's secret manager.
