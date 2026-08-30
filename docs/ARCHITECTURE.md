# Architecture

React and Hono remain one Cloudflare Worker with a strict `/api/v1` boundary. D1 stores normalized metadata; video bytes upload directly to Cloudflare Stream.

## Read path

The public client selects only a spot, a Taipei calendar-day offset from 0 through 6, and a whole hour from 05:00 through 19:00; past choices are rejected. The API reads the newest provider-separated run available at query time, links each ready/public/same-spot video to the newest run available at capture time, and returns both sides of each explainable comparison. A candidate must cover at least 50% of the target forecast's available numeric feature weight; similarity and coverage remain separate response values. The client does not render a detached target-forecast section above the historical results. Inside each provider/model group it renders that target on the fixed left as the comparison baseline, horizontally scrolls same-source historical candidates on the right, and row-aligns all returned condition groups. It loads only lazy still thumbnails before an explicit play tap. Authentication is not required to view public results.

Public thumbnail URLs remain first-party API paths. That endpoint repeats the public lifecycle query, then delegates provider metadata lookup to the video-provider interface and redirects to the derived still image. Provider API credentials stay in the Worker.

Playback is also provider-neutral and user-initiated. The thumbnail play control calls a first-party endpoint that repeats the complete/ready/public/terms/visible query before asking the configured provider for playback data, then opens one modal player with the optional public `display_id`, share, and video-report controls. Provider-returned input width/height sizes the player to the actual horizontal or vertical aspect ratio; unknown dimensions fall back to 16:9. Closing or switching leaves at most one active player in that candidate group. Cloudflare Stream uploads require signed URLs and the configured site hostname as an allowed origin. The Worker creates a 15-minute iframe token and never returns Stream API credentials or an unsigned video UID. Candidate lists alone still create no player, manifest, or segment request.

Private contributor feedback is event-based rather than token-request-based. The client loads Cloudflare's official Stream Player SDK only after explicit playback and submits a signed, one-use event identifier after the player emits `playing`. D1 stores only video ID, random event ID, and server timestamp; an authenticated owner playing their own video is excluded. Owner queries count the trailing 90 days, while the six-hour Cron deletes older events in bounded batches. Counts never enter public DTOs, matching, ranking, or rewards.

## Write path

Upload requires an active spot, creates a private record and direct Stream ticket, and never permits the spot to be filled or changed later. Capture time may remain null for seven days. The server validates that any supplied capture time is neither future nor more than 168 hours old, independently of browser or file metadata. Completion verifies the provider-reported 10–60 second duration. If capture time and provider status are valid, the record can become public; otherwise it remains private until its time is supplemented or it expires. Condition enrichment runs best-effort and cannot roll back a successful media completion.

LINE registration has a database-enforced 100-user ceiling for the internal test. Existing subjects are looked up and updated first, so they continue to sign in at capacity. A new subject is inserted only by a single conditional `INSERT ... SELECT` whose count predicate is evaluated with the write; a full registry creates neither a user nor a session.

Link sharing and owner MP4 export are separate. Any authenticated viewer may request a 24-hour `/v/:videoId?share=<opaque>` link for a currently public video. AES-GCM keeps the exporter ID, video ID, creation-month budget period, and expiry opaque and tamper-evident without storing individual link rows. D1 stores only one `share_playback_budgets` counter per exporter and Taipei month. Anonymous shared playback atomically increments that counter below 100 before asking the provider for a token; a valid signed-in viewer skips it. All links for that exporter/month share the counter, including a link that crosses into the next month. Page/thumbnail access is free of this counter. Separately, the authenticated owner-download route rechecks ownership plus lifecycle and returns only a short-lived encoded-MP4 ticket. The Worker never buffers or proxies media.

Anonymous D1-writing entry points share one `PUBLIC_WRITE_RATE_LIMITER` binding but use separate `line-login:`, `problem-report:`, and `video-report:` key scopes. Each key contains only an HMAC pseudonym derived from Cloudflare's client address and `SESSION_SECRET`; raw addresses are not stored, logged, or sent to the limiter. Rejection happens before OAuth/report D1 access. Product reports remain separate from media moderation, and only the configured administrator can list/resolve reports or render the inline moderation queue in 「我的」.

## Lifecycle path

The six-hour Cron also scans globally for incomplete videos whose seven-day metadata window has expired. A conditional D1 update claims each row with an internal `deleting` state before the provider call, so a concurrent metadata completion cannot delete a valid upload. Failed or interrupted claims become eligible again after a 15-minute lease; successful provider deletion is followed by a conditional D1 delete. Owner-list cleanup uses the same path as a low-latency fallback.

## Forecast path

Cloudflare Cron invokes the forecast path every six hours, independently of uploads and lifecycle cleanup. Open-Meteo is fetched once per active spot with 168 hourly ECMWF WAM forecast hours so the selected Taipei day offsets remain covered. CWA's large ZIP is streamed through a bounded unzipper; only three-hourly leads from 0 through 72 are decompressed and only the nearest sea grid for each active spot is retained. Days four through seven can therefore be ECMWF-only. CWA tide events for `O00400` are interpolated onto those valid times using local-mean-sea-level heights.

Each source run is normalized into immutable `forecast_snapshots`; stable IDs plus `INSERT OR IGNORE` make retries idempotent. Provider failures are isolated. CWA and ECMWF WAM remain separate rather than averaged. Open-Meteo does not expose the upstream ECMWF run timestamp, so its `issued_at` means first observed by this service and `model_run_at` remains null; CWA preserves the official XML `Sent`, derived model run, valid time, lead, and selected grid.

Development mocks require explicit development flags. Production fails closed for authentication and video provider configuration, but fails open for optional condition enrichment.

The Worker wraps API, rendered HTML, asset, and image responses with `Referrer-Policy: strict-origin` and `X-Content-Type-Options: nosniff`. Unexpected API failures return a generated request ID and generic message; structured server logs correlate that ID with method, path, error name, and a bounded/redacted error summary without logging request bodies or query strings.
