# 台灣浪況實錄

把「今天現場的浪」留下來，未來用同浪點、相似海況的歷史影片理解預報實際長什麼樣。Milestone 1 先完成極簡上傳與紀錄，不做預報比對 UI。

## Architecture

One Cloudflare deployment contains a React mobile UI and a Hono `/api/v1` boundary. D1 stores users, spot metadata, video records, and normalized condition snapshots. Production videos use Cloudflare Stream direct creator uploads, so bytes do not pass through the Worker. Vinext is the current Sites/Vite build adapter; it is not a persistent Next.js server.

## Prerequisites

- Node.js 22+
- pnpm 11+
- A Cloudflare account for D1/Workers/Stream when moving beyond mocks
- A LINE Login channel for production authentication

## Local development

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

The checked-in Vite development binding explicitly enables fake auth, mock video, and mock conditions. Production never silently falls back to mocks.

## Verify

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Database

`db/schema.ts` is authoritative and Drizzle outputs reviewed SQL into `drizzle/`.

```bash
pnpm db:generate
pnpm db:migrate:local
```

`data/spots.csv` seeds development. 烏石港 is the sole verified, active spot; other checklist entries remain inactive with blank coordinates/translations until independently verified.

## Cloudflare and LINE setup

1. Create a D1 database and replace the Wrangler placeholder ID, or use the Sites-managed `DB` binding.
2. Create a Stream API token scoped to Stream writes/reads.
3. Create a LINE Login v2.1 web channel and register the exact callback URL.
4. Configure secrets from `.env.example` in the runtime; never commit `.env.local`.
5. Apply migrations, build, and deploy manually after reviewing environment separation.

Real LINE Login and real marine/tide adapters are intentionally not presented as complete. See [Operations](docs/OPERATIONS.md) and [Data sources](docs/DATA_SOURCES.md).

## Documentation

- [Product](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Data model](docs/DATA_MODEL.md)
- [API](docs/API.md)
- [Security and privacy](docs/SECURITY_PRIVACY.md)
- [Roadmap](docs/ROADMAP.md)
- [Current project state](docs/PROJECT_STATE.md)
