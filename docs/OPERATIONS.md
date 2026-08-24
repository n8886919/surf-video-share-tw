# Operations

## Resources and secrets

One Worker/Sites deployment, D1 database, Cloudflare Stream account, LINE Login channel, and marine/tide APIs. `.env.example` is the complete current variable checklist. Runtime secrets must be configured outside Git.

## Deploy

1. Review/replace D1 IDs and apply `drizzle/` migrations.
2. Configure LINE/session, Stream, and provider secrets.
3. Ensure production variables select real providers and do not enable dev auth.
4. Run `pnpm typecheck && pnpm test && pnpm build`.
5. Deploy manually; automatic production deploy remains disabled.

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
