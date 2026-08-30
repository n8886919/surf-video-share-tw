import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { api } from "../src/worker/api";
import type { AppEnv } from "../src/worker/db";
import {
  recordOpsEvent,
  runHourlyOpsAnalysis,
  sanitizeOpsSummary,
  sendLineNotification,
} from "../src/worker/ops-observability";

function readinessDb(ok = true): D1Database {
  const statement = {
    bind: () => statement,
    first: async () => ok ? { ok: 1 } : null,
  };
  return { prepare: () => statement } as unknown as D1Database;
}

const LINE_USER_ID = `U${"a".repeat(32)}`;

describe("operations observability", () => {
  it("redacts credentials and URLs before storing summaries", () => {
    const summary = sanitizeOpsSummary(
      "Bearer line-token failed at https://example.com/path?token=secret&code=private",
    );

    expect(summary).toContain("Bearer [REDACTED]");
    expect(summary).toContain("[URL_REDACTED]");
    expect(summary).not.toContain("line-token");
    expect(summary).not.toContain("secret");
    expect(summary).not.toContain("private");
  });

  it("uses LINE Messaging API without putting credentials in the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const result = await sendLineNotification({
      DB: readinessDb(),
      LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: "channel-token",
      OPS_LINE_USER_ID: LINE_USER_ID,
    } as unknown as AppEnv, "test alert", fetchMock);

    expect(result).toBe("sent");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.line.me/v2/bot/message/push");
    expect(init.headers).toMatchObject({ authorization: "Bearer channel-token" });
    expect(JSON.parse(String(init.body))).toEqual({
      to: LINE_USER_ID,
      messages: [{ type: "text", text: "test alert" }],
    });
    expect(String(init.body)).not.toContain("channel-token");
  });

  it("opens one incident only after three matching errors within five minutes", async () => {
    let eventCount = 0;
    let incident: Record<string, unknown> | null = null;
    const db = {
      prepare: (sql: string) => {
        let bindings: unknown[] = [];
        const statement = {
          bind: (...values: unknown[]) => {
            bindings = values;
            return statement;
          },
          first: async () => {
            if (sql.includes("COUNT(*) AS count")) return { count: eventCount };
            if (sql.includes("FROM ops_incidents")) return incident;
            return null;
          },
          run: async () => {
            if (sql.includes("INSERT INTO ops_events")) eventCount += 1;
            if (sql.includes("INSERT INTO ops_incidents")) {
              incident = {
                fingerprint: bindings[0],
                status: "open",
                severity: bindings[1],
                title: bindings[2],
                first_seen_at: bindings[3],
                last_seen_at: bindings[4],
                occurrences: 1,
                notified_at: null,
                recovered_at: null,
                recovery_notified_at: null,
              };
            }
            if (sql.includes("SET notified_at") && incident) {
              incident.notified_at = bindings[0];
            }
            return { meta: { changes: 1 } };
          },
        };
        return statement;
      },
    } as unknown as D1Database;
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const env = {
      DB: db,
      LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: "channel-token",
      OPS_LINE_USER_ID: LINE_USER_ID,
    } as unknown as AppEnv;

    const results = [];
    for (const minute of [0, 1, 2]) {
      results.push(await recordOpsEvent(env, {
        code: "api.unhandled_error",
        severity: "error",
        source: "api",
        fingerprint: "api.unhandled:spots",
      }, {
        now: new Date(`2026-08-30T12:0${minute}:00.000Z`),
        fetchImpl: fetchMock,
      }));
    }

    expect(results.map((result) => result.incidentOpened)).toEqual([false, false, true]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps an empty hourly window silent and skips Workers AI", async () => {
    const statements: string[] = [];
    const statement = {
      bind: () => statement,
      run: async () => ({ meta: { changes: 1 } }),
      first: async () => null,
      all: async () => ({ results: [] }),
    };
    const db = {
      prepare: (sql: string) => {
        statements.push(sql);
        return statement;
      },
      batch: async () => [],
    } as unknown as D1Database;
    const aiRun = vi.fn();
    const fetchMock = vi.fn();

    await runHourlyOpsAnalysis({
      DB: db,
      AI: { run: aiRun },
      LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: "channel-token",
      OPS_LINE_USER_ID: LINE_USER_ID,
    } as unknown as AppEnv, new Date("2026-08-30T12:05:00.000Z"), fetchMock);

    expect(aiRun).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(statements.some((sql) => sql.includes("INSERT OR IGNORE INTO ops_analysis_runs"))).toBe(true);
  });

  it("sends only grouped metadata to AI and keeps a normal result silent", async () => {
    const statementFor = (sql: string) => {
      const statement = {
        bind: () => statement,
        run: async () => ({ meta: { changes: 1 } }),
        first: async () => null,
        all: async () => ({
          results: sql.includes("GROUP BY event_code") ? [{
            event_code: "api.unhandled_error",
            severity: "error",
            source: "api",
            fingerprint: "api.unhandled:spots",
            route: "/spots",
            error_name: "Error",
            event_count: 2,
            first_seen_at: "2026-08-30T11:10:00.000Z",
            last_seen_at: "2026-08-30T11:20:00.000Z",
          }] : [],
        }),
      };
      return statement;
    };
    const db = {
      prepare: (sql: string) => statementFor(sql),
      batch: async () => [],
    } as unknown as D1Database;
    const aiRun = vi.fn().mockResolvedValue({
      response: {
        severity: "normal",
        summaryZh: "沒有需要處理的異常模式。",
        patterns: [],
        recommendedChecks: [],
      },
    });
    const fetchMock = vi.fn();

    await runHourlyOpsAnalysis({
      DB: db,
      AI: { run: aiRun },
      LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: "channel-token",
      OPS_LINE_USER_ID: LINE_USER_ID,
    } as unknown as AppEnv, new Date("2026-08-30T12:05:00.000Z"), fetchMock);

    expect(aiRun).toHaveBeenCalledOnce();
    const [model, input] = aiRun.mock.calls[0] as [string, Record<string, unknown>];
    expect(model).toBe("@cf/meta/llama-3.1-8b-instruct-fast");
    const messages = input.messages as Array<{ role: string; content: string }>;
    const groupedInput = JSON.parse(messages[1].content) as Array<Record<string, unknown>>;
    expect(groupedInput[0]).toMatchObject({ eventCode: "api.unhandled_error", count: 2 });
    expect(groupedInput[0]).not.toHaveProperty("summary");
    expect(groupedInput[0]).not.toHaveProperty("requestId");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a minimal production readiness result without exposing missing configuration", async () => {
    const ready = await api.fetch(
      new Request("https://example.com/api/v1/readiness"),
      {
        APP_ENV: "production",
        DB: readinessDb(),
        AI: { run: vi.fn() },
        VIDEO_PROVIDER: "cloudflare-stream",
        CLOUDFLARE_ACCOUNT_ID: "account-id",
        CLOUDFLARE_STREAM_API_TOKEN: "stream-token",
        PUBLIC_SITE_ORIGIN: "https://example.com",
        LINE_CHANNEL_ID: "login-channel",
        LINE_CHANNEL_SECRET: "login-secret",
        LINE_CALLBACK_URL: "https://example.com/api/v1/auth/line/callback",
        SESSION_SECRET: "session-secret",
        ADMIN_USER_ID: "admin-id",
        FORECAST_INGESTION_SECRET: "ingestion-secret",
        UPLOAD_RATE_LIMITER: {} as RateLimit,
        PLAYBACK_RATE_LIMITER: {} as RateLimit,
        DOWNLOAD_RATE_LIMITER: {} as RateLimit,
        PUBLIC_WRITE_RATE_LIMITER: {} as RateLimit,
        LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: "channel-token",
        OPS_LINE_USER_ID: LINE_USER_ID,
      } as unknown as AppEnv,
    );
    const unavailable = await api.fetch(
      new Request("https://example.com/api/v1/readiness"),
      { APP_ENV: "production", DB: readinessDb() } as unknown as AppEnv,
    );

    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toMatchObject({ ok: true });
    expect(unavailable.status).toBe(503);
    const body = await unavailable.text();
    expect(body).toContain('"ok":false');
    expect(body).not.toContain("LINE");
    expect(body).not.toContain("AI");
  });

  it("keeps the five-minute external monitor independent and silent on steady state", () => {
    const workflow = readFileSync(".github/workflows/uptime.yml", "utf8");

    expect(workflow).toContain('cron: "2-59/5 * * * *"');
    expect(workflow).toContain("https://surf-video-share-tw.nolanasd123.workers.dev");
    expect(workflow).toContain("${BASE_URL}/api/v1/readiness");
    expect(workflow).toContain("LINE_MESSAGING_CHANNEL_ACCESS_TOKEN");
    expect(workflow).toContain("test_line:");
    expect(workflow).toContain("No state transition; LINE remains silent.");
    expect(workflow).not.toContain("actions/checkout");
  });
});
