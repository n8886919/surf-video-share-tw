# Data sources

Last checked against official documentation and small live responses: 2026-08-31. Provider/model rows are immutable and independent. A shared API field name never authorizes mixing features across models.

## Source registry

| Provider / model | Native coverage and update | Retained fields observed for Taiwan | Product role |
|---|---|---|---|
| CWA `cwa-wave-f-a0020-001` | 0–72 h, retained every 3 h | total wave height/direction/period | active match |
| CWA `F-A0021-001` | nearest official location to each owner-supplied spot coordinate | tide height/slope/state with exact LocationId and datum provenance | enriches the CWA active row |
| Open-Meteo `meteofrance_wave` (MFWAM 0.08°) | global, native 3-hourly, 10-day forecast, updated every 12 h | total wave, wind wave, primary and secondary swell; peak fields retained if later supplied | active match |
| Open-Meteo `ecmwf_wam` (WAM HRES 9 km) | global, hourly, 15-day forecast, updated every 6 h | total wave plus total-wave peak period; component arrays were null in the checked response | collect-only |
| Open-Meteo `ncep_gfswave016` (GFS Wave 0.16°) | Taiwan is inside 52.5°N–15°S; hourly, 16-day forecast, updated every 6 h | total wave, wind wave, primary, secondary, and tertiary swell | collect-only |
| Open-Meteo `dwd_gwam` (GWAM 0.25°) | global, hourly, 4-day forecast, updated every 12 h | total wave, wind wave, and one total-swell system with available peak periods | collect-only |
| Cloudflare Stream | provider lifecycle | direct upload, signed thumbnail/playback, owner encoded MP4 | video |

Matching uses only CWA and MFWAM. Offsets 0–2 require both source scores and average them equally after independent 50% coverage gates; offsets 3–4 use MFWAM-only. ECMWF, GFS, and GWAM are still stored and shown after the active rows in 「我的影片」 with an explicit collect-only label.

## Normalization semantics

- `wave_*` is total wave for every listed wave model.
- MFWAM and GFS `swell_wave_*` is normalized as the first partitioned swell component; their secondary and tertiary arrays remain separate.
- DWD GWAM `swell_wave_*` is normalized into explicit `total_swell_*` columns, never into the primary-swell columns.
- ECMWF component arrays remain null when the provider does not supply them. Nothing is inferred from total wave.
- `wave_peak_period`, `swell_peak_period`, `total_swell_peak_period`, and `wind_wave_peak_period` are retained when present. Peak period is not a current matching input.
- Provider null remains null. A numeric zero returned by a provider remains a numeric zero and is not silently converted to missing.
- Grid coordinates, retrieval time, model, requested spot coordinates, response hash, and swell semantics remain in normalized columns or bounded provenance.

## Forecast versus historical forecast

Open-Meteo ingestion always calls the normal live Marine Forecast endpoint. MFWAM requests 168 future hours because it serves future matching; the three collect-only models request one future hour. All four also request `past_hours=6`.

A returned row with `valid_at < retrieved_at` is stored as `snapshot_kind = historical_forecast`; a current/future row is `forecast`. For a video, an available `historical_forecast` near capture is preferred as a later, more reality-adjacent model estimate. If absent, matching falls back to the newest `forecast` issued by capture. Future target queries filter to `forecast`, so a post-capture historical row can never become a future target.

The service does not switch to Open-Meteo Historical Forecast mode, Single Runs, reanalysis, or hindcast, and does not backfill existing videos. Scheduled recent-past capture is bounded and naturally stops changing once a valid time leaves the six-hour live window.

## CWA boundary

The outbound-only Home Assistant App owns the expensive official CWA archive parsing. The CWA key stays in App options and never reaches Cloudflare. Contract v4 uses the geographically nearest location listed by the official F-A0021-001 specification for every active owner-supplied coordinate. The Worker accepts only fixed HMAC-authenticated batches, validates active spots and time relationships, recomputes IDs, and rejects tide provenance that does not match this reviewed nearest-location allowlist:

| LocationId | Active spot | Approximate distance |
|---|---|---:|
| `10002040` | 烏石港 | 0.75 km |
| `O00400` | 雙獅 | 1.04 km |
| `10002030` | 無尾 | 2.11 km |
| `I02200` | 蜜月灣 | 3.68 km |
| `I00900` | 金樽、北東河 | 0.31 km、3.28 km |
| `I00500` | 漁光島 | 1.09 km |
| `O00700` | 南灣 | 0.24 km |
| `O00100` | 中角灣 | 0.37 km |
| `I03800` | 福隆 | 0.42 km |
| `I06100` | 環保 | 1.31 km |
| `10015010` | 北濱 | 0.48 km |
| `A00200` | 磯崎 | 0.76 km |
| `10013330` | 九棚 | 4.41 km |
| `O01000` | 佳樂水 | 0.26 km |
| `10005020` | 松柏港 | 2.72 km |
| `A01500` | 翡翠灣、萬里 | 1.90 km、0.68 km |
| `I04100` | 外埔 | 0.55 km |

Distances use a great-circle calculation against the coordinates published in the official CWA PDF. The farthest current pairing is 九棚 at about 4.41 km, so no active spot currently needs a far-distance exception. The selected LocationId is persisted in immutable raw provenance and exposed in `ForecastResponse.tide.sourceLocationId`.

CWA `Sent` is `issued_at`; `model_run_at` is derived from valid time minus lead. F-A0021-001 `AboveLocalMSL` centimetres are converted to metres, and interpolation provenance remains immutable.

## Official references

- CWA wave forecast: https://opendata.cwa.gov.tw/dataset/forecast/F-A0020-001
- CWA tide forecast: https://opendata.cwa.gov.tw/dataset/forecast/F-A0021-001
- Open-Meteo Marine API, model coverage, variables, and recent-past controls: https://open-meteo.com/en/docs/marine-weather-api
- Open-Meteo model update status: https://open-meteo.com/en/docs/model-updates
- Cloudflare Stream direct uploads: https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/

Provider attribution and licence requirements must be rechecked before public launch and presented in the product's non-interrupting About/Support area. Do not infer licence terms from an API response.

## Spot coordinates

The nineteen active coordinates in `data/spots.csv` come from owner-supplied points and are not provider grid assertions. Provider responses preserve their independently selected sea-grid coordinates.
