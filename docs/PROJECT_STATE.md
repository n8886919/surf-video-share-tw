# Project state

Updated: 2026-09-05

Product `0.23` release commit `b8e9613` is pushed to `main`. Workers Build published Cloudflare version `db82d484-099e-4129-8406-fbc3756085b7`; the deploy gate passed without a schema migration, and query-string redaction remained verified.

Home Assistant CWA Ingestor App `0.5.0` commit `12359f2` is pushed to its repository `main`. It retains contract v4 and persisted v1/v2/v3 retry compatibility, expands private pending state to 128 batches, and keeps a signed completion notification pending until the Worker accepts it. Local `npm run verify` passed 9 test files / 31 tests, typecheck, and build; GitHub Verify run `33479245582` also passed. This workspace has no Home Assistant Supervisor connection with which to refresh or update the separately installed App instance.

## D1 quota incident and local matching candidate update

- At `2026-09-05T13:09:54.571Z` (21:09 Asia/Taipei), request `100f5c56-a91c-4e22-b75b-557c6b711c63` failed on `/api/v1/matches` with D1's free-tier daily row-read limit error. Read-only `ops_events` inspection also found the same error on `/api/v1/auth/line` at `13:09:42.134Z`; this evidence identifies a database quota failure, not a confirmed LINE callback/cookie defect. Subsequent remote diagnostic SQL was also rejected. The request-level source of total daily read consumption has not been measured.
- The user requested removing the newest-20 candidate cutoff and excluding collect-only sources from historical matching SQL. Local changes now consider every eligible same-spot public video and restrict historical lookup to the exact CWA/MFWAM provider/model pairs before window ranking. Target forecast context, five-model owner history, capture-time alignment, coverage, and scoring stay unchanged.
- SQLite integration tests apply the real migrations in memory and verify all 25 eligible videos are ranked, the oldest/best match wins, lifecycle exclusions hold, and only 50 CWA/MFWAM history rows are returned from a five-model fixture. `EXPLAIN QUERY PLAN` confirms lookup through the existing source index using spot/provider/model. Owner-history regression coverage includes all five models.
- Local `pnpm verify` passed lint, typecheck, 37 test files / 219 tests, migration drift, production build, 2 rendered-site tests, and 7 Chromium/accessibility tests.
- A subsequent query-plan-only audit submitted all four current workspace `/matches` SELECTs as `EXPLAIN QUERY PLAN` to production D1, without deploying them or executing the underlying SELECTs. All four succeeded with `rows_read = 0`, `rows_written = 0`, and `changed_db = false`; those figures describe EXPLAIN itself, not application query costs. Production and local migrated SQLite plans agree: target forecasts use `forecast_source_run_idx` on spot only; historical forecasts use spot/provider/model without a valid-time range. Historical candidate retrieval and the recent-two-hour query choose `videos_public_lookup_idx` on moderation/publication, without spot/capture-time bounds in that index search. Both public observation queries also perform a correlated 90-day playback count that public serialization does not expose. No SQL/index change was made in this audit; actual workload row counts remain unmeasured.
- No migration, production write, deployment, pricing change, or cache has been introduced. These scoped changes do not prove that daily D1 reads are now within budget; unbounded candidates increase scoring/response size, and time-range query optimization remains a follow-up. Production remains Product `0.23` until a reviewed release is approved.

## Product 0.24 read-reduction release candidate

- The owner requested implementing both query optimizations and pushing to trigger deployment. Product/package versions are `0.24` / `0.24.0`; the release also includes the previously requested explicit Search UI, removal of the newest-20 candidate cap, and exact CWA/MFWAM historical filtering.
- Target/public-history/owner-history queries now use inclusive integer-second valid-time bounds instead of an ABS distance filter. Migration `0015_fresh_captain_stacy.sql` adds spot/time and source/time forecast expression indexes plus a visible-video spot/Julian-day partial index. The recent-video SQL keeps its original Julian-day range. Immutable data, unique source-run keys, time precision and ranking remain unchanged.
- Migrated SQLite tests assert indexed spot/time bounds for target, exact-source history and recent videos. A 1,300-forecast-row fixture compares optimized and prior target/history results across multiple runs, snapshot kinds, offsets and fractional seconds, including the four-hour edges. Recent-video tests include both exact two-hour edges and one-millisecond exclusions.
- Local migration 0015 applied successfully; schema-drift checks pass. Drizzle generated malformed quoting for the nested CAST/strftime expressions; the migration SQL was corrected to match its schema snapshot and executed against both SQLite and local D1.
- Final local `pnpm verify` passed lint, typecheck, 37 test files / 220 tests, migration drift, production build, 2 rendered-site tests and 9 Chromium/accessibility tests.
- At 22:43 Asia/Taipei on 2026-09-05, production preflight using existing Wrangler OAuth was blocked at remote migration listing by D1 daily-read quota (7500). A push may trigger a failed migration/deploy gate until quota resets; do not skip the gate or assume publication. No price-plan change is authorized. Production remains `0.23` until a new version and migration are confirmed.

