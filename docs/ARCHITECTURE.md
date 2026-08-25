# Architecture

React and Hono remain one Cloudflare Worker with a strict `/api/v1` boundary. D1 stores normalized metadata; video bytes upload directly to Cloudflare Stream.

## Read path

The public client selects only a spot and a time from now through +72 hours. The API reads the newest provider-separated run available at query time, links each ready/public/same-spot video to the newest run available at capture time, and returns an explainable ranking. Authentication is not required to view public results.

## Write path

Upload creates a private record and direct Stream ticket. Completion verifies provider status. If spot and time are present and valid, the record can become public; otherwise it remains private until supplemented or expired. Condition enrichment runs best-effort and cannot roll back a successful media completion.

## Forecast path

Forecast ingestion is scheduled independently of uploads. Each source run is normalized into immutable `forecast_snapshots`; retries are idempotent. CWA, ECMWF WAM, and any future source remain separate rather than averaged.

Development mocks require explicit development flags. Production fails closed for authentication and video provider configuration, but fails open for optional condition enrichment.
