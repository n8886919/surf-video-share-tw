import { afterEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => vi.restoreAllMocks());

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
    expect(location.searchParams.has("disable_auto_login")).toBe(false);
    expect(writes).toHaveLength(2);
    expect(writes[1]?.sql).toContain("INSERT INTO oauth_attempts");
  });

  it("can disable auto login for an iPhone-safe retry", async () => {
    const statement = { bind: () => statement, run: async () => ({ success: true }) };
    const db = { prepare: () => statement } as unknown as D1Database;

    const response = await beginLineLogin(configuredEnv(db), { disableAutoLogin: true });
    const location = new URL(response.headers.get("location")!);

    expect(location.searchParams.get("disable_auto_login")).toBe("true");
    expect(location.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
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

  it("stores the verified LINE display name as a private suggestion", async () => {
    const writes: Array<{ sql: string; values: unknown[] }> = [];
    let userReads = 0;
    const db = {
      prepare(sql: string) {
        let values: unknown[] = [];
        const statement = {
          bind(...nextValues: unknown[]) {
            values = nextValues;
            return statement;
          },
          async first() {
            if (sql.includes("DELETE FROM oauth_attempts")) {
              return {
                nonce: "expected-nonce",
                code_verifier: "expected-verifier",
                expires_at: new Date(Date.now() + 60_000).toISOString(),
              };
            }
            if (sql.includes("FROM users WHERE line_subject")) {
              userReads += 1;
              if (userReads === 1) return null;
              return {
                id: "internal-user-id",
                line_display_name: "浪人小明 🏄",
                display_id: null,
                show_identity_default: 0,
              };
            }
            return null;
          },
          async run() {
            writes.push({ sql, values });
            return { success: true };
          },
        };
        return statement;
      },
    } as unknown as D1Database;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ id_token: "verified-token" }))
      .mockResolvedValueOnce(Response.json({
        iss: "https://access.line.me",
        sub: "U-private-subject",
        name: "浪人小明 🏄",
        aud: "2011238358",
        exp: Math.floor(Date.now() / 1000) + 300,
        nonce: "expected-nonce",
      }));

    const response = await finishLineLogin(
      new Request("https://example.com/api/v1/auth/line/callback?state=valid-state&code=valid-code"),
      configuredEnv(db),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    const userWrite = writes.find(({ sql }) => sql.includes("INSERT INTO users"));
    expect(userWrite?.values.slice(1, 3)).toEqual(["U-private-subject", "浪人小明 🏄"]);
    expect(userWrite?.values.at(-1)).toBe(100);
    expect(userWrite?.sql).toContain("(SELECT COUNT(*) FROM users) < ?");
    expect(userWrite?.sql).not.toContain("display_id = excluded");
    const existingUserUpdate = writes.find(({ sql }) => sql.includes("UPDATE users"));
    expect(existingUserUpdate?.values).toEqual([
      "浪人小明 🏄",
      expect.any(String),
      "U-private-subject",
    ]);
  });

  it("keeps an existing LINE user eligible when registration is full", async () => {
    const writes: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        let values: unknown[] = [];
        const statement = {
          bind(...nextValues: unknown[]) {
            values = nextValues;
            return statement;
          },
          async first() {
            if (sql.includes("DELETE FROM oauth_attempts")) {
              return {
                nonce: "expected-nonce",
                code_verifier: "expected-verifier",
                expires_at: new Date(Date.now() + 60_000).toISOString(),
              };
            }
            if (sql.includes("FROM users WHERE line_subject")) {
              return {
                id: "existing-user-id",
                line_display_name: "既有浪人",
                display_id: null,
                show_identity_default: 0,
              };
            }
            return null;
          },
          async run() {
            writes.push({ sql, values });
            return { success: true };
          },
        };
        return statement;
      },
    } as unknown as D1Database;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ id_token: "verified-token" }))
      .mockResolvedValueOnce(Response.json({
        iss: "https://access.line.me",
        sub: "U-existing-subject",
        name: "既有浪人",
        aud: "2011238358",
        exp: Math.floor(Date.now() / 1000) + 300,
        nonce: "expected-nonce",
      }));

    const response = await finishLineLogin(
      new Request("https://example.com/api/v1/auth/line/callback?state=valid-state&code=valid-code"),
      configuredEnv(db),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(writes.some(({ sql }) => sql.includes("INSERT INTO users"))).toBe(false);
    expect(writes.some(({ sql }) => sql.includes("INSERT INTO auth_sessions"))).toBe(true);
  });

  it("rejects a new LINE user when all 100 registration slots are occupied", async () => {
    const writes: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        let values: unknown[] = [];
        const statement = {
          bind(...nextValues: unknown[]) {
            values = nextValues;
            return statement;
          },
          async first() {
            if (sql.includes("DELETE FROM oauth_attempts")) {
              return {
                nonce: "expected-nonce",
                code_verifier: "expected-verifier",
                expires_at: new Date(Date.now() + 60_000).toISOString(),
              };
            }
            return null;
          },
          async run() {
            writes.push({ sql, values });
            return { success: true };
          },
        };
        return statement;
      },
    } as unknown as D1Database;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ id_token: "verified-token" }))
      .mockResolvedValueOnce(Response.json({
        iss: "https://access.line.me",
        sub: "U-new-subject-at-capacity",
        name: "晚來的浪人",
        aud: "2011238358",
        exp: Math.floor(Date.now() / 1000) + 300,
        nonce: "expected-nonce",
      }));

    const response = await finishLineLogin(
      new Request("https://example.com/api/v1/auth/line/callback?state=valid-state&code=valid-code"),
      configuredEnv(db),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/?login=capacity");
    const attemptedInsert = writes.find(({ sql }) => sql.includes("INSERT INTO users"));
    expect(attemptedInsert?.values.at(-1)).toBe(100);
    expect(writes.some(({ sql }) => sql.includes("INSERT INTO auth_sessions"))).toBe(false);
  });
});