## Explicit Find search and public read reduction (local)

- Find now follows spot → date → time → Search → videos. Entry, control changes, clock ticks, and tab return do not initiate `/matches`. Pending submissions are guarded against duplicates; a failed search can be retried explicitly. Initial/changed selections show a search prompt instead of claiming there are no videos.
- The page retains the last query and selections across bottom-tab navigation without adding server/browser persistent caches. Leaving Find unmounts its result players. Recent-two-hour results represent the last explicit query, not an automatically refreshed feed.
- Public observation queries now skip the unused correlated 90-day playback-count subquery. Owner queries keep their count; event recording, scoring and public DTOs remain unchanged. Migrated SQLite tests verify both public list query plans no longer reference playback events or a correlated scalar subquery; owner regression verifies its count SQL and response.
- Local `pnpm verify` passed lint, typecheck, 37 test files / 219 tests, migration drift, build, 2 rendered-site tests and 9 Chromium/accessibility tests. The mobile screenshot was inspected for search-button placement. Time-range/index optimization remains unimplemented; no production deployment or actual read-savings claim is made.

## LINE mobile login investigation

- Read-only production inspection found five owner sessions created at 14:01–14:31 Asia/Taipei on 2026-09-05, all expiring on September 12. This proves successful backend LINE verification/session creation that afternoon, not acceptance of the cookie by the reported Android home-screen browser.
- The confirmed evening D1 quota error affected the login start endpoint; it does not establish the cause of the user's callback failure or earlier iPhone failure. The current callback returns `failed`/`expired` without a diagnostic event. A temporary read-only Workers telemetry query was denied with HTTP 403; no permissions or production settings were changed.
- Code review confirms a fixed seven-day session, ten-minute one-use OAuth attempts, an existing cross-platform manual-login retry, and no foreground/pageshow session refresh. A failed owner-video fetch can also obscure a successful `/me`. Exact mobile attribution remains unresolved; see [LINE login investigation](LINE_LOGIN_INVESTIGATION.md) for evidence, limitations, and the proposed two-platform fix/acceptance plan.
- Existing login/API-auth tests passed: 2 files / 16 tests. No auth implementation or deployment was made; physical Android and iPhone acceptance remains required.

## Product 0.23 native mobile spot scrolling release

- Two iPhone users reported that horizontal movement in the Find spot strip felt visibly slow while the Android owner device did not reproduce it. The strip had disabled native horizontal touch panning with `touch-action: pan-y` and synchronously assigned `scrollLeft` from every React `pointermove`, bypassing iOS accelerated momentum scrolling.
- Touch and pen input now leave the `overflow-x: auto` strip to the browser with `touch-action: manipulation`. The custom pointer path is mouse-only, preserving desktop drag scrolling, wheel scrolling, and mouse long-press ordering while intentionally removing mobile long-press ordering.
- A browser regression check verifies the touch policy and proves a synthetic touch pointer sequence does not enter the custom `scrollLeft` path. Product documentation and the accessible strip description state the reduced mobile behavior explicitly.
- Local `pnpm verify` passed lint, typecheck, 36 test files / 217 tests, migration drift, production build, 2 rendered-site tests, and 7 Chromium/accessibility tests. GitHub Verify run `33948361299` and Workers Build passed for commit `b8e9613`.
- Post-deploy preflight found every required binding and secret name, no pending migration, the retired Worker CWA key absent, and query-string redaction enabled. Production health/readiness returned `ok`; an iPhone-sized headless render showed Product `0.23`, all nineteen spot buttons, `overflow-x: auto`, and computed `touch-action: manipulation`. Physical iPhone acceptance remains required because desktop browser emulation cannot verify Safari's actual scrolling physics.

