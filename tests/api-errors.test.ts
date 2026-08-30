import { describe, expect, it, vi } from "vitest";
import { api } from "../src/worker/api";
import type { AppEnv } from "../src/worker/db";

describe("unexpected API errors", () => {
  it("returns a request ID without exposing the original exception", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await api.fetch(
      new Request("https://example.com/api/v1/spots?token=must-not-be-logged"),
      {
        APP_ENV: "production",
        DB: {
          prepare: () => {
            throw new Error("database failed with internal detail");
          },
        } as unknown as D1Database,
      } as AppEnv,
    );
    const body = await response.json() as {
      error: string;
      message: string;
      requestId: string;
    };

    expect(response.status).toBe(500);
    expect(body.error).toBe("REQUEST_FAILED");
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get("x-request-id")).toBe(body.requestId);
    expect(body.message).toContain(body.requestId);
    expect(JSON.stringify(body)).not.toContain("database failed");
    expect(consoleError).toHaveBeenCalledWith("Unhandled API error", expect.objectContaining({
      requestId: body.requestId,
      method: "GET",
      path: "/api/v1/spots",
      errorName: "Error",
      errorMessage: "database failed with internal detail",
    }));
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("must-not-be-logged");
    consoleError.mockRestore();
  });
});
