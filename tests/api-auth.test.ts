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
});