## Product 0.22 external heartbeat scheduling resilience release

- The external MFWAM heartbeat keeps its `35 */6 * * *` UTC schedule, fifteen minutes after the Cloudflare `:20` collection Cron. Four initial scheduled runs were created 2 hours 42 minutes to 5 hours 23 minutes late by GitHub, so the former four-hour wall-clock freshness rule repeatedly mislabelled healthy stored forecasts as unconfirmed.
- The production check now derives the newest six-hour `:20` UTC ingestion slot that should already be complete and requires the selected public MFWAM `issuedAt` to cover that slot. A fifteen-minute completion grace avoids racing a newly started Cloudflare collection, and the existing five-minute clock tolerance remains.
- The change does not move either Cron, change matching, call a provider, create a temporary trigger, backfill forecasts, or add a migration. GitHub remains an independent failure path while its best-effort scheduling can no longer manufacture a stale-data alert solely by starting late.
- Local `pnpm verify` passed lint, typecheck, 36 test files / 217 tests, migration drift, production build, 2 rendered-site tests, and 6 Chromium/accessibility tests. GitHub Verify run `33600720430` and Workers Build passed for commit `b55f2f3`.
- Production health and readiness returned `ok`, and headless Chromium rendered Product `0.22`. Manual forecast-heartbeat run `33601065157` passed both the production MFWAM slot check and the independent LINE-delivery job.

## Completed checkpoint

- Forecast collection now keeps five provider/model rows independent: CWA, Météo-France MFWAM, ECMWF WAM 9 km, NOAA GFS Wave 0.16°, and DWD GWAM.
- Only CWA and MFWAM participate in matching. They receive equal provider weight when both are available; collect-only models never change similarity or ranking.
- Forecast snapshots record `forecast` versus `historical_forecast`. A normal Forecast-mode response covering recent past hours may create `historical_forecast`; the worker does not call Historical Forecast mode and does not backfill existing videos.
- Future target forecasts use only `forecast` rows. A video's captured condition may prefer an explicit `historical_forecast`, otherwise it uses the newest run issued no later than capture time. Provider feature rows are never averaged or combined.
- Migration `0011_cuddly_lilandra.sql` adds snapshot kind plus peak-period, total-swell, tertiary-swell, and wind-wave fields while retaining immutable provider provenance.
- “我的影片” shows all collected model rows in active-first order. CWA and MFWAM are marked as matching sources; ECMWF, GFS, and GWAM are marked “僅蒐集，不影響相似度”.
- `docs/MATCHING.md` is the detailed matching specification. Its source fingerprint and generated provider-role table are guarded by tests against `packages/domain/src/matching.ts` and `packages/domain/src/forecast-sources.ts`.
- README, Roadmap, architecture, product, data-source, data-model, API, operations, principles, ADR, and project-state documentation now describe the five independent sources rather than the obsolete two-spot / ECMWF-matching design.
- CI runs lint, typecheck, unit/integration tests, migration-drift checks, production build, rendered-site tests, and browser/accessibility tests.
- Product `0.16` implements the upload UX task: the two introductory lines are removed, the short `7天內,10-60秒的浪況或衝浪影片` copy owns the info icon, and `顯示公開名稱` opens enabled when the user has a `display_id`.

## Product 0.21 CWA notification and beta-label release

- The main and public-share headers display a compact `測試版` label beside the top-left brand. Product version is `0.21` / package `0.21.0`.
- App `0.5.0` submits a separately signed completion request only after every persisted CWA row batch succeeds. Completion-message failure remains pending and retries without downloading the ZIP or resubmitting forecast rows.
- The Worker accepts `POST /api/v1/internal/forecast-ingestion/cwa/complete`, verifies that the exact provider/model run covers all active coordinate-bearing spots, and sends one dedicated owner LINE message with model/publication times plus spot and snapshot counts.
- Migration `0014_pale_the_spike.sql` adds `forecast_ingestion_notifications`. A unique provider/model/model-run claim deduplicates restart/replay while failed or abandoned delivery claims remain retryable.
- The App state limit increases from 32 to 128 batches. The verified nineteen-spot × twenty-five-lead workload requires 95 batches, so the former limit could reject a complete production run before ingestion.
- Main `pnpm verify` passed lint, typecheck, 36 test files / 217 tests, migration drift, production build, 2 rendered-site tests, and 6 Chromium/accessibility tests. App `npm run verify` passed 9 test files / 31 tests, typecheck, and build.
- Production health/readiness returned `ok`; rendered HTML contains `測試版`; the unsigned completion endpoint returns `401`; remote migration listing is clear; and the new notification table exists with zero rows before the installed App is upgraded. No temporary ingestion trigger or historical backfill was created.
- App `0.5.0` is published in the GitHub App Store repository, but installing it on the Home Assistant host remains an explicit operator step because this workspace has no Supervisor connection. Therefore a real nineteen-spot CWA completion and LINE delivery have not yet been claimed.

