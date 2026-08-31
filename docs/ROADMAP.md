# Roadmap

## Milestone A — product vertical slice

Complete: public spot/time matching, eighteen active Taiwan spots, immutable-spot 10–60 second upload, seven-day capture-time completion, public Stream lifecycle, three-tab mobile UI, versioned CC0 notice, owner feedback, reporting, and administrator delisting.

## Milestone B — independent forecast history

Implemented:

- immutable provider/model/run/valid/lead/grid snapshots;
- CWA F-A0020-001 wave plus allowlisted F-A0021-001 tide ingestion through the outbound-only Home Assistant adapter;
- independent Open-Meteo ingestion for MFWAM, ECMWF WAM 9 km, NOAA GFS Wave 0.16°, and DWD GWAM;
- explicit `forecast` versus bounded recent `historical_forecast` rows without Historical Forecast mode or arbitrary backfill;
- CWA＋MFWAM matching for offsets 0–2 and MFWAM-only matching for offsets 3–4;
- collect-only ECMWF/GFS/GWAM storage and owner display;
- full owner columns for total wave, total swell, primary/secondary/tertiary swell, wind wave, peak periods, wind, and tide;
- synchronized algorithm specification in [Matching algorithm](MATCHING.md).

The next data-quality step is production observation of several normal Cron cycles, confirming per-model rows, request volume, D1 growth, and the first naturally selected `historical_forecast` without mutating old videos.

## Milestone C — production readiness

Complete in code: LINE Login, direct signed Stream upload, lifecycle-gated signed thumbnail/playback, owner MP4 download, HMAC-pseudonymized burst limits, private 90-day playback feedback, guarded deployments, query-string-redacted observability, migration-drift checks, rendered-site tests, and Chromium WCAG A/AA tests in CI.

Remaining launch gates:

- apply and smoke the current forecast-schema migration and multi-model Cron in production;
- verify required provider attribution/licence presentation before public launch;
- isolated staging exercise of seven-day expiry deletion and moderation;
- Cloudflare cost alarms and D1 restore practice;
- optional two-phone share-link acceptance and real-device camera/metadata acceptance.

## Later experiments

As data grows, improve indexed candidate retrieval before raising the current 20-video exact-scoring boundary. Compare the deterministic baseline with offline clustering or nearest-neighbor methods only after enough complete samples. Ship ML only when held-out evaluation improves useful matches without hiding provider provenance or mixing model features.
