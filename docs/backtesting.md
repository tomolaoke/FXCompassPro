# Backtesting

> **Backtest results are not predictions and are not guarantees.** They describe
> what a fixed set of rules would have done on one historical sample, under
> assumptions you chose. Read [Limitations](#limitations) before you draw any
> conclusion from a number in this section.

## How it works

The backtester replays history **candle by candle**, exactly as the live engine
reads it.

At each step the engine can see bars `0 … i` and nothing else. Indicators,
structure and levels are recomputed from that window only. There is no access to
`i + 1`, no full-series precomputation, and no "known" future extreme.

Configurable per run: instrument, timeframe, date range, strategy version,
permission mode (`STRICT`, `TREND_FOLLOWING`, `COUNTERTREND`, `MANUAL`), spread,
slippage, commission.

Every signal, entry, exit and the reason for each is recorded to
`backtest_trades`, so any result can be opened and inspected trade by trade.

### Look-ahead prevention

Three layers:

1. The replay slices the series; future bars are not in memory.
2. `closedThrough` is enforced — only closed candles are read.
3. A guard in the test suite runs a **deliberately cheating strategy** that
   reads a future candle. **The guard must catch it and fail the run.** If that
   test ever passes silently, every backtest number in the app is meaningless.

### Stop and target in the same candle

When a candle's range contains both the stop and the target, the outcome is
genuinely unknown without tick data — which is not available for free.

The assumption is configurable and recorded on every run:

| Setting | Behaviour |
| --- | --- |
| `STOP_FIRST` *(default)* | Assume the stop was hit. Pessimistic. |
| `TARGET_FIRST` | Assume the target was hit. Optimistic — treat any result produced this way with suspicion. |
| `EXCLUDE` | Discard the trade and report how many were discarded. |

The default is pessimistic on purpose. A backtest that flatters itself is worse
than no backtest.

### Costs

Spread is applied on entry and exit. Slippage is applied against you on both.
Commission is applied per lot per side where configured. All three are shown with
the results, because a strategy that only works at zero cost does not work.

## Metrics

| Metric | Definition |
| --- | --- |
| Number of trades | Sample size. Shown first, because everything else depends on it. |
| Net return | Total P/L after costs |
| Gross profit / gross loss | Sum of winners / sum of losers |
| Profit factor | Gross profit ÷ gross loss |
| Win rate | Winners ÷ settled trades |
| Average win / average loss | Mean of each |
| Expectancy | `(winRate × avgWin) − (lossRate × avgLoss)`, in R |
| Maximum drawdown | Largest peak-to-trough decline in equity |
| Maximum losing streak | Longest consecutive run of losses |
| Sharpe-like ratio | Mean return ÷ standard deviation of returns, per-trade, **not annualised** and not a true Sharpe ratio. Shown only above the minimum sample size. |

### Segmentation

Results are broken down by: session (Asia / London / New York / overlap) · day of
week · news condition (event nearby vs not vs unknown) · higher timeframes in
agreement vs in conflict · signal strength band.

The **agreement vs conflict** split is the one worth reading. It is the direct
measurement of whether the higher-timeframe filter this application is built
around actually changes outcomes on your data.

Every segment shows its own sample size. A 78% win rate over nine trades is
noise, and the interface presents it as such.

## Forward testing

Backtesting alone is not enough to justify trading a rule. Use the paper-trading
mode as well — it runs the same engine on live or delayed data, creates simulated
entries and exits, records spread and slippage assumptions, lets signals expire,
and records why you accepted or rejected each one.

**Paper results, backtest results and live results are stored separately and are
never combined.** Combining them would hide the difference between what a rule
did on curated history and what it does in real time.

## Market-closed policy

`evaluateSignal` is the one function both live analysis and backtest replay
call — there is no separate "backtest mode" strategy path. The market-closed
gate (readiness capped at WATCH, `MARKET_CLOSED` in `blockReasons`, whenever
the evaluated instant falls on a broker-closed weekend) therefore applies
during a backtest exactly as it does live, evaluated against **each bar's own
historical timestamp**, not the wall-clock time the backtest happens to run
at.

This is a deliberate choice, not an oversight: a real market was genuinely
closed at that historical weekend moment too, so a trade generated there could
not actually have been filled then either. Suppressing it makes the backtest
slightly *more* conservative near a weekend boundary, not less — the opposite
direction from a look-ahead bias. `runBacktest`'s regression suite pins this
(`replay.test.ts`, "market-closed policy") by asserting no trade's `session`
is ever `CLOSED`.

The gate only checks day-of-week (Saturday/Sunday in the broker's server
timezone) — it has no holiday calendar. A backtest run across a historical
market holiday will therefore not suppress trades that a real closed market
would have. This is a known, accepted gap, not a silent one: fixing it
properly needs a maintained historical holiday calendar per instrument, which
is out of scope for the free-tier data this project runs on.

## Limitations

- Results describe **one historical sample**, not the future.
- Spread, slippage and commission are **your assumptions**, not your broker's
  fills.
- Free historical data has limited depth, gaps, and occasional revisions. Data
  quality degrades noticeably the further back you go.
- Same-candle stop/target sequencing cannot be resolved correctly without tick
  data. See above.
- The engine reads the broker session boundaries configured in
  `BROKER_SERVER_TIMEZONE`. Backtesting against a different alignment than you
  trade produces results that do not transfer.
- **Small samples mean very little.** Sample size is displayed with every metric
  for exactly this reason.
- Repeatedly adjusting parameters until the results improve is curve-fitting.
  The strategy version hash on every run makes that visible — if you have thirty
  versions and kept the best one, you have measured luck.

Nothing in this module should be described, to yourself or anyone else, as a
guarantee, a prediction, or an expected win rate.
