# Operations

## Resources and secrets

One Worker deployment, D1 database, Cloudflare Stream account, LINE Login channel, and marine/tide APIs. Runtime secrets must be configured outside Git. `wrangler.jsonc` schedules forecast ingestion and expired-video cleanup at minute 20 every six UTC hours (`20 */6 * * *`). Cloudflare Cron schedules use UTC.

LINE Login requires the exact deployed callback URL plus `LINE_CHANNEL_ID`, secret `LINE_CHANNEL_SECRET`, and secret `SESSION_SECRET`. Changing the callback origin requires updating both the LINE Developers Console and runtime configuration. Never put either secret in Git, browser code, D1, documentation, or chat. Set non-secret `ADMIN_USER_ID` to the project owner's internal ID returned by `/api/v1/me`; without it, moderation endpoints fail closed for every user.

## Deploy to the owner's Cloudflare account

1. The production D1 binding is `DB`; apply `drizzle/` migrations with `pnpm db:migrate:remote`.
2. Configure `LINE_CHANNEL_SECRET`, `SESSION_SECRET`, `CLOUDFLARE_STREAM_API_TOKEN`, and `CWA_API_KEY` as Worker secrets, never plaintext vars. For example: `pnpm exec wrangler secret put CWA_API_KEY`.
3. After the first deployment, set `LINE_CALLBACK_URL` and `PUBLIC_SITE_ORIGIN` to the exact `workers.dev` origin and update the LINE Developers Console callback.
4. Run `pnpm typecheck && pnpm test && pnpm build`.
5. Deploy only after explicit approval. The current `pnpm deploy` applies pending remote D1 migrations before publishing, so it is intentionally not used during local product work.

The Worker name in Cloudflare must remain `surf-video-share-tw` because Workers Builds requires it to match `wrangler.jsonc`.

The Stream token must include `Stream Write`; the scheduled lifecycle job uses the official [delete-video API](https://developers.cloudflare.com/api/resources/stream/methods/delete/) after the seven-day pending window.

## Candidate thumbnails

- 找浪 comparison does not create a Stream player or request HLS/DASH manifests. Cloudflare documents that playback, preloading, and delivered video segments count toward [Stream delivery usage](https://developers.cloudflare.com/stream/pricing/), so players remain user-initiated work for the next checkpoint.
- The public thumbnail endpoint uses the official [retrieve-video-details API](https://developers.cloudflare.com/api/resources/stream/methods/get/) and adds the documented `time=1s`, `height=270`, and `fit=crop` [thumbnail parameters](https://developers.cloudflare.com/stream/viewing-videos/displaying-thumbnails/). Redirects are browser-private cached for five minutes.
- Videos marked `requireSignedURLs` return no thumbnail until the signed-token flow is implemented. Cloudflare requires the token to replace the video ID for protected thumbnails as well as playback; never fall back to an unsigned UID URL.

Add preview/staging later as a separate Cloudflare environment with separate D1/Stream credentials, not shared production data.

## Forecast ingestion

- Open-Meteo ECMWF WAM needs no secret. CWA is skipped, without blocking ECMWF, when `CWA_API_KEY` is absent.
- Before enabling CWA in production, set and verify `observability.redact_query_string: true` through Cloudflare's [Patch Script Settings API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/settings/methods/edit/). CWA requires its authorization value in provider query strings, so production observability must not retain query parameters. The Wrangler schema does not currently accept this script-level setting in `wrangler.jsonc`; adding it there only warns and is ignored. Re-verify it after every deployment until Wrangler supports the field.
- Each run logs one structured `forecast_ingestion` summary. A partial provider failure is a warning; the scheduled invocation fails only when every configured provider fails.
- CWA ZIP input is streamed with compressed/XML/file-count limits. Only leads `0, 3, …, 72` are decompressed. Do not change this to extract the full archive without measuring Worker CPU and memory first.
- D1 writes use chunks of 50 and `INSERT OR IGNORE`. Re-running the same upstream content should report duplicates, not create another copy.
- For local Cron testing after local migrations, run the Worker and call `/cdn-cgi/handler/scheduled?cron=20+*/6+*+*+*&time=<unix-seconds>` as documented by Cloudflare. Never put a real CWA key in a URL, log, fixture, or Git.
- Before enabling production, verify one scheduled invocation against production-like D1 and inspect the structured result. Code-level provider and current-format parsing are tested locally; the deployed Cron/D1 path is not yet verified.

## Expired-video cleanup

- Every scheduled invocation selects at most 50 globally expired incomplete videos. Opening 「我的」 also checks up to 10 videos owned by that user.
- Cleanup first claims a row through a conditional D1 update. Metadata completion uses the same optimistic concurrency fields, so only one side can proceed.
- A failed or interrupted provider deletion remains private and can be retried after a 15-minute lease. An already absent Stream object counts as the desired deleted state so a stale D1 row can be removed.
- Inspect the structured `expired_video_cleanup` log for `selected`, `claimed`, `deleted`, `failed`, and `skipped`. Per-video failures are isolated; fatal D1/provider configuration errors fail the scheduled invocation without cancelling the independently executed forecast task.
- Before public rollout, exercise one expiry against staging Stream and D1 and verify both the Stream object and D1 row are gone. Do not shorten production expiry to perform this test on user data.

## Backup and recovery

Export D1 before destructive migrations and periodically once user data exists. Stream is the blob system of record; D1 holds IDs/metadata, so both are required for full recovery. Test restore before relying on it.

`ops/bootstrap-production.sql` is only the historical one-time Console bootstrap through migration `0002`; it intentionally lives outside `drizzle/` and must never be applied as a normal Wrangler migration.

## Cost monitoring

Watch Stream stored minutes, delivered minutes, abandoned upload reservations, Workers requests/CPU, D1 reads/writes/storage, and any external API plan. Do not hard-code prices; check current provider dashboards and terms. Set budget alerts below NT$1,000/month.

## Emergency controls

- Disable uploads: production config flag or temporarily reject `upload-request`; do not take the public read path down.
- Compromised Stream/API key: revoke in provider console, create least-privilege replacement, update runtime secret, redeploy.
- Compromised LINE secret/session key: rotate, invalidate sessions, update secret, redeploy.
- Suspected abuse: disable uploads first, preserve logs/record IDs, then investigate.
- Reported media: review the open report under 我的 → 設定. The one-action delist clears `public_at`, marks the video `delisted`, and resolves all open reports for that video; it does not revoke existing CC0 copies.
