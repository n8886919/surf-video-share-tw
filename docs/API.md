# API

Base path: `/api/v1`.

| Access | Method | Path | Purpose |
|---|---|---|---|
| Public | GET | `/health` | Readiness smoke check |
| Public | GET | `/spots` | Active launch spots |
| Public | GET | `/matches?spotId=&targetTime=` | Public forecast context and same-spot videos |
| Public | GET | `/videos/:id/thumbnail` | Revalidate public lifecycle and redirect to a provider thumbnail |
| Public | POST | `/videos/:id/reports` | Record a report against a currently public video |
| Public | GET | `/auth/line` | Start LINE Login |
| Public | GET | `/auth/line/callback` | Complete LINE Login |
| Signed in | GET/PATCH | `/me` | Profile/default identity |
| Signed in | GET | `/videos` | Own complete and pending videos |
| Signed in | POST | `/videos/upload-request` | Create upload; spot/time may be null |
| Signed in | POST | `/videos/:id/complete` | Verify media; conditions are best-effort |
| Signed in | PATCH | `/videos/:id` | Fill metadata, favorite, identity, public supplement, or fun reaction |
| Admin | GET | `/admin/reports` | List open reports |
| Admin | POST | `/admin/reports/:id/delist` | Delist the video and resolve its open reports |

`/matches` accepts only now through +72 hours. Only CC0-versioned, moderation-visible, public-ready rows appear; pending and delisted rows never leak. Each provider/model group returns its fixed `targetForecast`; every ranked item includes the same-source `candidateForecast` that was available when that video was captured. Candidates must cover at least 50% of the numeric weight available on the target. Ranked items return `score` as a 0–1 similarity index plus `availableWeight`, `matchedWeight`, and `coverage`; the score is not a probability. Public observations link to the first-party thumbnail endpoint rather than exposing an API credential.

`/videos/:id/thumbnail` repeats the complete/ready/public/terms/visible D1 check on every uncached request, then asks the configured video provider for a still-image URL. Missing, private, delisted, provider-mismatched, and signed-only-without-token cases do not redirect.

DTOs never include LINE subjects or internal owner IDs. Shared observation, forecast, match-group, and public-match response types live in `packages/api-contract/src/index.ts` and are used by both the Worker serializers and React find flow.
