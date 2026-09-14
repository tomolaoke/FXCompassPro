# FX Compass Pro

**Educational multi-timeframe market analysis for forex and gold.**

FX Compass Pro reads eight timeframes of a currency pair, states what each one is
doing, and tells you plainly whether they agree. When the short-term charts point
one way and the higher timeframes point the other, it says so — loudly — instead
of showing you a green BUY badge.

> **Educational analysis only. Trading leveraged forex/CFDs can cause rapid
> losses. No signal is guaranteed.** This application does not provide financial
> advice, does not place orders, and does not predict prices.

---

## The problem this app exists to solve

Most retail signal tools collapse many timeframes into a single BUY or SELL word.
A beginner sees `BUY` and assumes every chart agrees. Often they do not — the
5-minute chart is bouncing while the weekly and monthly are falling. The tool
either hides that, or labels the disagreeing timeframes "not used", which reads
like "irrelevant" when it actually means "this contradicts what I just told you".

FX Compass Pro is built on the opposite principle:

- **Short-term direction and higher-timeframe bias are computed separately and
  displayed separately.** They are never merged into one vote.
- **A plain `BUY` or `SELL` is only ever shown when every configured timeframe
  agrees.** Anything else is labelled, e.g.
  `SHORT-TERM BUY — HIGHER-TIMEFRAME BEARISH CONFLICT`.
- **`NOT CONFIGURED` means one thing only:** the active strategy deliberately
  excludes that timeframe. It is never used for a timeframe that disagrees, is
  unclear, or has no data. Those have their own states.
- **Missing, stale, delayed, malformed or still-forming data is never treated as
  agreement.** It blocks confirmation and says exactly what is wrong.
- **A reading taken from a candle that has not closed yet is labelled
  `PROVISIONAL — CANDLE NOT CLOSED`** and cannot become a confirmed signal.

---

## Timeframe model

Two groups, both configurable in one place
([`src/lib/market/config/timeframes.ts`](src/lib/market/config/timeframes.ts)):

| Group | Timeframes | Role |
| --- | --- | --- |
| **Execution / short-term** | M5, M15, M30, H1 | Direction and entry timing |
| **Context / higher-timeframe** | H4, D1, W1, MN | Bias, filters, permission |

H4 and D1 carry extra weight: a conflict there is shown more prominently than a
W1/MN conflict, because they are the timeframes that most often decide whether an
intraday idea survives the session.

### Timeframe states

Every timeframe always has exactly one explicit state. There is no implicit or
blank state.

| State | Meaning |
| --- | --- |
| `BULLISH` | Rules resolved upward on closed data |
| `BEARISH` | Rules resolved downward on closed data |
| `NEUTRAL` | Rules resolved, with no directional edge |
| `INCONCLUSIVE` | Rules ran but did not produce a clear reading |
| `DATA_MISSING` | No candles, or not enough history |
| `DATA_STALE` | Candles are older than the freshness limit for this timeframe |
| `DATA_DELAYED` | Provider explicitly reports delayed data |
| `CANDLE_OPEN` | Latest candle has not closed; any reading is provisional |
| `NOT_CONFIGURED` | **Intentionally excluded by the active strategy config** |

Alongside the state, each timeframe reports: last candle timestamp, whether that
candle is closed, data age, data provider, the exact conditions that produced the
state, a heuristic score contribution, and — when unclear or unavailable — the
specific reason.

### Alignment

| Label | Meaning |
| --- | --- |
| `FULLY ALIGNED BUY` | Short-term and all configured context timeframes bullish |
| `FULLY ALIGNED SELL` | Short-term and all configured context timeframes bearish |
| `SHORT-TERM BUY WITH HIGHER-TIMEFRAME CONFLICT` | Countertrend upward |
| `SHORT-TERM SELL WITH HIGHER-TIMEFRAME CONFLICT` | Countertrend downward |
| `NEUTRAL / NO CLEAR SETUP` | Nothing resolved |
| `INSUFFICIENT DATA` | Not enough valid timeframes to judge |
| `DATA QUALITY ERROR` | A data problem blocks any conclusion |

### Trade permission

Alignment describes the market. **Permission** decides whether the app is willing
to present a tradeable idea, under a configurable policy:

| Mode | Behaviour |
| --- | --- |
| **`STRICT`** *(default)* | Any conflict, unclear reading or data problem on **any** configured timeframe produces `NO TRADE`. |
| `TREND_FOLLOWING` | Permission requires agreement with the configured higher-timeframe filters (default H4 + D1). A W1/MN conflict warns and caps the score rather than blocking. |
| `COUNTERTREND` | Off by default. Must be explicitly enabled. Countertrend setups are shown with a prominent high-risk warning. |
| `MANUAL` | Full analysis is displayed; no trade permission is ever issued. |

Short-term direction is **never** converted automatically into a tradeable
BUY or SELL.

---

## Strategy

The directional rule is the **Stochastic Oscillator (K 25, slowing 2, D 4)** at
the 20 / 30 / 70 / 80 levels. It is the primary gate: no timeframe resolves to
`BULLISH` or `BEARISH` without it.

Price action then acts as a **confirmation and veto layer**, not as bonus points:

| Category | Inputs | Role |
| --- | --- | --- |
| **Momentum** | Stochastic 25,2,4 | Primary direction gate |
| **Location** | Support/resistance, previous day/week/month high & low, equal highs/lows | Must confirm — a stretched oscillator with no level is not a setup |
| **Structure** | Liquidity sweep, break of structure, change of character, fair value gaps, order-block approximation, displacement | Must confirm the turn |
| **Trend** | Moving averages, higher-high/higher-low sequencing | Context filter — caps score against the trend |
| **Volatility** | ATR regime, spread condition | Practicality filter — blocks unworkable stops |

