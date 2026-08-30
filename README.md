# 彼日浪影

> 不預測浪好不好；只用社群共享的歷史實拍，呈現指定浪點與時間的預報可能長什麼樣。

完整理念與不可逾越的產品邊界見 [Project principles](docs/PROJECT_PRINCIPLES.md)。

## Architecture

One Cloudflare Worker contains a React mobile UI and a Hono `/api/v1` boundary. D1 stores users, spot metadata, video records, and normalized condition snapshots. Production videos use Cloudflare Stream direct creator uploads, so bytes do not pass through the Worker. Vinext compiles the app into a Cloudflare Workers artifact; it is not a persistent Next.js server.

## Prerequisites

- Node.js 22+
- pnpm 11+
- A Cloudflare account for D1/Workers/Stream when moving beyond mocks
- A LINE Login channel for production authentication
- A separately deployed Home Assistant CWA ingestor with its CWA key stored only in that App

## Local development

```bash
cp .dev.vars.example .dev.vars
pnpm install
pnpm db:migrate:local
pnpm dev
```

PowerShell equivalent for the first command: `Copy-Item .dev.vars.example .dev.vars`.
The git-ignored `.dev.vars` explicitly enables fake auth, mock video, and mock conditions. Do not put production secrets in it. Production never silently falls back to mocks.

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

`data/spots.csv` seeds development. 首波只啟用烏石港與雙獅；其他清單項目保持停用。

## Cloudflare and LINE setup

1. The production D1 database is configured in `wrangler.jsonc`; use a separate database and Wrangler environment for staging.
2. Create a Stream API token scoped to Stream writes/reads.
3. Create a LINE Login v2.1 web channel, register the exact callback URL, and configure the four `LINE_*`/session values listed in `.env.example`.

4. Production deploys to Cloudflare Worker `surf-video-share-tw` with D1 binding `DB`. `pnpm deploy` requires a separate write credential, applies pending remote migrations, publishes, then restores and reads back query-string redaction. Cloudflare Workers Builds must be configured in its Dashboard settings to use `pnpm deploy`; framework auto-detection may otherwise bypass this guard.
5. Configure the Worker secrets from `.env.example`, including the dedicated `FORECAST_INGESTION_SECRET`; never commit `.env.local`.

LINE Login remains fail-closed when production values are incomplete. Signed, origin-restricted Stream upload/thumbnail/playback and owner MP4 download have passed real mobile checks; the newer 24-hour share-link/quota flow still needs two-phone acceptance after an approved deployment. Cloudflare Cron retains ECMWF WAM and cleanup duties. The outbound-only Home Assistant App performs the CWA whole-ZIP compute and submits small HMAC-authenticated batches; it never receives a D1 token. See [Operations](docs/OPERATIONS.md) and [Data sources](docs/DATA_SOURCES.md).

## Documentation

- [Product](docs/PRODUCT.md)
- [Project principles](docs/PROJECT_PRINCIPLES.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Data model](docs/DATA_MODEL.md)
- [API](docs/API.md)
- [Security and privacy](docs/SECURITY_PRIVACY.md)
- [Roadmap](docs/ROADMAP.md)
- [Current project state](docs/PROJECT_STATE.md)
