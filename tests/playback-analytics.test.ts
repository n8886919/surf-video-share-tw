import { describe, expect, it } from "vitest";
import { api } from "../src/worker/api";
import type { AppEnv } from "../src/worker/db";
import { cleanupExpiredPlaybackEvents } from "../src/worker/playback-analytics";

function playbackDatabase() {
  const inserts: unknown[][] = [];
  const statements: string[] = [];
  const statementFor = (sql: string) => {
    const statement = {
      bind: (...values: unknown[]) => ({
        first: async () => sql.includes("FROM videos") ? {
          id: "video_public",
          user_id: "owner_user",
          provider_video_id: "mock_video",
          video_provider: "mock",
        } : null,
        run: async () => {
          if (sql.includes("INSERT OR IGNORE INTO video_playback_events")) inserts.push(values);
          return { meta: { changes: 1 } };
        },
        all: async () => ({ results: [] }),
      }),
    };
    return statement;
  };
  const db = {
    prepare: (sql: string) => {
      statements.push(sql);
      return statementFor(sql);
    },
    batch: async () => [],
  } as unknown as D1Database;
  return { db, inserts, statements };
}

describe("private owner playback feedback", () => {
  it("records a server-timestamped event only after a valid playback tracking token is returned", async () => {
    const { db, inserts } = playbackDatabase();
    const env = { APP_ENV: "development", DB: db, VIDEO_PROVIDER: "mock" } as AppEnv;
    const playbackResponse = await api.fetch(new Request(
      "https://example.com/api/v1/videos/video_public/playback",
      { method: "POST" },
    ), env);
    const playback = await playbackResponse.json() as { trackingToken: string };

    expect(playbackResponse.status).toBe(200);
    expect(playback.trackingToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);

    const startedResponse = await api.fetch(new Request(
      "https://example.com/api/v1/videos/video_public/playback-start",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trackingToken: playback.trackingToken }),
      },
    ), env);

    expect(startedResponse.status).toBe(204);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.[1]).toBe("video_public");
    expect(inserts[0]?.[2]).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });

  it("rejects a modified tracking token without writing an event", async () => {
    const { db, inserts } = playbackDatabase();
    const response = await api.fetch(new Request(
      "https://example.com/api/v1/videos/video_public/playback-start",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trackingToken: `${"a".repeat(40)}.${"b".repeat(40)}` }),
      },
    ), { APP_ENV: "development", DB: db, VIDEO_PROVIDER: "mock" } as AppEnv);

    expect(response.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it("deletes playback events beyond the 90-day owner-feedback window in bounded batches", async () => {
    const deletes: unknown[][] = [];
    const db = {
      prepare: () => ({
        bind: (...values: unknown[]) => ({
          all: async () => ({ results: [{ id: "old_1" }, { id: "old_2" }] }),
          run: async () => { deletes.push(values); return { meta: { changes: 1 } }; },
        }),
      }),
      batch: async (statements: D1PreparedStatement[]) => Promise.all(statements.map((statement) => statement.run())),
    } as unknown as D1Database;

    const result = await cleanupExpiredPlaybackEvents(
      { DB: db },
      new Date("2026-08-30T00:00:00.000Z"),
    );

    expect(result).toEqual({ selected: 2, deleted: 2, cutoff: "2026-06-01T00:00:00.000Z" });
    expect(deletes).toEqual([
      ["old_1", "2026-06-01T00:00:00.000Z"],
      ["old_2", "2026-06-01T00:00:00.000Z"],
    ]);
  });
});
