# Architecture

React and Hono run as one Cloudflare Worker with a strict `/api/v1` boundary. D1 stores normalized metadata and immutable condition provenance; browsers never read D1 or provider secrets. Video bytes upload directly to Cloudflare Stream.

The detailed score formula, weights, coverage, unordered swell assignment, source roles, and deterministic tie-breaks are authoritative in [Matching algorithm](MATCHING.md). This document describes only system and data-flow boundaries.

## Read path

A debounced freshness preview reuses the exact target SQL without fetching videos or creating search events. It displays retained-row retrieval timestamps beside Search, separately per required source; this is not an upstream issue timestamp or latest check time. Missing/error/stale states remain explicit. Public thumbnail routes proxy raster bytes; no signed URL is returned.


The public client selects one of the nineteen active spots plus an `Asia/Taipei` calendar-day offset 0–4 and a whole hour 05:00–19:00, then explicitly presses Search below the date/time controls. Entry, control changes, and tab return do not trigger matching requests. The browser discards stale responses by exact `spotId + targetTime` request ownership; changing a control immediately hides the old result. Last-query state survives tab changes within the page, but players are unmounted on leaving Find. Public observation SQL skips playback counts; only owner queries compute them.

For a future target, the API reads only `snapshot_kind = forecast`, requires `issued_at <= queryNow`, limits `valid_at` distance to four hours, and chooses the newest provider/model run. Matching source features are never merged:

- offsets 0–2 require CWA `cwa-wave-f-a0020-001` and Open-Meteo `meteofrance_wave`; each source must independently pass 50% coverage and contributes 50% of the final score;
- offsets 3–4 require only `meteofrance_wave`, so the MFWAM source score is the final score;
- ECMWF WAM 9 km, NOAA GFS Wave 0.16°, and DWD GWAM are collect-only and never enter the current score.

The candidate query considers all complete, ready, public, current-terms, moderation-visible videos at the same spot. Historical matching reads only the exact CWA/MFWAM pairs. For every required provider/model, a video prefers a nearby `historical_forecast`; if none exists it falls back to a nearby `forecast` whose `issued_at <= captured_at`. Expression indexes bound forecast valid time in integer seconds and recent public capture time in Julian days, preserving the original time precision and ranking. The selected source rows remain independent through domain scoring. Primary and secondary swell are an unordered pair, and the API returns the exact chosen assignment so the client never infers a pairing from display row order.

The result uses one fixed target-forecast column beside a horizontally scrolling candidate list. Each candidate card displays its independent capture-time source metrics. A second rail returns every same-spot public video captured between server request time and two hours earlier, inclusive. This rolling rail does not use the selected forecast target, require forecast coverage, or change ranking; its snapshot updates only on an explicit Search.

Authenticated owner responses select one row per provider/model with the same historical preference. They order CWA and MFWAM first, followed by collect-only ECMWF, GFS, and GWAM. The owner table exposes total wave, total swell, primary/secondary/tertiary swell, wind wave, wind, and tide fields as available, plus an explicit active or collect-only label. Missing values remain null and render as `—`.

Public thumbnail, playback, sharing, and download URLs stay first-party. Every media route repeats lifecycle and authorization checks before delegating to the video-provider interface. Stream credentials and unsigned provider video IDs never cross the API boundary.

## Write path

Before requesting a Stream ticket, the browser computes SHA-256 over the full selected file in a dedicated Web Worker using pinned `@noble/hashes`, reading 256 KiB chunks. The worker is terminated after completion, cancellation, error or a 30-second timeout; an unavailable hash does not block upload. An in-memory result is reused only for the exact selected File object and discarded on replacement/unmount. No original video bytes are sent to the application Worker for hashing. Optional client SHA-256 and byte-size claims are stored on the existing video row; a partial composite index supports a rolling 24-hour, cross-account public-duplicate reminder inside the authenticated upload-request route. A fingerprint cannot prove ownership or media identity because video bytes go directly to Stream. The user can open the eligible public video, choose a different file or report a suspected mistake; no overwrite, cross-account asset adoption, permanent hash lock, new Cron, scan of Stream media or historical hash backfill is added.

Upload offers gallery selection and an HTML `capture="environment"` preference. A bounded browser parser may suggest an explicitly zoned QuickTime creation time and, under strict precision/distance rules, a nearby active spot. Raw coordinates never leave component memory. The user confirms only spot and capture time; no condition number is user-entered.

The API creates a private upload row, validates the server-owned 168-hour and 05:00–19:59 capture policy, and issues a direct Stream ticket. Completion verifies provider-authoritative 10–60 second duration. Missing capture time remains private for at most seven days. Condition enrichment is best-effort and cannot roll back successful media completion.

LINE registration has a database-enforced 100-user ceiling. Raw LINE subjects never enter public DTOs. Anonymous D1-writing routes use scoped Cloudflare rate limits keyed by an HMAC pseudonym rather than a stored client address.

