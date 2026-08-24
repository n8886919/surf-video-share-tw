import { describe, expect, it } from "vitest";
import { beginLineLogin, finishLineLogin } from "../src/worker/auth";
import type { AppEnv } from "../src/worker/db";

function configuredEnv(db: D1Database): AppEnv {
  return {
    APP_ENV: "production",
    LINE_CHANNEL_ID: "2011238358",
    LINE_CHANNEL_SECRET: "test-channel-secret",
    LINE_CALLBACK_URL: "https://example.com/api/v1/auth/line/callback",
    SESSION_SECRET: "test-session-secret",
    DB: db,
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
  } as unknown as AppEnv;
}

describe("LINE Login", () => {
  it("starts a v2.1 authorization request with state, nonce, and PKCE", async () => {
    const writes: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        let values: unknown[] = [];
        return {
          bind(...nextValues: unknown[]) {
            values = nextValues;
            return this;
          },
          async run() {
            writes.push({ sql, values });
            return { success: true };
          },
        };
      },
    } as unknown as D1Database;

    const response = await beginLineLogin(configuredEnv(db));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://access.line.me/oauth2/v2.1/authorize");
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("client_id")).toBe("2011238358");
    expect(location.searchParams.get("redirect_uri")).toBe("https://example.com/api/v1/auth/line/callback");
    expect(location.searchParams.get("scope")).toBe("openid profile");
    expect(location.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.searchParams.get("nonce")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(writes).toHaveLength(2);
    expect(writes[1]?.sql).toContain("INSERT INTO oauth_attempts");
  });

  it("fails closed before redirecting when secrets are missing", async () => {
    const response = await beginLineLogin({} as AppEnv);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: "AUTH_NOT_CONFIGURED" });
  });

  it("rejects a callback without state before touching the database", async () => {
    const response = await finishLineLogin(
      new Request("https://example.com/api/v1/auth/line/callback?code=unused"),
      configuredEnv({} as D1Database),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/?login=invalid");
  });
});
