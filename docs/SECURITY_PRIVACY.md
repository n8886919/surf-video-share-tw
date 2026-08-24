# Security and privacy

| Threat | MVP countermeasure |
|---|---|
| Unauthorized video access | Same-origin authenticated app; authorize every record by internal user ID; configure Stream delivery restrictions before launch |
| Upload abuse / cost spike | Auth required, 200 MB and 60 second caps, Stream max-duration reservation, quick upload-disable switch |
| Forged completion | Video ownership check and exact provider-ID match; real adapter re-queries Stream status/duration |
| OAuth CSRF/replay | One-time HMACed state, nonce, PKCE S256, LINE ID-token verification, issuer/audience/expiry checks, and secure HTTP-only sessions |
| LINE identifier leak | `line_subject` stays private and is never selected into public DTOs |
| Malicious file | MIME is only UX validation; Stream handles media processing; never execute or proxy bytes through Worker |
| Secret leak | Server-only environment values, `.env*` ignored, no secrets in frontend or D1 |
| Location profiling | Store surf spot only; no uploader GPS or inferred home/history model |

The production cookie is HTTP-only, Secure, SameSite=Lax, and carries a random opaque session ID. D1 stores only its HMAC, supports server-side logout/revocation, and expires it after seven days. Development fake auth requires `APP_ENV=development` and `ENABLE_DEV_AUTH=true`; production fails closed.

Before public launch, define video deletion/retention, reporting/moderation, Stream signed-delivery policy, rate limits, and privacy notice. These are intentionally not fabricated as complete.
