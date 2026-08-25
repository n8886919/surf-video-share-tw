# API

Base path: `/api/v1`.

| Access | Method | Path | Purpose |
|---|---|---|---|
| Public | GET | `/health` | Readiness smoke check |
| Public | GET | `/spots` | Active launch spots |
| Public | GET | `/matches?spotId=&targetTime=` | Public forecast context and same-spot videos |
| Public | POST | `/videos/:id/reports` | Record a report against a currently public video |
| Public | GET | `/auth/line` | Start LINE Login |
| Public | GET | `/auth/line/callback` | Complete LINE Login |
| Signed in | GET/PATCH | `/me` | Profile/default identity |
| Signed in | GET | `/videos` | Own complete and pending videos |
| Signed in | POST | `/videos/upload-request` | Create upload; spot/time may be null |
| Signed in | POST | `/videos/:id/complete` | Verify media; conditions are best-effort |
| Signed in | PATCH | `/videos/:id` | Fill metadata, favorite, identity, public supplement, or fun reaction |
| Admin | GET | `/admin/reports` | List open reports |
| Admin | POST | `/admin/reports/:id/delist` | Delist the video and resolve its open reports |

`/matches` accepts only now through +72 hours. Only CC0-versioned, moderation-visible, public-ready rows appear; pending and delisted rows never leak. DTOs never include LINE subjects or internal owner IDs. Schemas live in `packages/api-contract/src/index.ts`.
