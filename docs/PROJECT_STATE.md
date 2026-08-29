# Project state

Updated: 2026-08-29. This describes the current local worktree; production may be behind it.

## Completed checkpoint

- React/Hono/D1 modular monolith, LINE auth/session, direct Stream uploads, public reports, administrator delisting, and the three-tab mobile UI exist locally.
- The product name is now 「彼日浪影」 in rendered metadata, the visible brand, navigation, README, package metadata, and product/principles documentation. The canonical `PROJECT_PURPOSE` value remains unchanged and tested.
- LINE registration now has a database-enforced 100-user ceiling. Existing users remain eligible at capacity; a verified new LINE subject is conditionally inserted only below the cap, and otherwise receives a generic capacity screen without a user or session row.
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
- Owner cards now expose 「分享我的影片」 only for the authenticated owner's complete, ready, terms-versioned, moderation-visible public rows. The provider creates or polls Stream's encoded MP4, then returns a `no-store` 15-minute token with download permission; the Worker never proxies media bytes or promises the original upload.
- The share UI uses two explicit user actions: first prepare/fetch the MP4, then open the system Web Share sheet. It checks file-share capability, keeps a conservative 50 MiB native-share ceiling, and retains 「下載 MP4（非原始檔）」 for unsupported browsers, large files, and Stream delivery CORS failures. Specific target apps are not promised.
- New Stream uploads require signed URLs and restrict playback to the validated `PUBLIC_SITE_ORIGIN` hostname. Protected thumbnails use five-minute tokens and playback uses a `no-store` 15-minute iframe token. Unsigned legacy videos fail closed.
- Stream thumbnail and playback lookup stay behind the video-provider interface. Incomplete, non-ready, unversioned, private, delisted, provider-mismatched, and provider-error cases fail closed without exposing Stream credentials or unsigned UIDs.
- Cost-bearing upload-ticket creation is limited to three requests per user per minute. Playback-token creation is limited to 20 requests per HMAC-pseudonymized client per minute, and owner MP4 preparation/status is limited to 20 requests per user per minute. Rejected bursts return `429` before Stream or D1 video-write cost; missing production bindings fail closed.
- A compact global 「問題回報」 pill opens a single 5–300 character textarea and success state without requiring login or contact information. The current `find`/`upload`/`mine` view is attached automatically; the flow is separate from public-video moderation.
- Anonymous problem reports store no reporter identity or raw address. A dedicated HMAC-pseudonymized limiter permits three submissions per minute, and configured administrators can list or resolve open rows through authenticated API routes.
- Wrangler configuration contains separate Rate Limiting API namespaces for upload, playback, owner download, and problem reporting, and the rebuilt deployment artifact exposes all four bindings.
- `pnpm production:preflight` now provides a repeatable read-only remote audit. It lists secret names, active version binding names/types, pending migration filenames, and query-string redaction status while omitting all secret and plaintext binding values.
- The preflight explicitly prefers a nonblank process token and otherwise parses `.env.cloudflare-readonly`; an inherited blank environment variable can no longer suppress the ignored file.
- `pnpm deploy` now requires a distinct write credential before any mutation, applies reviewed remote migrations, publishes, PATCHes the complete `{ enabled: true, head_sampling_rate: 1, redact_query_string: true }` observability setting, and immediately reads it back. Missing credentials, rejected PATCHes, and false/missing read-back fail without printing token or Cloudflare response contents; `pnpm production:redaction` provides a patch/read-back-only recovery path.
- Logged-in operators can use `pnpm deploy:oauth` or `pnpm production:redaction:oauth`; these read `wrangler auth token --json` into process memory without printing or persisting it. The first release using this code revealed that the account-owned Workers Builds deploy command still invokes framework deployment directly, so the repository guard is not yet wired into automatic `main` deployments.
- CWA ingestion now requires both `CWA_API_KEY` and `CWA_QUERY_STRING_REDACTION_VERIFIED=true`. The reviewed first-user configuration sets the guard to `false`, so a deployment cannot issue credential-bearing CWA queries until redaction has been read back as enabled. ECMWF WAM remains independent.
- The Windows workstation is now self-contained for this project: Node 22, the repository-pinned pnpm 11 shim, GitHub reads, Wrangler OAuth, local D1, mock-only development, builds, dry-runs, and production read-only preflight all run without the former `penguin` environment. The transferred Wrangler credential was verified on Windows and removed from `penguin`.
- `.dev.vars.example` is the tracked mock-only Worker development template; the real `.dev.vars` is git-ignored. Local Vite therefore uses development auth plus mock video/conditions and does not load the ignored production-operation token files.
- `@cloudflare/vite-plugin` is pinned to `1.54.1`, Wrangler to `4.127.0`, and matching Worker types to `5.20260826.1`. Their workerd `1.20260826.1` supports the configured `2026-08-24` compatibility date; the previous runtime stopped local development before startup.
- With owner authorization, commits `2e529e5` and `ead0f41` were pushed to `main` and the reviewed first-user build was published by Workers Builds. The production Stream secret and both rate-limit bindings are present, and script-level query-string redaction was patched and read back after the latest deployment.
- Real LINE Login now completes the production redirect/callback, establishes the signed-in UI, and maps to the configured administrator through the internal UUID without returning the raw LINE subject from `/api/v1/me`.
- Locally, verified LINE `name` is now stored separately as a private `line_display_name` suggestion. The authenticated user must save it as the site's public name and separately enable visibility; public queries still select only the confirmed `display_id` and never select the LINE subject or suggestion.
- Public-name input now accepts 2–24 printable Unicode characters, including Chinese and emoji, while rejecting control, line-separator, and hidden-format characters. User-facing identity copy says 「公開名稱」 while the existing storage/API compatibility field remains `display_id`/`displayId`.
- The source-file cap is centralized as exactly `200,000,000` bytes across browser validation, the shared API boundary, and upload-ticket responses. The browser displays decimal MB and sends the original file directly to Stream without client-side transcoding; the existing basic POST flow and 5–60-second provider verification remain unchanged.
- The left bottom-navigation label is 「彼日浪影」; matching behavior is unchanged.
- A future, not-yet-implemented product decision extends selection to Taipei calendar-day offsets 0–6 at whole hours 05:00–19:00 with no past targets. The owner accepts ECMWF WAM as the only source for days 4–7 while CWA remains limited to its currently verified first three days; the canonical 72-hour policy remains in force until that separate implementation updates validation, ingestion, tests, and docs together.
- The first real Stream video completed direct upload, processing, public matching/thumbnail, explicit signed playback, and owner-confirmed picture/audio playback. The public D1 video ID is `51e42f58-4330-4519-a931-1386c361ce66`; its non-secret Stream UID is `18e8b3129d2fc2e736cf3e1a3ee919a5`.
- The E2E exposed Stream's transient `duration: 0` during initial processing. Commit `3bc48da` now treats non-positive duration as unavailable, waits for a positive real-provider duration before publication, and fails closed when a later verified duration is outside 5–60 seconds. Owner-list reconciliation uses the same rule. Workers Builds deployed it as version `d0fa3c7e-569e-4006-9756-b3475926d6a2` at 100% traffic.
- Migrations `0000` through `0006` exist. Migration `0005_wet_donald_blake.sql` adds nullable private `users.line_display_name`; migration `0006_milky_madelyne_pryor.sql` adds anonymous `problem_reports`. Both have been applied and inspected only on local D1.

