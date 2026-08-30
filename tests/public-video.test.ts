import { describe, expect, it } from "vitest";
import { api } from "../src/worker/api";
import type { AppEnv } from "../src/worker/db";

const publicObservation = {
  id: "video_public",
  status: "ready",
  metadata_status: "complete",
  metadata_expires_at: null,
  public_at: "2026-08-29T02:00:00.000Z",
  captured_at: "2026-08-29T01:00:00.000Z",
  created_at: "2026-08-29T02:00:00.000Z",
  duration_seconds: 20,
  show_uploader: 1,
  is_favorite: 1,
  uploader_note: "浪況補充",
  fun_reaction: "fun",
  terms_version: "2026-08-24-cc0-v1",
  moderation_status: "visible",
  delisted_at: null,
  provider_video_id: "provider_secret_id",
  video_provider: "cloudflare-stream",
  spot_id: "spot_wushi",
  spot_slug: "wushi-harbor-north",
  spot_name_en: "Wushi Harbor North",
  spot_name_zh: "烏石港",
  display_id: "浪人小明",
  playback_count_90d: 99,
  wave_height: null,
  wave_direction: null,
  wave_period: null,
  swell_height: null,
  swell_direction: null,
  swell_period: null,
  secondary_swell_height: null,
  secondary_swell_direction: null,
  secondary_swell_period: null,
  wind_wave_height: null,
  wind_wave_direction: null,
  wind_wave_period: null,
  wind_speed: null,
  wind_direction: null,
  wind_gust: null,
  tide_height: null,
  tide_slope: null,
  tide_state: null,
};

describe("stable public video details", () => {
  it("returns only a qualifying public observation without owner analytics or provider UID", async () => {
    const sql: string[] = [];
    const db = {
      prepare: (statement: string) => {
        sql.push(statement);
        return { bind: () => ({ first: async () => publicObservation }) };
      },
    } as unknown as D1Database;

    const response = await api.fetch(
      new Request("https://example.com/api/v1/public-videos/video_public"),
      { APP_ENV: "production", DB: db } as AppEnv,
    );
    const body = await response.json() as { observation: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(body.observation).toMatchObject({
      id: "video_public",
      uploaderDisplayId: "浪人小明",
      uploaderNote: "浪況補充",
      funReaction: "fun",
      isFavorite: false,
      video: {
        provider: "cloudflare-stream",
        thumbnailUrl: "/api/v1/videos/video_public/thumbnail",
      },
    });
    expect(body.observation).not.toHaveProperty("playbackCount90d");
    expect(JSON.stringify(body)).not.toContain("provider_secret_id");
    expect(sql[0]).toContain("v.metadata_status = 'complete'");
    expect(sql[0]).toContain("v.status = 'ready'");
    expect(sql[0]).toContain("v.public_at IS NOT NULL");
    expect(sql[0]).toContain("v.terms_version IS NOT NULL");
    expect(sql[0]).toContain("v.moderation_status = 'visible'");
  });

  it("fails closed when the public lifecycle query finds no row", async () => {
    const db = {
      prepare: () => ({ bind: () => ({ first: async () => null }) }),
    } as unknown as D1Database;
    const response = await api.fetch(
      new Request("https://example.com/api/v1/public-videos/video_private"),
      { APP_ENV: "production", DB: db } as AppEnv,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "VIDEO_NOT_FOUND" });
  });
});
