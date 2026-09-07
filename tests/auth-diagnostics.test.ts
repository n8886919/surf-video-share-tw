import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/worker/api";
import { beginLineLogin, completeLineLogin, finishLineLogin } from "../src/worker/auth";
import { withAuthDiagnostic } from "../src/worker/auth-diagnostics";
import type { AppEnv } from "../src/worker/db";
import { runHourlyOpsAnalysis } from "../src/worker/ops-observability";

const origin = "https://example.com";
const now = "2026-09-07T09:09:00.000Z";
const callback = `${origin}/api/v1/auth/line/callback`;
const privateCode = "private-authorization-code";
const privateToken = "private-id-token";
const privateSubject = "U-private-line-subject";
const headers = {
  "user-agent": "Mozilla/5.0 (Linux; Android 15) Chrome/140.0.0.0 private-ua-sentinel",
  "cf-connecting-ip": "203.0.113.42",
};

interface DiagnosticRow {
  id: string;
  trace_id: string;
  kind: string;
  details_json: string;
  occurred_at: string;
}

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = new URL("../drizzle/", import.meta.url);
  for (const file of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  function prepare(sql: string) {
    let values: SQLInputValue[] = [];
    const statement = {
      bind(...bindings: SQLInputValue[]) { values = bindings; return statement; },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...values), success: true }; },
      async run() { return { meta: sqlite.prepare(sql).run(...values), success: true }; },
      execute() { return { results: sqlite.prepare(sql).all(...values), success: true }; },
    };
    return statement;
  }
  const db = {
    prepare,
    async batch(statements: Array<ReturnType<typeof prepare>>) {
      sqlite.exec("BEGIN");
      try { const results = statements.map(s => s.execute()); sqlite.exec("COMMIT"); return results; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  } as unknown as D1Database;
  const limit = vi.fn().mockResolvedValue({ success: true });
  const env = {
    APP_ENV: "production", DB: db,
    LINE_CHANNEL_ID: "fixture-channel", LINE_CHANNEL_SECRET: "private-channel-secret",
    LINE_CALLBACK_URL: callback, SESSION_SECRET: "private-session-secret",
    AUTH_DIAGNOSTICS_UNTIL: "2026-09-14T00:00:00.000Z",
    PUBLIC_WRITE_RATE_LIMITER: { limit },
    PLAYBACK_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
  } as unknown as AppEnv;
  return {
    sqlite, env, limit,
    rows: () => sqlite.prepare("SELECT * FROM auth_diagnostic_events ORDER BY rowid").all() as unknown as DiagnosticRow[],
  };
}

async function start(env: AppEnv, ua = headers["user-agent"]) {
  const response = await beginLineLogin(env, { request: new Request(`${origin}/api/v1/auth/line`, {
    headers: { ...headers, "user-agent": ua },
  }) });
  const url = new URL(response.headers.get("location")!);
  return { response, url, cookie: response.headers.get("set-cookie")!.split(";")[0], state: url.searchParams.get("state")!, nonce: url.searchParams.get("nonce")! };
}

function claimRequest(cookie: string, ua = headers["user-agent"]) {
  return new Request(`${origin}/api/v1/auth/line/complete`, { method: "POST", headers: {
    ...headers, "user-agent": ua, origin, cookie, "content-type": "application/json", "sec-fetch-site": "same-origin",
  } });
}

function completeRequest(state: string, ua = headers["user-agent"], params = `code=${privateCode}`) {
  return new Request(`${callback}?state=${encodeURIComponent(state)}&${params}`, {
    headers: { ...headers, "user-agent": ua },
  });
}

function verified(nonce: string) {
  return { iss: "https://access.line.me", sub: privateSubject, name: "private-line-name",
    aud: "fixture-channel", exp: Date.parse(now) / 1000 + 300, nonce };
}

function mockLine(nonce: string) {
  return vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ id_token: privateToken }))
    .mockResolvedValueOnce(Response.json(verified(nonce)));
}

