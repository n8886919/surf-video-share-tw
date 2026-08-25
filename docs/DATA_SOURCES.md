# Data sources

Last checked: 2026-08-25. Provider/model values remain independent; do not average them.

Historical matching uses the newest forecast run issued by capture time whose valid time is near the capture. Current queries use the newest run issued by query time whose valid time is near the selected 0–72 hour target. Lead time is preserved for provenance but is not a similarity requirement. Reanalysis, hindcast, buoy, satellite, and other post-event observations may be stored only as separately labelled data; they never replace or overwrite the historical forecast used for matching.

| Purpose | Preferred source | Current decision |
|---|---|---|
| Taiwan wave forecast | CWA F-A0020-001 | Preserve each six-hour run; total significant wave height/direction/period |
| Tide forecast | CWA F-A0021-001 | Derive interpolated height/slope/state with datum provenance |
| Wave model comparison | ECMWF WAM through Open-Meteo Marine | Separate feature row; explicit WAM test returned total wave fields but not components |
| Optional component comparison | Open-Meteo best-match Marine | Separate model/source only; never silently merge with WAM |
| Wind | Open-Meteo Weather or verified CWA dataset | Wind speed/direction/gust, separate provenance |
| Video | Cloudflare Stream | Direct creator upload; playback/signing/deletion still require live verification |

Official references:

- CWA wave forecast: https://opendata.cwa.gov.tw/dataset/forecast/F-A0020-001
- CWA tide forecast: https://opendata.cwa.gov.tw/dataset/forecast/F-A0021-001
- Open-Meteo Marine: https://open-meteo.com/en/docs/marine-weather-api
- Cloudflare Stream direct uploads: https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/

Launch coordinates and provenance:

- 烏石港: `24.8731036, 121.8411446`, user-supplied Google Maps point.
- 雙獅: `24.8887597, 121.8495724`, user-supplied Google Maps place marker.
