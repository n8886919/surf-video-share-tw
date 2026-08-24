# Roadmap

## Milestone 1 — runnable upload slice

Foundation, D1 schema, spot checklist, dev auth, mock/Stream video provider boundary, mock conditions, phone upload UI, today-only enforcement, observation display, identity preferences, tests, and CI.

## Milestone 2 — production identity and data

1. Complete: same-origin LINE Login/session flow with state, nonce, PKCE, verified ID token, and server-side revocable sessions. Live callback verification remains an operations gate.
2. Verify coordinates for a small launch subset, then implement Open-Meteo marine and verified CWA tide adapters with fixture tests.
3. Configure Stream delivery/access policy, webhook or polling reconciliation, deletion/retention, upload rate limit, and cost alarms.

## Milestone 3 — core matching value

Add forecast retrieval/cache, same-spot candidate query, deterministic match endpoint, debug differences, and the simple 今天/明天/後天 lookup UI. Do not tune learned weights until real observations exist.
