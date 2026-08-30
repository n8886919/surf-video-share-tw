import { describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  reportVideoSchema,
  problemReportSchema,
  updateMeSchema,
  updateVideoSchema,
  uploadRequestSchema,
} from "../packages/api-contract/src";
import { normalizeConditions } from "../packages/domain/src/conditions";
import { resolvePublicUploader } from "../packages/domain/src/identity";

describe("domain validation", () => {
  it("normalizes directions and keeps unavailable metrics null", () => {
    const normalized = normalizeConditions({
      waveHeight: null,
      waveDirection: 361,
      wavePeriod: 8,
      swellHeight: 1,
      swellDirection: -1,
      swellPeriod: 9,
      secondarySwellHeight: null,
      secondarySwellDirection: null,
      secondarySwellPeriod: null,
      windWaveHeight: null,
      windWaveDirection: null,
      windWavePeriod: null,
      windSpeed: Number.NaN,
      windDirection: 720,
      windGust: null,
      tideHeight: null,
      tideSlope: null,
      tideState: null,
      validTime: "2026-08-24T02:00:00.000Z",
      provider: "test",
      model: null,
      modelRunTime: null,
      retrievedAt: "2026-08-24T00:00:00.000Z",
      schemaVersion: 1,
    });
    expect(normalized.waveHeight).toBeNull();
    expect(normalized.waveDirection).toBe(1);
    expect(normalized.swellDirection).toBe(359);
    expect(normalized.windDirection).toBe(0);
    expect(normalized.windSpeed).toBeNull();
  });

  it("never exposes an identity when display ID is absent", () => {
    expect(resolvePublicUploader({ displayId: null, showIdentityDefault: true })).toBeNull();
    expect(resolvePublicUploader({ displayId: "sea-cat", showIdentityDefault: false }, true)).toBe("sea-cat");
    expect(resolvePublicUploader({ displayId: "sea-cat", showIdentityDefault: true }, false)).toBeNull();
  });

  it("rejects oversized, non-video, and long uploads at the contract boundary", () => {
    const base = {
      spotId: "spot_donghe",
      capturedAt: "2026-08-24T02:00:00.000Z",
      durationSeconds: 10,
      sizeBytes: 10_000,
      fileName: "surf.mp4",
      contentType: "video/mp4",
    };
    expect(uploadRequestSchema.safeParse(base).success).toBe(true);
    expect(uploadRequestSchema.safeParse({ ...base, durationSeconds: 9.9 }).success).toBe(false);
    expect(uploadRequestSchema.safeParse({ ...base, durationSeconds: 61 }).success).toBe(false);
    expect(uploadRequestSchema.safeParse({ ...base, sizeBytes: MAX_UPLOAD_BYTES }).success).toBe(true);
    expect(uploadRequestSchema.safeParse({ ...base, sizeBytes: MAX_UPLOAD_BYTES + 1 }).success).toBe(false);
    expect(uploadRequestSchema.safeParse({ ...base, contentType: "image/png" }).success).toBe(false);
  });

  it("accepts printable Unicode public names but rejects control characters", () => {
    expect(updateMeSchema.safeParse({ displayId: "浪人小明 🏄", showIdentityDefault: false }).success).toBe(true);
    expect(updateMeSchema.safeParse({ displayId: "浪\n人", showIdentityDefault: false }).success).toBe(false);
    expect(updateMeSchema.safeParse({ displayId: "浪\u200b人", showIdentityDefault: false }).success).toBe(false);
    expect(updateMeSchema.safeParse({ displayId: "浪", showIdentityDefault: false }).success).toBe(false);
  });

  it("requires a spot but allows capture time to remain pending", () => {
    expect(uploadRequestSchema.safeParse({
      spotId: "spot_donghe",
      capturedAt: null,
      durationSeconds: 10,
      sizeBytes: 10_000,
      fileName: "surf.mp4",
      contentType: "video/mp4",
    }).success).toBe(true);
    expect(uploadRequestSchema.safeParse({
      capturedAt: null,
      durationSeconds: 10,
      sizeBytes: 10_000,
      fileName: "surf.mp4",
      contentType: "video/mp4",
    }).success).toBe(false);
    expect(updateVideoSchema.safeParse({ spotId: "spot_other" }).success).toBe(false);
  });

  it("limits subjective input to one reaction and a 100-character supplement", () => {
    expect(updateVideoSchema.safeParse({ funReaction: "fun", uploaderNote: "分享一下" }).success).toBe(true);
    expect(updateVideoSchema.safeParse({ funReaction: "great" }).success).toBe(false);
    expect(updateVideoSchema.safeParse({ uploaderNote: "浪".repeat(101) }).success).toBe(false);
  });

  it("accepts only the fixed public report reasons", () => {
    expect(reportVideoSchema.safeParse({ reason: "privacy" }).success).toBe(true);
    expect(reportVideoSchema.safeParse({ reason: "bad_waves" }).success).toBe(false);
  });

  it("accepts a concise problem report with only a known page context", () => {
    expect(problemReportSchema.safeParse({ message: "播放按鈕沒有反應", view: "find" }).success).toBe(true);
    expect(problemReportSchema.safeParse({ message: "太短", view: "find" }).success).toBe(false);
    expect(problemReportSchema.safeParse({ message: "浪".repeat(301), view: "find" }).success).toBe(false);
    expect(problemReportSchema.safeParse({ message: "播放按鈕沒有反應", view: "admin" }).success).toBe(false);
  });
});
