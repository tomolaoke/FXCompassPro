# Environment variables

Copy `.env.example` to `.env` and fill it in. `.env` is git-ignored.

## The one rule that matters

**Never prefix a secret with `VITE_`.**

Vite inlines every `VITE_*` variable into the browser bundle at build time. A
variable named `VITE_TWELVEDATA_API_KEY` would be readable by anyone who opens
devtools on the deployed site — and, because it is baked into the bundle,
rotating it requires a rebuild and redeploy.

Every variable in this project is read server-side. The build fails if a
variable matching `VITE_.*(KEY|SECRET|TOKEN|PASSWORD)` is present.

### How server-only reads stay server-only

Secrets are read via `process.env` inside modules that end in `.server.ts`, or
inside modules dynamically imported within a `createServerFn` handler. Vite's
SSR boundary keeps those out of the client graph. If you `import` a
secret-reading module at the top level of a component file, the secret will be
bundled for the browser. Don't.

---

## Reference

### Market data

| Variable | Default | Purpose |
| --- | --- | --- |
| `TWELVEDATA_API_KEY` | *(empty)* | Twelve Data API key. Without it the app shows an explicit "no verified data" state rather than inventing prices. |
| `TWELVEDATA_CREDITS_PER_MIN` | `8` | Free-tier per-minute limit. The token bucket spaces requests to stay inside it. |
| `TWELVEDATA_CREDITS_PER_DAY` | `800` | Free-tier daily limit. Tracked and displayed on the provider-health page. |
| `TWELVEDATA_WEBSOCKET_ENABLED` | `false` | Enables the WebSocket quote feed. Not included in the free tier — leave off unless your plan supports it. REST polling is used regardless. |

Get a free key at <https://twelvedata.com/pricing>. See
[`data-providers.md`](data-providers.md) for the credit budget.

### Time

| Variable | Default | Purpose |
| --- | --- | --- |
| `BROKER_SERVER_TIMEZONE` | `Europe/Athens` | Your MT4/MT5 server's timezone. Candle buckets are aligned to it so the app's D1/W1/H4 candles match your terminal. |
| `DISPLAY_TIMEZONE` | `Africa/Lagos` | Timezone for every time shown to you. Storage is always UTC. |

`Europe/Athens` is EET/EEST — UTC+2 in winter, UTC+3 in summer — which is what
HF Markets and most MetaTrader brokers use. It places the daily candle close
around 17:00 America/New_York.

Buckets are computed in this zone rather than against a fixed New York hour,
because EU and US daylight-saving transitions are two to three weeks apart: in
late March and late October the broker's daily close really is 16:00 or 18:00
New York, not 17:00. Your terminal is the reference. If your broker uses a
different server time, change this or your higher-timeframe candles will not
match your charts.

`Africa/Lagos` is UTC+1 with no daylight saving.

### Database

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `file:./data/fxcompass.db` | Local SQLite file. Ignored in production on Cloudflare, where a D1 binding is used instead. |

### News

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEWS_CALENDAR_ENABLED` | `true` | Enables the free economic-calendar feed. |
| `NEWS_BUFFER_BEFORE_MINUTES` | `30` | Block or warn this long before a high-impact event. |
| `NEWS_BUFFER_AFTER_MINUTES` | `15` | Block or warn this long after one. |

When the feed is disabled, unreachable, or returns unusable data, the app shows
**NEWS CHECK UNAVAILABLE — VERIFY ECONOMIC CALENDAR MANUALLY**. It never treats
a failed lookup as "no news".

### Public API

`/api/public/feed` and `/api/public/events` exist for agent/MCP integration.
**They are disabled unless `PUBLIC_API_TOKEN` is set.**

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUBLIC_API_TOKEN` | *(empty)* | Bearer token required by both endpoints. Empty means both are off. |
| `PUBLIC_API_ALLOWED_ORIGINS` | *(empty)* | Comma-separated allowed origins. `*` is refused when a token is set. Empty means same-origin only. |

Generate a token with `openssl rand -hex 32`.

These endpoints previously ran unauthenticated with `Access-Control-Allow-Origin: *`,
and the feed opened a provider poll per connection — which let any caller drain
the API quota. They now require a token, share one poller across connections,
and are rate-limited.

### Development only

| Variable | Default | Purpose |
| --- | --- | --- |
| `ALLOW_DEMO_DATA` | `false` | Allows clearly-labelled synthetic sample candles so the interface can be reviewed without an API key. **Ignored when `NODE_ENV=production`.** Sample data is labelled everywhere it appears and can never produce a trade permission. |

---

## Deployment

On Cloudflare, set these as Worker secrets rather than plain variables:

```bash
wrangler secret put TWELVEDATA_API_KEY
wrangler secret put PUBLIC_API_TOKEN
```

Non-secret values (`DISPLAY_TIMEZONE`, buffers, limits) can be plain environment
variables. See [`deployment.md`](deployment.md).
