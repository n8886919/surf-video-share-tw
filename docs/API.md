# API

Base path: `/api/v1`. All current product endpoints require authentication and use JSON except the browser-to-Stream upload.

| Method | Path | Purpose |
|---|---|---|
| GET | `/me` | Current public profile preferences |
| PATCH | `/me` | Update `display_id` and default visibility |
| GET | `/spots` | Active spot checklist |
| GET | `/videos` | Current user's latest observations |
| POST | `/videos/upload-request` | Validate policy and create one-time upload ticket |
| POST | `/videos/:id/complete` | Verify owned ticket and attach condition snapshot |
| GET | `/videos/:id` | Owned observation detail |
| PATCH | `/videos/:id` | Change that video's public identity visibility |

The Zod source of truth is `packages/api-contract/src/index.ts`; handler behavior is `src/worker/api.ts`. Error responses contain stable `error` and user-readable `message`. Do not manually duplicate every schema here.

Forecast and matches endpoints are deferred until real provider integration and upload stability.
