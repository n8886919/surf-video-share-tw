import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/worker/api";
import { completeLineLogin, finishLineLogin } from "../src/worker/auth";
import { callbackRequest, claimRequest, lineLoginFixture, origin, verified } from "./helpers/line-login-fixture";

describe("private LINE account avatar", () => {
  afterEach(() => vi.restoreAllMocks());
  it("stores verified pictures, exposes them only through the authenticated account and clears removed/invalid pictures", async () => {
    const f = lineLoginFixture();
    try {
      for (const picture of ["https://profile.line-scdn.net/test-avatar", undefined, "javascript:alert(1)"]) {
        const a = await f.start();
        const fetchSpy = vi.spyOn(globalThis, "fetch")
          .mockResolvedValueOnce(Response.json({ id_token: "fixture-token" }))
          .mockResolvedValueOnce(Response.json({ ...verified(a.nonce), picture }));
        expect((await finishLineLogin(callbackRequest(a.state), f.env)).status).toBe(303);
        const completed = await completeLineLogin(claimRequest(a.cookie), f.env);
        const cookie = completed.headers.getSetCookie().find(value => value.startsWith("__Host-surf_session="))!.split(";")[0];
        const account = await api.fetch(new Request(`${origin}/api/v1/me`, { headers: { cookie } }), f.env);
        const body = await account.json();
        expect(body).toMatchObject({ avatarUrl: picture?.startsWith("https://") ? picture : null });
        expect(JSON.stringify(body)).not.toContain("U-fixture-only-private");
        expect(f.sqlite.prepare("SELECT line_picture_url FROM users").get()?.line_picture_url).toBe(picture?.startsWith("https://") ? picture : null);
        fetchSpy.mockRestore();
      }
      expect((await api.fetch(new Request(`${origin}/api/v1/me`), f.env)).status).toBe(401);
    } finally { f.sqlite.close(); }
  });
});
