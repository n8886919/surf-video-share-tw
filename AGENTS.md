# AGENTS.md

## Product goal

Build a Taiwan surf-condition service that attaches real uploaded videos to the conditions at capture time, then later finds same-spot historical videos similar to a forecast. Real-world videos—not another generic forecast dashboard—are the core value.

## Hard MVP constraints

- Taiwan, at most 100 initial users, infrastructure at most NT$1,000/month.
- Uploads are 5–60 seconds, at most 200 MB, and captured today in `Asia/Taipei`.
- LINE Login is the production identity. Never expose raw LINE subjects.
- Content requires authentication. Uploader identity is optional and uses only `display_id`.
- No points, ads, payments, subscriptions, arbitrary backfill, or forecast-matching UI before upload is stable.

## Architecture rules

- One Cloudflare modular monolith; React and Hono are separated at `/api/v1`.
- Browser never reads D1 or provider secrets. Video bytes go directly to Cloudflare Stream.
- D1 stores normalized searchable metrics and provider provenance. Never overwrite historical snapshots when providers change.
- External video, marine, and tide systems stay behind provider interfaces.
- Backend owns authorization and all business rules, including today-only validation.
- No SwellEye crawler or copied descriptions/media/forecasts. Spot names are only a checklist.
- Never invent spot coordinates, translations, provider behavior, or licensing. Verify official docs and leave fields blank/TODO.

## Coding conventions

- Strict TypeScript; no unexplained `any`.
- Domain code must not import Hono, React, D1, or provider SDKs.
- Validate trust boundaries with shared Zod schemas.
- Store timestamps as UTC ISO strings; product date rules use `Asia/Taipei` explicitly.
- Prefer the smallest correct change. Avoid enterprise patterns and do not rewrite working modules unnecessarily.
- Update docs when API, schema, architecture, source, security, or operations behavior changes.

## Commands

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm db:generate
pnpm db:migrate:local
```

Production deployment uses the reviewed Wrangler configuration. Cloudflare Stream, LINE, and condition-provider secrets must be configured in the Cloudflare runtime, never committed.

## Authoritative files

| Topic | Authority |
|---|---|
| Product scope and UX | `docs/PRODUCT.md` |
| Current handoff | `docs/PROJECT_STATE.md` |
| System boundaries | `docs/ARCHITECTURE.md` and `docs/adr/` |
| Schema and indexes | `db/schema.ts`, then `drizzle/` |
| API validation | `packages/api-contract/src/index.ts` |
| API behavior | `src/worker/api.ts` |
| Time/date policy | `packages/domain/src/time-policy.ts` |
| Matching behavior | `packages/domain/src/matching.ts` |
| Spot checklist | `data/spots.csv` |
| Providers and provenance | `src/worker/providers/`, `docs/DATA_SOURCES.md` |
| Secrets/deployment/cost | `docs/OPERATIONS.md`, `.env.example` |

Before a task, read this file, `docs/PROJECT_STATE.md`, and only the relevant deeper document. Never guess external API behavior; verify current official documentation.
