# Market Compass Pro

You are an expert MERN-stack full-stack software engineer, quantitative trading-systems architect, UX designer, security engineer, and professional market analyst.

Build a production-quality, mobile-first Progressive Web App called “Caveman Markets” for educational forex and gold analysis.

The user is an aggressive but rules-based trader. The app must never promise profits, guarantee win rates, claim certainty, fabricate prices, use insider information, or present AI output as financial advice. It must clearly display:

“Educational analysis only. Trading leveraged forex/CFDs can cause rapid losses. No signal is guaranteed.”

The application must be built with 100% free/open-source tools and free API tiers where available. Do not require paid infrastructure for local development. Make providers configurable so the user can replace data sources later.

Preferred stack:

- Frontend: React + TypeScript + Vite

- Styling: Tailwind CSS

- UI: shadcn/ui or another free accessible component library

- Charts: Lightweight Charts, Apache ECharts, or another free library

- Backend: Node.js + Express + TypeScript

- Database: MongoDB/MongoDB Atlas free tier, with a local JSON/in-memory fallback

- Authentication: JWT or a simple local demo mode

- AI: Groq API through the backend only; never expose the API key in the browser

- PWA: manifest, install prompt, service worker, offline shell, IndexedDB cache

- Notifications: Web Push API with VAPID keys; use a service worker

- Validation: Zod

- Testing: Vitest/Jest and Supertest

- Deployment-friendly: Render/Railway/free static hosting alternatives, but do not assume a paid service

The app must be fully responsive and work well on mobile screens.

==================================================

1. USER’S PERSONAL TRADING STRATEGY

==================================================

The user’s indicator is the Stochastic Oscillator with:

- K period: 25

- Slowing: 2

- D period: 4

- Levels: 20, 30, 70, 80

The strategy is multi-timeframe:

- Main timeframes: MN, W1, D1, H4, H1, M30, M15, M5

- The user may select which timeframes are required for confirmation.

- Default confirmation timeframes: D1, H4, H1, M30, M15.

- Execution timeframe: M15, with M5 optional for entry refinement.

Basic interpretation:

- Stochastic near or above 70/80 means price may be overextended upward; hunt for sells only after price-action confirmation.

- Stochastic near or below 30/20 means price may be overextended downward; hunt for buys only after price-action confirmation.

- Stochastic alone is never an entry signal.

- The app must warn that Stochastic can remain overbought in an uptrend and oversold in a downtrend.

The app must implement this sequence:

BUY candidate:

1. Required timeframes show oversold or recovering-from-oversold conditions.

2. Price is near a support zone, previous low, equal lows, previous-day low, previous-week low, order block, or fair-value-gap area.

3. Optional ICT-style confirmation:

   - sell-side liquidity sweep

   - bullish market-structure shift

   - displacement candle

   - bullish fair value gap or order-block retest

4. M15 closes bullish or confirms a bullish structure shift.

5. Entry is either:

   - market entry after confirmation, or

   - limit entry inside a validated bullish FVG/order block.

6. Stop-loss must be beyond the invalidation point, such as below the sweep low or structure low.

7. Take-profit targets should be based on opposing liquidity, support/resistance, previous highs, equal highs, previous-day high, or previous-week high.

SELL candidate:

1. Required timeframes show overbought or rolling down from overbought conditions.

2. Price is near resistance, previous high, equal highs, previous-day high, previous-week high, order block, or bearish FVG area.

3. Optional ICT-style confirmation:

   - buy-side liquidity sweep

   - bearish market-structure shift

   - displacement candle

   - bearish fair value gap or order-block retest

4. M15 closes bearish or confirms a bearish structure shift.

5. Entry is either:

   - market entry after confirmation, or

   - limit entry inside a validated bearish FVG/order block.

6. Stop-loss must be beyond the invalidation point, such as above the sweep high or structure high.

7. Take-profit targets should be based on opposing liquidity, support/resistance, previous lows, equal lows, previous-day low, or previous-week low.

==================================================

2. SUPPORTED INSTRUMENTS

==================================================

Default watchlist:

- XAUUSD

- EURJPY

- USDJPY

- EURUSD

