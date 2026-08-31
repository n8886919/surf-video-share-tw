# Roadmap

## Milestone A — product vertical slice

Complete: public spot/time matching, immutable-spot upload with a seven-day capture-time pending window, provider-authoritative 10–60 second media validation, three-tab mobile UI, versioned CC0 notice, eight active MVP spots, owner feedback, reporting, and administrator delisting. The upload notice now distinguishes incidental people from identifiable main subjects and links to official third-party-rights guidance without adding a consent checkbox.

## Milestone B — forecast history

Complete for ECMWF WAM and CWA: immutable run/valid/lead/grid snapshots, retry/idempotency coverage, historical run selection, provider-separated matching, and the horizontally scrollable composite-result UI with a target baseline inside each comparison. Production Cron/D1 behavior and the seven-day ECMWF horizon have been verified.

CWA archive retrieval and parsing run in the outbound-only Home Assistant App; the Worker accepts fixed five-row HMAC batches and remains within Workers Free CPU. Real production ingestion and idempotent replay passed, CWA remains a separate source from ECMWF, and the Worker no longer stores the CWA provider key.

ECMWF ingestion targets every active spot. CWA contract v2 has a reviewed tide mapping for every active spot, while rollout and current production coverage remain explicitly tracked in `docs/PROJECT_STATE.md`; neither source fabricates historical backfill.

## Milestone C — production readiness

Complete: real LINE Login, direct signed Stream upload, lifecycle-gated signed thumbnail/playback, owner MP4 download on both tested mobile platforms, HMAC-pseudonymized burst limits, private 90-day playback feedback, guarded deployments, and query-string-redacted observability.

Released and production-smoked: 24-hour share links with a shared monthly anonymous-playback budget, adaptive portrait/landscape playback, public-write rate limiting, generic client errors with request IDs, and baseline response security headers.

Remaining launch gates: isolated staging verification of seven-day expiry deletion and moderation plus Cloudflare cost alarms and restore practice. The owner deliberately deferred the optional two-phone acceptance pass for this release.

## UX acceptance remaining

The side-by-side `選擇影片`／`拍攝影片` actions and the inline `更多`／`收合` rights guidance are implemented and deployed. Remaining work is real-device acceptance of camera fallback, metadata behavior, and accessible expanded/control semantics on the target browsers; it is not a pending implementation item.

## Later experiments

After enough complete samples, compare the deterministic baseline with offline clustering or nearest-neighbor methods. Ship ML only when held-out evaluation improves useful matches without hiding provider provenance.
