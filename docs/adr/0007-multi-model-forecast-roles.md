# ADR 0007: Multi-model forecast roles and bounded historical preference

Status: accepted

## Context

Wave models expose different independent features. Treating Open-Meteo as one ECMWF feature source hid MFWAM's partitioned swell data, mislabeled DWD aggregate swell, and prevented collecting extra models for later evaluation. The product goal is to associate a video with the best normally available estimate of conditions at capture, while never showing a post-event row as a future forecast.

## Decision

- Keep CWA, MFWAM, ECMWF WAM 9 km, GFS Wave 0.16°, and DWD GWAM as immutable provider/model rows.
- Match with CWA＋MFWAM for Taipei offsets 0–2 and MFWAM-only for offsets 3–4. ECMWF, GFS, and GWAM are collect-only.
- Never mix model features. MFWAM/GFS swell fields are partitioned components; DWD GWAM swell fields map to explicit total-swell columns.
- Use the normal Open-Meteo live Forecast endpoint with `past_hours=6`. Mark returned past-valid rows `historical_forecast`; do not call Historical Forecast mode and do not backfill old videos.
- Future targets filter to `forecast`. Video-side selection prefers `historical_forecast`, then falls back to a `forecast` issued by capture time.
- Keep 168 future hours only for active MFWAM. Collect-only models retain one future hour plus the six recent-past hours.
- Show every selected source in the owner view, active sources first, with collect-only status explicit.

## Consequences

Matching remains inexpensive because exact scoring still evaluates at most 20 videos and at most two active sources. D1 growth is dominated by MFWAM's required future horizon; collect-only growth is bounded. Existing dog/test videos are not migrated or backfilled. Source roles and score details are synchronized in [Matching algorithm](../MATCHING.md).
