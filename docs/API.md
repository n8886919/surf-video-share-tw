# API

Base path: `/api/v1`.

| Access | Method | Path | Purpose |
|---|---|---|---|
| Public | GET | `/health` | Shallow process liveness check |
| Public | GET | `/readiness` | D1 and required operations-binding readiness check |
| Public | GET | `/spots` | Active launch spots, with 烏石港 first |
| Public | GET | `/matches?spotId=&targetTime=` | Public forecast context and same-spot videos |
| Public | GET | `/public-videos/:id` | Return one currently public video for its stable first-party page |
| Public | GET | `/videos/:id/thumbnail` | Revalidate public lifecycle and redirect to a provider thumbnail |
| Public | POST | `/videos/:id/playback` | Revalidate public lifecycle and create short-lived provider playback data |
| Public | POST | `/shared-videos/:id/playback` | Validate a 24-hour share token and grant playback; anonymous grants consume exporter budget |
| Public | POST | `/videos/:id/playback-start` | Validate a short-lived playback token and record one actual player start |
| Public | POST | `/videos/:id/reports` | Record a report against a currently public video |
| Public | POST | `/problem-reports` | Record a concise anonymous product problem report |
| Public | GET | `/auth/line` | Start LINE Login; `?manual=1` disables LINE auto login for recovery |
| Public | GET | `/auth/line/callback` | Complete LINE Login |
| Signed in | GET/PATCH | `/me` | Profile/default identity |
| Signed in | GET | `/videos` | Own complete and pending videos |
| Signed in | POST | `/videos/:id/share-link` | Create a 24-hour first-party share path for any currently public video |
| Signed in | POST | `/videos/:id/download` | Prepare or poll an owner-only encoded MP4 download |
| Signed in | POST | `/videos/upload-request` | Create upload; spot is required and capture time may be null |
| Signed in | POST | `/videos/:id/complete` | Verify media; conditions are best-effort |
| Signed in | PATCH | `/videos/:id` | Fill metadata, favorite, identity, public supplement, or fun reaction |
| Admin | GET | `/admin/reports` | List open reports |
| Admin | POST | `/admin/reports/:id/delist` | Delist the video and resolve its open reports |
| Admin | GET | `/admin/problem-reports` | List open product problem reports |
| Admin | POST | `/admin/problem-reports/:id/resolve` | Resolve one open product problem report |
| Internal HMAC | GET | `/internal/forecast-ingestion/spots` | Return only active spot IDs/slugs and verified coordinates for the CWA adapter |
| Internal HMAC | POST | `/internal/forecast-ingestion/cwa` | Validate and insert up to five fixed-schema CWA snapshots |

The two forecast-ingestion routes are not browser APIs. Every request requires the dedicated `FORECAST_INGESTION_SECRET` and HMAC-SHA256 headers covering signature version, Unix timestamp, nonce, uppercase method, exact pathname, and the SHA-256 of the raw body. The accepted clock skew is at most five minutes. Missing configuration fails closed; malformed, expired, wrong-path, wrong-signature, or over-128-KiB requests are rejected before D1. The current POST contract is `cwa-forecast-ingestion-v2`: payload version 2 accepts only provider `cwa`, model `cwa-wave-f-a0020-001`, batches of at most five, three-hourly leads 0–72, active server-known spots, bounded nullable metrics, and fixed F-A0020-001 plus allowlisted per-spot F-A0021-001 provenance. A mismatched spot/LocationId is rejected before D1. Payload version 1 remains temporarily accepted for safe Worker-first rollout and retains only its former `O00400` tide behavior. The Worker normalizes timestamps, recomputes the stable forecast ID, assigns receive/retrieve time, and returns only `attempted`, `inserted`, and `duplicates`.

