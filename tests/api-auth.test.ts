import { describe, expect, it, vi } from "vitest";
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
    let spotsSql = "";
    const response = await api.fetch(
      new Request("https://example.com/api/v1/spots"),
      {
        APP_ENV: "production",
        DB: {
          prepare: (sql: string) => {
            spotsSql = sql;
            return ({
            all: async () => ({
              results: [
                { id: "spot_wushi-harbor-north", slug: "wushi-harbor-north", name_en: "Wushi Harbor North", name_zh: "烏石港", region: "Northeast", latitude: 24.8731036, longitude: 121.8411446 },
                { id: "spot_double-lions", slug: "double-lions", name_en: "Double Lions", name_zh: "雙獅", region: "Northeast", latitude: 24.8887597, longitude: 121.8495724 },
              ],
            }),
          });
          },
        } as unknown as D1Database,
      } as AppEnv,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ spots: [{ name: "烏石港" }, { name: "雙獅" }] });
    expect(spotsSql).toContain("CASE WHEN slug = 'wushi-harbor-north' THEN 0 ELSE 1 END");
  });

  it("rejects public match targets outside the Taipei day/hour selection policy", async () => {
    const response = await api.fetch(
      new Request(`https://example.com/api/v1/matches?spotId=spot_double-lions&targetTime=${encodeURIComponent(new Date(Date.now() + 8 * 24 * 60 * 60_000).toISOString())}`),
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

  it("rejects a future capture time even when the upload request metadata is modified", async () => {
    const user = { id: "user_dev_local", display_id: "wave-friend", show_identity_default: 1 };
    const statement = {
      bind: () => statement,
      first: async () => user,
      run: async () => ({ meta: { changes: 1 } }),
      all: async () => ({ results: [] }),
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await api.fetch(
      new Request("https://example.com/api/v1/videos/upload-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spotId: "spot_wushi-harbor-north",
          capturedAt: new Date(Date.now() + 60_000).toISOString(),
          durationSeconds: 20,
          sizeBytes: 1024,
          fileName: "future.mp4",
          contentType: "video/mp4",
        }),
      }),
      {
        APP_ENV: "development",
        ENABLE_DEV_AUTH: "true",
        DB: { prepare: () => statement, batch: async () => [] } as unknown as D1Database,
        VIDEO_PROVIDER: "mock",
      } as AppEnv,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ message: expect.stringContaining("不可晚於現在") });
    consoleError.mockRestore();
  });

  it("rejects a future capture time when a pending video's metadata request is modified", async () => {
    const user = { id: "user_dev_local", display_id: "wave-friend", show_identity_default: 1 };
    const createdAt = new Date().toISOString();
    const currentVideo = {
      id: "video_pending",
      spot_id: "spot_wushi-harbor-north",
      captured_at: null,
      status: "ready",
      show_uploader: 0,
      is_favorite: 0,
      uploader_note: null,
      fun_reaction: null,
      terms_version: "2026-08-24-cc0-v1",
      moderation_status: "visible",
      metadata_status: "pending",
      metadata_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      public_at: null,
      condition_snapshot_id: null,
      created_at: createdAt,
      updated_at: createdAt,
    };
    const db = {
      prepare: (sql: string) => {
        const statement = {
          bind: () => statement,
          first: async () => sql.includes("FROM videos WHERE id") ? currentVideo : user,
          run: async () => ({ meta: { changes: 1 } }),
          all: async () => ({ results: [] }),
        };
        return statement;
      },
      batch: async () => [],
    } as unknown as D1Database;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await api.fetch(
      new Request("https://example.com/api/v1/videos/video_pending", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ capturedAt: new Date(Date.now() + 60_000).toISOString() }),
      }),
      { APP_ENV: "development", ENABLE_DEV_AUTH: "true", DB: db } as AppEnv,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ message: expect.stringContaining("不可晚於現在") });
    consoleError.mockRestore();
  });

  it("records a public report without automatically delisting the video", async () => {
    const statements: string[] = [];
    const limit = vi.fn().mockResolvedValue({ success: true });
    const response = await api.fetch(
      new Request("https://example.com/api/v1/videos/video_1/reports", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.25",
        },
        body: JSON.stringify({ reason: "privacy" }),
      }),
      {
        APP_ENV: "production",
        SESSION_SECRET: "test-session-secret",
        PUBLIC_WRITE_RATE_LIMITER: { limit } as unknown as RateLimit,
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
      } as unknown as AppEnv,
    );
    expect(response.status).toBe(201);
    expect(limit.mock.calls[0]?.[0]?.key).toMatch(/^video-report:[a-f0-9]{64}$/);
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
