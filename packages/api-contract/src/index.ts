import { z } from "zod";

export interface ObservationConditionsResponse {
  waveHeight: number | null;
  waveDirection: number | null;
  wavePeriod: number | null;
  swellHeight: number | null;
  swellDirection: number | null;
  swellPeriod: number | null;
  secondarySwellHeight: number | null;
  secondarySwellDirection: number | null;
  secondarySwellPeriod: number | null;
  windWaveHeight: number | null;
  windWaveDirection: number | null;
  windWavePeriod: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  windGust: number | null;
  tideHeight: number | null;
  tideSlope: number | null;
  tideState: "rising" | "falling" | "high" | "low" | "unknown" | null;
}

export interface ObservationResponse {
  id: string;
  status: string;
  metadataStatus: "pending" | "complete";
  metadataExpiresAt: string | null;
  publicAt: string | null;
  capturedAt: string | null;
  createdAt: string;
  durationSeconds: number | null;
  uploaderDisplayId: string | null;
  uploaderNote: string | null;
  funReaction: "fun" | "not_fun" | null;
  license: "CC0-1.0" | null;
  termsVersion: string | null;
  moderationStatus?: "visible" | "delisted";
  delistedAt: string | null;
  isFavorite: boolean;
  showUploader?: boolean;
  playbackCount90d?: number;
  video: {
    provider: string;
    thumbnailUrl: string | null;
  };
  spot: {
    id: string;
    slug: string;
    name: string;
    nameEn: string;
  } | null;
  conditions: ObservationConditionsResponse;
  historicalForecasts?: ForecastResponse[];
}

export interface ForecastMetricGroupResponse {
  height: number | null;
  direction: number | null;
  period: number | null;
}

export interface ForecastResponse {
  id: string;
  provider: string;
  model: string;
  issuedAt: string;
  modelRunAt: string | null;
  validAt: string;
  leadHours: number | null;
  totalWave: ForecastMetricGroupResponse;
  primarySwell: ForecastMetricGroupResponse;
  secondarySwell: ForecastMetricGroupResponse;
  windWave: ForecastMetricGroupResponse;
  tide: { height: number | null; slope: number | null; state: string | null };
  wind: { speed: number | null; direction: number | null; gust: number | null };
}

export interface MatchGroupResponse {
  provider: string;
  model: string;
  targetForecast: ForecastResponse;
  observations: Array<{
    score: number;
    availableWeight: number;
    matchedWeight: number;
    coverage: number;
    candidateForecast: ForecastResponse;
    observation: ObservationResponse;
  }>;
}

export interface PublicMatchesResponse {
  spot: { id: string; slug: string; name: string };
  targetTime: string;
  forecasts: ForecastResponse[];
  observations: ObservationResponse[];
  matchesBySource: MatchGroupResponse[];
  ranking:
    | "provider-separated-historical-forecast"
    | "same-spot-recent-until-forecast-history-is-available";
}

export type PlaybackResponse =
  | {
      type: "iframe";
      iframeUrl: string;
      expiresAt: string;
      trackingToken: string;
      width: number | null;
      height: number | null;
    }
  | {
      type: "mock";
      iframeUrl: null;
      expiresAt: null;
      trackingToken: string;
      width: null;
      height: null;
    };

export interface VideoShareLinkResponse {
  path: string;
  expiresAt: string;
  anonymousPlayLimit: number;
  remainingAnonymousPlays: number;
}

export const sharedPlaybackSchema = z.object({
  shareToken: z.string().min(40).max(2_000),
});

export const playbackStartSchema = z.object({
  trackingToken: z.string().min(20).max(2_000),
});

export type VideoDownloadResponse =
  | {
      type: "download";
      state: "preparing";
      percentComplete: number | null;
      downloadUrl: null;
      expiresAt: null;
    }
  | {
      type: "download";
      state: "ready";
      percentComplete: 100;
      downloadUrl: string;
      expiresAt: string;
    }
  | {
      type: "mock";
      state: "ready";
      percentComplete: 100;
      downloadUrl: null;
      expiresAt: null;
    };

export const MAX_UPLOAD_BYTES = 200_000_000;
export const MIN_VIDEO_DURATION_SECONDS = 10;
export const MAX_VIDEO_DURATION_SECONDS = 60;

export const publicDisplayNameSchema = z.string()
  .trim()
  .min(2)
  .max(24)
  .regex(/^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+$/u, "公開名稱不可包含控制或隱藏格式字元");

export const updateMeSchema = z.object({
  displayId: publicDisplayNameSchema.nullable(),
  showIdentityDefault: z.boolean(),
});

export const uploadRequestSchema = z.object({
  spotId: z.string().min(1),
  capturedAt: z.string().datetime({ offset: true }).nullable().optional(),
  durationSeconds: z.number().min(MIN_VIDEO_DURATION_SECONDS).max(MAX_VIDEO_DURATION_SECONDS),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  fileName: z.string().min(1).max(255),
  contentType: z.string().startsWith("video/"),
  showUploader: z.boolean().optional(),
});

export const completeUploadSchema = z.object({
  providerVideoId: z.string().min(1),
});

export const updateVideoSchema = z.object({
  capturedAt: z.string().datetime({ offset: true }).nullable().optional(),
  showUploader: z.boolean().optional(),
  isFavorite: z.boolean().optional(),
  uploaderNote: z.string().trim().max(100).nullable().optional(),
  funReaction: z.enum(["fun", "not_fun"]).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, "至少提供一個更新欄位");

export const matchQuerySchema = z.object({
  spotId: z.string().min(1),
  targetTime: z.string().datetime({ offset: true }),
});

export const reportVideoSchema = z.object({
  reason: z.enum(["privacy", "minor", "copyright", "irrelevant"]),
});

export const problemReportSchema = z.object({
  message: z.string().trim().min(5).max(300),
  view: z.enum(["find", "upload", "mine"]),
});

export type UploadRequestInput = z.infer<typeof uploadRequestSchema>;
export type ProblemReportInput = z.infer<typeof problemReportSchema>;
