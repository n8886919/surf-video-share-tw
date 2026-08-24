# Operations

## Resources and secrets

One Worker deployment, D1 database, Cloudflare Stream account, LINE Login channel, and marine/tide APIs. `.env.example` is the complete current variable checklist. Runtime secrets must be configured outside Git.

LINE Login requires the exact deployed callback URL plus `LINE_CHANNEL_ID`, secret `LINE_CHANNEL_SECRET`, and secret `SESSION_SECRET`. Changing the callback origin requires updating both the LINE Developers Console and runtime configuration. Never put either secret in Git, browser code, D1, documentation, or chat.

## Deploy to the owner's Cloudflare account

1. The production D1 binding is `DB`; apply `drizzle/` migrations with `pnpm db:migrate:remote`.
2. Configure `LINE_CHANNEL_SECRET`, `SESSION_SECRET`, and `CLOUDFLARE_STREAM_API_TOKEN` as Worker secrets, never plaintext vars.
3. After the first deployment, set `LINE_CALLBACK_URL` and `PUBLIC_SITE_ORIGIN` to the exact `workers.dev` origin and update the LINE Developers Console callback.
4. Run `pnpm typecheck && pnpm test && pnpm build`.
5. Deploy with `pnpm deploy`, or connect the GitHub repository with Cloudflare Workers Builds and use `pnpm deploy` as its deploy command. This applies pending D1 migrations before publishing the Worker.

The Worker name in Cloudflare must remain `surf-video-share-tw` because Workers Builds requires it to match `wrangler.jsonc`.

Add preview/staging later as a separate Cloudflare environment with separate D1/Stream credentials, not shared production data.

## Backup and recovery

Export D1 before destructive migrations and periodically once user data exists. Stream is the blob system of record; D1 holds IDs/metadata, so both are required for full recovery. Test restore before relying on it.

## Cost monitoring

Watch Stream stored minutes, delivered minutes, abandoned upload reservations, Workers requests/CPU, D1 reads/writes/storage, and any external API plan. Do not hard-code prices; check current provider dashboards and terms. Set budget alerts below NT$1,000/month.

## Emergency controls

- Disable uploads: production config flag or temporarily reject `upload-request`; do not take the read path down.
- Compromised Stream/API key: revoke in provider console, create least-privilege replacement, update runtime secret, redeploy.
- Compromised LINE secret/session key: rotate, invalidate sessions, update secret, redeploy.
- Suspected abuse: disable uploads first, preserve logs/record IDs, then investigate.