- GBPUSD

- AUDUSD

Allow the user to add/remove instruments.

Do not hardcode market prices. Every displayed price must include:

- Provider name

- Timestamp

- Whether it is live, delayed, manually entered, or stale

- Bid and ask when available

- Spread when available

- Data quality indicator

==================================================

3. PRICE INPUTS

==================================================

The user must be able to:

A. Enter a broker price manually:

- Symbol

- Bid

- Ask

- Timestamp

- Optional screenshot upload

- Source label: “User broker input”

B. Use an external market-data provider:

- Provider adapter interface

- REST polling

- WebSocket adapter when available

- Graceful fallback to manual price

- No fake data in production mode

Create:

MarketDataProvider interface:

- getQuote(symbol)

- getCandles(symbol, timeframe, limit)

- getMarketStatus()

- getProviderHealth()

If an API does not support Gold or forex, clearly mark it unsupported. Do not silently substitute another instrument.

If real-time free data is unavailable:

- Tell the user “No verified real-time feed available.”

- Ask for the broker price.

- Use the broker price only for the final calculation.

- Never infer a live quote from an old search result.

==================================================

4. TECHNICAL ENGINE

==================================================

Implement deterministic calculations on the backend:

- Stochastic 25,2,4

- RSI as optional context, not a required signal

- ATR

- EMA/SMA

- Swing highs and lows

- Previous day/week/month high and low

- Support/resistance zones

- Equal highs/equal lows

- Liquidity sweep detection

- Market-structure shift detection

- Displacement candle detection

- Fair value gap detection

- Order-block approximation

- Session labels: Asia, London, New York

- Spread and volatility checks

The signal engine must return:

{

  symbol,

  direction: "BUY" | "SELL" | "WAIT",

  confidenceScore: 0-100,

  confidenceLabel: "LOW" | "MEDIUM" | "HIGH",

  setupType,

  entryZone,

  invalidationLevel,

  stopLoss,

  takeProfit1,

  takeProfit2,

  takeProfit3,

  riskRewardRatios,

  reasons[],

  warnings[],

  timeframeEvidence[],

  dataTimestamp,

  dataSource,

  expiresAt

}

Do not call confidenceScore a probability of winning unless it is statistically calibrated from a clearly documented backtest. Prefer labels such as “setup quality score.”

Signal rules:

- If prices are stale, return WAIT.

- If spreads exceed a configured threshold, return WAIT.

- If there is conflicting higher-timeframe evidence, reduce score or return WAIT.

- If the stop distance is too large for the user’s account risk rules, return WAIT.

- If a major scheduled event is close, show “news risk” and optionally block new entries.

- If price is already beyond the entry zone, mark the setup “MISSED—DO NOT CHASE.”

- Never create a signal solely from AI text.

==================================================

5. RISK AND POSITION-SIZE ENGINE

==================================================

User settings:

- Current account capital

- Account currency

- Maximum risk per trade percentage

- Maximum daily loss percentage

- Maximum open trades

- Maximum correlated exposure

- Broker contract size

- Pip/tick value

- Minimum lot

- Lot step

- Maximum lot

- Leverage, displayed as informational only

- Whether to allow partial profit-taking

Default risk:

- 1% per trade

- 2% maximum daily loss

- One primary position at a time

- No stacking unless explicitly enabled

Formula:

riskAmount = accountCapital * riskPercent / 100

The engine must calculate:

- Stop distance

- Pip/tick value

- Suggested lot size

- Maximum affordable lot size

- Expected loss at stop

- Expected gain at each target

- R:R to TP1, TP2, TP3

- Fees/spread estimate where available

If broker symbol specifications are missing, do not invent lot size. Display:

“Cannot safely calculate lot size until contract size and tick value are supplied.”

Add a “why this size?” explanation.

Add a hard warning:

“1.0 lot on a small account can cause rapid loss. Aggressive trading does not remove the need for a stop-loss.”

==================================================

6. AI INTEGRATION WITH GROQ

==================================================

Use Groq only on the backend.

Create an AI service with:

- Configurable GROQ_API_KEY

- Configurable GROQ_MODEL

- Timeout

