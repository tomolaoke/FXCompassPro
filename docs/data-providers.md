# Data providers

Every source used by this project is free. No paid tier is required to develop,
test or run it.

| Provider | Role | Key | Cost |
| --- | --- | --- | --- |
| **Twelve Data** | Primary — historical OHLC and quotes | Required | Free tier |
| **Frankfurter (ECB)** | Fallback — daily reference FX rates | None | Free |
| **Manual broker entry** | Source of truth for entry, stop, target, spread | None | Free |
| **Economic calendar** | High-impact news risk | None | Free |

---

## Twelve Data

Sign up at <https://twelvedata.com/pricing> and put the key in `.env` as
`TWELVEDATA_API_KEY`. It is read server-side only.

### Free-tier limits

| Limit | Value |
| --- | --- |
| Credits per minute | 8 |
| Credits per day | 800 |
| WebSocket | Not included |
| Max `outputsize` | 5000 |

One `time_series` request costs 1 credit. Exceeding the per-minute limit returns
HTTP 429; exceeding the daily limit returns a `{"status":"error"}` envelope with
HTTP 200 — both are handled explicitly.

### Base series

Eight timeframes are served by **three** requests per symbol, chosen so that
every timeframe gets enough history for a Stochastic(25,2,4) reading plus its
structure lookbacks:

| Base request | `outputsize` | Covers | Bars available after rollup |
| --- | --- | --- | --- |
| `5min` | 1500 | M5, M15, M30 | 1500 / 500 / 250 |
| `1h` | 2000 | H1, H4 | 2000 / 500 |
| `1day` | 1200 | D1, W1, MN | 1200 / ~240 / ~55 |

> **Why H4 comes from H1, not M5.** The original implementation rolled M5 up into
> everything through H4. 1500 M5 bars is about five trading days — roughly 31 H4
> bars — and Stochastic(25,2,4) needs about 31 bars to produce a single value. H4
> was therefore either dropped or produced one meaningless reading. Since H4 is
> one of the two context timeframes that matter most, it now comes from a
> dedicated H1 base series.