## Verification

| Check | Result | Last run |
|---|---|---|
| `pnpm typecheck` | pass | 2026-08-29 |
| `pnpm test` | pass, 98 tests across 18 files, including deployment safeguard/OAuth parsing, 100-user registration, owner download, reporting, and provider regressions | 2026-08-29 |
| `pnpm lint` | pass | 2026-08-29 |
| `pnpm build` | pass | 2026-08-29 |
| rendered-site test | pass, 1 test; built client bundle contains 「彼日浪影」, 「問題回報」, and 「分享我的影片」 | 2026-08-29 |
| `pnpm deploy:dry-run` | pass; generated files only, no deployment | 2026-08-29 |
| `wrangler deploy --dry-run` | pass; D1 plus upload/playback/download/problem-report rate-limit bindings present | 2026-08-29 |
| local D1 migration | pass; fresh `0000`→`0006` chain completed and read-only schema queries found `users.line_display_name` plus `problem_reports` | 2026-08-29 |
| Windows local development | prior pass; mock `.dev.vars`, local D1, home/health/spots/dev `/me` all returned `200` before this checkpoint | 2026-08-28 |
| Windows Wrangler/preflight | pass; production audit found redaction enabled, migrations `0005`–`0006` pending, and the two new limiter bindings not yet deployed | 2026-08-29 |
| production post-deploy preflight (before local `0005`) | pass; Stream secret, both rate-limit bindings, then-no-pending migration, and query-string redaction enabled | 2026-08-28 |
| production public smoke | pass; health/spots/current matches `200`, ECMWF WAM forecast present, unauthenticated `/me` returned `401 UNAUTHENTICATED` | 2026-08-28 |
| first-user LINE/Stream E2E | pass; real login, direct upload, ready/public lifecycle, signed thumbnail/playback, origin rejection, and owner-confirmed picture/audio | 2026-08-28 |
| migration chain | pass on fresh temporary local D1; `0000`→`0005`, SQLite integrity `ok`, no foreign-key violations, temporary database removed | 2026-08-28 |
| internal-release production deploy | pass with recovery; Workers Builds published version `b4605499-e2bd-4d70-9b30-249a72df8b82`, local OAuth applied migrations `0005`–`0006`, and the complete observability PATCH/read-back restored redaction | 2026-08-29 |
| internal-release production smoke | pass; brand/purpose, health, two spots, one ECMWF match group, existing thumbnail `302`, signed playback `200`, and unauthenticated `/me` `401` | 2026-08-29 |
| Workers Builds guarded-deploy verification | pass; empty commit `6ef6acb` produced version `f62123b8-40d9-4fb9-a68f-4e000ec5bb95`; post-deploy preflight found no pending migrations, all four limiter bindings, and query-string redaction enabled without local recovery | 2026-08-29 |

