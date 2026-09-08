# Caveman Markets — roadmap

## Phase 1 — UI shell (in progress)
- [ ] Dark, mobile-first dashboard shell + disclaimer banner
- [ ] Watchlist (XAUUSD, EURJPY, USDJPY, EURUSD, GBPUSD, AUDUSD), add/remove
- [ ] Chart with candles + Stochastic 25/2/4 panel
- [ ] Settings (risk, timeframes, providers)
- [ ] Demo/seed candle data (clearly labelled DEMO)

## Phase 2 — deterministic engine
- [ ] Stochastic 25,2,4, RSI, ATR, EMA/SMA, swings, PDH/PDL/PWH/PWL
- [ ] Equal highs/lows, liquidity sweeps, MSS, displacement, FVG, order blocks
- [ ] Sessions, spread/volatility checks, signal engine + states

## Phase 3 — risk + journal
- [ ] Position size engine, "why this size?", hard warnings
- [ ] Trade journal + analytics (win rate, R, expectancy, profit factor, drawdown)
- [ ] Signal outcome logging: "did you take this position?" prompt, live-updating success records per pair

## Phase 4 — providers
- [ ] MarketDataProvider interface, ManualBrokerProvider, free provider adapters
- [ ] Provider health page, stale/manual/delayed badges

## Phase 5 — AI (Groq-style explanation layer)
- [x] Enable AI key for the project
- [ ] Server-side explain endpoint, schema-validated output, EN/Pidgin/Caveman toggles

## Phase 6 — PWA + push
- [ ] Manifest, install support, offline shell, IndexedDB cache
- [ ] Web Push with VAPID, throttling, quiet hours

## Phase 7 — backtesting
- [ ] Transparent backtester, no look-ahead, full metrics

## Phase 8 — hardening
- [ ] Tests, security + accessibility review, docs (README, limitations, providers)

## Extra requests
- [ ] Agent integrations (MCP) server exposing the app's analysis tools