## Product 0.20 Waipu release

- The active set expands from eighteen to nineteen spots by activating the existing `waipu-fishing-harbor` checklist row as 外埔 at owner-supplied coordinates `24.6506129,120.7655767`. Public `/spots`, the selector, uploads, matching, GPS suggestion, and external uptime all use the same server-owned spot row and ordered slug.
- The official CWA F-A0021-001 specification lists 漁港外埔 as LocationId `I04100` at `24.651,120.771`, about 0.55 km from the owner-supplied point. CWA ingestion contract v4 pins this mapping and its live Zod JSON Schema with synchronized SHA-256 fingerprints in both repositories.
- The Worker accepts new v4 batches while retaining v1/v2/v3 schemas and their exact legacy mappings for persisted retry compatibility. Home Assistant App `0.4.0` requests seventeen approved tide locations and emits v4 batches for all nineteen spots.
- `pnpm verify` passed lint, typecheck, 36 test files / 214 tests, migration drift, production build, 2 rendered-site tests, and 5 Chromium/accessibility tests. Local migration 0013 applied successfully. Main CI run `33476340688`, Workers Build check `99756291471`, and Ingestor Verify run `33476354451` all passed.
- Post-build production preflight found every required secret and binding, no pending migration, the retired Worker CWA key absent, and query-string redaction enabled. Public smoke returned health/readiness `ok`, exactly nineteen ordered spots with the exact 外埔 name and coordinates, and HTTP 200 for a valid 外埔 match query; headless Chromium rendered Product `0.20` and one 外埔 selector.

## Product 0.19 matching column alignment release

- The fixed forecast column is now 96–102 px with its horizontal source-section padding reduced from 10 px to 4 px; existing 11 px source, 8 px label, and 7 px metric font sizes are unchanged.
- MFWAM's source heading is explicitly rendered as a no-wrap `Météo-France` line followed by a forced `MFWAM` line. Compact values such as `0.7m · 76° · 6.3s` remain on one line.
- Target and candidate source headings share a 27 px minimum height, and every metric row has an exact 34 px height. Browser geometry assertions verify all six representative target/candidate rows align within 0.5 px and that the required strings fit without reducing font size.
- `pnpm verify` passed lint, typecheck, 36 test files / 212 tests, migration drift, production build, 2 rendered-site tests, and 5 Chromium/accessibility tests. Production preflight found every required secret and binding, no pending migration, and query-string redaction enabled.
- Post-deploy health and readiness returned `ok`; the deployment script restored and read back query-string redaction.

## Product 0.18 matching UI release

- The fixed forecast card is half its previous width and starts with the selected Taipei date (`M/D 周X`) plus `預報資料`.
- Public comparison rows now follow the source data actually available: CWA shows total wave and tide; MFWAM shows total wave, primary/secondary swell, and wind wave. Empty CWA swell/wind rows and empty MFWAM wind/tide rows are absent instead of rendering placeholders.
- Candidate source headers no longer repeat `CWA` or `MFWAM`; each uses `相似度` plus the source percentage. The redundant feature header and public CWA tide LocationId are removed.
- CWA never had swell components in the normalized ingestion row, so unordered primary/secondary swell assignment was not applied to CWA and the matching algorithm did not require a scoring change. MFWAM's real partitioned swell matching remains unchanged.
- The release also includes the already reviewed compact external heartbeat message and the first-user validation strategy checkpoint from the previous session.
- `pnpm verify` passed lint, typecheck, 36 test files / 212 tests, migration drift, production build, 2 rendered-site tests, and 5 Chromium/accessibility tests. Production preflight found all required secrets and bindings, no pending migration, and query-string redaction enabled.
- Post-deploy health and readiness returned `ok`; the public spots response still contained all eighteen active spots and the homepage rendered the canonical brand and purpose.

