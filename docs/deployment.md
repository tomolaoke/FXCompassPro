# Deployment checklist

The project deploys at **zero cost**. Cloudflare Workers' free tier serves the
app, and Cloudflare D1 (free tier, SQLite) holds the database. The Nitro build
already targets Cloudflare.

---

## Before every deploy

### Security

- [ ] No `VITE_*` variable holds a key, secret, token or password.
      The build fails if one does — do not bypass it.
- [ ] `TWELVEDATA_API_KEY` is set as a **secret**, not a plain variable.
- [ ] Grep the built client bundle for the key value. It must not appear:
      `grep -r "$TWELVEDATA_API_KEY" .output/public/`
- [ ] `PUBLIC_API_TOKEN` is either unset (endpoints off) or a freshly generated
      32-byte value. Never a guessable string.
- [ ] `PUBLIC_API_ALLOWED_ORIGINS` does not contain `*`.
- [ ] `ALLOW_DEMO_DATA` is `false`, and `NODE_ENV=production` (which ignores it
      regardless).
- [ ] No real account balance, broker credential or personal data is committed.
- [ ] `.env` is not committed. Confirm with `git check-ignore -v .env`.

### Correctness

- [ ] `bun run check` passes — typecheck, lint and the full test suite.
- [ ] The `short-term-bull-higher-bear` regression test passes. It must never
      produce a plain BUY.
- [ ] The backtest look-ahead guard test passes — the deliberately cheating
      strategy is caught.
- [ ] `BROKER_SERVER_TIMEZONE` matches your broker. Open the app and compare its
      D1 and H4 candles against your terminal before trusting anything.
- [ ] `DISPLAY_TIMEZONE` is correct for you.
- [ ] Database migrations are applied.

### Data

- [ ] Twelve Data key is valid and the daily credit budget is realistic for the
      configured watchlist size and refresh interval.
- [ ] The provider-health page loads and reports real status.
- [ ] With the key deliberately removed, the app shows an explicit
      "no verified data" state — **not** synthetic prices.

### Interface

- [ ] A green BUY/SELL badge does not appear for any conflict, provisional,
      no-trade or data-error state.
- [ ] The string "not used" appears nowhere: `grep -ri "not used" src/`
- [ ] The disclaimer is visible on every page.
- [ ] No Lovable branding remains in page metadata.
- [ ] Keyboard navigation reaches every control; timeframe states are announced
      by a screen reader, not conveyed by colour alone.

---

## Deploying

```bash
# once
bun add -d wrangler
wrangler login
wrangler d1 create fxcompass

# put the database_id from that output into wrangler.toml, then
bun run db:migrate:remote

wrangler secret put TWELVEDATA_API_KEY
wrangler secret put PUBLIC_API_TOKEN      # only if enabling the public API

bun run build
wrangler deploy
```

Non-secret configuration (`DISPLAY_TIMEZONE`, `BROKER_SERVER_TIMEZONE`, news
buffers, credit limits) goes in `wrangler.toml` under `[vars]`.

### Free-tier limits to stay inside

| Resource | Free allowance |
| --- | --- |
| Workers requests | 100,000/day |
| Worker CPU | 10 ms/request |
| D1 rows read | 5,000,000/day |
| D1 rows written | 100,000/day |
| D1 storage | 5 GB |

Signal evaluation runs well inside the CPU budget. Candle snapshots are the main
storage consumer — retention is configurable, and old snapshots are pruned.

---

## After deploying

- [ ] Load every page. Check for console errors.
- [ ] Confirm the provider-health page shows a recent successful update.
- [ ] Confirm data ages are plausible — **not negative, not zero**. A future or
      zero timestamp means the quote timestamp is being fabricated.
- [ ] Trigger a signal and open "Why this signal?". The audit trail and strategy
      version must both be present.
- [ ] Confirm the public API endpoints are off, or reject a request without a
      bearer token.
- [ ] Back up the database. There is no sync and no managed backup.

---

## Rollback

Workers keeps prior versions:

```bash
wrangler deployments list
wrangler rollback <version-id>
```

D1 migrations are **not** rolled back by this. Take a D1 export before any
migration that drops or rewrites a column:

```bash
wrangler d1 export fxcompass --output backup-$(date +%F).sql
```

---

## Alternatives

Any static-plus-serverless host with a free tier works — Netlify, Vercel's hobby
tier, Deno Deploy — provided environment variables stay server-side. If you move
off Cloudflare, replace D1 with Turso (free tier, libSQL, same SQLite dialect and
the same Drizzle schema) rather than rewriting the data layer.

Running it only on your own machine is also completely valid, and is the most
private option: `bun run build && bun run start`, with the SQLite file local.