## Production status

- The owner explicitly authorized this internal-test release and its migrations. Future deployments, secret changes, and production deletion still require explicit authorization.
- The current internal-test release serves 100% traffic. The rendered app is branded 「彼日浪影」 and retains the exact canonical purpose; `/health`, `/spots`, and a current `/matches` query returned `200` on 2026-08-29. Both launch spots are present and the match response contained an ECMWF WAM provider/model group.
- Real production LINE redirect/callback and the signed-in UI succeeded with the owner. The resulting internal user ID matches `ADMIN_USER_ID`; `/api/v1/me` exposes no raw LINE subject.
- The post-deploy production preflight succeeded. `LINE_CHANNEL_SECRET`, `SESSION_SECRET`, `CWA_API_KEY`, and `CLOUDFLARE_STREAM_API_TOKEN` are present. The active version includes upload, playback, owner-download, and problem-report rate-limit bindings; no secret or plaintext binding value was printed.
- Production D1 is on migrations `0000`–`0006`. Public-name/source-size code, anonymous problem reports, owner MP4 sharing, the 100-user cap, and the two new rate-limit bindings are deployed. A read-only query found exactly one registered user.
- Owner-download provider/API/browser paths pass local tests and are deployed, but real Stream MP4 generation, JavaScript delivery CORS, native sharing, and fallback download have not been exercised. Chrome Android, Safari iOS, and LINE's in-app browser remain owner acceptance checks before inviting the full internal group.
- The deployed script setting `observability.redact_query_string` remained enabled after the verified Workers Builds `pnpm deploy` run and exact post-deploy read-back. `CWA_QUERY_STRING_REDACTION_VERIFIED` remains `false`, so CWA stays guarded and ECMWF WAM remains active.
- Because redaction was previously disabled while `CWA_API_KEY` was present, treat the current CWA key as potentially retained in observability. Revoke/rotate it at CWA before any future CWA enablement; do not change the application guard to `true` in the same unreviewed step.
- Real Stream direct upload, processing, public matching, signed thumbnail redirect, playback creation, correct-origin playback, wrong-origin playback rejection, and picture/audio playback succeeded. Cloudflare returned the signed thumbnail from a wrong `Referer` as well; this matches its documentation of Allowed Origins as a playback control, so the first-party thumbnail gate and five-minute signed token remain required.
- The first completion attempt failed because Stream transiently returned `duration: 0`. The owner-authorized recovery conditionally updated exactly one D1 row after Stream reported `ready` and `20.1` seconds. Commit `3bc48da` fixes the timing case in production; its five regression tests pass.
- With explicit owner approval, duplicate private Stream UID `04c511182f64c51ac6c9955f8a3f1fe3` was deleted with `200` and confirmed absent with `404`; only then was D1 video `08d8273d-ff01-4d01-bd45-e4605e0ace7b` conditionally deleted and confirmed absent. Public video `51e42f58-4330-4519-a931-1386c361ce66` remained `ready/public` and passed thumbnail/playback smoke afterward.
- The deployment reset script-level query-string redaction. The first partial PATCH was correctly rejected by read-back despite an API `success` response; a complete observability payload restored `redact_query_string: true`, and the final preflight read it back as enabled. CWA remained guarded throughout.
- Workers Builds reported success for commit `d863bda` but bypassed the repository's `pnpm deploy`: it published the Worker while leaving migrations `0005`–`0006` pending and redaction disabled. The local OAuth recovery restored/read back redaction and applied both migrations. The owner then set the account-owned production deploy command to `pnpm deploy` and added Workers Scripts Edit plus D1 Edit to its build token; commit `6ef6acb` produced version `f62123b8-40d9-4fb9-a68f-4e000ec5bb95`, and the post-deploy preflight proved the guard completed without local repair.
- The existing production video `51e42f58-4330-4519-a931-1386c361ce66` remains `ready`, `complete`, and public. Its first-party thumbnail returned `302` and explicit playback returned signed iframe data with `200` after the release; no production video was deleted, delisted, or edited.
- General seven-day expiry deletion and webhook behavior still need staging or a separately approved safe verification.
- Cost alarms and staged reporting/delisting verification remain launch gates.
- CWA key revocation/rotation plus a fresh query-string-redaction read-back remain mandatory before production CWA ingestion is enabled.

## Next task

Objective: complete owner acceptance of real Stream MP4 preparation, native sharing, and fallback download on a phone before inviting users 2–10.

Scope:

- On the owner's signed-in phone, open the existing public video under 「我的」, choose 「分享我的影片」, prepare the MP4, wait for Stream to report it ready, and tap the explicit share action.
- Record the phone/browser and whether the system share sheet accepts the file. If native file sharing is unavailable or browser fetch is blocked, follow the offered signed MP4 download fallback and confirm the file downloads and plays.
- Keep `CWA_QUERY_STRING_REDACTION_VERIFIED=false`; do not rotate or enable CWA during this acceptance test.
- After one mobile path passes, invite users 2–10 gradually and watch Stream/Workers usage plus upload/playback/download `429` logs.

Done when:

- The existing production video can be prepared as an encoded MP4 from the owner's phone.
- Either native file sharing succeeds, or the exact browser-specific fallback downloads a playable MP4.
- The tested device/browser and result are recorded before inviting users 2–10.

Out of scope: destructive production tests, CWA key rotation/enablement, staging creation, automated multi-device tests, condition-schema removal, and unrelated UI refactors.
