# API

Base path: `/api/v1`.

| Access | Method | Path | Purpose |
|---|---|---|---|
| Public | GET | `/health` | Readiness smoke check |
| Public | GET | `/spots` | Active launch spots |
| Public | GET | `/matches?spotId=&targetTime=` | Public forecast context and same-spot videos |
| Public | GET | `/videos/:id/thumbnail` | Revalidate public lifecycle and redirect to a provider thumbnail |
| Public | POST | `/videos/:id/playback` | Revalidate public lifecycle and create short-lived provider playback data |
| Public | POST | `/videos/:id/reports` | Record a report against a currently public video |
| Public | POST | `/problem-reports` | Record a concise anonymous product problem report |
| Public | GET | `/auth/line` | Start LINE Login |
| Public | GET | `/auth/line/callback` | Complete LINE Login |
| Signed in | GET/PATCH | `/me` | Profile/default identity |
| Signed in | GET | `/videos` | Own complete and pending videos |
| Signed in | POST | `/videos/:id/download` | Prepare or poll an owner-only encoded MP4 download |
| Signed in | POST | `/videos/upload-request` | Create upload; spot/time may be null |
| Signed in | POST | `/videos/:id/complete` | Verify media; conditions are best-effort |
| Signed in | PATCH | `/videos/:id` | Fill metadata, favorite, identity, public supplement, or fun reaction |
| Admin | GET | `/admin/reports` | List open reports |
| Admin | POST | `/admin/reports/:id/delist` | Delist the video and resolve its open reports |
| Admin | GET | `/admin/problem-reports` | List open product problem reports |
| Admin | POST | `/admin/problem-reports/:id/resolve` | Resolve one open product problem report |

`/matches` accepts only now through +72 hours. Only CC0-versioned, moderation-visible, public-ready rows appear; pending and delisted rows never leak. Each provider/model group returns its fixed `targetForecast`; every ranked item includes the same-source `candidateForecast` that was available when that video was captured. Candidates must cover at least 50% of the numeric weight available on the target. Ranked items return `score` as a 0–1 similarity index plus `availableWeight`, `matchedWeight`, and `coverage`; the score is not a probability. Public observations link to the first-party thumbnail endpoint rather than exposing an API credential.

`/videos/:id/thumbnail` repeats the complete/ready/public/terms/visible D1 check on every uncached request, then asks the configured video provider for a still-image URL. Missing, private, delisted, provider-mismatched, and signed-only-without-token cases do not redirect.

`POST /videos/:id/playback` repeats the same lifecycle check and is called only after an explicit play action on the selected candidate. Cloudflare Stream responses contain a 15-minute signed iframe URL and ISO expiry; the mock provider returns a deterministic non-video response. Responses are `no-store`. Missing, incomplete, non-ready, unversioned, private, delisted, provider-mismatched, unsigned legacy, and provider-error cases never expose an unsigned Stream UID or API credential.

Authenticated `POST /videos/:id/download` additionally requires that the row belong to the current user. It accepts only complete, ready, public, terms-versioned, moderation-visible videos. A `202` response reports Stream MP4 preparation progress; a ready `200` response contains a 15-minute signed URL whose token is marked `downloadable`. The URL retrieves Stream's encoded MP4, not the original upload. Responses are `no-store`; the Worker never proxies video bytes.

Upload-ticket, playback-token, owner-download, and problem-report creation use independent rate-limit bindings. A rejected burst returns `429` with `Retry-After: 60`; unavailable required limiter configuration returns `503` in production. Public read routes such as health, spots, matches, and thumbnail redirects are not blocked by these route-specific counters.

`POST /problem-reports` accepts only a trimmed 5–300 character `message` and `view` in `find | upload | mine`. It does not require authentication and stores no contact detail, user ID, raw LINE subject, or raw client address. Admin list/resolve routes remain authenticated and do not expose reporter identity because none is collected.

Public DTOs never include LINE subjects or internal owner IDs. Shared observation, forecast, match-group, public-match, playback, and owner-download response types live in `packages/api-contract/src/index.ts` and are used by the Worker and React client.

Authenticated `GET /me` includes `suggestedDisplayName`, the current private LINE display-name suggestion, separately from the user-confirmed `displayId`. Public video DTOs can return only the confirmed name and only when that video's visibility flag is enabled. Upload requests enforce the shared 200,000,000-byte source-file limit before creating a Stream ticket.

The LINE callback keeps existing users eligible but does not create user 101. When the 100-user internal-test registry is full, a verified new LINE subject is redirected to `/?login=capacity` without creating a user or session; the browser presents a capacity message without exposing the LINE subject.
