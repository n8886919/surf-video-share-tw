import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/worker/api";
import type { AppEnv } from "../src/worker/db";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cost-bearing route limits", () => {
  it("allows a normal first-user upload through the configured limiter", async () => {
    const statements: string[] = [];
    const statement = {
      bind: () => statement,
      run: async () => ({ meta: { changes: 1 } }),
      first: async () => ({
        id: "user_dev_local",
        display_id: "wave-friend",
        show_identity_default: 1,
      }),
      all: async () => ({ results: [] }),
    };
    const db = {
      prepare: (sql: string) => {
        statements.push(sql);
        return statement;
      },
      batch: async () => [],
    } as unknown as D1Database;
    const limit = vi.fn().mockResolvedValue({ success: true });

    const response = await api.fetch(
      new Request("https://example.com/api/v1/videos/upload-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          durationSeconds: 20,
          sizeBytes: 1024,
          fileName: "first-user.mp4",
          contentType: "video/mp4",
        }),
      }),
      {
        APP_ENV: "development",
        ENABLE_DEV_AUTH: "true",
        DB: db,
        VIDEO_PROVIDER: "mock",
        UPLOAD_RATE_LIMITER: { limit } as unknown as RateLimit,
      } as AppEnv,
    );

    expect(response.status).toBe(201);
    expect(limit).toHaveBeenCalledWith({ key: "user_dev_local" });
    expect(statements.some((sql) => sql.includes("INSERT INTO videos"))).toBe(true);
  });

  it("rejects an upload-ticket burst before Stream or a video insert", async () => {
    const statements: string[] = [];
    const statement = {
      bind: () => statement,
      run: async () => ({ meta: { changes: 1 } }),
      first: async () => ({
        id: "user_dev_local",
        display_id: "wave-friend",
        show_identity_default: 1,
      }),
      all: async () => ({ results: [] }),
    };
    const db = {
      prepare: (sql: string) => {
        statements.push(sql);
        return statement;
      },
      batch: async () => [],
    } as unknown as D1Database;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const limit = vi.fn().mockResolvedValue({ success: false });

    const response = await api.fetch(
      new Request("https://example.com/api/v1/videos/upload-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          durationSeconds: 20,
          sizeBytes: 1024,
          fileName: "first-user.mp4",
          contentType: "video/mp4",
        }),
      }),
      {
        APP_ENV: "development",
        ENABLE_DEV_AUTH: "true",
        DB: db,
        VIDEO_PROVIDER: "cloudflare-stream",
        CLOUDFLARE_ACCOUNT_ID: "account",
        CLOUDFLARE_STREAM_API_TOKEN: "token",
        UPLOAD_RATE_LIMITER: { limit } as unknown as RateLimit,
      } as AppEnv,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(limit).toHaveBeenCalledWith({ key: "user_dev_local" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(statements.some((sql) => sql.includes("INSERT INTO videos"))).toBe(false);
  });

  it("fails closed when a production upload limiter binding is absent", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const limitableUser = {
      id: "user_line",
      display_id: "first-user",
      show_identity_default: 1,
    };
    const statement = {
      bind: () => statement,
      first: async () => limitableUser,
      run: async () => ({ meta: { changes: 1 } }),
    };
    const db = { prepare: () => statement } as unknown as D1Database;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await api.fetch(
      new Request("https://example.com/api/v1/videos/upload-request", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "__Host-surf_session=test-session",
        },
        body: JSON.stringify({
          durationSeconds: 20,
          sizeBytes: 1024,
          fileName: "first-user.mp4",
          contentType: "video/mp4",
        }),
      }),
      {
        APP_ENV: "production",
        DB: db,
        LINE_CHANNEL_ID: "channel",
        LINE_CHANNEL_SECRET: "channel-secret",
        LINE_CALLBACK_URL: "https://example.com/api/v1/auth/line/callback",
        SESSION_SECRET: "session-secret",
      } as AppEnv,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: "RATE_LIMIT_UNAVAILABLE" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith("Required rate-limit binding is missing");
  });
});
