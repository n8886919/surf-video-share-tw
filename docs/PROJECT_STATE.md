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
| migration chain | not rerun; prior `0000`→`0004` SQLite integrity/foreign-key check passed | 2026-08-25 |

## Production status

- Do not deploy, migrate production D1, modify secrets, or delete production data without explicit authorization.
- The deployed Worker is reachable: `/health`, `/spots`, and a current `/matches` query returned `200` on 2026-08-28. Both launch spots are present, and the match response contained an ECMWF WAM snapshot issued by the deployed six-hour Cron that day.
- An unauthenticated production `/me` returned `401 UNAUTHENTICATED`, not `AUTH_NOT_CONFIGURED`; the currently deployed Worker therefore accepts its LINE/session configuration. The actual LINE redirect/callback has not been exercised in this checkpoint because it writes an OAuth attempt and requires the user.
- The read-only production preflight succeeded. `LINE_CHANNEL_SECRET`, `SESSION_SECRET`, and `CWA_API_KEY` are present; `CLOUDFLARE_STREAM_API_TOKEN` is missing. No secret or plaintext binding value was printed.
- A least-privilege Stream token is present only in the Windows git-ignored operation file and passed a read-only Stream API request. It has not been written to the production Worker.
- Production D1 has no pending migration. The current deployment from `2026-08-28T09:29:32.355038Z` sends 100% traffic to version `d1ed66b1-f421-43c3-9028-0cd221b5a84f`.
- The deployed script setting `observability.redact_query_string` is not enabled while `CWA_API_KEY` is present. Treat the current CWA key as potentially retained in observability and rotate it before any future CWA enablement.
- The deployed version is behind this local checkpoint. `CWA_QUERY_STRING_REDACTION_VERIFIED`, `UPLOAD_RATE_LIMITER`, and `PLAYBACK_RATE_LIMITER` are the only local bindings not present on the active version. Signed Stream upload/thumbnail/playback code is also not deployed.
- Real Stream upload, processing, thumbnail redirect, playback/origin control, deletion, and webhook behavior still need first-user or staging end-to-end verification.
- Cost alarms and staged reporting/delisting verification remain launch gates.
- CWA query-string redaction must be verified before production ingestion is enabled.

## Next task

Objective: with explicit owner authorization, remediate the two production gates and deploy the reviewed first-user build with CWA safely disabled.

Scope:

- Set the already verified, git-ignored least-privilege Stream token as the Worker secret `CLOUDFLARE_STREAM_API_TOKEN`; never print it, paste it into chat, or commit it.
- Keep `CWA_QUERY_STRING_REDACTION_VERIFIED=false` for this deployment. Separately patch and read back `observability.redact_query_string=true`, rotate `CWA_API_KEY`, and leave CWA guarded until a later reviewed enablement.
- Apply no D1 migration; the remote list is empty.
- Commit the reviewed local change set. Push/deploy only after explicit approval because GitHub `main` is connected to Workers Builds and the deploy command publishes production.
- After deployment, rerun `pnpm production:preflight` and require the Stream secret plus both rate-limit bindings to be present. Recheck redaction, health, spots, matches, and unauthenticated `/me` before the owner begins LINE Login.
- The owner then completes the real LINE redirect/callback and supplies one 5–60 second, at-most-200 MB test video captured within 168 hours for upload, processing, thumbnail, selected playback, reporting, and cleanup follow-up.

Done when:

- `CLOUDFLARE_STREAM_API_TOKEN` is present, the reviewed build is active, no unintended migration occurred, and CWA remains guarded.
- Post-deploy preflight and public smoke checks pass without exposing credentials.
- Real LINE Login reaches the signed-in UI and one real Stream video completes the user-visible upload-to-protected-playback path.

Out of scope: production secret changes, production migration/deploy, destructive production tests, condition-schema removal, and unrelated UI refactors.