`/matches` accepts only whole-hour targets from 05:00 through 19:00 in `Asia/Taipei`, from the current local calendar day through day offset four, and rejects already-past targets. Offset-bearing ISO input is normalized to a UTC `Z` timestamp before validation, query binding, and response serialization. Upload creation and capture-time completion use the same normalization before D1 persistence; historical forecast availability compares actual Unix instants rather than raw timestamp text, so an equivalent `+08:00` representation cannot admit a run published after capture. Only CC0-versioned, moderation-visible, public-ready rows appear; pending and delisted rows never leak. `timeWindowObservations` contains every such same-spot video whose `Asia/Taipei` capture clock time is within two hours before or after the selected whole hour, inclusive and ordered newest first. It is independent of forecast coverage and matching. At offsets 0–2, a video enters `matches` only when both CWA `cwa-wave-f-a0020-001` and Open-Meteo `ecmwf_wam` have a current target forecast plus a historical forecast available at capture time. Each source is scored independently, must cover at least 50% of that source target's numeric weight, and contributes 50% of `score`; `ranking` is `equal-provider-composite-historical-forecast`. At offsets 3–4 only ECMWF is required, `score` is its source score, and `ranking` is `ecmwf-only-historical-forecast`. Within each source, primary and secondary swell share one fixed swell budget according to target height squared, are compared as an unordered pair, and all circular directions use cosine distance. Neither mode averages raw forecast fields, learns from subjective reactions, or returns a probability. Every participating source keeps its own `targetForecast`, `candidateForecast`, `score`, `availableWeight`, `matchedWeight`, and `coverage`; public observations link to the first-party thumbnail endpoint rather than exposing an API credential. The complete reproducible scoring specification is [Matching algorithm](MATCHING.md).

Each participating `/matches` source also returns the exact `swellPairing` chosen while scoring: every target `primary` or `secondary` component maps to the candidate's original `primary` or `secondary` provider label, or to `null` when unmatched. The browser renders this assignment directly and never recomputes or silently relabels it. This field is preserved separately for every provider and candidate alongside `targetForecast`, `candidateForecast`, `score`, `availableWeight`, `matchedWeight`, and `coverage`.

`/videos/:id/thumbnail` repeats the complete/ready/public/terms/visible D1 check on every uncached request, then asks the configured video provider for a still-image URL. Missing, private, delisted, provider-mismatched, and signed-only-without-token cases do not redirect.

`POST /videos/:id/playback` repeats the same lifecycle check and is called only after an explicit tap on a candidate or owner thumbnail. The response opens one modal player; candidate listing itself never creates playback data. Cloudflare Stream responses contain a 15-minute signed iframe URL, ISO expiry, and sanitized original width/height used to size horizontal or vertical players; the mock provider returns null dimensions. Responses are `no-store`. Missing, incomplete, non-ready, unversioned, private, delisted, provider-mismatched, unsigned legacy, and provider-error cases never expose an unsigned Stream UID or API credential.

The playback response also contains a 15-minute HMAC tracking token with a random event ID. The client submits it to `POST /videos/:id/playback-start` only after the official Stream Player SDK emits `playing`. The endpoint repeats the public lifecycle query, rejects altered/expired tokens, excludes an authenticated owner playing their own video, and inserts the event ID with server time using `INSERT OR IGNORE`. It stores no viewer identity or address. Authenticated owner video responses include `playbackCount90d`; public responses do not.

`GET /public-videos/:id` is the metadata boundary for `/v/:videoId` pages. It returns spot/capture time, first-party thumbnail path, optional public `display_id`, supplement and reaction only while the existing complete/ready/public/terms/visible lifecycle passes. It never returns a provider video UID, owner ID, playback token, MP4 URL, owner favorite, or owner playback count. A clean page path can render metadata, but shared-page playback requires its `share` query token.

Authenticated `POST /videos/:id/share-link` accepts any currently public video, encrypts the video ID, exporter internal ID, `Asia/Taipei` creation month, and 24-hour expiry with AES-GCM derived from `SESSION_SECRET`, and returns only a first-party path plus expiry and remaining anonymous quota. It never exposes those internal fields in plaintext. All links made by one exporter during one month share a D1 budget of 100 anonymous playback grants; new links do not reset it. `POST /shared-videos/:id/playback` validates the encrypted token, expiry, path video ID, current public lifecycle, and normal playback burst limit. It reserves one quota unit atomically before the provider call only when no valid login session is present; authenticated viewers skip this budget. Page/metadata/thumbnail access does not reserve quota. A provider failure after reservation is conservatively not refunded.

