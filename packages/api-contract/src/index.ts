import { z } from "zod";

export const CWA_FORECAST_INGESTION_CONTRACT = {
  version: "cwa-forecast-ingestion-v1",
  jsonSchemaSha256: "6316768333f715908074526c113f5ddf01a508d55dae93eb01032867575fac30",
} as const;

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

export interface CombinedMatchSourceResponse {
  provider: string;
  model: string;
  score: number;
  availableWeight: number;
  matchedWeight: number;
  coverage: number;
  targetForecast: ForecastResponse;
  candidateForecast: ForecastResponse;
}

export interface CombinedMatchResponse {
  score: number;
  availableWeight: number;
  matchedWeight: number;
  coverage: number;
  observation: ObservationResponse;
  sources: CombinedMatchSourceResponse[];
}

export interface PublicMatchesResponse {
  spot: { id: string; slug: string; name: string };
  targetTime: string;
  forecasts: ForecastResponse[];
  observations: ObservationResponse[];
  matches: CombinedMatchResponse[];
  ranking: "equal-provider-composite-historical-forecast";
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

export const forecastIngestionSpotSchema = z.object({
  id: z.string().min(1).max(100),
  slug: z.string().min(1).max(100),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
}).strict();

const cwaWaveIdentifiersSchema = z.object({
  hs: z.string().min(1).max(200).optional(),
  t: z.string().min(1).max(200).optional(),
  dir: z.string().min(1).max(200).optional(),
}).strict();

export const cwaForecastIngestionSnapshotSchema = z.object({
  spotId: z.string().min(1).max(100),
  provider: z.literal("cwa"),
  model: z.literal("cwa-wave-f-a0020-001"),
  issuedAt: z.string().datetime({ offset: true }),
  modelRunAt: z.string().datetime({ offset: true }),
  validAt: z.string().datetime({ offset: true }),
  leadHours: z.number().int().min(0).max(72).refine((value) => value % 3 === 0),
  gridLatitude: z.number().finite().min(-90).max(90).nullable(),
  gridLongitude: z.number().finite().min(-180).max(180).nullable(),
  waveHeight: z.number().finite().min(0).max(30).nullable(),
  waveDirection: z.number().finite().min(0).lt(360).nullable(),
  wavePeriod: z.number().finite().min(0).max(60).nullable(),
  tideHeight: z.number().finite().min(-20).max(20).nullable(),
  tideSlope: z.number().finite().min(-10).max(10).nullable(),
  tideState: z.enum(["rising", "falling", "high", "low"]).nullable(),
  provenance: z.object({
    wave: z.object({
      dataset: z.literal("F-A0020-001"),
      identifiers: cwaWaveIdentifiersSchema,
    }).strict(),
    tide: z.object({
      dataset: z.literal("F-A0021-001"),
      locationId: z.literal("O00400"),
      datum: z.literal("AboveLocalMSL"),
      units: z.literal("m"),
      interpolation: z.literal("half-cosine-between-adjacent-extrema"),
    }).strict().nullable(),
  }).strict(),
}).strict().refine(
  (snapshot) => [snapshot.waveHeight, snapshot.waveDirection, snapshot.wavePeriod]
    .some((value) => value !== null),
  { message: "At least one CWA wave metric is required" },
);

export const cwaForecastIngestionBatchSchema = z.object({
  version: z.literal(1),
  snapshots: z.array(cwaForecastIngestionSnapshotSchema).min(1).max(5),
}).strict();

export type ForecastIngestionSpot = z.infer<typeof forecastIngestionSpotSchema>;
export type CwaForecastIngestionSnapshot = z.infer<typeof cwaForecastIngestionSnapshotSchema>;
export type CwaForecastIngestionBatch = z.infer<typeof cwaForecastIngestionBatchSchema>;

export type UploadRequestInput = z.infer<typeof uploadRequestSchema>;
export type ProblemReportInput = z.infer<typeof problemReportSchema>;