- Retry with exponential backoff

- Rate-limit handling

- Response schema validation

- Prompt/version logging

- Fallback to deterministic analysis if AI fails

The AI must receive structured data, not raw ambiguous text:

- Verified quote

- Candle data

- Indicator values

- Structure levels

- News/event summaries from verified sources

- Account/risk settings

- Existing position data

The AI must not:

- Invent live prices

- Claim access to insider information

- Guarantee an 80–90% win rate

- Override risk limits

- Change stop-loss without user confirmation

- Place trades

- Pretend to be a licensed adviser

- Use “God mode” as a claim of certainty

Use AI for:

- Plain-English and Nigerian Pidgin explanation

- Explaining why a deterministic signal was generated

- Ranking watchlist setups

- Identifying conflicts and missing data

- Summarizing market news

- Generating a trading checklist

- Reviewing a completed trade

- Answering “why WAIT?” questions

AI output schema:

{

  summary,

  plainEnglishExplanation,

  pidginExplanation,

  primaryBias,

  setupQualityComment,

  risks[],

  missingData[],

  checklist[],

  disclaimer

}

Use this system prompt:

“You are a disciplined market-analysis assistant. Use only the verified structured inputs supplied. Never invent prices, dates, news, indicators, or broker specifications. Never guarantee profit or win rate. If data is stale, conflicting, or incomplete, say WAIT and explain what is missing. Separate deterministic calculations from interpretation. Respect the user’s risk limits. You may explain ICT-style concepts such as liquidity sweeps, market-structure shifts, displacement, fair value gaps, and order blocks, but you must not present them as guaranteed institutional knowledge or insider information.”

==================================================

7. DAILY SIGNALS

==================================================

Create a daily dashboard with:

- Market status

- Today’s event risk

- Watchlist bias

- Best candidate

- Setups to avoid

- Active signals

- Missed setups

- Expiring setups

- User’s current risk exposure

Signal states:

- WAIT

- WATCH

- READY

- TRIGGERED

- MISSED

- INVALIDATED

- EXPIRED

Never describe a WAIT as a BUY or SELL.

Each signal card must show:

- Symbol

- Direction

- Entry zone

- Stop

- TPs

- R:R

- Score

- Data age

- Trigger condition

- Invalidation condition

- News risk

- “Why this setup exists”

- “Why this setup may fail”

==================================================

8. NOTIFICATIONS AND BACKGROUND

==================================================

Implement Web Push notifications:

- Ask for permission only after user action.

- Store subscription securely.

- Service worker handles push events.

- Backend scheduler checks eligible conditions.

- Notify when:

  - Price enters entry zone

  - Confirmation candle appears

  - Signal is invalidated

  - TP1/TP2 is reached

  - Stop-loss zone is approached

  - Data feed goes stale

  - Major event is approaching

- Include notification throttling and deduplication.

- Allow per-symbol and per-event notification settings.

- Add quiet hours.

- Explain that browser/OS support may limit background behavior.

A PWA service worker can process push messages when the app is not open, but this must not be described as guaranteed background execution. [Insert citation/reference in documentation to MDN Push API guidance.]

==================================================

9. UX/UI

==================================================

Design a serious, clean, mobile-first trading dashboard:

- Dark theme by default

- Green/red only where meaningful; do not use color alone

- Large readable price and data-age badges

- Compact signal cards

- Expandable reasoning panel

- “Caveman English” toggle

- “Nigerian Pidgin” toggle

- Advanced technical view

- Chart with:

  - Candles

  - Entry zone

  - Stop-loss

  - TP lines

  - Support/resistance

  - FVGs

  - Liquidity highs/lows

  - Stochastic 25,2,4 panel

- Account/risk calculator

- Manual broker-price input modal

- Trade journal

- Backtest page

- Settings page

- API/data-provider health page

- Accessibility: keyboard navigation, readable contrast, semantic labels

- Skeleton states, empty states, error states, stale-data states

- Never make the interface look like a guaranteed signal-selling product

==================================================

10. TRADE JOURNAL

==================================================

Allow the user to record:

- Symbol

- Direction

- Planned entry

- Actual entry

- Stop