describe("temporary LINE diagnostics with the migrated schema", () => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(now));
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    f = fixture();
  });
  afterEach(() => { f.sqlite.close(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it.each([
    [headers["user-agent"], "android", "chrome", "standalone"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1", "ios", "safari", "browser"],
    ["Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0 Safari/537.36", "windows", "chrome", "browser"],
  ])("retains secure success, /me and one-use rejection for %s", async (ua, os, browser, displayMode) => {
    const attempt = await start(f.env, ua);
    const line = mockLine(attempt.nonce);
    expect(attempt.url.searchParams.has("auth_trace")).toBe(false);
    expect(attempt.url.searchParams.has("disable_auto_login")).toBe(false);
    expect(attempt.url.searchParams.get("code_challenge_method")).toBe("S256");
    const response = await finishLineLogin(completeRequest(attempt.state, ua), f.env);
    const trace = response.headers.get("x-surf-auth-trace")!;
    expect(trace).toMatch(/^[a-f0-9]{32}$/);
    expect(trace).toBe(attempt.response.headers.get("x-surf-auth-trace"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/?login=completing&auth_trace=${trace}`);
    expect(response.headers.has("set-cookie")).toBe(false);
    const claimed = await completeLineLogin(claimRequest(attempt.cookie, ua), f.env);
    const setCookie = claimed.headers.getSetCookie().find(value => value.startsWith("__Host-surf_session="))!;
    expect(setCookie).toMatch(/^__Host-surf_session=[A-Za-z0-9_-]+; Path=\/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax$/);
    const cookie = setCookie.split(";")[0];
    for (const [sentCookie, status] of [[cookie, 200], ["", 401], ["__Host-surf_session=forged", 401]] as const) {
      const me = await api.fetch(new Request(`${origin}/api/v1/me`, { headers: {
        ...headers, "user-agent": ua, cookie: sentCookie, "x-surf-auth-trace": trace, "x-surf-display-mode": displayMode,
      } }), f.env);
      expect(me.status).toBe(status);
    }
    const replay = await finishLineLogin(completeRequest(attempt.state, ua), f.env);
    expect(replay.status).toBe(303);
    expect(replay.headers.get("location")).toBe(`/?login=completing&auth_trace=${trace}`);
    expect(replay.headers.has("set-cookie")).toBe(false);
    expect(line).toHaveBeenCalledTimes(2);
    const rows = f.rows();
    expect(rows).toHaveLength(7);
    expect(new Set(rows.map(row => row.trace_id))).toEqual(new Set([trace]));
    expect(new Set(rows.map(row => row.id)).size).toBe(7);
    expect(JSON.parse(rows[1].details_json)).toMatchObject({ sessionCookieSet: false });
    expect(JSON.parse(rows[2].details_json)).toMatchObject({ os, browser, sessionCookieSet: true,
      steps: expect.arrayContaining([{ stage: "session", outcome: "delivered" }]) });
    expect(JSON.parse(rows[3].details_json)).toMatchObject({ os, browser, displayMode, sessionCookiePresent: true,
      traceSource: "untrusted_client", steps: expect.arrayContaining([{ stage: "session", outcome: "authenticated", httpStatus: 200 }]) });
    expect(JSON.parse(rows[4].details_json)).toMatchObject({ sessionCookiePresent: false,
      steps: expect.arrayContaining([{ stage: "session", outcome: "unauthenticated", httpStatus: 401 }]) });
    expect(JSON.parse(rows[6].details_json).steps.at(-1)).toEqual({ stage: "attempt", outcome: "completed" });

    const serialized = JSON.stringify([rows, vi.mocked(console.info).mock.calls]);
    const session = f.sqlite.prepare("SELECT id_hash FROM auth_sessions").get()!;
    for (const secret of [attempt.state, attempt.nonce, attempt.cookie.split("=")[1], privateCode, privateToken, privateSubject,
      "private-line-name", f.env.LINE_CHANNEL_SECRET!, f.env.SESSION_SECRET!, cookie.split("=")[1],
      String(session.id_hash), ua, headers["cf-connecting-ip"], callback]) expect(serialized).not.toContain(secret);
    expect(f.limit.mock.calls.every(([input]) => /^auth-diagnostic:(begin|callback|completion|me):[a-f0-9]{32}$/.test(input.key))).toBe(true);
  });

  it.each([undefined, "", "invalid-date", now])("does not instrument when deadline is %s", async until => {
    f.env.AUTH_DIAGNOSTICS_UNTIL = until;
    const attempt = await start(f.env);
    mockLine(attempt.nonce);
    const response = await finishLineLogin(completeRequest(attempt.state), f.env);
    expect(response.headers.get("location")).toBe("/?login=completing");
    expect(response.headers.has("x-surf-auth-trace")).toBe(false);
    expect(f.rows()).toEqual([]);
    expect(console.info).not.toHaveBeenCalled();
    expect(f.limit).not.toHaveBeenCalled();
  });

  it.each(["deny", "limiter-error", "missing-limiter", "storage-error"])("does not gate auth on %s", async failure => {
    if (failure === "deny") f.limit.mockResolvedValue({ success: false });
    if (failure === "limiter-error") f.limit.mockRejectedValue(new Error(privateToken));
    if (failure === "missing-limiter") f.env.PUBLIC_WRITE_RATE_LIMITER = undefined;
    if (failure === "storage-error") f.sqlite.exec("DROP TABLE auth_diagnostic_events");
    const attempt = await start(f.env);
    mockLine(attempt.nonce);
    const response = await finishLineLogin(completeRequest(attempt.state), f.env);
    expect(response.status).toBe(303);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(response.headers.get("location")).toContain("login=completing");
    const claimed = await completeLineLogin(claimRequest(attempt.cookie), f.env);
    expect(claimed.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect(console.info).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(privateToken);
  });

  it.each([
    ["token-http", "token", "http_error"], ["token-schema", "token", "invalid_response"],
    ["verify-http", "verify", "http_error"], ["verify-schema", "verify", "invalid_response"],
    ["nonce", "verify", "claims_rejected"], ["audience", "verify", "claims_rejected"],
    ["expired-token", "verify", "claims_rejected"],
  ])("records %s without accepting an invalid token", async (failure, stage, outcome) => {
    const attempt = await start(f.env);
    const claims = verified(attempt.nonce);
    if (failure === "nonce") claims.nonce = "wrong-nonce";
    if (failure === "audience") claims.aud = "wrong-audience";
    if (failure === "expired-token") claims.exp = Date.parse(now) / 1000;
    const line = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(failure === "token-http" ? new Response(privateToken, { status: 400 })
        : Response.json(failure === "token-schema" ? {} : { id_token: privateToken }))
      .mockResolvedValueOnce(failure === "verify-http" ? new Response(privateSubject, { status: 400 })
        : Response.json(failure === "verify-schema" ? {} : claims));
    const response = await finishLineLogin(completeRequest(attempt.state), f.env);
    expect(response.headers.get("location")).toContain("login=failed&auth_trace=");
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(JSON.parse(f.rows().at(-1)!.details_json).steps.at(-1)).toMatchObject({ stage, outcome });
    expect(line).toHaveBeenCalledTimes(stage === "token" ? 1 : 2);
    expect(f.sqlite.prepare("SELECT COUNT(*) AS count FROM auth_sessions").get()?.count).toBe(0);
  });

  it.each(["missing-state", "unknown-state", "expired-attempt", "cancelled", "missing-code"])("distinguishes %s", async failure => {
    const attempt = await start(f.env);
    const line = vi.spyOn(globalThis, "fetch");
    if (failure === "expired-attempt") f.sqlite.prepare("UPDATE oauth_attempts SET expires_at = ?").run(now);
    const request = failure === "missing-state" ? new Request(callback)
      : completeRequest(failure === "unknown-state" ? "unknown-state" : attempt.state, undefined,
        failure === "cancelled" ? `error=${privateToken}` : failure === "missing-code" ? "" : `code=${privateCode}`);
    await finishLineLogin(request, f.env);
    const expected = { "missing-state": "missing_state", "unknown-state": "missing_or_consumed",
      "expired-attempt": "expired", cancelled: "cancelled", "missing-code": "missing_code" }[failure];
    expect(JSON.parse(f.rows().at(-1)!.details_json).steps.at(-1).outcome).toBe(expected);
    expect(line).not.toHaveBeenCalled();
  });

  it("keeps manual retry parameters and distinct business rate-limit keys", async () => {
    const response = await api.fetch(new Request(`${origin}/api/v1/auth/line?manual=1`, { headers }), f.env);
    expect(response.status).toBe(302);
    expect(new URL(response.headers.get("location")!).searchParams.get("disable_auto_login")).toBe("true");
    expect(JSON.parse(f.rows()[0].details_json).manual).toBe(true);
    expect(f.limit.mock.calls[0][0].key).toMatch(/^line-login:[a-f0-9]{64}$/);
    expect(f.limit.mock.calls[1][0].key).toMatch(/^auth-diagnostic:begin:/);
  });

  it("validates correlation headers and never uses them to authenticate", async () => {
    const response = await api.fetch(new Request(`${origin}/api/v1/me`, { headers: {
      ...headers, "x-surf-auth-trace": privateToken, "x-surf-display-mode": privateSubject,
    } }), f.env);
    expect(response.status).toBe(401);
    const row = f.rows()[0];
    expect(row.trace_id).toMatch(/^[a-f0-9]{32}$/);
    expect(JSON.parse(row.details_json)).toMatchObject({ displayMode: "unknown", traceSource: "server" });
    expect(JSON.stringify(row)).not.toContain(privateToken);
    expect(JSON.stringify(row)).not.toContain(privateSubject);
    f.env.LINE_CHANNEL_ID = undefined;
    expect((await api.fetch(new Request(`${origin}/api/v1/me`), f.env)).status).toBe(503);
    expect(JSON.parse(f.rows().at(-1)!.details_json).steps.at(-1)).toEqual({ stage: "session", outcome: "unconfigured", httpStatus: 503 });
  });

  it("sanitizes both diagnostic and existing API logs on an upstream exception", async () => {
    const attempt = await start(f.env);
    const privateException = `${privateToken} ${privateCode} ${privateSubject} ${attempt.state}`;
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(Object.assign(new Error(privateException), { name: privateException }));
    const response = await api.fetch(completeRequest(attempt.state), f.env);
    expect(response.status).toBe(500);
    const json = await response.json() as { requestId: string };
    expect(json.requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(JSON.parse(f.rows().at(-1)!.details_json).steps.at(-1)).toEqual({ stage: "token", outcome: "exception" });
    const captured = JSON.stringify([f.rows(), f.sqlite.prepare("SELECT * FROM ops_events").all(),
      vi.mocked(console.info).mock.calls, vi.mocked(console.error).mock.calls]);
    for (const secret of [privateToken, privateCode, privateSubject, attempt.state]) expect(captured).not.toContain(secret);
  });

  it("uses waitUntil and tolerates immutable response headers", async () => {
    const pending: Promise<unknown>[] = [];
    const response = Response.redirect(origin, 303);
    const result = await withAuthDiagnostic(f.env, new Request(callback), "callback", async () => response,
      promise => { pending.push(promise); });
    expect(result).toBe(response);
    expect(result.headers.get("location")).toBe(`${origin}/`);
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect(f.rows()).toHaveLength(1);
  });

  it("cleans at most 500 diagnostic records older than seven days after the flag expires", async () => {
    f.env.AUTH_DIAGNOSTICS_UNTIL = now;
    const insert = f.sqlite.prepare("INSERT INTO auth_diagnostic_events VALUES (?, ?, 'me', '{}', ?)");
    for (let i = 0; i < 501; i++) insert.run(`old-${i}`, "a".repeat(32), "2026-08-30T00:00:00.000Z");
    insert.run("boundary", "a".repeat(32), "2026-08-31T09:09:00.000Z");
    insert.run("recent", "a".repeat(32), now);
    await runHourlyOpsAnalysis(f.env, new Date(now), vi.fn());
    expect(f.rows()).toHaveLength(3);
    expect(f.rows().some(row => row.id === "boundary")).toBe(true);
    expect(f.rows().some(row => row.id === "recent")).toBe(true);
  });
});
