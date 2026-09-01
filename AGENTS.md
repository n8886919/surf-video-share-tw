# AGENTS.md

## Product goal

Build a Taiwan surf-condition service that answers: under a selected spot and forecast time, what did the waves actually look like in comparable historical conditions? Public real-world videos—not another generic forecast dashboard or personal cloud drive—are the core value.

The non-negotiable philosophy is in `docs/PROJECT_PRINCIPLES.md`. The canonical five-second copy is `PROJECT_PURPOSE` in `packages/domain/src/project-purpose.ts`; README and the rendered app must contain that exact value, enforced by tests.

## Hard MVP constraints

- Taiwan, at most 100 initial users, infrastructure at most NT$1,000/month.
- Uploads are 10–60 seconds, at most 200 MB, and captured no more than 168 hours ago. Future capture times are invalid.
- LINE Login is the production identity. Never expose raw LINE subjects.
- Complete videos are public. Uploader identity is optional and uses only `display_id`; incomplete uploads are private and expire after seven days.
- Active MVP spots are 烏石港、雙獅、無尾、蜜月灣、金樽、北東河、漁光島、南灣、中角灣、福隆、環保、北濱、磯崎、九棚、佳樂水、松柏港、翡翠灣、萬里 only.
- Users enter only spot and capture time; condition numbers always come from providers.
- No points, ads, product payments, subscriptions, arbitrary backfill, or public comment threads. Donations belong only in About/Support and never interrupt core flows.
- An uploader may add one optional 100-character public supplement and optionally mark whether they had fun that day. Neither affects matching; never add more subjective fields or comment threads.

## Architecture rules

- One Cloudflare modular monolith; React and Hono are separated at `/api/v1`.
- Browser never reads D1 or provider secrets. Video bytes go directly to Cloudflare Stream.
- D1 stores normalized searchable metrics and provider provenance. Never overwrite historical snapshots when providers change.
- External video, marine, and tide systems stay behind provider interfaces.
- Backend owns authorization and all business rules, including the 168-hour validation and public/private lifecycle.
- Forecast runs are immutable, provider-specific snapshots. A future query uses the newest available `forecast` row near its target. A historical capture prefers a separately labelled `historical_forecast` row collected through the normal live forecast endpoint's bounded recent-past window, then falls back to the newest `forecast` row available at capture; never invoke an old Historical Forecast mode or fabricate backfill. Never average CWA, MFWAM, ECMWF WAM, GFS Wave, GWAM, or other models into one feature row.
- Matching currently uses only CWA `cwa-wave-f-a0020-001` and Open-Meteo `meteofrance_wave`; ECMWF WAM, GFS Wave 0.16°, and DWD GWAM are collect-only and must still remain independently stored and visible in the owner video view.
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
| Philosophy and project boundaries | `docs/PROJECT_PRINCIPLES.md` |
| Product scope and UX | `docs/PRODUCT.md` |
| Current handoff | `docs/PROJECT_STATE.md` |
| System boundaries | `docs/ARCHITECTURE.md` and `docs/adr/` |
| Schema and indexes | `db/schema.ts`, then `drizzle/` |
| API validation | `packages/api-contract/src/index.ts` |
| API behavior | `src/worker/api.ts` |
| Time/date policy | `packages/domain/src/time-policy.ts` |
| Matching behavior | `packages/domain/src/matching.ts`; detailed synchronized specification in `docs/MATCHING.md` |
| Spot checklist | `data/spots.csv` |
| Providers and provenance | `src/worker/providers/`, `docs/DATA_SOURCES.md` |
| Secrets/deployment/cost | `docs/OPERATIONS.md`, `.env.example` |

Before a task, read this file, `docs/PROJECT_PRINCIPLES.md`, `docs/PROJECT_STATE.md`, and only the relevant deeper document. Never guess external API behavior; verify current official documentation.

## Session checkpoints

- During pre-user validation, an ordinary isolated change defaults to targeted tests plus `pnpm typecheck`. Run `pnpm verify` for a release candidate and for cross-cutting API, schema, authentication, security, provider, operations, or deployment changes.
- Update `docs/PROJECT_STATE.md` after a milestone, release, material operational result, or handoff—not after every small UI or implementation change. Keep one exact next task.
- Until the first-user validation gates in `docs/ROADMAP.md` are met, do not add providers, models, analytics, sharing mechanics, or operations automation unless observed user behavior or a blocker in the find/watch/upload path requires it.
- Recommend opening a new session when the next task changes domain or the current session has accumulated broad context.
- Do not recommend a new session while tests fail, required documentation is stale, or work is half-complete.
- A new session follows `PROJECT_STATE.md`'s `Next task` unless the user overrides it.
- Keep handoff facts in `PROJECT_STATE.md`; use Git status, log, and diff as the authority for current files and uncommitted work.
