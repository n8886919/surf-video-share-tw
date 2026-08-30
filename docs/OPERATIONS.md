# Operations

## Resources and secrets

One Worker deployment, D1 database, Cloudflare Stream account, LINE Login channel, and marine/tide APIs. Runtime secrets must be configured outside Git. `wrangler.jsonc` schedules forecast ingestion and expired-video cleanup at minute 20 every six UTC hours (`20 */6 * * *`). Cloudflare Cron schedules use UTC.

LINE Login requires the exact deployed callback URL plus `LINE_CHANNEL_ID`, secret `LINE_CHANNEL_SECRET`, and secret `SESSION_SECRET`. Changing the callback origin requires updating both the LINE Developers Console and runtime configuration. Never put either secret in Git, browser code, D1, documentation, or chat. Set non-secret `ADMIN_USER_ID` to the project owner's internal ID returned by `/api/v1/me`; without it, moderation endpoints fail closed for every user.

On iPhone, [LINE documents that auto login can fail](https://developers.line.biz/en/docs/line-login/how-to-handle-auto-login-failure/) in Safari Private Browsing or because of OS/browser Universal Link behavior. An expired/mismatched callback or failed token exchange therefore presents a visible retry action that starts a fresh OAuth attempt with `disable_auto_login=true`; do not weaken the one-time `state`, `nonce`, or PKCE checks to work around the failure. For acceptance, test normal Safari first with Private Browsing off, then the manual retry screen. LINE's [auto-login compatibility FAQ](https://developers.line.biz/en/faq/tags/line-login/) lists Safari, rather than other iOS browsers, for the external-browser path, so use Safari or LINE's in-app browser when validating automatic login.

### Windows workstation

- Use Node.js 22 or newer. The repository pins `pnpm@11.19.0` through `packageManager`; enable the Corepack pnpm shim in a user-writable directory if `pnpm` is not on PATH.
- Copy `.dev.vars.example` to the git-ignored `.dev.vars` before starting Vite. This file is deliberately mock-only and must not contain LINE, Stream, CWA, or production session secrets.
- Authenticate the workstation with `pnpm exec wrangler login` when production reads or an approved deployment are needed. Prefer a fresh OAuth login over copying Wrangler's `default.toml`, which contains renewable credentials.
- Keep the read-only production token and Stream runtime token only in the git-ignored `.env.cloudflare-readonly` and `.env.cloudflare-stream-runtime` files used by the reviewed operations flow. Neither file is loaded by local Vite development.

## Deploy to the owner's Cloudflare account

1. The production D1 binding is `DB`; reviewed deployments apply pending `drizzle/` migrations before publishing.
2. Configure `LINE_CHANNEL_SECRET`, `SESSION_SECRET`, `CLOUDFLARE_STREAM_API_TOKEN`, and `CWA_API_KEY` as Worker secrets, never plaintext vars. For example: `pnpm exec wrangler secret put CWA_API_KEY`.
3. After the first deployment, set `LINE_CALLBACK_URL` and `PUBLIC_SITE_ORIGIN` to the exact `workers.dev` origin and update the LINE Developers Console callback.
4. Run `pnpm typecheck && pnpm test && pnpm build`.
5. Deploy only after explicit approval. `pnpm deploy` requires a Workers Scripts Write plus D1 Edit deployment credential before making changes, applies pending remote migrations, publishes the Worker, PATCHes the complete script-level `observability` object, and immediately reads it back. The command fails unless `enabled: true`, `head_sampling_rate: 1`, and `redact_query_string: true` are all present after deployment.

Workers Builds supplies its deployment token only inside Workers CI. For an approved local deployment, set `CLOUDFLARE_DEPLOY_API_TOKEN` in the parent process or in the git-ignored `.env.cloudflare-deploy`; do not place it in `.env.cloudflare-readonly`, documentation, chat, or Git. An inherited `CLOUDFLARE_API_TOKEN` is deliberately ignored outside Workers CI so a read-only audit token cannot be mistaken for deployment authority. The deployment script prints progress only and never prints token or Cloudflare response contents.

An approved operator who is already authenticated through `wrangler login` may instead run `pnpm deploy:oauth`. The script calls `wrangler auth token --json`, keeps the returned OAuth token only in process memory, and never prints it. `pnpm production:redaction:oauth` provides the equivalent redaction-only recovery.

The repository cannot force the account-owned Workers Builds deploy command. In Cloudflare Dashboard → Worker → Settings → Build, set the production deploy command to exactly `pnpm deploy` and ensure its build token has Workers Scripts Write plus D1 Edit. Framework auto-detection can otherwise invoke the Vinext Cloudflare deploy CLI directly, bypassing both migrations and the post-deploy redaction repair even though the repository script is correct. Treat a `main` push as unsafe until the post-deploy preflight confirms no pending migrations and redaction enabled.

If publication succeeds but the PATCH or read-back fails, `CWA_QUERY_STRING_REDACTION_VERIFIED=false` keeps credential-bearing CWA requests disabled. Correct the credential or transient Cloudflare failure and run `pnpm production:redaction` (or `pnpm production:redaction:oauth` for a logged-in operator); this repeats only the complete PATCH and read-back, without publishing or migrating again. Do not change the CWA guard in the same recovery step.

The Worker name in Cloudflare must remain `surf-video-share-tw` because Workers Builds requires it to match `wrangler.jsonc`.

### Read-only production preflight

Before requesting migration or deploy approval, create the git-ignored `.env.cloudflare-readonly` locally with one line, `CLOUDFLARE_API_TOKEN=<scoped token>`. Do not paste the token into chat, commit it, or reuse the Stream runtime token. At this stage the token needs only account-scoped Workers Scripts Read and D1 Read permissions.

Run `pnpm production:preflight`. The script performs only reads: secret-name listing, latest deployment/version binding inspection, pending D1 migration listing, and the official script-settings query for `observability.redact_query_string`. Its output intentionally excludes secret values and plaintext binding values. Remove the local token file after the reviewed deployment work is complete.

The Stream token must include `Stream Write`; the scheduled lifecycle job uses the official [delete-video API](https://developers.cloudflare.com/api/resources/stream/methods/delete/) after the seven-day pending window.

## Stream delivery and owner downloads

- Candidate and owner lists do not create a Stream player or request HLS/DASH manifests. Cloudflare documents that playback, preloading, and delivered video segments count toward [Stream delivery usage](https://developers.cloudflare.com/stream/pricing/), so only an explicit thumbnail play action creates playback data and opens one modal player.
- The public thumbnail endpoint uses the official [retrieve-video-details API](https://developers.cloudflare.com/api/resources/stream/methods/get/) and adds the documented `time=1s`, `height=270`, and `fit=crop` [thumbnail parameters](https://developers.cloudflare.com/stream/viewing-videos/displaying-thumbnails/). Redirects are browser-private cached for five minutes.
- New uploads set `requireSignedURLs: true` and `allowedOrigins` to the hostname derived from validated HTTPS `PUBLIC_SITE_ORIGIN`. A missing or malformed origin fails before Stream creates an upload ticket. Cloudflare documents Allowed Origins as a playback control over embeds, manifests, and segments; the first-user E2E confirmed a wrong-origin iframe receives `403`.
- Protected thumbnails receive a five-minute signed token and protected playback receives a 15-minute signed iframe token through Cloudflare's low-volume token endpoint. The token replaces the video ID; never fall back to an unsigned UID URL. Playback API responses are `no-store`. Stream thumbnails require the signed token but are not blocked by the playback origin allowlist, so the first-party lifecycle check and short token lifetime remain their access boundary.
- Actual-play feedback uses the official [Stream Player API](https://developers.cloudflare.com/stream/viewing-videos/using-the-stream-player/using-the-player-api/) `playing` event. The browser submits a 15-minute application HMAC token once per opened player; D1 stores only the random event ID, video ID, and server timestamp. Owner self-play is excluded when the LINE session is present. The six-hour Cron deletes events older than 90 days in batches of at most 500; inspect `playback_event_cleanup` logs.
- The low-volume endpoint is appropriate for the first-user rollout, but every play and protected thumbnail miss makes control-plane requests. Watch token request volume and Stream delivery minutes; keep candidate images lazy, cache thumbnail redirects privately for five minutes, and do not preload iframe players.
- Repeated-owner-playback evaluation found no application-layer cache that can prove lower delivered video bytes without keeping a player/media response alive after the modal closes. Token-response caching would reduce only control-plane calls and could skip a fresh lifecycle check. The app therefore keeps `no-store`, revalidates each explicit opening, and relies only on Stream/browser HTTP media caching; reconsider only with measured Stream delivery evidence.
- Link sharing creates `/v/:videoId?share=<opaque>` with a fixed 24-hour lifetime through Web Share or clipboard fallback. Link/page/thumbnail creation performs no Stream media request. On explicit shared playback, an anonymous viewer consumes one of the exporter's 100 monthly grants before the provider call; a signed-in viewer consumes none. All exporter links created in the same Taipei month share the counter, and provider failures after reservation are not refunded. Delisting still blocks playback immediately.
- Owner download uses Stream's [download-video API](https://developers.cloudflare.com/stream/viewing-videos/download-videos/) to generate an encoded MP4. The owner route polls generation state and, once ready, creates a 15-minute token with `downloadable: true`; it never returns an unsigned UID or the original upload. Video bytes travel from Stream to the browser, never through the Worker. Do not claim a specific share target or permanent MP4 URL is guaranteed.

Add preview/staging later as a separate Cloudflare environment with separate D1/Stream credentials, not shared production data.

## Forecast ingestion

- Open-Meteo ECMWF WAM needs no secret. CWA is skipped, without blocking ECMWF, when `CWA_API_KEY` is absent or `CWA_QUERY_STRING_REDACTION_VERIFIED` is not exactly `true`. The reviewed production configuration keeps that guard `false`. The authorization code was replaced on 2026-08-30, but the first real CWA Cron trial consumed about 2 seconds of CPU and ended with `exceededCpu` on Workers Free before any CWA snapshot was written.
- Each Open-Meteo request asks for 168 hourly ECMWF WAM forecast hours. This covers Taipei day offsets 0–6 at 05:00–19:00; CWA remains independently bounded to its verified 0–72-hour leads and may be absent on days four through seven.
- Before enabling CWA in production, set and verify `observability.redact_query_string: true` through Cloudflare's [Patch Script Settings API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/settings/methods/edit/). Send a complete valid `observability` object including `enabled`, the intended `head_sampling_rate`, and `redact_query_string`; the first-user deployment showed that a partial nested payload can return API `success` while leaving script settings absent. CWA requires its authorization value in provider query strings, so production observability must not retain query parameters. The Wrangler schema does not currently accept this script-level setting in `wrangler.jsonc`; adding it there only warns and is ignored. Re-verify it after every deployment until Wrangler supports the field.
- Never set the application guard to `true` based only on an intended dashboard/API change. Read the deployed script setting back as `true` with `pnpm production:preflight` first. If redaction was ever disabled while a CWA key was active, treat that key as potentially retained in observability and rotate it before re-enabling ingestion.
- Each run logs one structured `forecast_ingestion` summary. A partial provider failure is a warning; the scheduled invocation fails only when every configured provider fails.
- CWA ZIP input is streamed with compressed/XML/file-count limits. Only leads `0, 3, …, 72` are decompressed. Do not change this to extract the full archive without measuring Worker CPU and memory first.
- D1 writes use chunks of 50 and `INSERT OR IGNORE`. Re-running the same upstream content should report duplicates, not create another copy.
- For local Cron testing after local migrations, run the Worker and call `/cdn-cgi/handler/scheduled?cron=20+*/6+*+*+*&time=<unix-seconds>` as documented by Cloudflare. Never put a real CWA key in a URL, log, fixture, or Git.
- Workers Free allows only 10 ms CPU for a Cron invocation. CWA F-A0020-001 officially provides a whole ZIP rather than a filterable REST response, and the bounded parser cannot safely fit that limit. The preferred next step is Workers Paid (US$5/month, still below the product budget), an explicit conservative `limits.cpu_ms`, and one temporary verification Cron before restoring `20 */6 * * *`. Do not repeatedly retry the archive on Free. A chunked R2/Queue design is a later alternative only if avoiding the paid plan is worth the added architecture and operations burden.

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

## Cost-bearing route limits

- `UPLOAD_RATE_LIMITER` permits three upload-ticket creations per internal user ID per 60 seconds. It runs after input/spot validation and before Stream ticket creation or the D1 video insert.
- `PLAYBACK_RATE_LIMITER` permits 20 playback-token creations per privacy-preserving client key per 60 seconds. The key is an HMAC of Cloudflare's client address using `SESSION_SECRET`; raw addresses are not logged, stored in D1, or passed as limiter keys.
- In addition to that burst limiter, official share links use the exact D1 `share_playback_budgets` counter: 100 anonymous playback grants per exporter and `Asia/Taipei` creation month. This is an application cost budget, not a Cloudflare Rate Limiting API counter. Monitor exhausted-budget `429` responses and compare aggregate counters with Stream delivered minutes; changing 100 or the 24-hour TTL is a product/cost decision.
- `DOWNLOAD_RATE_LIMITER` permits 20 owner MP4 prepare/status requests per internal user ID per 60 seconds. It runs only after the ownership and public-lifecycle lookup and before any Stream control-plane request; the five-second client poll cadence stays within this burst ceiling.
- `PUBLIC_WRITE_RATE_LIMITER` permits three requests per 60 seconds within each `line-login`, `problem-report`, or `video-report` scope. The scoped key suffix is an HMAC of the Cloudflare client address using `SESSION_SECRET`; scopes do not consume one another's counters, and the raw address is never stored or used as a limiter key. Rejection occurs before OAuth/report D1 access.
- All four bindings use separate account-unique namespaces in `wrangler.jsonc`; the three public-write scopes intentionally share the fourth binding and namespace. A rejected request returns `429` and `Retry-After: 60`; upload/playback/download rejection creates no Stream control-plane request, and public-write rejection creates no D1 read/write. A missing or failed binding returns `503` in production; explicit development mode may run without a binding for deterministic unit/local work.
- Cloudflare documents the [Workers Rate Limiting API](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) counters as per-location, permissive, and eventually consistent. They are a burst guard, not billing-grade accounting or a substitute for Stream/Workers budget alerts. Monitor Worker `429` logs and provider usage, and disable uploads if usage is abnormal.

## Emergency controls

- Disable uploads: production config flag or temporarily reject `upload-request`; do not take the public read path down.
- Compromised Stream/API key: revoke in provider console, create least-privilege replacement, update runtime secret, redeploy.
- Compromised LINE secret/session key: rotate, invalidate sessions, update secret, redeploy.
- Suspected abuse: disable uploads first, preserve logs/record IDs, then investigate.
- Reported media: an authorized administrator sees the moderation queue directly in 「我的」; ordinary users never load it. The one-action delist clears `public_at`, marks the video `delisted`, and resolves all open reports for that video; it does not revoke existing CC0 copies.
