# Project state

Updated: 2026-08-28. This describes the current local worktree; production may be behind it.

## Completed checkpoint

- React/Hono/D1 modular monolith, LINE auth/session, direct Stream uploads, public reports, administrator delisting, and the three-tab mobile UI exist locally.
- Public matching uses immutable, provider-separated CWA and ECMWF WAM forecast snapshots. Current and historical sides select the newest run available at the relevant time; models are never averaged.
- Six-hour Cron ingestion isolates provider failures and preserves run/valid/grid provenance.
- Expired pending videos now have a six-hour global cleanup with bounded batches, optimistic D1 claims, retry leases, structured results, and owner-list fallback cleanup.
- Spot CSV seeding handles LF and CRLF checkouts while keeping only 烏石港 and 雙獅 active.
- Deterministic matching now reports target-available weight, candidate-matched weight, and coverage; candidates below 50% coverage cannot enter a provider/model ranking.
- Observation, forecast, match-group, and public-match response types are shared through `packages/api-contract`. Worker serializers, the public match route, and the React find flow compile against them.
- 找浪 presents a 0–100 similarity index separately from data coverage instead of probability-like match copy.
- Each match group now returns its fixed target forecast and every candidate video's same-source historical forecast. 找浪 keeps the target card fixed while horizontally scrolling aligned candidate forecast cards.
- Public candidate cards use lazy Stream still thumbnails through a first-party lifecycle-checking endpoint. The comparison creates no player and requests no HLS/DASH manifest or video segment; only the selected candidate expands.
- The selected candidate now has an explicit play action. It repeats the complete/ready/public/terms/visible D1 boundary and only then creates provider playback data; selection alone still causes no video delivery.
- New Stream uploads require signed URLs and restrict delivery to the validated `PUBLIC_SITE_ORIGIN` hostname. Protected thumbnails use five-minute tokens and playback uses a `no-store` 15-minute iframe token. Unsigned legacy videos fail closed.
- Stream thumbnail and playback lookup stay behind the video-provider interface. Incomplete, non-ready, unversioned, private, delisted, provider-mismatched, and provider-error cases fail closed without exposing Stream credentials or unsigned UIDs.
- Cost-bearing upload-ticket creation is limited to three requests per user per minute. Playback-token creation is limited to 20 requests per HMAC-pseudonymized client per minute. Rejected bursts return `429` before Stream or D1 video-write cost; missing production bindings fail closed.
- Wrangler configuration contains separate Rate Limiting API namespaces for upload and playback, and the rebuilt deployment artifact exposes both bindings.
- `pnpm production:preflight` now provides a repeatable read-only remote audit. It lists secret names, active version binding names/types, pending migration filenames, and query-string redaction status while omitting all secret and plaintext binding values.
- The preflight explicitly prefers a nonblank process token and otherwise parses `.env.cloudflare-readonly`; an inherited blank environment variable can no longer suppress the ignored file.
- CWA ingestion now requires both `CWA_API_KEY` and `CWA_QUERY_STRING_REDACTION_VERIFIED=true`. The reviewed first-user configuration sets the guard to `false`, so a deployment cannot issue credential-bearing CWA queries until redaction has been read back as enabled. ECMWF WAM remains independent.
- The Windows workstation is now self-contained for this project: Node 22, the repository-pinned pnpm 11 shim, GitHub reads, Wrangler OAuth, local D1, mock-only development, builds, dry-runs, and production read-only preflight all run without the former `penguin` environment. The transferred Wrangler credential was verified on Windows and removed from `penguin`.
- `.dev.vars.example` is the tracked mock-only Worker development template; the real `.dev.vars` is git-ignored. Local Vite therefore uses development auth plus mock video/conditions and does not load the ignored production-operation token files.
- `@cloudflare/vite-plugin` is pinned to `1.54.1`, Wrangler to `4.127.0`, and matching Worker types to `5.20260826.1`. Their workerd `1.20260826.1` supports the configured `2026-08-24` compatibility date; the previous runtime stopped local development before startup.
- With owner authorization, commits `2e529e5` and `ead0f41` were pushed to `main` and the reviewed first-user build was published by Workers Builds. The production Stream secret and both rate-limit bindings are present, and script-level query-string redaction was patched and read back after the latest deployment.
- Migrations `0000` through `0004` exist. This checkpoint adds no schema migration.

## Verification

