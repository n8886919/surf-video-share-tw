import { describe, expect, it } from "vitest";
import { api } from "../src/worker/api";
import type { AppEnv } from "../src/worker/db";

const user = {
  id: "user_dev_local",
  line_display_name: "Wave Friend",
  display_id: "wave-friend",
  show_identity_default: 1,
};

const spot = {
  id: "spot_wushi-harbor-north",
  slug: "wushi-harbor-north",
  name_en: "Wushi Harbor North",
  name_zh: "烏石港",
  region: "Northeast",
  latitude: 24.8731036,
  longitude: 121.8411446,
};

function recentTaipeiCaptureWithOffset(): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(Date.now() - 24 * 60 * 60_000))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T12:34:56+08:00`;
}

describe("capturedAt UTC canonicalization", () => {
  it("stores an offset-bearing upload capture time as canonical UTC", async () => {
    const capturedAt = recentTaipeiCaptureWithOffset();
    const expectedUtc = new Date(capturedAt).toISOString();
    let insertBindings: unknown[] = [];
    const db = {
      prepare: (sql: string) => {
        const statement = {
          bind: (...bindings: unknown[]) => {
            if (sql.includes("INSERT INTO videos")) insertBindings = bindings;
            return statement;
          },
          first: async () => {
            if (sql.includes("FROM users WHERE id = ?")) return user;
            if (sql.includes("FROM spots WHERE")) return spot;
            return null;
          },
          run: async () => ({ meta: { changes: 1 } }),
          all: async () => ({ results: [] }),
        };
        return statement;
      },
      batch: async () => [],
    } as unknown as D1Database;

    const response = await api.fetch(
      new Request("https://example.com/api/v1/videos/upload-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spotId: spot.id,
          capturedAt,
          durationSeconds: 20,
          sizeBytes: 1_024,
          fileName: "offset.mp4",
          contentType: "video/mp4",
        }),
      }),
      {
        APP_ENV: "development",
        ENABLE_DEV_AUTH: "true",
        VIDEO_PROVIDER: "mock",
        DB: db,
      } as AppEnv,
    );

    expect(response.status).toBe(201);
    expect(insertBindings[5]).toBe(expectedUtc);
    expect(insertBindings[5]).not.toBe(capturedAt);
  });

  it("documents why raw ISO text ordering could admit a forecast issued after capture", () => {
    const capturedAt = "2026-08-25T09:00:00+08:00";
    const issuedAfterCapture = "2026-08-25T02:00:00.000Z";

    expect(issuedAfterCapture < capturedAt).toBe(true);
    expect(new Date(issuedAfterCapture).getTime()).toBeGreaterThan(new Date(capturedAt).getTime());
    expect(new Date(capturedAt).toISOString()).toBe("2026-08-25T01:00:00.000Z");
    expect(issuedAfterCapture < new Date(capturedAt).toISOString()).toBe(false);
  });
});
