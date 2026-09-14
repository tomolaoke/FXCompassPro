<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# FX Compass Pro — instructions for AI agents

An educational multi-timeframe forex and gold analysis tool. Read `README.md`
first for what the app is and why it exists.

## Non-negotiable product rules

These are safety requirements, not preferences. Code that violates one is wrong
even if it compiles and passes review.

1. **Never present a signal as certain, guaranteed, safe, or profitable.**
2. **Never hide timeframe disagreement.** Short-term direction and
   higher-timeframe bias are computed and displayed separately, always.
3. **`NOT_CONFIGURED` means one thing: the active strategy config deliberately
   excludes that timeframe.** It must never be produced for a timeframe that
   disagrees, is unclear, or has no data. Those have their own states
   (`CONFLICTING` is expressed via direction + alignment; see
   `docs/signal-states.md`).
4. **Missing, delayed, stale, invalid or incomplete data is never bullish,
   bearish, neutral, or confirmation.** It produces a `DATA_*` state and blocks
   confirmation.
5. **A reading from an unclosed candle is `CANDLE_OPEN`** and any signal built
   on one is marked provisional and cannot be confirmed.
6. **Short-term direction is never auto-converted into a tradeable BUY/SELL.**
   That decision belongs to the permission policy, whose default is `STRICT`.
7. **No BUY or SELL without a valid invalidation price and risk-to-reward.**
8. **No position size without contract size, pip value and a current price.**
9. **Never expose an API key to the browser.** Server-side only, never `VITE_*`.
10. **No live order execution.** Analysis and paper trading only.
11. **The score is a heuristic, not a probability.** Do not label it a win rate,
    confidence percentage, or probability anywhere unless it has been
    statistically calibrated against recorded outcomes.
12. **Backtest, paper and live results are stored and displayed separately.**

## Architecture

```
src/lib/market/
  config/       timeframes.ts, strategy.ts   ← single source of truth; change here
  domain/       states.ts, clock.ts          ← state unions; all UTC time logic
  data/         providers, normalisation, resampling, provenance
  modules/      one rule per file + one test per file, grouped by category
  engine/       readTimeframe → shortTerm / higherBias → alignment → permission
  backtest/ paper/ news/ broker/ observability/
```

- **Timeframe configuration lives only in `config/timeframes.ts`.** Never
  hard-code a timeframe list anywhere else.
- **Strategy parameters live only in `config/strategy.ts`** and are content-hashed
  into a `strategyVersion` stored with every signal.
- **Candles always travel as `CandleSeries`**, which carries provider, fetch
  time, provider timestamp, `isSynthetic`, `closedThrough` and gap information.
  Never pass a bare `Candle[]` into the engine — provenance must not be
  separable from the data.
- **Indicators and structure modules read only data available at that point in
  time.** No look-ahead, in live or backtest.

## Conventions

- TypeScript strict. No `any`. Prefer discriminated unions over booleans for
  state.
- Server-only code lives in `*.server.ts` or is dynamically imported inside a
  `createServerFn` handler. Anything else may end up in the client bundle.
- All external responses are validated with Zod before use.
- File-based routing under `src/routes/` — see `src/routes/README.md`.
  `routeTree.gen.ts` is generated; never edit it.
- `bun run typecheck && bun run lint && bun run test` must pass before a change
  is considered done.

## Testing

Every rule module has unit tests. Every data-quality and conflict scenario has a
committed fixture in `src/lib/market/__fixtures__/`. The fixture
`short-term-bull-higher-bear` is a regression lock: **it must never produce a
plain BUY.** See `docs/testing.md`.

## UI rules

- Never rely on colour alone. Every state needs text and an accessible label.
- A green BUY/SELL badge may only render from a `TradePermission` of `BUY` or
  `SELL`. Never from a direction string.
- The words "not used" must not appear in the codebase.
- Beginner-readable explanation first; advanced rule detail behind a disclosure.
