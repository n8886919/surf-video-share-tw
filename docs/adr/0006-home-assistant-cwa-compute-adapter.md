# ADR 0006: Home Assistant CWA compute adapter

Status: accepted

## Context

CWA F-A0020-001 is distributed as one large ZIP. The bounded production parser
requires about two seconds of CPU, while the current Workers Free Cron limit is
10 ms. Upgrading Workers Paid is outside the approved solution. The owner has an
always-on Raspberry Pi 4 running Home Assistant OS.

## Decision

Use one narrowly scoped Home Assistant App as trusted provider compute. It makes
outbound HTTPS requests only: retrieve active spot authority from the Worker,
download and stream-parse the latest official CWA wave/tide data, and submit
small normalized batches through HMAC-SHA256.

The adapter is not a second product backend. It has no inbound port, public API,
D1 credential, arbitrary SQL, Home Assistant API, Supervisor API, Docker API,
host network, privileged capability, device mapping, or Home Assistant config
mount. It persists only last-attempt/success/run summaries and small normalized
batches awaiting retry in its own `/data` volume; full ZIP files are never kept.

Hono remains the only public API and D1 authorization boundary. The Worker
validates the dedicated secret, five-minute timestamp window, nonce syntax,
method/path/raw-body hash, fixed provider/model/schema, active spots, lead/time
relationships, metric bounds, and provenance before any write. It recomputes
stable IDs, supplies server timestamps, and uses `INSERT OR IGNORE` for replay
idempotency. No nonce receipt is stored, avoiding a receipt-written/data-missing
failure mode.

Cloudflare Cron retains `20 */6 * * *` for independent Open-Meteo model ingestion and cleanup. The retired
Worker CWA guard remains false and its CWA secret is removed only after a real
adapter ingestion succeeds.

### Contract packaging deviation

The Worker and App are independent repositories and each keeps its own Zod
validator at its trust boundary. A physically shared package would require a
new registry publication workflow or a build-time Git dependency/submodule.
That would make Home Assistant installation depend on another mutable network
fetch and add more supply-chain failure modes than this small fixed contract
removes. Unpinned Git dependencies and a third checked-in schema artifact are
therefore rejected for this release.

The first contract was version-locked as `cwa-forecast-ingestion-v1`, followed
by the initial multi-location `cwa-forecast-ingestion-v2`. The nearest-location
release advances new batches to `cwa-forecast-ingestion-v3` while the Worker
temporarily accepts persisted v1 and v2 batches under their legacy mappings.
Adding 外埔 advances new batches to `cwa-forecast-ingestion-v4` while the Worker
also accepts persisted v3 batches for a safe Worker-first rollout. Both
repositories generate JSON Schema from their live v4 Zod batch validator and
assert the same SHA-256
fingerprint, plus a separate canonical SHA-256 fingerprint for the complete
spot-to-LocationId mapping. Separate parity assertions cover the three-hour
lead rule and required wave metric refinement because those Zod refinements
are not represented by the generated JSON Schema. The Worker additionally
enforces the mapping at its trust boundary; an App-supplied but wrong approved
LocationId is rejected. A release must run both suites and compare the named
contract version and both fingerprints. Any wire-field, bound, or mapping
change requires a coordinated versioned contract change; one repository must
never drift alone.

## Consequences

- Workers Free remains viable and the large ZIP/parser leaves the scheduled
  Worker bundle.
- A Home Assistant outage can miss an immutable upstream run. Recovery fetches
  only the latest available data; arbitrary backfill is intentionally absent.
- Secret rotation requires updating the Worker secret and App option as one
  coordinated operation. The CWA key exists only in the App after cutover.
- App backup/restore preserves state and pending normalized batches, not source
  archives.
