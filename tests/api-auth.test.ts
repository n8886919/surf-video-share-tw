import { describe, expect, it } from "vitest";
import { api } from "../src/worker/api";
import type { AppEnv } from "../src/worker/db";

describe("API authorization boundary", () => {
  it("fails closed when production authentication is not configured", async () => {
    const response = await api.fetch(
      new Request("https://example.com/api/v1/me"),
      {
        APP_ENV: "production",
        DB: {} as D1Database,
        ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
      } as unknown as AppEnv,
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: "AUTH_NOT_CONFIGURED" });
  });

  it("requires a session when LINE authentication is configured", async () => {
    const response = await api.fetch(
      new Request("https://example.com/api/v1/me"),
      {
        APP_ENV: "production",
        LINE_CHANNEL_ID: "1234567890",
        LINE_CHANNEL_SECRET: "test-channel-secret",
        LINE_CALLBACK_URL: "https://example.com/api/v1/auth/line/callback",
        SESSION_SECRET: "test-session-secret",
        DB: {} as D1Database,
        ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
      } as unknown as AppEnv,
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "UNAUTHENTICATED" });
  });

  it("keeps the health endpoint public", async () => {
    const response = await api.fetch(
      new Request("https://example.com/api/v1/health"),
      {} as AppEnv,
    );
    expect(response.status).toBe(200);
  });

  it("keeps the launch spot list public", async () => {
    const response = await api.fetch(
      new Request("https://example.com/api/v1/spots"),
      {
        APP_ENV: "production",
        DB: {
          prepare: () => ({
            all: async () => ({
              results: [{ id: "spot_double-lions", slug: "double-lions", name_en: "Double Lions", name_zh: "雙獅", region: "Northeast", latitude: 24.8887597, longitude: 121.8495724 }],
            }),
          }),
        } as unknown as D1Database,
      } as AppEnv,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ spots: [{ name: "雙獅" }] });
  });

  it("rejects public match targets beyond 72 hours", async () => {
    const response = await api.fetch(
      new Request(`https://example.com/api/v1/matches?spotId=spot_double-lions&targetTime=${encodeURIComponent(new Date(Date.now() + 73 * 60 * 60_000).toISOString())}`),
      {
        APP_ENV: "production",
        DB: {
          prepare: () => ({
            bind: () => ({
              first: async () => ({ id: "spot_double-lions", slug: "double-lions", name_en: "Double Lions", name_zh: "雙獅", region: "Northeast", latitude: 24.8887597, longitude: 121.8495724 }),
            }),
          }),
        } as unknown as D1Database,
      } as AppEnv,
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: "TARGET_OUT_OF_RANGE" });
  });

  it("records a public report without automatically delisting the video", async () => {
    const statements: string[] = [];
    const response = await api.fetch(
      new Request("https://example.com/api/v1/videos/video_1/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "privacy" }),
      }),
      {
        APP_ENV: "production",
        DB: {
          prepare: (sql: string) => {
            statements.push(sql);
            return {
              bind: () => ({
                first: async () => sql.includes("SELECT id FROM videos") ? { id: "video_1" } : null,
                run: async () => ({ meta: { changes: 1 } }),
              }),
            };
          },
        } as unknown as D1Database,
      } as AppEnv,
    );
    expect(response.status).toBe(201);
    expect(statements.some((sql) => sql.includes("INSERT INTO video_reports"))).toBe(true);
    expect(statements.some((sql) => sql.includes("UPDATE videos"))).toBe(false);
  });

  it("allows the configured administrator to list reports", async () => {
    const user = { id: "user_dev_local", display_id: "wave-friend", show_identity_default: 1 };
    const db = {
      prepare: (sql: string) => {
        const statement = {
          bind: () => statement,
          first: async () => user,
          run: async () => ({ meta: { changes: 1 } }),
          all: async () => ({ results: sql.includes("FROM video_reports") ? [] : [user] }),
        };
        return statement;
      },
      batch: async () => [],
    } as unknown as D1Database;

    const response = await api.fetch(
      new Request("https://example.com/api/v1/admin/reports"),
      {
        APP_ENV: "development",
        ENABLE_DEV_AUTH: "true",
        ADMIN_USER_ID: user.id,
        DB: db,
      } as AppEnv,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ reports: [] });
  });
});
