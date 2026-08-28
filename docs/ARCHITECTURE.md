# Architecture

React and Hono remain one Cloudflare Worker with a strict `/api/v1` boundary. D1 stores normalized metadata; video bytes upload directly to Cloudflare Stream.

## Read path

The public client selects only a spot and a time from now through +72 hours. The API reads the newest provider-separated run available at query time, links each ready/public/same-spot video to the newest run available at capture time, and returns both sides of each explainable comparison. A candidate must cover at least 50% of the target forecast's available numeric feature weight; similarity and coverage remain separate response values. The UI keeps the target forecast fixed and scrolls same-source historical candidates beside it. It loads lazy still thumbnails and expands only the candidate selected by the user; it does not create players or preload video segments during comparison. Authentication is not required to view public results.

Public thumbnail URLs remain first-party API paths. That endpoint repeats the public lifecycle query, then delegates provider metadata lookup to the video-provider interface and redirects to the derived still image. Provider API credentials stay in the Worker.

## Write path

Upload creates a private record and direct Stream ticket. Completion verifies provider status. If spot and time are present and valid, the record can become public; otherwise it remains private until supplemented or expired. Condition enrichment runs best-effort and cannot roll back a successful media completion.

## Lifecycle path

The six-hour Cron also scans globally for incomplete videos whose seven-day metadata window has expired. A conditional D1 update claims each row with an internal `deleting` state before the provider call, so a concurrent metadata completion cannot delete a valid upload. Failed or interrupted claims become eligible again after a 15-minute lease; successful provider deletion is followed by a conditional D1 delete. Owner-list cleanup uses the same path as a low-latency fallback.

## Forecast path

Cloudflare Cron invokes the forecast path every six hours, independently of uploads and lifecycle cleanup. Open-Meteo is fetched once per active spot. CWA's large ZIP is streamed through a bounded unzipper; only three-hourly leads from 0 through 72 are decompressed and only the nearest sea grid for each active spot is retained. CWA tide events for `O00400` are interpolated onto those valid times using local-mean-sea-level heights.

Each source run is normalized into immutable `forecast_snapshots`; stable IDs plus `INSERT OR IGNORE` make retries idempotent. Provider failures are isolated. CWA and ECMWF WAM remain separate rather than averaged. Open-Meteo does not expose the upstream ECMWF run timestamp, so its `issued_at` means first observed by this service and `model_run_at` remains null; CWA preserves the official XML `Sent`, derived model run, valid time, lead, and selected grid.

Development mocks require explicit development flags. Production fails closed for authentication and video provider configuration, but fails open for optional condition enrichment.
