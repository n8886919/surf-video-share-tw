# Security and privacy

| Threat | MVP countermeasure |
|---|---|
| Unauthorized video access | Same-origin authenticated app; authorize every record by internal user ID; configure Stream delivery restrictions before launch |
| Upload abuse / cost spike | Auth required, 200 MB and 60 second caps, Stream max-duration reservation, quick upload-disable switch |
| Forged completion | Video ownership check and exact provider-ID match; real adapter re-queries Stream status/duration |
| OAuth CSRF/replay | Production LINE work must validate state, nonce/ID token, issuer/audience/expiry and use secure HTTP-only sessions |
| LINE identifier leak | `line_subject` stays private and is never selected into public DTOs |
| Malicious file | MIME is only UX validation; Stream handles media processing; never execute or proxy bytes through Worker |
| Secret leak | Server-only environment values, `.env*` ignored, no secrets in frontend or D1 |
| Location profiling | Store surf spot only; no uploader GPS or inferred home/history model |

Production cookie target: HTTP-only, Secure, appropriate SameSite, short opaque session ID, rotation on login, server-side expiry/revocation. Development fake auth requires `APP_ENV=development` and `ENABLE_DEV_AUTH=true`; production fails closed.

Before public launch, define video deletion/retention, reporting/moderation, Stream signed-delivery policy, rate limits, and privacy notice. These are intentionally not fabricated as complete.
