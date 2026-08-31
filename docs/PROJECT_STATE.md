# Project state

Updated: 2026-08-31

Product `0.15` release code commit `831eeb8` and deployment-handoff commit `772d557` are pushed to `main`. The final guarded Workers Build is deployed at 100% as Cloudflare version `8cab4613-4018-4bfd-ae19-d2bc8468cc32`; remote migration `0011_cuddly_lilandra.sql` is applied.

Product `0.16` is a verified release candidate in the working tree. It has not yet been committed or deployed; production and the installed Home Assistant App remain on the versions described below.

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

## Product 0.16 release candidate

- The working tree expands the active set from eight to eighteen spots. It adds 中角灣、福隆、環保、北濱、磯崎、九棚、佳樂水、松柏港、翡翠灣、萬里 and updates 南灣 to the owner-supplied 2026-08-31 coordinate.
- Data-only migration `0012_add_nearest_tide_spots.sql` upserts the ten additions and updated 南灣 into production D1 without changing existing video or forecast rows.
- CWA ingestion contract v3 maps every active spot to the geographically nearest location in the official F-A0021-001 PDF. The farthest current pairing is 九棚 → `10013330` at about 4.41 km, so no current mapping was flagged as excessively distant.
- The Worker temporarily accepts legacy v1/v2 batches under their original mappings, while v3 requires the new exact spot/LocationId mapping. Contract fingerprints are `d4dc3b42665cb89621c2c68090622ab51b1a1dc20c25fbbe1224ee53206914af` for the JSON Schema and `c5d3c97ea5f0f391bd808ff6fba3983ea0e59e47248a5800ad4592fe26e7cd16` for the mapping.
- CWA raw provenance remains immutable; `ForecastResponse.tide.sourceLocationId` exposes the selected LocationId and both owner and comparison UI display it.
- The Find result restores one fixed left-side `目標預報` card. Horizontally scrolling historical-video cards show only the candidate-time metrics and swell pairing, so target metrics are not repeated on every card.
- Public `/spots` and the external uptime workflow now pin the same ordered eighteen slugs.
- The separately maintained Home Assistant CWA Ingestor release candidate is App `0.3.0`. It emits contract v3 for all eighteen spots, retains persisted v1/v2 retry compatibility, and updates its aarch64 Docker label gate.
- This checkpoint is local only. Production remains on Product `0.15`, migration 0012 is not remote-applied, and the installed Home Assistant App remains on `0.2.0`.

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

The Product `0.16` release candidate passed `pnpm verify`: lint, typecheck, 35 test files / 208 tests, migration drift, production build, 2 rendered-site tests, and 5 Chromium/accessibility tests. The release-only Product-version and eighteen-spot uptime checks also passed after the unified gate. Local migration 0012 applied successfully, and a read-only D1 query confirmed exactly 18 active spots with the expected coordinates.

The Home Assistant App `0.3.0` release candidate passed `npm run verify`: typecheck, 9 test files / 25 tests, and build. Its v3 JSON Schema and tide-mapping fingerprints match this repository exactly.

## Deployment state and cautions

- GitHub CI run `33405296113` passed for release commit `831eeb8`, and run `33406300442` passed for handoff commit `772d557`. The first guarded Workers Build applied migration 0011; the final build published version `8cab4613-4018-4bfd-ae19-d2bc8468cc32` at 100% with no pending migration and retained query-string redaction.
- Post-deploy preflight found every required binding and secret name, no pending migration, the retired Worker CWA key absent, and query-string redaction enabled.
- Public smoke passed health, readiness, eight ordered spots, Product `0.15` assets, MFWAM client markers, and a valid `/matches` request. The response exposes CWA as active and existing ECMWF data as collect-only.
- A read-only D1 check confirmed the new snapshot columns. The pre-Cron baseline is 50 CWA rows across two spots and 9,672 legacy ECMWF rows across eight spots; the audit wrote zero rows.
- The `Surf Video Share CWA Ingestor` payload/HMAC contract is unchanged and needs no App update for Product 0.15. The Worker adds `snapshotKind=forecast` and null model-only fields while accepting the existing v1/v2 payload.
- Existing test videos will not be rewritten or backfilled. New rows accumulate through normal scheduled collection only.
- No temporary production trigger was added. The exact schedules remain `5 * * * *` and `20 */6 * * *`; the first normal multi-model run after deployment is due at 2026-09-01 02:20 Asia/Taipei.
- Until that run completes, production has no MFWAM/GFS/GWAM rows, so similarity matches that require MFWAM may remain empty. The first run must be observed model by model; a collect-only success must not hide a complete MFWAM failure.
- Product `0.16`, migration `0012_add_nearest_tide_spots.sql`, and Home Assistant App `0.3.0` are not deployed yet. Deploy the backward-compatible Worker and migration first; update the App only after production accepts v3.
- Open-Meteo may omit fields or model runs. Storage and UI tolerate nulls, and each model keeps its own provenance and failure result.
- MFWAM retains the matching horizon; collect-only models intentionally use a short horizon so storage growth remains bounded until a model is promoted.

## Next task

Commit and push the verified Product `0.16` release candidate, observe the guarded Worker deployment applying migration 0012, run production preflight/smoke, then publish Home Assistant App `0.3.0` and confirm its first natural v3 ingestion.
