# Project state

Updated: 2026-09-01

Product `0.20` release commit `23d0829` is pushed to `main`. The reviewed OAuth deployment applied migration `0013_activate_waipu.sql` and published Cloudflare version `85a7ec49-64ad-49af-9326-410138954c8f`; the subsequent successful release Workers Build published version `9c77280c-e758-4ce8-9a02-15edd381e977` at 100%.

Home Assistant CWA Ingestor App `0.4.0` commit `5be64af` is pushed to its repository `main`. New batches use contract v4 with 外埔 mapped to official F-A0021-001 LocationId `I04100`; persisted v1/v2/v3 batches remain valid for retry. Local `npm run verify` passed 9 test files / 29 tests, typecheck, and build. GitHub Verify run `33476354451` also passed. This workspace has no Home Assistant Supervisor connection with which to refresh or update the separately installed App instance.

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

On the Home Assistant host, refresh the App Store and update the installed CWA Ingestor to `0.4.0`. Confirm one natural contract-v4 ingestion across all nineteen spots, including 外埔 → `I04100`, without creating a temporary trigger or historical backfill. After recording that result, move to recruiting and observing the first 5–10 non-developer pilot users rather than adding infrastructure or secondary features.
