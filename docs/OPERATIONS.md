# Operations

## Resources and secrets

One Worker deployment, D1 database, Cloudflare Stream account, LINE Login channel, and marine/tide APIs. Runtime secrets must be configured outside Git. `wrangler.jsonc` schedules forecast ingestion at minute 20 every six UTC hours (`20 */6 * * *`). Cloudflare Cron schedules use UTC.

LINE Login requires the exact deployed callback URL plus `LINE_CHANNEL_ID`, secret `LINE_CHANNEL_SECRET`, and secret `SESSION_SECRET`. Changing the callback origin requires updating both the LINE Developers Console and runtime configuration. Never put either secret in Git, browser code, D1, documentation, or chat. Set non-secret `ADMIN_USER_ID` to the project owner's internal ID returned by `/api/v1/me`; without it, moderation endpoints fail closed for every user.

## Deploy to the owner's Cloudflare account

1. The production D1 binding is `DB`; apply `drizzle/` migrations with `pnpm db:migrate:remote`.
2. Configure `LINE_CHANNEL_SECRET`, `SESSION_SECRET`, `CLOUDFLARE_STREAM_API_TOKEN`, and `CWA_API_KEY` as Worker secrets, never plaintext vars. For example: `pnpm exec wrangler secret put CWA_API_KEY`.
3. After the first deployment, set `LINE_CALLBACK_URL` and `PUBLIC_SITE_ORIGIN` to the exact `workers.dev` origin and update the LINE Developers Console callback.
4. Run `pnpm typecheck && pnpm test && pnpm build`.
5. Deploy only after explicit approval. The current `pnpm deploy` applies pending remote D1 migrations before publishing, so it is intentionally not used during local product work.

The Worker name in Cloudflare must remain `surf-video-share-tw` because Workers Builds requires it to match `wrangler.jsonc`.

Add preview/staging later as a separate Cloudflare environment with separate D1/Stream credentials, not shared production data.

## Forecast ingestion

- Open-Meteo ECMWF WAM needs no secret. CWA is skipped, without blocking ECMWF, when `CWA_API_KEY` is absent.
- Each run logs one structured `forecast_ingestion` summary. A partial provider failure is a warning; the scheduled invocation fails only when every configured provider fails.
- CWA ZIP input is streamed with compressed/XML/file-count limits. Only leads `0, 3, …, 72` are decompressed. Do not change this to extract the full archive without measuring Worker CPU and memory first.
- D1 writes use chunks of 50 and `INSERT OR IGNORE`. Re-running the same upstream content should report duplicates, not create another copy.
- For local Cron testing after local migrations, run the Worker and call `/cdn-cgi/handler/scheduled?cron=20+*/6+*+*+*&time=<unix-seconds>` as documented by Cloudflare. Never put a real CWA key in a URL, log, fixture, or Git.
- Before enabling production, verify one scheduled invocation against production-like D1 and inspect the structured result. Code-level provider and current-format parsing are tested locally; the deployed Cron/D1 path is not yet verified.

## Backup and recovery

Export D1 before destructive migrations and periodically once user data exists. Stream is the blob system of record; D1 holds IDs/metadata, so both are required for full recovery. Test restore before relying on it.

## Cost monitoring

Watch Stream stored minutes, delivered minutes, abandoned upload reservations, Workers requests/CPU, D1 reads/writes/storage, and any external API plan. Do not hard-code prices; check current provider dashboards and terms. Set budget alerts below NT$1,000/month.

## Emergency controls

- Disable uploads: production config flag or temporarily reject `upload-request`; do not take the public read path down.
- Compromised Stream/API key: revoke in provider console, create least-privilege replacement, update runtime secret, redeploy.
- Compromised LINE secret/session key: rotate, invalidate sessions, update secret, redeploy.
- Suspected abuse: disable uploads first, preserve logs/record IDs, then investigate.
- Reported media: review the open report under 我的 → 設定. The one-action delist clears `public_at`, marks the video `delisted`, and resolves all open reports for that video; it does not revoke existing CC0 copies.
