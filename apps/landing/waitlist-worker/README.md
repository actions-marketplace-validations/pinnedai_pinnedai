# pinnedai waitlist worker

Tiny Cloudflare Worker that backs the Founder Pro waitlist form on
`pinnedai.dev`. Stores signups in a KV namespace; one record per email.

## Deploy

1. `cd apps/landing/waitlist-worker`
2. `npx wrangler login` (one time)
3. `npx wrangler kv:namespace create PINNED_WAITLIST` — copy the returned `id` into `wrangler.toml`
4. `npx wrangler kv:namespace create PINNED_WAITLIST --preview` — for `wrangler dev` (optional)
5. `npx wrangler deploy`
6. Copy the deployed URL (e.g. `https://pinned-waitlist.<your-account>.workers.dev`)
7. Set `VITE_PINNED_WAITLIST_ENDPOINT=<url>` when building the landing page (`pnpm --filter pinnedai-landing build`)

## API

- `POST /` — body `{ email, mostWantedFeature?, source }` — returns `{ ok: true }`
- `GET /count` — returns `{ count: N, truncated?: bool }` (for ops dashboards)
- CORS open to pinnedai.dev + localhost dev. Override via `ALLOWED_ORIGINS` env var (comma-separated).

## Read signups

```bash
npx wrangler kv:key list --binding=PINNED_WAITLIST
npx wrangler kv:key get --binding=PINNED_WAITLIST <email>
```

Or export to CSV:
```bash
for k in $(npx wrangler kv:key list --binding=PINNED_WAITLIST | jq -r '.[].name'); do
  npx wrangler kv:key get --binding=PINNED_WAITLIST "$k"
  echo ""
done > waitlist.jsonl
```

## Privacy

Each record stores: email, mostWantedFeature, source, submittedAt, User-Agent,
Cloudflare country code. No IP, no tracking pixel, no third-party analytics.
Delete a record: `npx wrangler kv:key delete --binding=PINNED_WAITLIST <email>`.
