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
- New Stream uploads require signed URLs and restrict playback to the validated `PUBLIC_SITE_ORIGIN` hostname. Protected thumbnails use five-minute tokens and playback uses a `no-store` 15-minute iframe token. Unsigned legacy videos fail closed.
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
- Real LINE Login now completes the production redirect/callback, establishes the signed-in UI, and maps to the configured administrator through the internal UUID without returning the raw LINE subject from `/api/v1/me`.
- The first real Stream video completed direct upload, processing, public matching/thumbnail, explicit signed playback, and owner-confirmed picture/audio playback. The public D1 video ID is `51e42f58-4330-4519-a931-1386c361ce66`; its non-secret Stream UID is `18e8b3129d2fc2e736cf3e1a3ee919a5`.
- The E2E exposed Stream's transient `duration: 0` during initial processing. Commit `3bc48da` now treats non-positive duration as unavailable, waits for a positive real-provider duration before publication, and fails closed when a later verified duration is outside 5–60 seconds. Owner-list reconciliation uses the same rule. Workers Builds deployed it as version `d0fa3c7e-569e-4006-9756-b3475926d6a2` at 100% traffic.
- Migrations `0000` through `0004` exist. This checkpoint adds no schema migration.

## Verification

| Check | Result | Last run |
|---|---|---|
| `pnpm typecheck` | pass | 2026-08-28 |
| `pnpm test` | pass, 73 tests | 2026-08-28 |
| `pnpm lint` | pass | 2026-08-28 |
| `pnpm build` | pass | 2026-08-28 |
| rendered-site test | pass, 1 test | 2026-08-28 |
| `pnpm deploy:dry-run` | pass; generated files only, no deployment | 2026-08-28 |
| `wrangler deploy --dry-run` | pass; D1 plus both rate-limit bindings present | 2026-08-28 |
| Windows local development | pass; mock `.dev.vars`, local D1 `0000`–`0004`, home/health/spots/dev `/me` all returned `200` | 2026-08-28 |
| Windows Wrangler/preflight | pass; OAuth authenticated and production audit completed without `penguin` | 2026-08-28 |
| production post-deploy preflight | pass; Stream secret, both rate-limit bindings, no pending migration, and query-string redaction enabled | 2026-08-28 |
| production public smoke | pass; health/spots/current matches `200`, ECMWF WAM forecast present, unauthenticated `/me` returned `401 UNAUTHENTICATED` | 2026-08-28 |
| first-user LINE/Stream E2E | pass; real login, direct upload, ready/public lifecycle, signed thumbnail/playback, origin rejection, and owner-confirmed picture/audio | 2026-08-28 |
| migration chain | not rerun; prior `0000`→`0004` SQLite integrity/foreign-key check passed | 2026-08-25 |

## Production status

- Do not deploy, migrate production D1, modify secrets, or delete production data without explicit authorization.
- The deployed Worker is reachable: `/health`, `/spots`, and a current `/matches` query returned `200` on 2026-08-28. Both launch spots are present, and the match response contained an ECMWF WAM snapshot issued by the deployed six-hour Cron that day.
- Real production LINE redirect/callback and the signed-in UI succeeded with the owner. The resulting internal user ID matches `ADMIN_USER_ID`; `/api/v1/me` exposes no raw LINE subject.
- The post-deploy production preflight succeeded. `LINE_CHANNEL_SECRET`, `SESSION_SECRET`, `CWA_API_KEY`, and `CLOUDFLARE_STREAM_API_TOKEN` are present. The active version includes `CWA_QUERY_STRING_REDACTION_VERIFIED`, `UPLOAD_RATE_LIMITER`, and `PLAYBACK_RATE_LIMITER`; no secret or plaintext binding value was printed.
- Production D1 has no pending migration. The active deployment sends 100% traffic to the reviewed build with the configured Stream secret and rate-limit bindings.
- The deployed script setting `observability.redact_query_string` is enabled and was read back after the final deployment. `CWA_QUERY_STRING_REDACTION_VERIFIED` was separately confirmed as `false`, so CWA remains guarded and ECMWF WAM remains active.
- Because redaction was previously disabled while `CWA_API_KEY` was present, treat the current CWA key as potentially retained in observability. Revoke/rotate it at CWA before any future CWA enablement; do not change the application guard to `true` in the same unreviewed step.
- Real Stream direct upload, processing, public matching, signed thumbnail redirect, playback creation, correct-origin playback, wrong-origin playback rejection, and picture/audio playback succeeded. Cloudflare returned the signed thumbnail from a wrong `Referer` as well; this matches its documentation of Allowed Origins as a playback control, so the first-party thumbnail gate and five-minute signed token remain required.
- The first completion attempt failed because Stream transiently returned `duration: 0`. The owner-authorized recovery conditionally updated exactly one D1 row after Stream reported `ready` and `20.1` seconds. Commit `3bc48da` fixes the timing case in production; its five regression tests pass.
- With explicit owner approval, duplicate private Stream UID `04c511182f64c51ac6c9955f8a3f1fe3` was deleted with `200` and confirmed absent with `404`; only then was D1 video `08d8273d-ff01-4d01-bd45-e4605e0ace7b` conditionally deleted and confirmed absent. Public video `51e42f58-4330-4519-a931-1386c361ce66` remained `ready/public` and passed thumbnail/playback smoke afterward.
- The deployment reset script-level query-string redaction. The first partial PATCH was correctly rejected by read-back despite an API `success` response; a complete observability payload restored `redact_query_string: true`, and the final preflight read it back as enabled. CWA remained guarded throughout.
- General seven-day expiry deletion and webhook behavior still need staging or a separately approved safe verification.
- Cost alarms and staged reporting/delisting verification remain launch gates.
- CWA key revocation/rotation plus a fresh query-string-redaction read-back remain mandatory before production CWA ingestion is enabled.

## Next task

Objective: make every approved production deployment automatically restore and verify script-level query-string redaction.

Scope:

- Replace the manual post-deploy PATCH with a reviewed deploy step that sends the complete `observability` payload, then reads `observability.redact_query_string` back as exactly `true` and fails the deployment workflow otherwise.
- Do not print or persist the Workers Scripts Write credential. Keep the read-only preflight token separate from deploy credentials.
- Add tests for the exact PATCH payload and failed read-back behavior, then update `docs/OPERATIONS.md` with the automated recovery path.
- Separately verify upload/playback burst guards non-destructively. Exercise reporting/delisting, seven-day cleanup, and webhook behavior only in staging or with another reviewed safe procedure; do not shorten production expiry on user data.
- Before any CWA enablement, revoke/rotate the old CWA key, read back query-string redaction again, and obtain separate approval to change `CWA_QUERY_STRING_REDACTION_VERIFIED` from `false`.

Done when:

- A reviewed deployment automatically patches the complete observability setting and reads redaction back as enabled.
- A missing credential, rejected PATCH, or false/missing read-back fails closed with no secret value in output.
- Manual post-deploy redaction repair is no longer required.

Out of scope: additional production secret changes, production migrations, unrelated destructive production tests, CWA enablement, condition-schema removal, and unrelated UI refactors.
