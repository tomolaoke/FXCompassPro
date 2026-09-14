# Known limitations

An honest list. Read it before you rely on anything here.

## What this application is not

- **It is not financial advice.** It is a study and planning tool. Every
  decision, and every consequence, is yours.
- **It does not predict prices.** It describes what a fixed set of rules sees in
  past and present data.
- **It does not place orders** and has no connection to any broker's order
  system.
- **It is not a licensed advisory service** and does not claim any accuracy,
  profitability or win rate.

## Scoring

The setup-quality score is a **heuristic**, not a probability. It is not
calibrated against recorded outcomes. A score of 80 does not mean an 80% chance
of anything. It means the rules found more of what they look for than they did at
60. It is labelled as a heuristic everywhere it appears, and it will stay that
way until there is enough recorded live data to calibrate it — which may be
never.

## Data

- **Twelve Data's free tier is delayed, not real-time.** Quotes derive from the
  most recent completed bar. The app displays true data age; it does not round
  it down.
- **Bid and ask from the provider are estimated** from a typical spread unless a
  broker price has been entered. Estimated values are labelled. Do not size a
  stop against them.
- **Forex is decentralised.** Provider prices and your broker's prices differ,
  sometimes materially at session opens and around news. When a broker price is
  present it is used as the source of truth; when it is not, treat every price as
  indicative.
- **The free daily credit budget (800) limits refresh frequency.** A six-pair
  watchlist refreshes roughly every 30 minutes in the background. Fast scalping
  decisions are outside what this data supports.
- **Frankfurter is end-of-day ECB reference data** and does not cover gold.
- **Gaps happen.** Weekend gaps, holiday gaps and provider outages all occur.
  They are detected and reported rather than interpolated, but a gap in history
  still degrades any lookback that spans it.

## Timeframes and candles

- **Candle boundaries depend on a correct `BROKER_SERVER_TIMEZONE`.** The default
  matches HF Markets and most EET/EEST MetaTrader servers. If yours differs and
  you do not change it, your H4, D1, W1 and MN candles will not match your charts
  — and neither will the analysis.
- **Higher timeframes are rolled up from smaller base series**, so a W1 or MN
  candle is only as accurate as the D1 series behind it.
- **Monthly readings update slowly.** An MN Stochastic value changes a handful of
  times a year. Treat it as slow context, not a trigger.

## Rules

- **Some structure concepts are approximations of discretionary ideas.** Order
  blocks in particular are an approximation, not institutional fact. The app says
  so on the signal. Fair value gaps, liquidity sweeps and structure shifts are
  implemented to a specific written definition in
  [`strategy-rules.md`](strategy-rules.md); other traders define them
  differently and will disagree with specific readings.
- **Stochastic can remain overbought throughout an uptrend and oversold
  throughout a downtrend.** A stretched reading is not a reversal. This is the
  single most common way the primary rule fails, and it is stated on every
  signal.
- **Swing detection needs candles after the pivot to confirm it.** The most
  recent bars therefore cannot form confirmed swings, and near-term structure is
  always the least certain part of the reading.
- **Provisional readings change.** A signal built on an open candle can vanish
  when that candle closes. That is correct behaviour, not a bug.

## Backtesting

- **Backtest results are not predictions and are not guarantees.** They describe
  what a rule would have done on one historical sample, under assumptions.
- Spread, slippage and commission are **assumptions you configure**, not your
  broker's actual fills.
- Free historical data has limited depth and its own gaps and revisions.
- When stop-loss and take-profit are both touched within one candle, the
  sequencing assumption materially changes results. The assumption used is
  documented and configurable; it cannot be resolved correctly without tick data,
  which is not available for free.
- **Small sample sizes mean very little.** Sample size is displayed with every
  metric for that reason.

## Paper trading

- Fills are simulated at assumed prices with assumed spread and slippage. Real
  fills differ, especially around news and at session opens.
- Paper results are kept separate from backtest results and are never combined.

## News

- The free economic calendar is community-maintained and can change format or
  disappear without notice.
- **"News check unavailable" is not "no news."** The app distinguishes them; a
  failed lookup never becomes an all-clear.
- Unscheduled news — central bank remarks, geopolitics — is not covered by any
  calendar.

## Application

- **Single user.** There is no authentication and no multi-user isolation.
  Do not deploy it somewhere others can reach without adding auth first.
- **Local persistence.** Data lives in a local SQLite database (or Cloudflare D1)
  and in browser storage. Back it up yourself; there is no sync.
- **Notifications depend on browser and OS behaviour** and cannot be guaranteed
  to arrive, or to arrive on time, when the app is closed.
- **No live execution, by design.** Adding it would require a separate, explicit
  decision and a separate confirmation step.

## Testing

Automated tests cover the rules, the state machine, data-quality handling,
timezone and candle-boundary logic, look-ahead prevention and position sizing.
They verify that the code does what it is documented to do. **They cannot verify
that the strategy makes money**, and no test in this repository should be read
as evidence that it does.