Each category contributes to the score under its own cap, so five correlated
readings of the same impulse cannot stack into false confidence. Highly
correlated indicators are explicitly grouped and counted once. Timeframes derived
from the same base series are not treated as independent evidence.

The score is a **heuristic setup-quality score, not a probability.** It is not
calibrated against historical outcomes, and the interface says so wherever it
appears.

---

## What a signal contains

Every signal records instrument, direction or no-trade status, short-term
direction, higher-timeframe bias, alignment, permission, strength label, exact
entry logic, entry zone, stop-loss rule and price, take-profit rule and prices,
risk-to-reward, invalidation price, creation timestamp, candle-close timestamp,
expiry, provisional/confirmed flag, spread and slippage assumptions, nearby
support and resistance, news-risk status, a beginner-readable explanation, and an
explicit warning when the setup is countertrend or built on incomplete data.

**The app will not issue a BUY or SELL if it cannot calculate a valid
invalidation point and risk-to-reward ratio.**

Every signal stores the exact inputs and the strategy version hash used to
produce it, so any past signal can be reproduced and audited.

---

## Data

| Source | Use | Cost |
| --- | --- | --- |
| **Twelve Data** | Historical OHLC, quotes, streaming where available | Free tier |
| **Frankfurter (ECB)** | Daily reference FX rates, fallback only | Free, no key |
| **Manual broker entry** | Bid/ask from your own terminal — **source of truth for entry, stop, target and spread when present** | Free |

Forex is decentralised, so provider prices and broker prices differ. The app
compares them side by side (provider mid, broker bid/ask/mid, spread, absolute
difference, difference in pips, timestamp of each) against a configurable
tolerance. Beyond tolerance it shows:

> **PRICE SOURCE MISMATCH — DO NOT TRADE UNTIL VERIFIED**

The Twelve Data API key is read server-side only and is never sent to the
browser. See [`docs/environment.md`](docs/environment.md).

### Candle and time handling

All candles are stored in **UTC** and displayed in your local timezone
(default `Africa/Lagos`). Because MetaTrader brokers do not start the day at
midnight UTC, timeframe buckets are aligned to your **broker's server day**:
D1 opens at broker midnight, W1 at broker Monday midnight, MN on the first of
the broker month, and H4 on the same anchor. The default is `Europe/Athens`
(EET/EEST), which is what HF Markets and most MT4/MT5 servers use — placing the
daily close around 17:00 New York.

Anchoring to the broker's own timezone rather than to "17:00 New York" is
deliberate: European and US daylight-saving transitions are two to three weeks
apart, and during those windows the broker's daily close genuinely is not 17:00
New York. The terminal is the reference. Both the broker timezone and your
display timezone are configurable.

Incoming series are normalised before anything reads them: duplicates removed,
out-of-order bars sorted, OHLC sanity checked, gaps recorded, weekend gaps
recognised, and partial (still-forming) buckets marked rather than silently
included.

---

## Running it

Requires [Bun](https://bun.sh). Node 20+ also works with npm.

```bash
bun install
cp .env.example .env      # then add your Twelve Data key
bun run dev
```

| Command | Purpose |
| --- | --- |
| `bun run dev` | Development server |
| `bun run build` | Production build |
| `bun run test` | Run the test suite |
| `bun run test:watch` | Tests in watch mode |
| `bun run typecheck` | TypeScript, no emit |
| `bun run lint` | ESLint |
| `bun run format` | Prettier |

Without a Twelve Data key the app shows an explicit "no verified data" state.
It does **not** fall back to synthetic prices in production. Synthetic sample
data exists for interface review only and is gated behind
`ALLOW_DEMO_DATA=true` in development, where it is labelled as sample data
everywhere it appears and can never produce a trade permission.

---

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/environment.md`](docs/environment.md) | Every environment variable, and which ones are safe |
| [`docs/data-providers.md`](docs/data-providers.md) | Provider setup, rate limits, credit budget |
| [`docs/strategy-rules.md`](docs/strategy-rules.md) | Exact rule definitions, lookbacks, edge cases, repaint behaviour |
| [`docs/signal-states.md`](docs/signal-states.md) | Every state, what it means, when it appears |
| [`docs/risk-management.md`](docs/risk-management.md) | Position sizing rules and limits |
| [`docs/backtesting.md`](docs/backtesting.md) | How the backtester works and what it cannot tell you |
| [`docs/testing.md`](docs/testing.md) | Test layout, fixtures, how to add cases |
| [`docs/limitations.md`](docs/limitations.md) | Known limitations, honestly listed |
| [`docs/deployment.md`](docs/deployment.md) | Deployment checklist |
| [`AGENTS.md`](AGENTS.md) | Instructions for AI agents working in this repository |

---

## Stack

React 19 · TypeScript · TanStack Start (SSR + server functions) · TanStack Router
· TanStack Query · Vite · Tailwind CSS v4 · shadcn/ui · Zod · Vitest · Drizzle
ORM on SQLite.

Every dependency and every data source is free. The project requires no paid
infrastructure to develop, test or run.

---

## Scope and limits

- **No live order execution.** The app analyses and paper-trades. It does not
  connect to a broker's order system.
- **Paper-trading, backtest and live results are stored and displayed
  separately** and are never combined.
- **Backtest results are not predictions.** They describe what a rule would have
  done on past data, including spread, slippage and commission assumptions that
  may not match your broker.
- **The heuristic score is not a win probability.**
- This is a study and planning tool. Every decision, and every consequence of it,
  is yours.
