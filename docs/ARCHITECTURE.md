# Architecture

React and Hono run as one Cloudflare Worker with a strict `/api/v1` boundary. D1 stores normalized metadata and immutable condition provenance; browsers never read D1 or provider secrets. Video bytes upload directly to Cloudflare Stream.

The detailed score formula, weights, coverage, unordered swell assignment, source roles, and deterministic tie-breaks are authoritative in [Matching algorithm](MATCHING.md). This document describes only system and data-flow boundaries.

## Read path

The public client selects one of the nineteen active spots plus an `Asia/Taipei` calendar-day offset 0–4 and a whole hour 05:00–19:00. The browser discards stale responses by exact `spotId + targetTime` request ownership; changing a control immediately hides the old result.

For a future target, the API reads only `snapshot_kind = forecast`, requires `issued_at <= queryNow`, limits `valid_at` distance to four hours, and chooses the newest provider/model run. Matching source features are never merged:

- offsets 0–2 require CWA `cwa-wave-f-a0020-001` and Open-Meteo `meteofrance_wave`; each source must independently pass 50% coverage and contributes 50% of the final score;
- offsets 3–4 require only `meteofrance_wave`, so the MFWAM source score is the final score;
- ECMWF WAM 9 km, NOAA GFS Wave 0.16°, and DWD GWAM are collect-only and never enter the current score.

The candidate query considers the latest 20 complete, ready, public, current-terms, moderation-visible videos at the same spot. For every required provider/model, a video prefers a nearby `historical_forecast`; if none exists it falls back to a nearby `forecast` whose `issued_at <= captured_at`. The selected source rows remain independent through domain scoring. Primary and secondary swell are an unordered pair, and the API returns the exact chosen assignment so the client never infers a pairing from display row order.

The result is one horizontally scrolling candidate list. Each card owns its target/candidate source comparison; there is no detached fixed forecast column. A second rail returns every same-spot public video captured between server request time and two hours earlier, inclusive. This rolling rail does not use the selected forecast target, require forecast coverage, or change ranking.

Authenticated owner responses select one row per provider/model with the same historical preference. They order CWA and MFWAM first, followed by collect-only ECMWF, GFS, and GWAM. The owner table exposes total wave, total swell, primary/secondary/tertiary swell, wind wave, wind, and tide fields as available, plus an explicit active or collect-only label. Missing values remain null and render as `—`.

Public thumbnail, playback, sharing, and download URLs stay first-party. Every media route repeats lifecycle and authorization checks before delegating to the video-provider interface. Stream credentials and unsigned provider video IDs never cross the API boundary.

## Write path

Upload offers gallery selection and an HTML `capture="environment"` preference. A bounded browser parser may suggest an explicitly zoned QuickTime creation time and, under strict precision/distance rules, a nearby active spot. Raw coordinates never leave component memory. The user confirms only spot and capture time; no condition number is user-entered.

The API creates a private upload row, validates the server-owned 168-hour and 05:00–19:59 capture policy, and issues a direct Stream ticket. Completion verifies provider-authoritative 10–60 second duration. Missing capture time remains private for at most seven days. Condition enrichment is best-effort and cannot roll back successful media completion.

LINE registration has a database-enforced 100-user ceiling. Raw LINE subjects never enter public DTOs. Anonymous D1-writing routes use scoped Cloudflare rate limits keyed by an HMAC pseudonym rather than a stored client address.

## Lifecycle path

The six-hour Cron claims expired incomplete videos with a recoverable `deleting` lease, deletes provider media, then conditionally removes D1 rows. Owner-list cleanup uses the same path as a low-latency fallback.

Playback feedback is event-based: a signed one-use token is accepted only after the Stream player emits `playing`. D1 stores video ID, random event ID, and server time; owner self-play is excluded, events older than 90 days are deleted, and counts never affect matching.

## Forecast path

Cloudflare Cron runs every six hours and makes one independent Open-Meteo Marine request per active spot and model:

| Model | Role | Requested window |
|---|---|---|
| `meteofrance_wave` | active match | 168 future hours + 6 recent past hours |
| `ecmwf_wam` | collect-only | 1 future hour + 6 recent past hours |
| `ncep_gfswave016` | collect-only | 1 future hour + 6 recent past hours |
| `dwd_gwam` | collect-only | 1 future hour + 6 recent past hours |

Rows whose `valid_at` is earlier than retrieval are labelled `historical_forecast`; all others are `forecast`. This uses the normal live Forecast endpoint with bounded `past_hours=6`. The Worker never invokes Open-Meteo Historical Forecast mode and never fabricates old-video backfill. MFWAM keeps the longer horizon because it serves future matching; collect-only models intentionally keep a bounded horizon to control D1 growth while scheduled runs accumulate video-time coverage.

Open-Meteo model fields are normalized without cross-model assumptions. MFWAM and GFS expose partitioned swell components; GFS may expose a third component. DWD GWAM's `swell_wave_*` is stored as total swell rather than primary swell. ECMWF currently contributes total wave fields. Peak periods are retained when supplied. The upstream model-run timestamp is unavailable, so `issued_at` is service retrieval time and `model_run_at` remains null; a normalized response hash makes identical retries idempotent.

CWA computation remains in the outbound-only Home Assistant adapter because the official archive exceeds Workers Free CPU. It reads active coordinates from an HMAC-authenticated endpoint, streams the bounded F-A0020-001 ZIP, keeps three-hourly 0–72-hour rows, selects each spot's reviewed nearest F-A0021-001 location, and submits at most five rows per request with the LocationId in provenance. The Worker revalidates provider/model/spot/time/the nearest tide allowlist, recomputes stable IDs, and writes with `INSERT OR IGNORE`.

Every provider/model/run/valid row is immutable. D1 never averages models or overwrites an older snapshot when a provider changes.

## Operations boundary

Curated credential-free operations events remain inside the modular monolith. Workers AI receives only grouped operational metadata and cannot change product data. A separate GitHub Actions probe monitors production so a Cloudflare outage cannot suppress the only alert path. Unexpected API errors return a generic request ID; request bodies, credentials, raw client addresses, and LINE subjects are not logged.
