import { describe, expect, it } from "vitest";
import type { PublicMatchesResponse } from "../packages/api-contract/src";
import { firstSelectableForecastHour, taipeiForecastTarget } from "../packages/domain/src/time-policy";
import { api } from "../src/worker/api";
import type { AppEnv } from "../src/worker/db";

const emptyForecastMetrics = {
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

function observationRow(id: string, capturedAt: string) {
  return {
    id,
    status: "ready",
    metadata_status: "complete",
    metadata_expires_at: null,
    public_at: capturedAt,
    captured_at: capturedAt,
    created_at: capturedAt,
    duration_seconds: 20,
    show_uploader: 0,
    is_favorite: 0,
    uploader_note: null,
    fun_reaction: null,
    terms_version: "cc0-1.0-test",
    moderation_status: "visible",
    delisted_at: null,
    provider_video_id: `provider_${id}`,
    video_provider: "mock",
    spot_id: "spot_double-lions",
    spot_slug: "double-lions",
    spot_name_en: "Double Lions",
    spot_name_zh: "雙獅",
    display_id: null,
    ...emptyForecastMetrics,
  };
}

describe("public matches response", () => {
  it("returns one equal-provider score and requires adequate CWA and ECMWF history", async () => {
    const current = new Date();
    const dayOffset = firstSelectableForecastHour(0, current) == null ? 1 : 0;
    const targetTime = taipeiForecastTarget(dayOffset, firstSelectableForecastHour(dayOffset, current) ?? 5, current).toISOString();
    const now = current.getTime();
    const capturedAt = new Date(now - 24 * 60 * 60_000).toISOString();
    const ecmwfTarget = {
      ...emptyForecastMetrics,
      id: "forecast_ecmwf_target",
      provider: "open-meteo",
      model: "ecmwf_wam",
      issued_at: new Date(now).toISOString(),
      model_run_at: null,
      valid_at: targetTime,
      lead_hours: 1,
      swell_height: 1,
      swell_period: 10,
      swell_direction: 90,
    };
    const cwaTarget = {
      ...emptyForecastMetrics,
      id: "forecast_cwa_target",
      provider: "cwa",
      model: "cwa-wave-f-a0020-001",
      issued_at: new Date(now).toISOString(),
      model_run_at: new Date(now - 6 * 60 * 60_000).toISOString(),
      valid_at: targetTime,
      lead_hours: 6,
      wave_height: 1,
      wave_period: 8,
      wave_direction: 80,
    };
    const adequateEcmwfHistory = {
      ...ecmwfTarget,
      id: "forecast_ecmwf_adequate",
      historical_video_id: "video_adequate",
      issued_at: capturedAt,
      valid_at: capturedAt,
      swell_direction: null,
    };
    const adequateCwaHistory = {
      ...cwaTarget,
      id: "forecast_cwa_adequate",
      historical_video_id: "video_adequate",
      issued_at: capturedAt,
      valid_at: capturedAt,
      wave_direction: null,
    };
    const sparseEcmwfHistory = {
      ...adequateEcmwfHistory,
      id: "forecast_ecmwf_sparse",
      historical_video_id: "video_sparse",
      swell_period: null,
    };
    const completeCwaHistoryForSparseVideo = {
      ...cwaTarget,
      id: "forecast_cwa_sparse_video",
      historical_video_id: "video_sparse",
      issued_at: capturedAt,
      valid_at: capturedAt,
    };
    const observations = [
      observationRow("video_adequate", capturedAt),
      observationRow("video_sparse", capturedAt),
    ];

    const db = {
      prepare: (sql: string) => {
        const statement = {
          bind: () => statement,
          first: async () => sql.includes("FROM spots WHERE")
            ? {
                id: "spot_double-lions",
                slug: "double-lions",
                name_en: "Double Lions",
                name_zh: "雙獅",
                region: "Northeast",
                latitude: 24.8887597,
                longitude: 121.8495724,
              }
            : null,
          all: async () => {
            if (sql.includes("WITH candidate_videos")) {
              return { results: [
                adequateEcmwfHistory,
                adequateCwaHistory,
                sparseEcmwfHistory,
                completeCwaHistoryForSparseVideo,
              ] };
            }
            if (sql.includes("FROM forecast_snapshots fs")) {
              return { results: [ecmwfTarget, cwaTarget] };
            }
            if (sql.includes("FROM videos v")) return { results: observations };
            return { results: [] };
          },
        };
        return statement;
      },
    } as unknown as D1Database;

    const response = await api.fetch(
      new Request(`https://example.com/api/v1/matches?spotId=spot_double-lions&targetTime=${encodeURIComponent(targetTime)}`),
      { APP_ENV: "production", DB: db } as AppEnv,
    );
    const body = await response.json() as PublicMatchesResponse;

    expect(response.status).toBe(200);
    expect(body.ranking).toBe("equal-provider-composite-historical-forecast");
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0]).toMatchObject({
      score: 1,
      observation: {
        id: "video_adequate",
        video: { thumbnailUrl: "/api/v1/videos/video_adequate/thumbnail" },
      },
      sources: [
        {
          provider: "cwa",
          model: "cwa-wave-f-a0020-001",
          targetForecast: { id: "forecast_cwa_target" },
          candidateForecast: {
            id: "forecast_cwa_adequate",
            totalWave: { height: 1, period: 8, direction: null },
          },
        },
        {
          provider: "open-meteo",
          model: "ecmwf_wam",
          targetForecast: { id: "forecast_ecmwf_target" },
          candidateForecast: {
            id: "forecast_ecmwf_adequate",
            primarySwell: { height: 1, period: 10, direction: null },
          },
        },
      ],
    });
    expect(body.matches[0].sources[0].coverage).toBeCloseTo(1.35 / 2);
    expect(body.matches[0].sources[1].coverage).toBeCloseTo(2.25 / 3.45);
  });
});