| Check | Result | Last run |
|---|---|---|
| `pnpm typecheck` | pass | 2026-08-28 |
| `pnpm test` | pass, 68 tests | 2026-08-28 |
| `pnpm lint` | pass | 2026-08-28 |
| `pnpm build` | pass | 2026-08-28 |
| rendered-site test | pass, 1 test | 2026-08-28 |
| `pnpm deploy:dry-run` | pass; generated files only, no deployment | 2026-08-28 |
| `wrangler deploy --dry-run` | pass; D1 plus both rate-limit bindings present | 2026-08-28 |
| Windows local development | pass; mock `.dev.vars`, local D1 `0000`–`0004`, home/health/spots/dev `/me` all returned `200` | 2026-08-28 |
| Windows Wrangler/preflight | pass; OAuth authenticated and production audit completed without `penguin` | 2026-08-28 |
| production post-deploy preflight | pass; Stream secret, both rate-limit bindings, no pending migration, and query-string redaction enabled | 2026-08-28 |
| production public smoke | pass; health/spots/current matches `200`, ECMWF WAM forecast present, unauthenticated `/me` returned `401 UNAUTHENTICATED` | 2026-08-28 |
| migration chain | not rerun; prior `0000`→`0004` SQLite integrity/foreign-key check passed | 2026-08-25 |

## Production status

- Do not deploy, migrate production D1, modify secrets, or delete production data without explicit authorization.
- The deployed Worker is reachable: `/health`, `/spots`, and a current `/matches` query returned `200` on 2026-08-28. Both launch spots are present, and the match response contained an ECMWF WAM snapshot issued by the deployed six-hour Cron that day.
- An unauthenticated production `/me` returned `401 UNAUTHENTICATED`, not `AUTH_NOT_CONFIGURED`; the currently deployed Worker therefore accepts its LINE/session configuration. The actual LINE redirect/callback has not been exercised in this checkpoint because it writes an OAuth attempt and requires the user.
- The post-deploy production preflight succeeded. `LINE_CHANNEL_SECRET`, `SESSION_SECRET`, `CWA_API_KEY`, and `CLOUDFLARE_STREAM_API_TOKEN` are present. The active version includes `CWA_QUERY_STRING_REDACTION_VERIFIED`, `UPLOAD_RATE_LIMITER`, and `PLAYBACK_RATE_LIMITER`; no secret or plaintext binding value was printed.
- Production D1 has no pending migration. The active deployment sends 100% traffic to the reviewed build with the configured Stream secret and rate-limit bindings.
- The deployed script setting `observability.redact_query_string` is enabled and was read back after the final deployment. `CWA_QUERY_STRING_REDACTION_VERIFIED` was separately confirmed as `false`, so CWA remains guarded and ECMWF WAM remains active.
- Because redaction was previously disabled while `CWA_API_KEY` was present, treat the current CWA key as potentially retained in observability. Revoke/rotate it at CWA before any future CWA enablement; do not change the application guard to `true` in the same unreviewed step.
- Real Stream upload, processing, thumbnail redirect, playback/origin control, deletion, and webhook behavior still need first-user or staging end-to-end verification.
- Cost alarms and staged reporting/delisting verification remain launch gates.
- CWA key revocation/rotation plus a fresh query-string-redaction read-back remain mandatory before production CWA ingestion is enabled.

## Next task

Objective: complete the owner-driven production identity and one-video Stream end-to-end check against the deployed first-user build.

Scope:

- The owner completes the real LINE redirect/callback and confirms that `/api/v1/me` reaches the signed-in UI without exposing the raw LINE subject.
- The owner supplies one 5–60 second, at-most-200 MB test video captured within 168 hours.
- Exercise direct upload, Stream processing readiness, metadata completion, public thumbnail, explicit selected playback, and origin/signed-URL behavior. Record the resulting non-secret IDs and statuses needed for follow-up.
- Verify the upload/playback burst guards in a non-destructive way, then exercise reporting/delisting and seven-day cleanup in staging or with a separately reviewed safe procedure; do not shorten production expiry on user data.
- Before any CWA enablement, revoke/rotate the old CWA key, read back query-string redaction again, and obtain separate approval to change `CWA_QUERY_STRING_REDACTION_VERIFIED` from `false`.

Done when:

- Real LINE Login reaches the signed-in UI.
- One real Stream video completes the user-visible upload-to-protected-playback path with signed delivery and the expected public/private lifecycle.
- Any observed production/provider mismatch is documented without exposing credentials, and destructive follow-up remains separately authorized.

Out of scope: additional production secret changes, production migration/deploy, destructive production tests, CWA enablement, condition-schema removal, and unrelated UI refactors.
