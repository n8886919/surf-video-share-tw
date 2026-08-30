# Data sources

Last checked: 2026-08-30. Provider/model values remain independent; do not average them.

Historical matching uses the newest forecast run issued by capture time whose valid time is near the capture. Current public queries use the newest run issued by query time whose valid time is near the selected `Asia/Taipei` day-offset 0–4, 05:00–19:00 whole-hour target. Lead time is preserved for provenance but is not a similarity requirement. At offsets 0–2 CWA and ECMWF remain separate feature rows and separate distance calculations, and only their normalized source scores are combined at equal weight after both pass coverage. Offsets 3–4 use the independent ECMWF score only. Reanalysis, hindcast, buoy, satellite, and other post-event observations may be stored only as separately labelled data; they never replace or overwrite the historical forecast used for matching.

| Purpose | Preferred source | Current decision |
|---|---|---|
| Taiwan wave forecast | CWA F-A0020-001 | Preserve each run at three-hourly 0–72 h leads; total wave height/direction/period |
| Tide forecast | CWA F-A0021-001 | `O00400`, `AboveLocalMSL` cm converted to m; half-cosine height/slope/state interpolation retained only for 烏石港／雙獅; null for added spots pending verified official locations |
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
