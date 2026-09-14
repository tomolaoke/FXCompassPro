# Deployment checklist

The project deploys at **zero cost**. The live app runs on Vercel's free tier;
the database is [Turso](https://turso.tech) (free tier, SQLite over libSQL).

---

## Before every deploy

### Security

- [ ] No `VITE_*` variable holds a key, secret, token or password.
      The build fails if one does — do not bypass it.
- [ ] `TWELVEDATA_API_KEY` is set as a Vercel environment variable, not
      committed anywhere.
- [ ] Grep the built client bundle for the key value. It must not appear:
      `grep -r "$TWELVEDATA_API_KEY" .output/public/`
- [ ] `PUBLIC_API_TOKEN` is either unset (endpoints off — the default) or a
      freshly generated 32-byte value. Never a guessable string.
- [ ] `PUBLIC_API_ALLOWED_ORIGINS` does not contain `*`.
- [ ] `ALLOW_DEMO_DATA` is unset or `false`. It is ignored outright in
      production regardless (`NODE_ENV=production`, which Vercel sets
      automatically), so sample data can never appear on the live site.
- [ ] No real account balance, broker credential or personal data is committed.
- [ ] `.env` is not committed. Confirm with `git check-ignore -v .env`.

### Correctness

- [ ] `bun run check` passes — typecheck, lint and the full test suite.
- [ ] The regression-lock tests in `engine/evaluate.test.ts` pass. A
      short-term-bullish / higher-timeframe-bearish fixture must never produce
      a plain BUY or a FULLY ALIGNED label.
- [ ] The backtest look-ahead guard test passes, once the backtester exists —
      the deliberately cheating strategy must be caught.
- [ ] `BROKER_SERVER_TIMEZONE` matches your broker. Open the app and compare
      its D1 and H4 candles against your terminal before trusting anything.
- [ ] `DISPLAY_TIMEZONE` is correct for you.

### Data

- [ ] Twelve Data key is valid and the daily credit budget is realistic for the
      configured watchlist size and refresh interval — see
      `docs/data-providers.md`.
- [ ] With the key deliberately removed, the app shows an explicit
      "no verified data" state, not synthetic prices standing in for real ones.

### Interface

- [ ] A green BUY/SELL badge does not appear for any conflict, provisional,
      no-trade or data-error state.
- [ ] The string "not used" appears nowhere: `grep -ri "not used" src/`
- [ ] The disclaimer is visible on every page.
- [ ] Keyboard navigation reaches every control; timeframe states are announced
      by a screen reader, not conveyed by colour alone.

---

## First-time setup

### 1. Database (Turso)

```bash
turso auth signup                     # or: turso auth login
turso db create fxcompass
turso db show fxcompass --url         # → DATABASE_URL
turso db tokens create fxcompass      # → DATABASE_AUTH_TOKEN
```

Tables are created automatically on first request — there is no separate
migration command to run against the deployed database.

### 2. Environment variables (Vercel)

In the Vercel project → **Settings → Environment Variables**, add for
**Production** (and Preview, if preview deployments should share live data —
otherwise give Preview its own Turso database):

| Variable | Value |
| --- | --- |
| `TWELVEDATA_API_KEY` | from https://twelvedata.com/pricing |
| `DATABASE_URL` | the `libsql://...` URL from `turso db show` |
| `DATABASE_AUTH_TOKEN` | the token from `turso db tokens create` |
| `BROKER_SERVER_TIMEZONE` | e.g. `Europe/Athens` for HF Markets / most MT4/MT5 servers |
| `DISPLAY_TIMEZONE` | e.g. `Africa/Lagos` |
| `PUBLIC_API_TOKEN` | only if you want the `/api/public/*` agent-integration endpoints on |

See `.env.example` and `docs/environment.md` for the full list.

### 3. Deploy

Push to the connected branch — Vercel builds and deploys automatically. No
CLI deployment step is required once the repository is connected.

---

## Free-tier limits to stay inside

| Resource | Free allowance |
| --- | --- |
| Vercel serverless function executions | 100,000/month (Hobby) |
| Vercel function duration | 10s default (Hobby) |
| Turso rows read | 500M/month |
| Turso rows written | 10M/month |
| Turso storage | 5 GB, 500 databases |
| Twelve Data API credits | 800/day, 8/minute |

Twelve Data is the binding constraint in practice — see
`docs/data-providers.md` for the credit budget a watchlist actually costs.

---

## After deploying

- [ ] Load every page. Check for console errors.
- [ ] Confirm data ages are plausible — **not negative, not zero**. A future or
      zero timestamp means a quote timestamp is being fabricated somewhere.
- [ ] Record a signal from the dashboard, then confirm a row appears via
      `getSignalHistoryFn` (or query the Turso database directly with
      `turso db shell fxcompass "select * from signals order by created_at desc limit 5"`).
- [ ] Confirm the public API endpoints reject a request without a bearer
      token, or are off entirely (`PUBLIC_API_TOKEN` unset).
- [ ] `turso db shell fxcompass ".dump" > backup-$(date +%F).sql` — there is no
      automatic backup.

---

## Rollback

Vercel keeps every previous deployment. From the project's **Deployments**
tab, use **Promote to Production** on an earlier one — no CLI needed.

Database changes are not rolled back by a Vercel rollback. Take a Turso dump
(above) before any change that drops or rewrites a column, since the schema is
applied with `CREATE TABLE IF NOT EXISTS` rather than tracked migrations — see
`src/lib/db/client.server.ts`.

---

## Alternatives

Any static-plus-serverless host with a free tier works — Netlify, Cloudflare
Workers, Deno Deploy — provided environment variables stay server-side and
outbound HTTP to `api.twelvedata.com` and the Turso endpoint is allowed. Turso
speaks plain libSQL over HTTP, so the database layer does not need to change
between hosts.

Running it only on your own machine is also completely valid, and is the most
private option: `bun run build && bun run start`, with `DATABASE_URL` pointed
at a local file instead of Turso.