Product `0.27` binds login delivery to an independent HttpOnly first-party proof cookie established by the user-clicked begin redirect. D1 retains ten-minute attempt progress; atomic pending→processing permits only one LINE code exchange, retained by Worker `waitUntil`. State/nonce/PKCE validation is unchanged. The callback stores only a short-lived internal-user result and never sets a session cookie. Another browser cannot claim it using state or a diagnostic ID. Only a same-origin JSON completion POST with the original proof can atomically create one session; lost responses allow 60-second idempotent redelivery of that same live session without extending expiry. The browser must confirm `/me`, and can resume on foreground/pageshow with bounded polling. Original-container and cookie-unavailable states are explicit; physical mobile acceptance remains necessary. See [API](API.md) and [Operations](OPERATIONS.md#line-login-completion-product-027).

The temporary diagnostics from Product `0.25` now cover begin/callback/proof-bearing completion and session checks. A separately namespaced non-credential HMAC trace correlates events; authorization never trusts a diagnostic value. Fixed allowlisted events go to console and best-effort D1 with separate per-kind/client rate-limit keys, a collection deadline and bounded seven-day-target cleanup. They are not fed to AI or LINE alerts and cannot gate login. No-proof visitors generate no completion diagnostic event; see [Operations](OPERATIONS.md#temporary-line-login-diagnostics-product-025).

## Lifecycle path

The six-hour Cron claims expired incomplete videos with a recoverable `deleting` lease, deletes provider media, then conditionally removes D1 rows. Owner-list cleanup uses the same path as a low-latency fallback.

Playback feedback is event-based: a signed one-use token is accepted only after the Stream player emits `playing`. D1 stores video ID, random event ID, and server time; owner self-play is excluded, events older than 90 days are deleted, and counts never affect matching.

## Forecast path

Cloudflare Cron runs every six hours and makes one independent Open-Meteo Marine request per active spot and model:

| Model | Role | Requested window |
|---|---|---|
| `meteofrance_wave` | active match | 126 future hours at Taipei 08:20/20:20; through tomorrow 23:00 at 02:20/14:20; always 6 recent past hours |
| `ecmwf_wam` | collect-only | 1 future hour + 6 recent past hours |
| `ncep_gfswave016` | collect-only | 1 future hour + 6 recent past hours |
| `dwd_gwam` | collect-only | 1 future hour + 6 recent past hours |

Rows whose `valid_at` is earlier than retrieval are labelled `historical_forecast`; all others are `forecast`. This uses the normal live Forecast endpoint with bounded `past_hours=6`. The Worker never invokes Open-Meteo Historical Forecast mode and never fabricates old-video backfill. MFWAM keeps the longer horizon because it serves future matching; collect-only models intentionally keep a bounded horizon to control D1 growth while scheduled runs accumulate video-time coverage.

Open-Meteo model fields are normalized without cross-model assumptions. MFWAM and GFS expose partitioned swell components; GFS may expose a third component. DWD GWAM's `swell_wave_*` is stored as total swell rather than primary swell. ECMWF currently contributes total wave fields. Peak periods are retained when supplied. The upstream model-run timestamp is unavailable, so `issued_at` is service retrieval time and `model_run_at` remains null; a validated MFWAM metadata availability hint plus per-point content/grid/kind hash makes unchanged overlapping points idempotent across a moving window. During metadata failure or the ten-minute replication window, use the whole-response hash fallback. Neither metadata nor a successful check fabricates model_run_at.

CWA computation remains in the outbound-only Home Assistant adapter because the official archive exceeds Workers Free CPU. It reads active coordinates from an HMAC-authenticated endpoint, streams the bounded F-A0020-001 ZIP, keeps three-hourly 0–72-hour rows, selects each spot's reviewed nearest F-A0021-001 location, and submits at most five rows per request with the LocationId in provenance. The Worker revalidates provider/model/spot/time/the nearest tide allowlist, recomputes stable IDs, and writes with `INSERT OR IGNORE`. After every row is accepted, the App sends a separately signed completion request. The Worker first checks the small operational run ledger, then verifies all twenty-five 0–72-hour leads at every active spot through a partial covering run index. It records completion without sending per-run LINE. MFWAM records each scheduled attempt separately and marks it complete only after every spot succeeds; operational slot timestamps never replace upstream model-run timestamps. The existing hourly task sends one combined prior-day CWA/MFWAM count at 09:05 Asia/Taipei, with a persisted message, claim and LINE retry key. See [Operations](OPERATIONS.md#daily-forecast-report-product-028) for counting, rollout and retry semantics.

Every provider/model/run/valid row is immutable. D1 never averages models or overwrites an older snapshot when a provider changes.

## Operations boundary

Curated credential-free operations events remain inside the modular monolith. Workers AI receives only grouped operational metadata and cannot change product data. A separate GitHub Actions probe monitors production so a Cloudflare outage cannot suppress the only alert path. Unexpected API errors return a generic request ID; request bodies, credentials, raw client addresses, and LINE subjects are not logged.

## Administrator and diagnostic boundaries (0.29)

`/admin` is a separate LINE-authenticated client surface; all `/api/v1/admin/*` operations enforce the internal administrator allowlist. Resolution/restoration and their append-only audit commit in one D1 transaction. Private review thumbnails proxy only provider-returned image bytes; explicit review playback remains signed and never enters public playback counts. New diagnostic events use strict shared input validation, no identity or arbitrary content, console-first best-effort persistence, per-source/day D1 caps and bounded hourly retention. Server observations and client claims remain distinct; daily counts cannot establish billing or unique people. See Operations for the exact limits and retention.