## Product 0.17 operations release

- Every successful required MFWAM run now sends one owner-only LINE heartbeat after the six-hour Cloudflare Open-Meteo collection finishes. It lists all four model statuses plus insert and duplicate counts.
- A degraded collect-only model produces a warning heartbeat. A required MFWAM failure still follows the existing critical incident path, while a LINE delivery failure is logged without mislabelling already stored forecasts as failed.
- The heartbeat explicitly excludes the separately scheduled Home Assistant CWA ingestion, so it never claims that both collection systems succeeded.
- After the 08:20 `Asia/Taipei` Worker run stored fresh MFWAM data but its direct LINE heartbeat did not arrive, the existing GitHub LINE test succeeded. The authoritative `.github/workflows/forecast-heartbeat.yml` therefore runs fifteen minutes after each collection Cron, verifies a production MFWAM `issuedAt` no more than four hours old through `/matches`, and sends verified success or failure through the independently configured GitHub LINE secrets.
- The final `pnpm verify` passed lint, typecheck, 36 test files / 212 tests, migration drift, production build, 2 rendered-site tests, and 5 Chromium/accessibility tests.
- Commit `66e209c` passed GitHub Verify run `33462727368` and Workers Build check `99716581531`. The build found no pending migration and published Cloudflare version `8b0f0830-4b43-4bec-b8f5-88c4a5f2a289` at 100%.
- Manual forecast-heartbeat run `33462739719` verified production MFWAM `issuedAt` `2026-09-01T00:20:34.678Z` and completed both the production-data check and LINE-delivery jobs. Post-build health and readiness returned `ok`; every required secret and binding remains present, no migration is pending, and query-string redaction remains enabled.
- No temporary forecast trigger or historical backfill was used. The next natural collection is 2026-09-01 14:20 `Asia/Taipei`, followed by the external verified heartbeat around 14:35.

## Product 0.16 release

- The release expands the active set from eight to eighteen spots. It adds 中角灣、福隆、環保、北濱、磯崎、九棚、佳樂水、松柏港、翡翠灣、萬里 and updates 南灣 to the owner-supplied 2026-08-31 coordinate.
- Data-only migration `0012_add_nearest_tide_spots.sql` upserts the ten additions and updated 南灣 into production D1 without changing existing video or forecast rows.
- CWA ingestion contract v3 maps every active spot to the geographically nearest location in the official F-A0021-001 PDF. The farthest current pairing is 九棚 → `10013330` at about 4.41 km, so no current mapping was flagged as excessively distant.
- The Worker temporarily accepts legacy v1/v2 batches under their original mappings, while v3 requires the new exact spot/LocationId mapping. Contract fingerprints are `d4dc3b42665cb89621c2c68090622ab51b1a1dc20c25fbbe1224ee53206914af` for the JSON Schema and `c5d3c97ea5f0f391bd808ff6fba3983ea0e59e47248a5800ad4592fe26e7cd16` for the mapping.
- CWA raw provenance remains immutable; `ForecastResponse.tide.sourceLocationId` exposes the selected LocationId and both owner and comparison UI display it.
- The Find result restores one fixed left-side `目標預報` card. Horizontally scrolling historical-video cards show only the candidate-time metrics and swell pairing, so target metrics are not repeated on every card.
- Public `/spots` and the external uptime workflow now pin the same ordered eighteen slugs.
- The separately maintained Home Assistant CWA Ingestor App `0.3.0` emits contract v3 for all eighteen spots, retains persisted v1/v2 retry compatibility, and updates its aarch64 Docker label gate.
- The Worker, migration, and App repository were released in that compatibility-safe order: backward-compatible Worker first, then App `0.3.0` publication.

## Verification

