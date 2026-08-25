# Roadmap

## Milestone A — revised local vertical slice

1. Public spot list and find-by-spot/time surface.
2. Seven-day upload/pending lifecycle; condition failure does not fail completion.
3. Three-tab mobile UI, versioned CC0 notice, two launch spots, logo, own filter/favorite/supplement/fun reaction.
4. Public reports, administrator delisting, schema/API tests, and local migration verification.

## Milestone B — forecast history

1. Implemented locally: scheduled immutable snapshots for CWA wave/tide and ECMWF WAM, including run/valid/lead/grid provenance.
2. Implemented locally: separate sources plus current/legacy fixture, missing-field, duplicate-run, and retry tests.
3. Implemented locally: query same-spot videos against the newest run available at historical capture time; equal lead time is not required.
4. Pending: production-like Cron/D1 verification, provider quota observation, and cost/CPU measurement before deployment.

## Milestone C — production readiness

Real Stream upload/playback/access control, lifecycle deletion job, staged moderation verification, rate limits, cost alarms, backups, and a staged rollout under 100 users and NT$1,000/month.

## Later experiments

After enough complete samples, compare the deterministic baseline with offline clustering or nearest-neighbor methods. Ship ML only when held-out evaluation improves useful matches without hiding provider provenance.
