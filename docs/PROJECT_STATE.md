# Project state

Last source review: 2026-08-25, GitHub `main` commit `761c6e3`.

## Current local verification

- Typecheck, 30 unit/integration tests, production build, lint, rendered-site test, and local production HTTP smoke checks pass as of 2026-08-25.
- React/Hono/D1 modular monolith, LINE auth/session source, mock development providers, and Cloudflare Stream direct-upload adapter exist.
- The production health endpoint responds; only non-destructive smoke checks were performed.
- Open-Meteo Marine currently returns total wave data for explicit `ecmwf_wam` near the launch spots, but its component swell/wind-wave arrays were null in the 2026-08-25 test. Best-match returns more components and must remain a separate model/source.

## Confirmed product changes

- Core is future forecast-to-public-video matching; personal review is an upload incentive.
- Upload window is 168 hours. Missing spot/time remains private for seven days, then expires.
- Conditions failure never blocks upload. Users never type condition numbers.
- Complete, terms-versioned, moderation-visible videos are public and upload includes a no-click inline CC0 notice.
- Launch spots are 烏石港 and 雙獅.
- Bottom navigation is 找浪／上傳／我的; own videos support spot filter, favorite, identity visibility, an optional fun reaction, and one optional 100-character public supplement. Subjective fields never enter matching.
- Public queries accept only now through +72 hours. Current and historical sides choose the newest provider run available at the relevant moment; equal forecast lead time is not required.
- CWA and ECMWF WAM are kept as independent provider/model features, never averaged.
- The five-second purpose, contributor-first commons policy, CC0 intent, three-year hosting target, trust-first moderation, sustainability boundary, and exit principles are recorded in `docs/PROJECT_PRINCIPLES.md`.
- Uploads remain capped at 60 seconds. Public reports are recorded without automatic hiding; a configured project administrator can delist in one action. There is no per-video pre-publication review.

## Still unknown or operationally gated

- Cloudflare Stream production upload, processing, playback domain/signing, deletion, and webhook behavior need a real end-to-end test.
- Production D1 has not received the new schema in this local branch.
- Real scheduled CWA/ECMWF forecast ingestion is not complete. It must run independently of video uploads so historical model runs are retained.
- Rate limits, cost alarms, and production moderation operations remain launch gates. Reporting/delisting and versioned CC0 terms now exist locally but have not been exercised against production D1.

## Implemented locally in this worktree

- Revised specs, 168-hour validation, nullable pending metadata, owner note/favorite, public-ready query boundary, and two active launch spots.
- Provider-separated forecast snapshot schema and deterministic per-source historical-forecast matching path. With no ingested snapshots, the UI explicitly labels results as unranked same-spot videos.
- Public 找浪, signed-in 上傳／我的, fixed three-tab navigation, inline public notice, pending supplement UI, filters, profile settings, and the supplied logo.
- Query-window enforcement, latest-available-run selection, uploader supplement/fun reaction boundaries, public report records, CC0 terms versioning, and administrator delisting.
- Migrations `0003_big_sprite.sql` and `0004_outgoing_ben_urich.sql` were generated. The full 0000→0004 SQL chain passed SQLite integrity and foreign-key checks, including a legacy-video migration check. Production was not migrated.

Do not push, deploy, or migrate production without explicit authorization.