The Product `0.15` change set has passed these local gates:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test` — 35 test files, 189 tests
- `pnpm db:check`
- `pnpm db:migrate:local` — migration 0011 applied successfully
- `pnpm build`
- `pnpm test:site` — 2 tests
- `pnpm test:browser` — 5 tests, including owner model display and accessibility

The Open-Meteo mapping was also checked against current official Marine API responses for `meteofrance_wave`, `ecmwf_wam`, `ncep_gfswave016`, and `dwd_gwam`. Missing component fields remain null rather than being inferred from another model.

The Product `0.16` release passed `pnpm verify`: lint, typecheck, 35 test files / 208 tests, migration drift, production build, 2 rendered-site tests, and 5 Chromium/accessibility tests. The release-only Product-version and eighteen-spot uptime checks also passed after the unified gate. Local migration 0012 applied successfully, and a read-only D1 query confirmed exactly 18 active spots with the expected coordinates.

The Home Assistant App `0.3.0` release passed `npm run verify`: typecheck, 9 test files / 25 tests, and build. Its v3 JSON Schema and tide-mapping fingerprints match this repository exactly. GitHub CI repeated the verification and aarch64 Docker inspection successfully after publication.

## Deployment state and cautions

- Product `0.16` GitHub verify run `33410486708` and Workers Build check `99549017220` passed for commit `61985cb`. The build applied migration 0012 and published version `64de237b-3d05-494d-a346-b01428359aa0` at 100%.
- Post-deploy preflight found every required binding and secret name, no pending migration, the retired Worker CWA key absent, and query-string redaction enabled.
- Public smoke passed `/health`, the exact ordered eighteen-spot `/spots` response, a valid `/matches` request, and a headless Chromium render of the eighteen spot selectors and Product `0.16` help dialog. The current public query returned no matches, so its conditional comparison cards were verified by the release Playwright fixture rather than fabricated production data.
- A read-only D1 check confirmed the new snapshot columns. The pre-Cron baseline is 50 CWA rows across two spots and 9,672 legacy ECMWF rows across eight spots; the audit wrote zero rows.
- The production Worker accepts contract v3 while temporarily retaining v1/v2 retry compatibility. App `0.3.0` is the first release that emits v3 for all eighteen spots.
- Existing test videos will not be rewritten or backfilled. New rows accumulate through normal scheduled collection only.
- No temporary production trigger was added. The exact schedules remain `5 * * * *` and `20 */6 * * *`; the first normal multi-model run after deployment is due at 2026-09-01 02:20 Asia/Taipei.
- Until that run completes, production has no MFWAM/GFS/GWAM rows, so similarity matches that require MFWAM may remain empty. The first run must be observed model by model; a collect-only success must not hide a complete MFWAM failure.
- Home Assistant App `0.3.0` GitHub verify run `33410745618` passed for commit `d0ce63b`, and the App Store repository now publishes the release. Whether the installed Home Assistant host has auto-updated cannot be observed from this workspace because the App intentionally exposes no inbound management surface and no Supervisor connection is configured here.
- Open-Meteo may omit fields or model runs. Storage and UI tolerate nulls, and each model keeps its own provenance and failure result.
- MFWAM retains the matching horizon; collect-only models intentionally use a short horizon so storage growth remains bounded until a model is promoted.

## Development strategy checkpoint

- Product `0.17` has no real users yet. The immediate objective is evidence that the core find/watch/upload path is useful, not additional platform breadth.
- The first-user validation gates and frozen secondary scope are recorded in `docs/ROADMAP.md`.
- Existing secondary features remain in production unless a separate cost or reliability decision disables them; this checkpoint does not change runtime behavior.
- Ordinary isolated changes use targeted tests plus `pnpm typecheck`. Full verification and release documentation are reserved for release candidates and cross-cutting API, schema, authentication, security, provider, operations, or deployment changes.

## Next task

Confirm the approved Product 0.24 deployment and migration 0015 after the main push; if D1 quota blocks the gate, retry the reviewed deployment after quota reset, then verify the three indexes, query plans and actual read volume. The unresolved Android/iPhone LINE roundtrip investigation remains pending separately; this release does not change auth.

Pending acceptance: the two users' physical iPhone Safari scrolling retest for Product `0.23` remains outstanding.

Deferred next-stage goal: after the first-user validation gates, use observed pilot behavior and the two-phone acceptance exercise to decide whether long share URLs block sharing. Only with that evidence, add a first-party expiring short-code path that preserves the existing 24-hour lifetime, exporter quota, and long-link compatibility; do not use a third-party shortener. The implementation decision must also settle whether the public share page's logged-in 「重新分享」 action remains in addition to the two intended share surfaces documented in `docs/PRODUCT.md`.
