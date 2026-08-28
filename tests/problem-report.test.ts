import { describe, expect, it, vi } from "vitest";
import { api } from "../src/worker/api";
import type { AppEnv } from "../src/worker/db";

describe("problem reports", () => {
  it("stores a trimmed anonymous report with a pseudonymous limiter key", async () => {
    const statements: string[] = [];
    const boundValues: unknown[][] = [];
    const limit = vi.fn().mockResolvedValue({ success: true });
    const db = {
      prepare: (sql: string) => {
        statements.push(sql);
        return {
          bind: (...values: unknown[]) => {
            boundValues.push(values);
            return { run: async () => ({ meta: { changes: 1 } }) };
          },
        };
      },
    } as unknown as D1Database;

    const response = await api.fetch(
      new Request("https://example.com/api/v1/problem-reports", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.25",
        },
        body: JSON.stringify({ message: "  播放按鈕沒有反應  ", view: "find" }),
      }),
      {
        APP_ENV: "production",
        DB: db,
        SESSION_SECRET: "test-session-secret",
        PROBLEM_REPORT_RATE_LIMITER: { limit } as unknown as RateLimit,
      } as AppEnv,
    );

    expect(response.status).toBe(201);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("INSERT INTO problem_reports");
    expect(boundValues[0]).toEqual([
      expect.any(String),
      "播放按鈕沒有反應",
      "find",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    ]);
    expect(boundValues.flat()).not.toContain("203.0.113.25");
    const limiterKey = limit.mock.calls[0]?.[0]?.key as string;
    expect(limiterKey).toMatch(/^[a-f0-9]{64}$/);
    expect(limiterKey).not.toContain("203.0.113.25");
  });

  it("rejects a report burst before writing to D1", async () => {
    const prepare = vi.fn();
    const limit = vi.fn().mockResolvedValue({ success: false });
    const response = await api.fetch(
      new Request("https://example.com/api/v1/problem-reports", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.25",
        },
        body: JSON.stringify({ message: "播放按鈕沒有反應", view: "find" }),
      }),
      {
        APP_ENV: "production",
        DB: { prepare } as unknown as D1Database,
        SESSION_SECRET: "test-session-secret",
        PROBLEM_REPORT_RATE_LIMITER: { limit } as unknown as RateLimit,
      } as AppEnv,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(prepare).not.toHaveBeenCalled();
  });

  it("fails closed without production key material", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const prepare = vi.fn();
    const limit = vi.fn().mockResolvedValue({ success: true });
    const response = await api.fetch(
      new Request("https://example.com/api/v1/problem-reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "播放按鈕沒有反應", view: "find" }),
      }),
      {
        APP_ENV: "production",
        DB: { prepare } as unknown as D1Database,
        PROBLEM_REPORT_RATE_LIMITER: { limit } as unknown as RateLimit,
      } as AppEnv,
    );

    expect(response.status).toBe(503);
    expect(prepare).not.toHaveBeenCalled();
    expect(limit).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("lets the configured administrator list anonymous open reports", async () => {
    const user = { id: "user_dev_local", line_display_name: null, display_id: "admin", show_identity_default: 0 };
    const statementFor = (sql: string) => {
      const statement = {
        bind: () => statement,
        first: async () => user,
        run: async () => ({ meta: { changes: 1 } }),
        all: async () => ({
          results: sql.includes("FROM problem_reports")
            ? [{ id: "report_1", message: "播放按鈕沒有反應", view: "find", status: "open", created_at: "2026-08-29T00:00:00.000Z", resolved_at: null }]
            : [],
        }),
      };
      return statement;
    };
    const db = {
      prepare: statementFor,
      batch: async () => [],
    } as unknown as D1Database;

    const response = await api.fetch(
      new Request("https://example.com/api/v1/admin/problem-reports"),
      {
        APP_ENV: "development",
        ENABLE_DEV_AUTH: "true",
        ADMIN_USER_ID: user.id,
        DB: db,
      } as AppEnv,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ reports: [{
      id: "report_1",
      message: "播放按鈕沒有反應",
      view: "find",
      status: "open",
      createdAt: "2026-08-29T00:00:00.000Z",
      resolvedAt: null,
    }] });
  });

  it("lets the configured administrator resolve one open report", async () => {
    const user = { id: "user_dev_local", line_display_name: null, display_id: "admin", show_identity_default: 0 };
    const updates: unknown[][] = [];
    const db = {
      prepare: (sql: string) => {
        const statement = {
          bind: (...values: unknown[]) => {
            if (sql.includes("UPDATE problem_reports")) updates.push(values);
            return statement;
          },
          first: async () => user,
          run: async () => ({ meta: { changes: 1 } }),
          all: async () => ({ results: [] }),
        };
        return statement;
      },
      batch: async () => [],
    } as unknown as D1Database;

    const response = await api.fetch(
      new Request("https://example.com/api/v1/admin/problem-reports/report_1/resolve", { method: "POST" }),
      {
        APP_ENV: "development",
        ENABLE_DEV_AUTH: "true",
        ADMIN_USER_ID: user.id,
        DB: db,
      } as AppEnv,
    );

    expect(response.status).toBe(200);
    expect(updates[0]).toEqual([expect.any(String), user.id, "report_1"]);
  });
});