Every request sends `&timezone=UTC` so timestamps are unambiguous. Bars are then
re-bucketed to broker session boundaries — see [Candle alignment](#candle-alignment).

### Credit budget

Defaults, for a six-pair watchlist during market hours:

| Series | TTL | Refreshes/day | Credits/day (6 pairs) |
| --- | --- | --- | --- |
| `5min` | 30 min | ~32 | 192 |
| `1h` | 2 h | ~8 | 48 |
| `1day` | 12 h | 2 | 12 |
| **Background total** | | | **~252** |
| Remaining for on-demand | | | **~548** |

The symbol you are actively viewing refreshes faster than the background scan.
A token bucket spaces requests so a cold scan (18 requests) is spread across
about three minutes instead of hitting the 8/minute wall.

Live credit usage is shown on the provider-health page. When the daily budget is
exhausted the app says so and stops requesting — it does not fall back to
synthetic data.

### Error handling

| Condition | Behaviour |
| --- | --- |
| HTTP 429 | Exponential backoff with jitter; logged; surfaced on the health page |
| `{"status":"error"}` | Message parsed and surfaced; no retry for quota errors |
| Timeout | `AbortSignal.timeout()`; request abandoned and logged |
| Malformed / missing fields | Zod validation fails; series marked `DATA_MISSING` |
| Cached data served after a failure | Marked `DATA_STALE` with its true age — **never relabelled as fresh** |

Every request logs: request time, response time, provider timestamp, local
receipt timestamp, HTTP status, candle count, missing fields, data freshness, and
whether a fallback was used.

### WebSocket

Supported in code, disabled by default (`TWELVEDATA_WEBSOCKET_ENABLED=false`)
because the free tier does not include it. When enabled: connection status and
reconnection attempts are displayed, subscriptions are de-duplicated across
reconnects, sockets are closed on unmount, and REST polling remains the fallback.

---

## Frankfurter

<https://frankfurter.dev> — free, no key, no rate limit. Serves ECB **daily
reference rates**, published once per working day around 16:00 CET.

Used only as a last-resort sanity price. It is:

- **not** suitable for execution, entry, stop or target calculation
- **not** available for XAU (gold) or any metal
- always labelled `DATA_DELAYED` with its true publication timestamp

---

## Manual broker entry

Forex is decentralised. Twelve Data's price is an aggregate; your broker's price
is what you actually trade. They differ, and the difference matters for stops.

HF Markets does not publish a public retail REST API, so broker prices are
entered manually: symbol, bid, ask, timestamp, optional screenshot, labelled
`User broker input`.

**When a broker price is present it is the source of truth** for entry,
stop-loss, take-profit and spread. The provider price becomes a cross-check.

The comparison panel shows provider mid, broker bid/ask/mid, spread, absolute
difference, difference in pips, and each source's timestamp. Beyond the
configurable tolerance:

> **PRICE SOURCE MISMATCH — DO NOT TRADE UNTIL VERIFIED**

Manual entries go stale like any other source, and say so.

*Possible later, still free:* a local bridge using the `MetaTrader5` Python
package on Windows, POSTing live bid/ask from your own terminal to the app. It
reads only; it never places orders.

---

## Economic calendar

Free calendar feeds are community-maintained and can change format or go away
without notice. The app therefore treats the calendar as **unreliable by
design**:

- responses are schema-validated and cached
- a failure, a timeout, an unexpected shape or a disabled feed all produce
  **NEWS CHECK UNAVAILABLE — VERIFY ECONOMIC CALENDAR MANUALLY**
- events can be entered manually, and manual entries are marked as such
- "news data unavailable" and "no news" are different states and always look
  different

Displayed per event: time in your timezone, currency affected, title, impact
level, and time remaining. Only events affecting a currency in the pair are
considered. The block/warn buffer is configurable
(`NEWS_BUFFER_BEFORE_MINUTES`, `NEWS_BUFFER_AFTER_MINUTES`).

---

## Candle alignment

Storage is UTC. Display is your local timezone. **Bucketing is neither** — it
follows your broker's session.

MetaTrader brokers do not use UTC day boundaries. HF Markets, like most, runs an
EET/EEST server (UTC+2 winter, UTC+3 summer), which places the daily candle close
around 17:00 New York.

Buckets are computed in **broker server time**, not in UTC and not against a
fixed New York hour:

| Timeframe | Boundary (broker server time) |
| --- | --- |
| M5 / M15 / M30 / H1 | Clock-aligned within the broker day |
| H4 | 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 |
| D1 | Broker midnight |
| W1 | Broker Monday 00:00 — this is what puts the Sunday-evening open bar into the correct week |
| MN | First broker day of the calendar month |

> **Why the broker's timezone rather than "17:00 New York".** European and US
> daylight-saving transitions are two to three weeks apart. In late March and
> late October the broker's daily close is genuinely *not* 17:00 New York — it
> is 16:00 or 18:00. Anchoring to a fixed New York hour would silently misalign
> D1, W1 and H4 for several weeks each year. The terminal is the reference.

Configured by `BROKER_SERVER_TIMEZONE`. If yours differs, change it — otherwise
the app's higher-timeframe candles will not match the ones on your screen.

### Normalisation

Before anything reads a series it is normalised, and every correction is
recorded on the series' provenance:

duplicates removed · out-of-order bars sorted · OHLC sanity checked
(`h ≥ max(o,c)`, `l ≤ min(o,c)`, all finite) · missing bars detected and recorded
as gaps · weekend gaps recognised rather than treated as missing data · the
still-forming bucket marked `open` rather than silently included.

`closedThrough` records the last fully-closed candle. Confirmed signals may only
use data up to that timestamp.

---

## Adding a provider

Implement `MarketDataProvider` in `src/lib/market/data/provider.ts`:

```ts
getQuote(symbol)          → Quote
getCandles(symbol, tf, n) → CandleSeries   // provenance is not optional
getMarketStatus()         → MarketStatus
getProviderHealth()       → ProviderHealth
```

A provider must report freshness honestly, must never fabricate bid/ask from a
mid price without marking them estimated, and must never substitute a different
instrument for an unsupported one — unsupported means unsupported.
