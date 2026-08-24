# Project State

## Current milestone

Milestone 1 implementation complete; production integrations remain intentionally gated.

## Working now

- React/Hono/D1 modular monolith builds from one Cloudflare-compatible artifact.
- Dev fake login, spot list, 5–60 second upload validation, Taipei today policy, mock upload/conditions, observation history, and identity visibility.
- Stream direct-upload adapter exists behind explicit production config.
- 烏石港 is the sole active spot, using the user-supplied Google Maps point and recorded provenance.
- Domain tests cover time boundaries, normalization, circular matching, missing data, identity, upload validation, and fail-closed auth.

## In progress

- None. External provider and identity wiring are the next milestone.

## Known problems

- Real LINE Login, Open-Meteo, and CWA tide adapters are not implemented.
- Remaining checklist spots are inactive; their translations and coordinates are unverified.
- Real Stream playback/access control, webhook reconciliation, moderation, deletion, and retention are unresolved.
- Forecast/matching UI is intentionally disabled.

## Next 3 tasks

1. Implement LINE Login/OIDC plus secure same-origin sessions and integration tests.
2. Wire real marine/tide snapshots for 烏石港 with provenance fixtures.
3. Finish Stream security/reconciliation, retention, rate limits, and cost alarms before inviting users.

## Important recent decisions

- Cloudflare-first modular monolith; Hono API boundary remains separate from React.
- Stream direct creator uploads; video bytes never proxy through Worker.
- Same-spot deterministic matching only; provider provenance is immutable history.
- Mocks require explicit development mode and fail closed in production.
- Only 烏石港 is active for the initial release; its exact point is `24.8731036, 121.8411446`.
- The current private checkpoint URL is used as the trusted origin for absolute social-preview metadata; update it if a custom domain replaces Sites hosting.