Authenticated `POST /videos/:id/download` additionally requires that the row belong to the current user. It accepts only complete, ready, public, terms-versioned, moderation-visible videos. A `202` response reports Stream MP4 preparation progress; a ready `200` response contains a 15-minute signed URL whose token is marked `downloadable`. The URL retrieves Stream's encoded MP4, not the original upload. Responses are `no-store`; the Worker never proxies video bytes.

Upload-ticket, playback-token, and owner-download creation use independent rate-limit bindings. Anonymous D1-writing routes use `PUBLIC_WRITE_RATE_LIMITER` with separate `line-login:`, `problem-report:`, and `video-report:` key scopes, each followed by an HMAC pseudonym rather than the raw client address. A rejected burst returns `429` with `Retry-After: 60`; missing key material or unavailable required limiter configuration returns `503` in production. LINE login, product-report, and video-report rejection happens before OAuth/report D1 access. Public read routes such as health, spots, matches, and thumbnail redirects are not blocked by these route-specific counters.

`POST /problem-reports` accepts only a trimmed 5–300 character `message` and `view` in `find | upload | mine`. It does not require authentication and stores no contact detail, user ID, raw LINE subject, or raw client address. Admin list/resolve routes remain authenticated and do not expose reporter identity because none is collected.

`POST /videos/upload-request` requires a valid active `spotId`; the shared contract rejects missing or null spots and `PATCH /videos/:id` does not accept `spotId`. Capture time may be null initially, but both creation and later completion enforce the server-owned 168-hour window, reject future timestamps, and require the actual `Asia/Taipei` capture hour to be 05–19 regardless of browser or file metadata. Capture minutes and seconds are preserved. Requested and provider-verified duration must be 10–60 seconds; a real provider video cannot publish until it reports a positive in-range duration.

Public DTOs never include LINE subjects or internal owner IDs. Shared observation, forecast, match-group, public-match, playback, share-link, and owner-download response types live in `packages/api-contract/src/index.ts` and are used by the Worker and React client.

Authenticated `GET /me` includes `suggestedDisplayName`, the current private LINE display-name suggestion, separately from the user-confirmed `displayId`. Public video DTOs can return only the confirmed name and only when that video's visibility flag is enabled. Upload requests enforce the shared 200,000,000-byte source-file limit before creating a Stream ticket.

Authenticated `GET /videos` also returns `historicalForecasts` for each owned video. For every provider/model it selects the newest immutable run that was available at capture time and whose valid time is within four hours of capture. Sources remain separate and missing values stay null; the compact owner view never averages or fills them.

The LINE callback keeps existing users eligible but does not create user 101. When the 100-user internal-test registry is full, a verified new LINE subject is redirected to `/?login=capacity` without creating a user or session; the browser presents a capacity message without exposing the LINE subject.

LINE Login attempts remain protected by one-time server-stored `state`, OpenID Connect `nonce`, and PKCE. If LINE auto login returns an expired/mismatched attempt or the token exchange fails, the browser now lands on a visible retry screen. Its retry starts a fresh protected attempt through `/auth/line?manual=1`, which sends LINE's documented `disable_auto_login=true` parameter instead of repeating a failing iPhone auto-login loop.

Every Worker response includes `Referrer-Policy: strict-origin` and `X-Content-Type-Options: nosniff`. Expected validation/domain failures retain their explicit status and safe message. An unexpected exception returns `500 REQUEST_FAILED` with a generic message, generated `requestId`, and matching `X-Request-ID`; the original exception is available only through the structured server log correlated by that ID, not in the client response.

`GET /readiness` returns only `ok` and `checkedAt`, is always `no-store`, and never names a missing secret or dependency. It checks D1 connectivity; in production it also requires the Workers AI binding, both operations-only LINE Messaging API values, core LINE Login/Stream/forecast-ingestion configuration, the administrator ID, and all four rate-limit bindings. It does not make live cost-bearing calls to those dependencies. The external monitor uses this endpoint in addition to `/health`, the exact eight-spot response, and the rendered home page. Recommendation accuracy is intentionally outside the uptime check.
