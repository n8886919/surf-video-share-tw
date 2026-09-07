import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { vi } from "vitest";
import { beginLineLogin } from "../../src/worker/auth";
import type { AppEnv } from "../../src/worker/db";

export const origin = "https://example.com";
export function lineLoginFixture() {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = new URL("../../drizzle/", import.meta.url);
  for (const file of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  function prepare(sql: string) {
    let values: SQLInputValue[] = [];
    const statement = {
      bind(...bindings: SQLInputValue[]) { values = bindings; return statement; },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async all() { return statement.execute(); },
      async run() { return { meta: sqlite.prepare(sql).run(...values), success: true }; },
      execute() { return { results: sqlite.prepare(sql).all(...values), success: true }; },
    };
    return statement;
  }
  const db = { prepare, async batch(statements: Array<ReturnType<typeof prepare>>) {
    // Model documented D1 batch atomicity, including rollback and RETURNING/SELECT results.
    sqlite.exec("BEGIN");
    try { const results = statements.map(s => s.execute()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } } as unknown as D1Database;
  const env = {
    APP_ENV: "production", DB: db,
    LINE_CHANNEL_ID: "fixture-channel", LINE_CHANNEL_SECRET: "fixture-channel-secret",
    LINE_CALLBACK_URL: `${origin}/api/v1/auth/line/callback`, SESSION_SECRET: "fixture-session-secret",
    PLAYBACK_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
  } as unknown as AppEnv;
  return { sqlite, env, async start(previousCookie = "") {
    const response = await beginLineLogin(env, { request: new Request(`${origin}/api/v1/auth/line`, { headers: { cookie: previousCookie } }) });
    const url = new URL(response.headers.get("location")!);
    return { response, url, cookie: response.headers.get("set-cookie")!.split(";")[0],
      state: url.searchParams.get("state")!, nonce: url.searchParams.get("nonce")! };
  } };
}

export function callbackRequest(state: string, code = "fixture-code", cookie = "") {
  return new Request(`${origin}/api/v1/auth/line/callback?state=${state}&code=${code}`, { headers: { cookie } });
}

export function claimRequest(cookie: string, extra: Record<string, string> = {}) {
  return new Request(`${origin}/api/v1/auth/line/complete`, { method: "POST", headers: {
    cookie, origin, "content-type": "application/json", "sec-fetch-site": "same-origin",
    "cf-connecting-ip": "203.0.113.9", ...extra,
  } });
}

export function verified(nonce: string, subject = "U-fixture-only-private") {
  return { iss: "https://access.line.me", sub: subject, name: "Fixture private name",
    aud: "fixture-channel", exp: Math.floor(Date.now() / 1000) + 300, nonce };
}

export function mockLine(nonce: string) {
  return vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ id_token: "fixture-token" }))
    .mockResolvedValueOnce(Response.json(verified(nonce)));
}
