import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:https";
import { httpsFixture } from "./helpers/https-fixture.mjs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { chromium } from "@playwright/test";

test("built Worker: concurrent callbacks in another Chromium container cannot steal the initiating browser's cookie", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const sqlite = new DatabaseSync(":memory:");
  const migrations = new URL("../drizzle/", import.meta.url);
  for (const file of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  function prepare(sql) {
    let values = [];
    return {
      bind(...bindings) { values = bindings; return this; },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async run() { return { success: true, meta: sqlite.prepare(sql).run(...values) }; },
      execute() { return { success: true, results: sqlite.prepare(sql).all(...values) }; },
    };
  }
  const DB = { prepare, async batch(statements) {
    sqlite.exec("BEGIN");
    try { const results = statements.map(s => s.execute()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  const pending = [];
  let authorize;
  let origin;
  let env;
  // Ephemeral fixture certificate in memory only. Secure __Host cookies must be tested on HTTPS.
  const server = createServer(httpsFixture(), async (request, response) => {
    try {
      if (!request.url.startsWith("/api/")) {
        response.writeHead(200, { "content-type": "text/html" });
        response.end('<!doctype html><a href="/api/v1/auth/line">Begin fixture login</a>'); return;
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) if (typeof value === "string") headers.set(name, value);
      headers.set("cf-connecting-ip", "203.0.113.10");
      const result = await worker.fetch(new Request(origin + request.url, { method: request.method, headers }), env, {
        props: {}, waitUntil(promise) { pending.push(promise); }, passThroughOnException() {},
      });
      if (request.url === "/api/v1/auth/line") authorize = new URL(result.headers.get("location"));
      const outgoing = Object.fromEntries(result.headers);
      const cookies = result.headers.getSetCookie();
      if (cookies.length) outgoing["set-cookie"] = cookies;
      response.writeHead(result.status, outgoing); response.end(Buffer.from(await result.arrayBuffer()));
    } catch { response.writeHead(500); response.end("Fixture failure"); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `https://127.0.0.1:${server.address().port}`;
  env = { APP_ENV: "production", DB, SESSION_SECRET: "fixture-session-secret", LINE_CHANNEL_ID: "fixture-channel",
    LINE_CHANNEL_SECRET: "fixture-channel-secret", LINE_CALLBACK_URL: `${origin}/api/v1/auth/line/callback`,
    PLAYBACK_RATE_LIMITER: { limit: async () => ({ success: true }) },
    PUBLIC_WRITE_RATE_LIMITER: { limit: async () => ({ success: true }) } };
  const originalFetch = globalThis.fetch;
  let release;
  let entered;
  const exchangeStarted = new Promise(resolve => { entered = resolve; });
  let lineRequests = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url) === "https://api.line.me/oauth2/v2.1/token") {
      lineRequests++; entered(); return new Promise(resolve => { release = () => resolve(Response.json({ id_token: "fixture-token" })); });
    }
    if (String(url) === "https://api.line.me/oauth2/v2.1/verify") {
      lineRequests++;
      return Response.json({ iss: "https://access.line.me", sub: "U-fixture-private", aud: "fixture-channel",
        exp: Math.floor(Date.now() / 1000) + 300, nonce: new URLSearchParams(init.body).get("nonce") });
    }
    return originalFetch(url, init);
  };
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const original = await browser.newContext({ ignoreHTTPSErrors: true });
    const other = await browser.newContext({ ignoreHTTPSErrors: true });
    const originalPage = await original.newPage();
    await originalPage.route("https://access.line.me/**", route => route.fulfill({ contentType: "text/html", body: "Fixture LINE approval" }));
    await originalPage.goto(origin);
    await originalPage.getByRole("link").click();
    await originalPage.waitForURL("https://access.line.me/**");
    const proof = (await original.cookies(origin)).find(c => c.name === "__Host-surf_login");
    assert.ok(proof?.httpOnly && proof.secure && proof.sameSite === "Lax", "real browser stores the first-party proof on the begin redirect");
    const callback = `${env.LINE_CALLBACK_URL}?state=${authorize.searchParams.get("state")}&code=fixture-code`;
    const first = other.request.get(callback, { maxRedirects: 0 });
    await exchangeStarted;
    const duplicate = await other.request.get(callback, { maxRedirects: 0 });
    assert.equal(duplicate.headers().location, "/?login=completing");
    assert.equal(duplicate.headers()["set-cookie"], undefined);
    release();
    const success = await first;
    assert.equal(success.headers()["set-cookie"], undefined);
    assert.equal(lineRequests, 2);
    const otherPage = await other.newPage();
    await otherPage.goto(origin);
    const completion = page => page.evaluate(async () => {
      const response = await fetch("/api/v1/auth/line/complete", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      return { status: response.status, body: await response.json() };
    });
    assert.deepEqual(await completion(otherPage), { status: 200, body: { status: "none" } });
    await originalPage.goto(origin);
    assert.deepEqual(await completion(originalPage), { status: 200, body: { status: "ready" } });
    assert.equal(await originalPage.evaluate(async () => (await fetch("/api/v1/me")).status), 200);
    assert.equal(await otherPage.evaluate(async () => (await fetch("/api/v1/me")).status), 401);
    const originalCookies = await original.cookies(origin);
    assert.ok(originalCookies.some(c => c.name === "__Host-surf_session" && c.httpOnly && c.secure && c.sameSite === "Lax"));
    assert.ok(!originalCookies.some(c => c.name === "__Host-surf_login"), "proof cleared after delivery");
    assert.equal(await originalPage.evaluate(() => document.cookie), "", "neither credential is JavaScript-readable");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM auth_sessions").get().count, 1);
  } finally {
    release?.();
    await browser?.close();
    await Promise.all(pending);
    globalThis.fetch = originalFetch;
    await new Promise(resolve => server.close(resolve));
    sqlite.close();
  }
});
