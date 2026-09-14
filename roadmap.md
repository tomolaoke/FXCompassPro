# FX Compass Pro — roadmap

Rebuilding the analysis engine so that timeframe disagreement is impossible to
miss. Each phase ends with `bun run check` green and the app still runnable.

## Phase 0 — foundation ✅
- [x] Vitest harness, `vitest.config.ts`, `test` / `typecheck` / `check` scripts
- [x] `.env.example` with a warning against `VITE_`-prefixed secrets
- [x] README rewritten to describe the application, not the original prompt
- [x] `AGENTS.md` rewritten with the non-negotiable product rules
- [x] Full `docs/` set: environment, providers, strategy rules, signal states,
      risk, backtesting, testing, limitations, deployment
- [x] Page metadata renamed to FX Compass Pro

## Phase 1 — time and configuration (in progress)
- [x] `config/timeframes.ts` — single source for roles, durations, freshness
      limits, expiry, minimum bars, base-series mapping
- [x] `domain/states.ts` — the nine timeframe states, alignment, permission,
      lifecycle, score categories
- [x] `domain/clock.ts` — UTC storage, broker-server-time candle boundaries,
      real candle-close detection, DST-safe session logic
- [x] `domain/clock.test.ts`
- [ ] `config/strategy.ts` — versioned, content-hashed strategy configuration

## Phase 2 — data integrity
- [ ] `CandleSeries` provenance type; a bare `Candle[]` can no longer reach the engine
- [ ] Normalisation: duplicates, ordering, OHLC sanity, gaps, weekend gaps
- [ ] Session-aware resampling; partial buckets marked, never silently included
- [ ] Synthetic data hard-gated; sample candles can never vote

## Phase 3 — provider hardening
- [ ] `timezone=UTC`, timeouts, exponential backoff, 429 and quota handling
- [ ] Zod validation of every response; credit budget and token bucket
- [ ] Per-request logging; stale cache served as stale, never as fresh
- [ ] Real quote timestamps; estimated bid/ask labelled as estimates

## Phase 4 — the core fix
- [ ] Short-term direction and higher-timeframe bias computed separately
- [ ] Seven alignment labels
- [ ] Four permission modes, default STRICT
- [ ] Category-capped, independence-adjusted, explainable scoring
- [ ] Conflict caps the score; audit trail for every point

## Phase 5 — interface
- [ ] Signal card: direction never shown alone
- [ ] Expandable timeframe matrix, accessible, text plus colour
- [ ] "Why this signal?" audit panel and advanced view
- [ ] `PROVISIONAL — CANDLE NOT CLOSED` banner
- [ ] The words "not used" removed from the codebase

## Phase 6 — entry and risk
- [ ] Entry, stop, target, invalidation, R:R from documented rules
- [ ] No BUY/SELL without a valid invalidation and R:R
- [ ] Position sizing wired in; daily and simultaneous risk limits

## Phase 7 — persistence and lifecycle
- [ ] Drizzle schema on SQLite, D1-compatible
- [ ] Signal lifecycle with per-timeframe expiry
- [ ] Strategy versioning and candle snapshots for reproducibility

## Phase 8 — rule modules
- [ ] Each indicator and structure rule independently testable
- [ ] Repaint behaviour declared and tested
- [ ] Wilder's ATR; correlated rules grouped and counted once

## Phase 9 — backtesting
- [ ] Candle-by-candle replay with a look-ahead guard
- [ ] Spread, slippage, commission; same-candle stop/target sequencing
- [ ] Full metrics with sample sizes and segmentation

## Phase 10 — paper trading
- [ ] Simulated entries and exits, separate from backtest and live
- [ ] Signal expiry, manual accept/reject with recorded reason

## Phase 11 — news and sessions
- [ ] Free economic calendar with an honest unavailable state
- [ ] Session and liquidity context

## Phase 12 — broker comparison
- [ ] Manual bid/ask entry as source of truth
- [ ] Divergence panel and `PRICE SOURCE MISMATCH` block

## Phase 13 — security and observability
- [ ] Public endpoints behind a bearer token, shared poller, rate limits
- [ ] WebSocket with reconnect and subscription dedupe
- [ ] Admin/debug view; notification audit

## Phase 14 — assembly
- [ ] Dashboard sections, performance pass
- [ ] Final security and accessibility review, deployment checklist
