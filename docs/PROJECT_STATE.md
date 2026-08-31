# Project state

Updated: 2026-08-31

Product `0.15` commit `831eeb8` is deployed at 100% as Cloudflare version `fdd3d180-0655-42f8-a607-5626dcccf3c1`. Remote migration `0011_cuddly_lilandra.sql` is applied.

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
- `docs/ROADMAP.md` now records a pending upload UX task to remove the two introductory lines, replace the duration/time copy with `7天內,10-60秒的浪況或衝浪影片` plus an info icon, and default `顯示公開名稱` to enabled whenever the upload flow opens. This item is documented only and is not yet implemented.

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

## Deployment state and cautions

- GitHub CI run `33405296113` passed for exact commit `831eeb8`. The guarded Workers Build applied migration 0011, published version `fdd3d180-0655-42f8-a607-5626dcccf3c1` at 100%, and retained query-string redaction.
- Post-deploy preflight found every required binding and secret name, no pending migration, the retired Worker CWA key absent, and query-string redaction enabled.
- Public smoke passed health, readiness, eight ordered spots, Product `0.15` assets, MFWAM client markers, and a valid `/matches` request. The response exposes CWA as active and existing ECMWF data as collect-only.
- A read-only D1 check confirmed the new snapshot columns. The pre-Cron baseline is 50 CWA rows across two spots and 9,672 legacy ECMWF rows across eight spots; the audit wrote zero rows.
- The `Surf Video Share CWA Ingestor` payload/HMAC contract is unchanged and needs no App update for Product 0.15. The Worker adds `snapshotKind=forecast` and null model-only fields while accepting the existing v1/v2 payload.
- Existing test videos will not be rewritten or backfilled. New rows accumulate through normal scheduled collection only.
- No temporary production trigger was added. The exact schedules remain `5 * * * *` and `20 */6 * * *`; the first normal multi-model run after deployment is due at 2026-09-01 02:20 Asia/Taipei.
- Until that run completes, production has no MFWAM/GFS/GWAM rows, so similarity matches that require MFWAM may remain empty. The first run must be observed model by model; a collect-only success must not hide a complete MFWAM failure.
- Open-Meteo may omit fields or model runs. Storage and UI tolerate nulls, and each model keeps its own provenance and failure result.
- MFWAM retains the matching horizon; collect-only models intentionally use a short horizon so storage growth remains bounded until a model is promoted.

## Next task

After the 2026-09-01 02:20 Asia/Taipei normal forecast Cron, inspect its structured result and run a read-only D1 audit proving MFWAM active rows plus independent ECMWF/GFS/GWAM collect-only rows and both snapshot kinds, then smoke one public match without backfilling existing videos.
