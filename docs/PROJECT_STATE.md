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
- Stream thumbnail lookup stays behind the video-provider interface. Incomplete, non-ready, unversioned, private, delisted, provider-mismatched, and signed-only-without-token cases fail closed.
- Migrations `0000` through `0004` exist. This checkpoint adds no schema migration.

## Verification

| Check | Result | Last run |
|---|---|---|
| `pnpm typecheck` | pass | 2026-08-28 |
| `pnpm test` | pass, 52 tests | 2026-08-28 |
| `pnpm lint` | pass | 2026-08-28 |
| `pnpm build` | pass | 2026-08-28 |
| rendered-site test | pass, 1 test | 2026-08-28 |
| migration chain | not rerun; prior `0000`→`0004` SQLite integrity/foreign-key check passed | 2026-08-25 |

## Production status

- Do not deploy, migrate production D1, modify secrets, or delete production data without explicit authorization.
- Production D1 has not received the pending local migrations; scheduled ingestion and lifecycle cleanup are not deployed.
- Real Stream upload, processing, thumbnail redirect, playback signing/origin control, deletion, and webhook behavior still need staging or production-like end-to-end verification.
- Rate limits, playback cost guards, cost alarms, and staged moderation verification remain launch gates.
- CWA query-string redaction must be verified before production ingestion is enabled.

## Next task

Objective: add user-initiated protected playback for the one candidate selected in the forecast comparison.

Scope:

- Add an on-demand public playback endpoint that repeats the complete/ready/public/terms/visible D1 boundary before asking the provider for playback data.
- For Cloudflare Stream, use the official low-volume signed-token flow appropriate to fewer than 100 initial users, set new direct uploads to require signed URLs, and restrict allowed origins from verified runtime configuration. Do not invent the customer delivery host; derive it from verified provider metadata or require explicit configuration.
- Request playback only after the user selects a candidate and presses play. Do not preload players, manifests, or segments for the candidate strip.
- Keep a deterministic mock playback path and add tests proving private, pending, failed, unversioned, and delisted rows never trigger token generation.
- Update shared DTOs plus API, architecture, security, operations, and cost-guard documentation.

Done when:

- Only an explicit play action for a selected public candidate creates playback data or video delivery.
- A public ready observation plays without exposing Stream credentials; private/incomplete/delisted rows cannot obtain a token or playable URL.
- Mock and Cloudflare adapters compile against the same playback contract, and typecheck, full tests, lint, build, and rendered-site test pass.

Out of scope: production secret changes, production migration/deploy, destructive production tests, condition-schema removal, and unrelated UI refactors.
