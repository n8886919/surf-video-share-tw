import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeLineLogin, finishLineLogin, getAuthenticatedUser, logout } from "../src/worker/auth";
import { callbackRequest, claimRequest, lineLoginFixture, mockLine, origin, verified } from "./helpers/line-login-fixture";

describe("initiating-browser LINE completion with real migrations", () => {
  let f: ReturnType<typeof lineLoginFixture>;
  beforeEach(() => { f = lineLoginFixture(); vi.useFakeTimers({ toFake: ["Date"] }); });
  afterEach(() => { f.sqlite.close(); vi.restoreAllMocks(); vi.useRealTimers(); });
  const sessionCount = () => Number(f.sqlite.prepare("SELECT COUNT(*) AS count FROM auth_sessions").get()!.count);
  const claim = (cookie: string) => completeLineLogin(claimRequest(cookie), f.env);
  const cookieOf = (response: Response) => response.headers.getSetCookie().find(value => value.startsWith("__Host-surf_session="))!.split(";")[0];

  it("sets a separate 256-bit HttpOnly first-party proof, stores only its hash, and uses an indexed lookup", async () => {
    const a = await f.start();
    expect(a.response.headers.get("set-cookie")).toMatch(/^__Host-surf_login=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/);
    const proof = a.cookie.split("=")[1];
    expect(a.state).not.toBe(proof);
    expect(a.url.toString()).not.toContain(proof);
    const row = f.sqlite.prepare("SELECT * FROM oauth_attempts").get()!;
    expect(row.browser_proof_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toContain(proof);
    expect(JSON.stringify(row)).not.toContain(a.state);
    expect(JSON.stringify(f.sqlite.prepare("EXPLAIN QUERY PLAN SELECT status FROM oauth_attempts WHERE browser_proof_hash = ?").all("fixture"))).toContain("oauth_attempts_browser_proof_idx");
    expect(await (await claim(a.cookie)).json()).toEqual({ status: "pending" });
  });

  it("allows only one LINE exchange during two concurrent callbacks; another browser never gets a session", async () => {
    const a = await f.start();
    let release!: (response: Response) => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const line = vi.spyOn(globalThis, "fetch").mockImplementationOnce(() => {
      started(); return new Promise<Response>(resolve => { release = resolve; });
    }).mockResolvedValueOnce(Response.json(verified(a.nonce)));
    const retained: Promise<unknown>[] = [];
    const winner = finishLineLogin(callbackRequest(a.state), f.env, promise => { retained.push(promise); });
    await entered;
    const duplicate = await finishLineLogin(callbackRequest(a.state, "different-code"), f.env);
    expect(duplicate.headers.get("location")).toBe("/?login=completing");
    expect(duplicate.headers.has("set-cookie")).toBe(false);
    expect(await (await claim(a.cookie)).json()).toEqual({ status: "pending" });
    expect(await (await claim("")).json()).toEqual({ status: "none" });
    release(Response.json({ id_token: "fixture-token" }));
    const success = await winner;
    await Promise.all(retained);
    expect(retained.length).toBeGreaterThan(0);
    expect(success.headers.has("set-cookie")).toBe(false);
    expect(sessionCount()).toBe(0);
    expect(line).toHaveBeenCalledTimes(2);
    const claimed = await claim(a.cookie);
    expect(await claimed.json()).toEqual({ status: "ready" });
    expect(await getAuthenticatedUser(new Request(origin, { headers: { cookie: cookieOf(claimed) } }), f.env)).toMatchObject({ authMode: "line" });
    expect(await getAuthenticatedUser(new Request(origin), f.env)).toBeNull();
    expect(sessionCount()).toBe(1);
    expect(f.sqlite.prepare("SELECT nonce, code_verifier, status FROM oauth_attempts").get()).toMatchObject({ nonce: "", code_verifier: "", status: "delivered" });
  });

  it("does not grant login using a callback URL, state, trace, forged proof, or another browser's valid proof", async () => {
    const a = await f.start(); const b = await f.start(); mockLine(a.nonce);
    await finishLineLogin(callbackRequest(a.state), f.env);
    for (const value of ["", `__Host-surf_login=${a.state}`, `__Host-surf_login=${"a".repeat(32)}`, `__Host-surf_login=${"a".repeat(43)}`, "__Host-surf_login=%ZZ", b.cookie]) {
      const response = await completeLineLogin(claimRequest(value, { "x-surf-auth-trace": "a".repeat(32) }), f.env);
      expect(response.headers.has("set-cookie")).toBe(false);
      expect(sessionCount()).toBe(0);
    }
    const callback = await finishLineLogin(callbackRequest(a.state, "replay", b.cookie), f.env);
    expect(callback.headers.has("set-cookie")).toBe(false);
    expect(await (await claim(a.cookie)).json()).toEqual({ status: "ready" });
  });

  it.each<Record<string, string>>([
    { origin: "https://attacker.example" }, { origin: "null" }, { origin: "" },
    { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" },
    { "content-type": "application/x-www-form-urlencoded" },
  ])("rejects cross-origin/form completion %j", async headers => {
    const a = await f.start(); mockLine(a.nonce); await finishLineLogin(callbackRequest(a.state), f.env);
    const response = await completeLineLogin(claimRequest(a.cookie, headers), f.env);
    expect(response.status).toBe(403); expect(response.headers.has("set-cookie")).toBe(false); expect(sessionCount()).toBe(0);
  });

  it("atomically mints one session for simultaneous claims and safely redelivers the same response for 60 seconds", async () => {
    const a = await f.start(); mockLine(a.nonce); await finishLineLogin(callbackRequest(a.state), f.env);
    const [first, second] = await Promise.all([claim(a.cookie), claim(a.cookie)]);
    expect(await first.json()).toEqual({ status: "ready" });
    expect(await second.json()).toEqual({ status: "ready" });
    expect(cookieOf(first)).toBe(cookieOf(second)); expect(sessionCount()).toBe(1);
    const originalExpiry = f.sqlite.prepare("SELECT expires_at FROM auth_sessions").get()!.expires_at;
    vi.setSystemTime(Date.now() + 59_000);
    const retry = await claim(a.cookie);
    expect(cookieOf(retry)).toBe(cookieOf(first));
    expect(retry.headers.get("set-cookie")).toContain("Max-Age=604741");
    expect(f.sqlite.prepare("SELECT expires_at FROM auth_sessions").get()!.expires_at).toBe(originalExpiry);
    vi.setSystemTime(Date.now() + 1_000);
    expect(await (await claim(a.cookie)).json()).toEqual({ status: "expired" });
    expect(sessionCount()).toBe(1);
  });

  it("rolls back session minting if delivery marking fails, then allows a safe retry", async () => {
    const a = await f.start(); mockLine(a.nonce); await finishLineLogin(callbackRequest(a.state), f.env);
    f.sqlite.exec("CREATE TRIGGER fail_delivery BEFORE UPDATE OF delivered_at ON oauth_attempts BEGIN SELECT RAISE(ABORT, 'fixture'); END");
    await expect(claim(a.cookie)).rejects.toThrow();
    expect(sessionCount()).toBe(0);
    expect(f.sqlite.prepare("SELECT status FROM oauth_attempts").get()!.status).toBe("completed");
    f.sqlite.exec("DROP TRIGGER fail_delivery");
    expect(await (await claim(a.cookie)).json()).toEqual({ status: "ready" });
  });

  it.each(["pending", "processing", "completed"])("cannot finish an expired %s attempt", async status => {
    const a = await f.start();
    if (status === "completed") { mockLine(a.nonce); await finishLineLogin(callbackRequest(a.state), f.env); }
    else f.sqlite.prepare("UPDATE oauth_attempts SET status = ?").run(status);
    vi.setSystemTime(Date.now() + 600_000);
    const response = await claim(a.cookie);
    expect(await response.json()).toEqual({ status: "expired" }); expect(response.headers.has("set-cookie")).toBe(false);
    expect((await finishLineLogin(callbackRequest(a.state), f.env)).headers.get("location")).toBe("/?login=expired");
    expect(sessionCount()).toBe(0);
  });

  it("fails closed for pre-migration attempts lacking a browser proof", async () => {
    const a = await f.start(); f.sqlite.exec("UPDATE oauth_attempts SET browser_proof_hash = NULL");
    const line = vi.spyOn(globalThis, "fetch");
    expect((await finishLineLogin(callbackRequest(a.state), f.env)).headers.get("location")).toBe("/?login=expired");
    expect(line).not.toHaveBeenCalled(); expect(sessionCount()).toBe(0);
  });

  it("new starts revoke the previous browser attempt, including a callback still in flight", async () => {
    const a = await f.start();
    let release!: (response: Response) => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() => { started(); return new Promise<Response>(resolve => { release = resolve; }); })
      .mockResolvedValueOnce(Response.json(verified(a.nonce)));
    const running = finishLineLogin(callbackRequest(a.state), f.env); await entered;
    const b = await f.start(a.cookie);
    release(Response.json({ id_token: "fixture-token" })); await running;
    expect(await (await claim(a.cookie)).json()).toEqual({ status: "expired" });
    expect(await (await claim(b.cookie)).json()).toEqual({ status: "pending" }); expect(sessionCount()).toBe(0);
  });

  it("does not resurrect a logged-out session through proof redelivery or callback replay", async () => {
    const a = await f.start(); mockLine(a.nonce); await finishLineLogin(callbackRequest(a.state), f.env);
    const loggedIn = await claim(a.cookie); const session = cookieOf(loggedIn);
    // The browser normally already cleared its login proof; logout still revokes this session.
    await logout(new Request(origin, { headers: { cookie: session } }), f.env);
    const retry = await claim(a.cookie);
    expect(await retry.json()).toEqual({ status: "expired" }); expect(retry.headers.has("set-cookie")).toBe(false);
    expect((await finishLineLogin(callbackRequest(a.state), f.env)).headers.has("set-cookie")).toBe(false);
    expect(sessionCount()).toBe(0);
  });

  it("logout also cancels a still-pending browser attempt", async () => {
    const a = await f.start(); await logout(new Request(origin, { headers: { cookie: a.cookie } }), f.env);
    expect(await (await claim(a.cookie)).json()).toEqual({ status: "expired" });
  });

  it("retains a failed exchange and never reuses its code", async () => {
    const a = await f.start(); const line = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("fixture outage"));
    await expect(finishLineLogin(callbackRequest(a.state), f.env)).rejects.toThrow();
    expect(await (await claim(a.cookie)).json()).toEqual({ status: "failed" });
    expect((await finishLineLogin(callbackRequest(a.state), f.env)).headers.get("location")).toBe("/?login=completing");
    expect(line).toHaveBeenCalledTimes(1); expect(sessionCount()).toBe(0);
  });

  it("keeps completion rate limits separate and performs no database work for ordinary visitors", async () => {
    const a = await f.start();
    vi.mocked(f.env.PLAYBACK_RATE_LIMITER!.limit).mockResolvedValue({ success: false });
    expect((await claim(a.cookie)).status).toBe(429);
    expect(vi.mocked(f.env.PLAYBACK_RATE_LIMITER!.limit).mock.calls[0][0].key).toMatch(/^line-completion:[a-f0-9]{64}$/);
    const prepare = vi.spyOn(f.env.DB, "prepare");
    expect(await (await claim("")).json()).toEqual({ status: "none" });
    expect(prepare).not.toHaveBeenCalled();
  });
});
