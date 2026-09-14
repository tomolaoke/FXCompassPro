# Testing

```bash
bun run test          # once
bun run test:watch    # watch mode
bun run test:ui       # Vitest UI
bun run typecheck     # tsc --noEmit
bun run lint          # ESLint
bun run check         # typecheck + lint + test — run this before calling a change done
```

Runner: **Vitest**. Component tests use Testing Library with jsdom. Pure logic
runs in the default Node environment.

## Layout

Tests live next to the code they test.

```
src/lib/market/
  domain/clock.ts              domain/clock.test.ts
  data/normalize.ts            data/normalize.test.ts
  modules/momentum/stoch.ts    modules/momentum/stoch.test.ts
  engine/alignment.ts          engine/alignment.test.ts
  __fixtures__/                committed JSON scenarios (see below)
```

**Every rule module ships with its own test file.** A module without tests is
not finished.

## Fixtures

`src/lib/market/__fixtures__/` holds hand-built, committed `CandleSeries`
scenarios. They are deterministic — no randomness, no `Date.now()`, no network —
so a failure always means a real change in behaviour.

| Fixture | Scenario | Must produce |
| --- | --- | --- |
| `all-bullish` | M5 → MN all bullish | `FULLY ALIGNED BUY` |
| `short-term-bull-higher-bear` | M5–H1 bullish, H4–MN bearish | `SHORT-TERM BUY WITH HIGHER-TIMEFRAME CONFLICT`, `NO_TRADE` under `STRICT` |
| `short-term-bear-higher-bull` | Inverse of the above | Mirror result |
| `missing-w1` | No W1 data | W1 `DATA_MISSING`, confirmation blocked |
| `stale-provider` | Cached response past its freshness limit | `DATA_STALE`, confirmation blocked |
| `open-candle` | Latest candle unclosed | `CANDLE_OPEN`, signal provisional |
| `news-imminent` | High-impact event inside the buffer | Signal blocked or warned |
| `broker-mismatch` | Broker and provider prices beyond tolerance | `PRICE SOURCE MISMATCH` |
| `no-valid-stop` | No calculable invalidation | No BUY/SELL issued |
| `insufficient-history` | Fewer bars than the lookback needs | `INSUFFICIENT DATA` |

### The regression lock

`short-term-bull-higher-bear` is the reason this project was rewritten. Its test
asserts that the engine **never** returns a plain `BUY`, in any mode, and that
the UI never renders a green BUY badge for it.

**Do not weaken or delete that test.** If a change makes it fail, the change is
wrong.

## Coverage requirements

Every item below has at least one test.

**Time and candles** — timeframe aggregation · timezone conversion · candle-close
detection · broker-server-time bucket boundaries for D1, W1, MN and H4 · the
Sunday-evening open landing in the correct week · DST transitions in both March
and October, in Athens, London and New York · weekend gaps · duplicate candles ·
out-of-order candles · missing candles · OHLC sanity violations · partial-bucket
exclusion · future-dated timestamps · repainting prevention.

**Data quality** — missing data · stale data · delayed data · synthetic data
rejection · API failures · rate limits (429) · quota exhaustion · timeouts ·
malformed responses · null fields · cache expiry · fallback labelling.

**Engine** — each of the seven alignment labels · each of the four permission
modes, with and without conflict · conflicting timeframes · fully aligned
timeframes · countertrend handling · no-trade states · minimum-data requirement ·
conflict penalty · confidence cap under conflict · `NOT_CONFIGURED` produced only
by the config reader · category caps preventing single-category confidence.

**Trade mechanics** — invalid stops · invalid risk-to-reward · position sizing ·
refusal to size without pip value or contract size · oversized-position warning ·
spread blocking · news blocking · broker-price mismatch · signal expiry per
timeframe.

**Backtest** — look-ahead prevention · stop and target touched in the same candle
· spread, slippage and commission application · metric arithmetic.

**UI** — a green BUY/SELL badge never renders for a conflict, provisional,
no-trade or data-error state · every timeframe state renders a text label, not
only a colour.

### The look-ahead test

The backtest suite includes a deliberately cheating strategy that reads a future
candle. **The look-ahead guard must catch it and fail the run.** If that test
ever passes silently, the guard is broken and every backtest number in the app is
meaningless.

## Writing a test

- No network. No `Date.now()` — inject the clock. No randomness without a fixed
  seed.
- Assert on states and reasons, not on rendered strings, wherever possible.
- When you fix a bug, add the failing case first.
- When you add a rule module, add its edge cases: empty series, single candle,
  flat market (zero range), extreme gap, and the exact bar count at which the
  rule becomes valid.

## What tests here cannot tell you

They verify that the code does what the documentation says. They say nothing
about whether the strategy is profitable. No test in this repository is evidence
of an edge.