- Targets

- Lot size

- Risk amount

- Setup type

- Timeframes aligned

- Screenshot

- Reason for entry

- Emotional state

- Result

- Mistakes

- Lessons

Analytics:

- Win rate

- Average R

- Expectancy

- Profit factor

- Maximum drawdown

- Losing streak

- Results by symbol

- Results by timeframe

- Results by setup type

- Results by Stochastic state

- Results by session

- Results by news conditions

Do not optimize the strategy to achieve an artificial win rate. Show sample size and confidence intervals where possible.

==================================================

11. BACKTESTING

==================================================

Build a transparent backtester:

- User selects symbol, timeframe, date range, spread, commission, slippage

- Use historical candles only

- Apply the exact deterministic rules

- Show every trade on the chart

- Include out-of-sample testing

- Include walk-forward option if practical

- Prevent look-ahead bias

- Do not use future candles in signal generation

- Report:

  - Number of trades

  - Win rate

  - Average R

  - Expectancy

  - Drawdown

  - Profit factor

  - Losing streak

  - Best/worst period

  - Fees and slippage

Clearly say that backtest results do not guarantee live results.

==================================================

12. API AND SECURITY

==================================================

Backend:

- Never expose API keys to frontend.

- Validate all input with Zod.

- Rate-limit public endpoints.

- Authenticate private endpoints.

- Sanitize logs.

- Encrypt sensitive notification tokens where practical.

- Use environment variables.

- Add CORS configuration.

- Add health checks.

- Add audit logs for signal generation and user changes.

- Never accept AI output as executable trade instructions without deterministic validation.

Recommended API routes:

GET /api/market/quotes

GET /api/market/candles

POST /api/market/manual-quote

GET /api/signals/daily

POST /api/signals/evaluate

POST /api/risk/calculate

GET /api/events

POST /api/notifications/subscribe

DELETE /api/notifications/subscribe

GET /api/journal

POST /api/journal

PUT /api/journal/:id

GET /api/backtest

POST /api/ai/explain

GET /api/system/health

==================================================

13. DATA PROVIDER DESIGN

==================================================

Implement adapters, not hardcoded vendor assumptions:

- ManualBrokerProvider

- FreeForexProvider

- TwelveDataProvider if available within free limits

- AlphaVantageProvider if available within free limits

- Broker-specific adapter interface

- NewsProvider interface

- EconomicCalendarProvider interface

The user must be able to select a provider and enter API keys in environment variables.

If a free source cannot provide reliable real-time Gold/forex:

- display “No verified real-time data”

- disable automated live signals

- keep manual broker-price mode available

==================================================

14. DELIVERABLES

==================================================

Generate:

1. Full folder structure.

2. Frontend and backend source code.

3. MongoDB models.

4. REST API.

5. PWA manifest and service worker.

6. Web Push implementation.

7. Deterministic signal engine.

8. Stochastic 25,2,4 implementation.

9. ICT-style structure modules.

10. Risk and position-size engine.

11. Groq integration.

12. Seed/demo data.

13. Unit and integration tests.

14. .env.example.

15. README with setup instructions.

16. Security and limitations documentation.

17. Data-provider setup documentation.

18. Example screenshots or polished UI preview.

19. Docker Compose for local MongoDB and app.

20. Deployment instructions using free-compatible services.

Build in phases:

Phase 1: UI shell, local demo data, charts, settings.

Phase 2: deterministic indicators and signals.

Phase 3: risk calculator and journal.

Phase 4: provider adapters and manual broker input.

Phase 5: Groq explanation layer.

Phase 6: PWA and push notifications.

Phase 7: backtesting.

Phase 8: tests, security review, accessibility review, and production hardening.

At the end of each phase:

- Run tests.

- Show changed files.

- Explain how to run the app.

- List known limitations.

- Never claim completion if a feature is mocked.

Forgot to add this: add logs for records that  helps to record success rate of provided signals accross all currency pairs, ask if I took position to help take records of my wins and losse, accumulate it all in real time constntly.

Add an interactive dashboard and clean UI with excellent users experience.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/178080f5-95b6-4a35-b81a-ee60e62f400a).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
