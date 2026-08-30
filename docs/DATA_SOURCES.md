# Data sources

Last checked: 2026-08-30. Provider/model values remain independent; do not average them.

Historical matching uses the newest forecast run issued by capture time whose valid time is near the capture. Current queries use the newest run issued by query time whose valid time is near the selected `Asia/Taipei` day-offset 0–6, 05:00–19:00 whole-hour target. Lead time is preserved for provenance but is not a similarity requirement. Reanalysis, hindcast, buoy, satellite, and other post-event observations may be stored only as separately labelled data; they never replace or overwrite the historical forecast used for matching.

| Purpose | Preferred source | Current decision |
|---|---|---|
| Taiwan wave forecast | CWA F-A0020-001 | Preserve each run at three-hourly 0–72 h leads; total wave height/direction/period |
| Tide forecast | CWA F-A0021-001 | `O00400`, `AboveLocalMSL` cm converted to m; half-cosine height/slope/state interpolation between adjacent extrema |
| Wave model comparison | ECMWF WAM through Open-Meteo Marine | 168 hourly forecast hours per run as separate feature rows; explicit WAM test returned total wave fields but null components |
| Optional component comparison | Open-Meteo best-match Marine | Separate model/source only; never silently merge with WAM |
| Wind | Open-Meteo Weather or verified CWA dataset | Wind speed/direction/gust, separate provenance |
| Video | Cloudflare Stream | Direct creator upload plus signed thumbnail/playback and owner encoded-MP4 paths are live-verified; general expiry deletion and staged moderation remain pending |

Official references:

- CWA wave forecast: https://opendata.cwa.gov.tw/dataset/forecast/F-A0020-001
- CWA tide forecast: https://opendata.cwa.gov.tw/dataset/forecast/F-A0021-001
- Open-Meteo Marine: https://open-meteo.com/en/docs/marine-weather-api
- Cloudflare Stream direct uploads: https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/

Implementation notes checked against live responses and official provider pages on 2026-08-30:

- The current CWA wave download is a large ZIP of PascalCase XML files. The parser also accepts the older lowercase schema fixture. The archive is streamed and bounded; hourly files not on a three-hour lead are skipped without decompression to control Worker CPU and D1 writes.
- CWA `Sent` is preserved as `issued_at`; `model_run_at` is derived from `valid_at - lead_hours`. Tide interpolation provenance stays in `raw_payload` and does not change the wave run identity.
- Production CWA retrieval requires both the secret `CWA_API_KEY` and the explicit runtime guard `CWA_QUERY_STRING_REDACTION_VERIFIED=true`. The guard must remain false until the deployed Worker script setting `observability.redact_query_string` has been read back as true; ECMWF WAM ingestion continues independently while CWA is guarded.
- The 2026-08-30 production audit found 2,952 immutable `open-meteo` / `ecmwf_wam` snapshots and no CWA snapshots. The owner replaced the authorization code after query-string redaction was verified. A guarded production trial then proved that the official F-A0020-001 whole-archive ZIP requires about 2 seconds of CPU and exceeds the Workers Free Cron limit; the release restored the CWA guard to `false` without storing partial CWA rows. ECMWF completed independently during that trial. CWA ingestion therefore requires Workers Paid or a separately reviewed chunked architecture.
- Open-Meteo exposes grid coordinates and hourly values but not an ECMWF model-run timestamp. `issued_at` therefore records the first retrieval by this service, `model_run_at` is null, and a normalized response hash makes an identical retry idempotent. Missing component arrays remain null rather than inferred.

Launch coordinates and provenance:

- 烏石港: `24.8731036, 121.8411446`, user-supplied Google Maps point.
- 雙獅: `24.8887597, 121.8495724`, user-supplied Google Maps place marker.
