import { describe, expect, it } from "vitest";
import { withSecurityHeaders } from "../src/worker/security-headers";

describe("basic security headers", () => {
  it("adds safe defaults while preserving the response", async () => {
    const response = withSecurityHeaders(new Response("ok", {
      status: 201,
      headers: {
        "cache-control": "no-store",
        "set-cookie": "session=test; HttpOnly; Secure",
      },
    }));

    expect(response.status).toBe(201);
    expect(await response.text()).toBe("ok");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
