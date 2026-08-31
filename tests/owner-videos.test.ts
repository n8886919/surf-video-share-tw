import { describe, expect, it } from "vitest";
import type { ObservationResponse } from "../packages/api-contract/src";
import { api } from "../src/worker/api";
import type { AppEnv } from "../src/worker/db";

const emptyMetrics = {
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
  tide_height: null,
  tide_slope: null,
  tide_state: null,
  wind_speed: null,
  wind_direction: null,
  wind_gust: null,
};

describe("owner video history response", () => {
  it("returns active sources first and retains collect-only model rows", async () => {
    const capturedAt = "2026-08-25T03:00:00.000Z";
    const historicalSql: string[] = [];
    const observation = {
      id: "video_owner",
      status: "ready",
      metadata_status: "complete",
      metadata_expires_at: null,
      public_at: capturedAt,
      captured_at: capturedAt,
      created_at: capturedAt,
      duration_seconds: 20,
      show_uploader: 1,
      is_favorite: 0,
      uploader_note: "乾淨的小浪",
      fun_reaction: "fun",
      terms_version: "cc0-1.0-test",
      moderation_status: "visible",
      playback_count_90d: 7,
      delisted_at: null,
      provider_video_id: "provider_video_owner",
      video_provider: "mock",
      spot_id: "spot_wushi-harbor-north",
      spot_slug: "wushi-harbor-north",
      spot_name_en: "Wushi Harbor North",
      spot_name_zh: "烏石港",
      display_id: "浪人",
      ...emptyMetrics,
    };
    const history = {
      id: "forecast_history",
      historical_video_id: "video_owner",
      provider: "open-meteo",
      model: "meteofrance_wave",
      snapshot_kind: "historical_forecast",
      issued_at: "2026-08-25T04:00:00.000Z",
      model_run_at: null,
      valid_at: capturedAt,
      lead_hours: 3,
      ...emptyMetrics,
      swell_height: 0.8,
      swell_direction: 90,
      swell_period: 8,
    };
    const cwaHistory = {
      ...history,
      id: "forecast_cwa",
      provider: "cwa",
      model: "cwa-wave-f-a0020-001",
      snapshot_kind: "forecast",
      issued_at: "2026-08-25T00:00:00.000Z",
    };
    const ecmwfHistory = {
      ...history,
      id: "forecast_ecmwf_collect_only",
      model: "ecmwf_wam",
      snapshot_kind: "forecast",
      issued_at: "2026-08-25T00:00:00.000Z",
    };
    const user = {
      id: "user_dev_local",
      line_display_name: "Wave Friend",
      display_id: "浪人",
      show_identity_default: 1,
    };
    const db = {
      prepare: (sql: string) => {
        const statement = {
          bind: () => statement,
          run: async () => ({ meta: { changes: 1 } }),
          first: async () => sql.includes("FROM users WHERE id = ?") ? user : null,
          all: async () => {
            if (sql.includes("WITH candidate_videos AS")) {
              historicalSql.push(sql);
              return { results: [ecmwfHistory, history, cwaHistory] };
            }
            if (sql.includes("metadata_expires_at <=") || sql.includes("status IN ('pending', 'processing')")) {
              return { results: [] };
            }
            if (sql.includes("FROM videos v") && sql.includes("LEFT JOIN condition_snapshots")) {
              return { results: [observation] };
            }
            return { results: [] };
          },
        };
        return statement;
      },
      batch: async () => [],
    } as unknown as D1Database;

    const response = await api.fetch(
      new Request("https://example.com/api/v1/videos"),
      {
        APP_ENV: "development",
        ENABLE_DEV_AUTH: "true",
        DB: db,
        VIDEO_PROVIDER: "mock",
      } as AppEnv,
    );
    const body = await response.json() as { observations: ObservationResponse[] };

    expect(response.status).toBe(200);
    expect(body.observations[0]).toMatchObject({
      id: "video_owner",
      historicalForecasts: [
        {
          id: "forecast_cwa",
          sourceDisplayName: "CWA",
          matchingRole: "active",
        },
        {
          id: "forecast_history",
          provider: "open-meteo",
          model: "meteofrance_wave",
          sourceDisplayName: "Météo-France MFWAM",
          matchingRole: "active",
          snapshotKind: "historical_forecast",
          primarySwell: { height: 0.8, direction: 90, period: 8 },
        },
        {
          id: "forecast_ecmwf_collect_only",
          sourceDisplayName: "ECMWF WAM 9 km",
          matchingRole: "collect-only",
        },
      ],
      playbackCount90d: 7,
    });
    expect(historicalSql[0]).toContain("CAST(strftime('%s', fs.issued_at) AS INTEGER)");
    expect(historicalSql[0]).toContain("CAST(strftime('%s', candidate_videos.captured_at) AS INTEGER)");
    expect(historicalSql[0]).toContain("fs.snapshot_kind = 'historical_forecast'");
    expect(historicalSql[0]).toContain("CASE WHEN fs.snapshot_kind = 'historical_forecast' THEN 0 ELSE 1 END");
    expect(historicalSql[0]).toContain("PARTITION BY candidate_videos.id, fs.provider, fs.model");
  });
});
