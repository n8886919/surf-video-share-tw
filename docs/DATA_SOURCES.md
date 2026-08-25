# Data sources

Last checked: 2026-08-25. Provider/model values remain independent; do not average them.

Historical matching uses the newest forecast run issued by capture time whose valid time is near the capture. Current queries use the newest run issued by query time whose valid time is near the selected 0–72 hour target. Lead time is preserved for provenance but is not a similarity requirement. Reanalysis, hindcast, buoy, satellite, and other post-event observations may be stored only as separately labelled data; they never replace or overwrite the historical forecast used for matching.

| Purpose | Preferred source | Current decision |
|---|---|---|
| Taiwan wave forecast | CWA F-A0020-001 | Preserve each run at three-hourly 0–72 h leads; total wave height/direction/period |
| Tide forecast | CWA F-A0021-001 | `O00400`, `AboveLocalMSL` cm converted to m; half-cosine height/slope/state interpolation between adjacent extrema |
| Wave model comparison | ECMWF WAM through Open-Meteo Marine | Hourly separate feature row; explicit WAM test returned total wave fields but null components |
| Optional component comparison | Open-Meteo best-match Marine | Separate model/source only; never silently merge with WAM |
| Wind | Open-Meteo Weather or verified CWA dataset | Wind speed/direction/gust, separate provenance |
| Video | Cloudflare Stream | Direct creator upload; playback/signing/deletion still require live verification |

Official references:

- CWA wave forecast: https://opendata.cwa.gov.tw/dataset/forecast/F-A0020-001
- CWA tide forecast: https://opendata.cwa.gov.tw/dataset/forecast/F-A0021-001
- Open-Meteo Marine: https://open-meteo.com/en/docs/marine-weather-api
- Cloudflare Stream direct uploads: https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/

Implementation notes checked against live responses on 2026-08-25:

- The current CWA wave download is a large ZIP of PascalCase XML files. The parser also accepts the older lowercase schema fixture. The archive is streamed and bounded; hourly files not on a three-hour lead are skipped without decompression to control Worker CPU and D1 writes.
- CWA `Sent` is preserved as `issued_at`; `model_run_at` is derived from `valid_at - lead_hours`. Tide interpolation provenance stays in `raw_payload` and does not change the wave run identity.
- Open-Meteo exposes grid coordinates and hourly values but not an ECMWF model-run timestamp. `issued_at` therefore records the first retrieval by this service, `model_run_at` is null, and a normalized response hash makes an identical retry idempotent. Missing component arrays remain null rather than inferred.

Launch coordinates and provenance:

- 烏石港: `24.8731036, 121.8411446`, user-supplied Google Maps point.
- 雙獅: `24.8887597, 121.8495724`, user-supplied Google Maps place marker.
