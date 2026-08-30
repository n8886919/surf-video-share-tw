# Data sources

Last checked: 2026-08-31. Provider/model values remain independent; do not average them.

Historical matching uses the newest forecast run issued by capture time whose valid time is near the capture. Current public queries use the newest run issued by query time whose valid time is near the selected `Asia/Taipei` day-offset 0–4, 05:00–19:00 whole-hour target. Lead time is preserved for provenance but is not a similarity requirement. At offsets 0–2 CWA and ECMWF remain separate feature rows and separate distance calculations, and only their normalized source scores are combined at equal weight after both pass coverage. Offsets 3–4 use the independent ECMWF score only. Reanalysis, hindcast, buoy, satellite, and other post-event observations may be stored only as separately labelled data; they never replace or overwrite the historical forecast used for matching.

| Purpose | Preferred source | Current decision |
|---|---|---|
| Taiwan wave forecast | CWA F-A0020-001 | Preserve each run at three-hourly 0–72 h leads; total wave height/direction/period |
| Tide forecast | CWA F-A0021-001 | Per-spot approved locations, `AboveLocalMSL` cm converted to m, with half-cosine height/slope/state interpolation; exact spot/location provenance is immutable and Worker-validated |
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
- Production CWA retrieval runs only in the outbound-only Home Assistant App. Its CWA key is stored in App options and never sent to Cloudflare. The Worker's retired `CWA_QUERY_STRING_REDACTION_VERIFIED` guard remains `false`; Cloudflare Cron continues ECMWF WAM independently.
- The 2026-08-30 production E2E retained 3,960 immutable `open-meteo` / `ecmwf_wam` snapshots and added 50 independent `cwa` / `cwa-wave-f-a0020-001` snapshots across the two active spots. The Raspberry Pi adapter replaces the rejected Worker-side archive compute path without Workers Paid; ten five-row HMAC/D1 batches stayed within Workers Free CPU, with an observed maximum of 9 ms. Replaying the same upstream run inserted zero rows and reported 50 duplicates, while D1 retained zero duplicate source/run/valid groups.
- Open-Meteo exposes grid coordinates and hourly values but not an ECMWF model-run timestamp. `issued_at` therefore records the first retrieval by this service, `model_run_at` is null, and a normalized response hash makes an identical retry idempotent. Missing component arrays remain null rather than inferred.
- The owner-provided official F-A0021-001 JSON sent at `2026-08-31T00:07:02+08:00` contained 266 locations and 32 forecast days per reviewed location. It exposed newer exact surf locations `O01200` 蜜月灣 and `O01300` 金樽 even though the previously indexed explanatory PDF stopped at `O01000`. All six approved location IDs had complete `AboveLocalMSL` extrema. Candidate comparison found identical full event sequences for 無尾's three nearby official locations, 金樽／東河's three candidates, and the three reviewed 安平 candidates; 蜜月灣's exact surf point was within 0.06 km of the owner coordinate. The approved mapping is therefore `O00400` 烏石港／雙獅, `10002030` 無尾, `O01200` 蜜月灣, `O01300` 金樽／北東河, `B02400` 漁光島, and `O00700` 南灣.
- F-A0021-001 locations are official forecast locations, not assertions that each point contains a physical tide gauge. CWA documents that locations without a gauge may be adjusted from numerical modelling and nearby-station harmonic forecasts. The product preserves the official LocationId and `AboveLocalMSL` datum rather than describing it as a measured station.

Launch coordinates and provenance:

- 烏石港: `24.8731036, 121.8411446`, user-supplied Google Maps point.
- 雙獅: `24.8887597, 121.8495724`, user-supplied Google Maps place marker.
- 無尾: `24.6114709, 121.867805`, user-supplied coordinates.
- 蜜月灣: `24.9333608, 121.885568`, user-supplied coordinates.
- 金樽: `22.9558919, 121.2942829`, user-supplied coordinates.
- 北東河: `22.976243201721132, 121.31300650318626`, user-supplied coordinates.
- 漁光島: `22.980289143624113, 120.15516081806676`, user-supplied coordinates.
- 南灣: `21.95878467673781, 120.76046672044414`, user-supplied coordinates.

Only the names and coordinates supplied by the owner are authoritative for the six additions. Existing checklist slugs/English labels are internal identifiers, not newly verified translations or external descriptions.
