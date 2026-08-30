# Roadmap

## Milestone A — product vertical slice

Complete: public spot/time matching, immutable-spot upload with a seven-day capture-time pending window, provider-authoritative 10–60 second media validation, three-tab mobile UI, versioned CC0 notice, two launch spots, owner feedback, reporting, and administrator delisting. The upload notice now distinguishes incidental people from identifiable main subjects and links to official third-party-rights guidance without adding a consent checkbox.

## Milestone B — forecast history

Complete for ECMWF WAM: immutable run/valid/lead/grid snapshots, retry/idempotency coverage, historical run selection, provider-separated matching, and the fixed-target/horizontally-scrollable comparison UI. Production Cron/D1 behavior and the seven-day ECMWF horizon have been verified.

CWA parsing and provenance are implemented and tested, but its official whole-archive ZIP exceeded Workers Free Cron CPU in a guarded production trial. Enabling Workers Paid or approving a separately reviewed chunked design remains a product/operations decision; CWA stays disabled and visibly absent rather than being inferred or mixed into ECMWF.

## Milestone C — production readiness

Complete: real LINE Login, direct signed Stream upload, lifecycle-gated signed thumbnail/playback, owner MP4 download on both tested mobile platforms, HMAC-pseudonymized burst limits, private 90-day playback feedback, guarded deployments, and query-string-redacted observability.

Implemented locally but not yet released: 24-hour share links with a shared monthly anonymous-playback budget, adaptive portrait/landscape playback, public-write rate limiting, generic client errors with request IDs, and baseline response security headers.

Remaining launch gates: isolated staging verification of seven-day expiry deletion and moderation, Cloudflare cost alarms and restore practice, plus two-phone acceptance of the new share-link/quota flow after an explicitly approved deployment.

## Later experiments

After enough complete samples, compare the deterministic baseline with offline clustering or nearest-neighbor methods. Ship ML only when held-out evaluation improves useful matches without hiding provider provenance.
