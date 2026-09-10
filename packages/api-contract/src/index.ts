import { z } from "zod";

const forecastCollectionSlotSchema = z.object({
  slotAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});

/** Public operational timestamps only; no provider responses or private logs. */
export const forecastCollectionStatusSchema = z.object({
  checkedAt: z.string().datetime(),
  near: forecastCollectionSlotSchema,
  far: forecastCollectionSlotSchema,
});
export type ForecastCollectionStatus = z.infer<typeof forecastCollectionStatusSchema>;

// Private account image from verified LINE claims; never part of public observations.
export const lineAvatarUrlSchema = z.string().url().startsWith("https://").max(2048);

// Diagnostic correlation only: never accepted as authentication or authorization.
export const authTraceSchema = z.string().regex(/^[a-f0-9]{32}$/);
export const authDisplayModeSchema = z.enum(["browser", "standalone", "unknown"]);
export const lineCompletionSchema = z.object({
  status: z.enum(["none", "pending", "ready", "expired", "failed", "cancelled", "capacity"]),
  traceId: authTraceSchema.optional(),
});
export type LineCompletion = z.infer<typeof lineCompletionSchema>;

export const CWA_FORECAST_INGESTION_CONTRACT = {
  version: "cwa-forecast-ingestion-v4",
  jsonSchemaSha256: "e09dbdb3ec07aa1d865cb2654181d5b7b2c6b42542cc308d0d9c936e9e5128f0",
  tideMappingSha256: "196d6e0a139fe9d2eab525232e801ef5613a01b1c064f2e28b273e2d4177eb4e",
} as const;

export const CWA_TIDE_LOCATION_IDS_V2 = [
  "O00400",
  "10002030",
  "O01200",
  "O01300",
  "B02400",
  "O00700",
] as const;

export const CWA_TIDE_LOCATION_BY_SPOT_ID_V2 = {
  "spot_wushi-harbor-north": "O00400",
  "spot_double-lions": "O00400",
  "spot_suao-wuwei-harbor": "10002030",
  "spot_daxi": "O01200",
  "spot_jinzun": "O01300",
  "spot_donghe": "O01300",
  "spot_yuguangdao": "B02400",
  "spot_nanwan": "O00700",
} as const satisfies Record<string, typeof CWA_TIDE_LOCATION_IDS_V2[number]>;

export const CWA_TIDE_LOCATION_IDS_V3 = [
  "10002040", "O00400", "10002030", "I02200", "I00900", "I00500",
  "O00700", "O00100", "I03800", "I06100", "10015010", "A00200",
  "10013330", "O01000", "10005020", "A01500",
] as const;

export const CWA_TIDE_LOCATION_BY_SPOT_ID_V3 = {
  "spot_wushi-harbor-north": "10002040",
  "spot_double-lions": "O00400",
  "spot_suao-wuwei-harbor": "10002030",
  "spot_daxi": "I02200",
  "spot_jinzun": "I00900",
  "spot_donghe": "I00900",
  "spot_yuguangdao": "I00500",
  "spot_nanwan": "O00700",
  "spot_zhongjiao-bay": "O00100",
  "spot_fulong": "I03800",
  "spot_environmental-park": "I06100",
  "spot_hualien-beibin": "10015010",
  "spot_jiqi": "A00200",
  "spot_jiupeng": "10013330",
  "spot_jialeshui": "O01000",
  "spot_songbai-harbor": "10005020",
  "spot_green-bay": "A01500",
  "spot_wanli": "A01500",
} as const satisfies Record<string, typeof CWA_TIDE_LOCATION_IDS_V3[number]>;

export const CWA_TIDE_LOCATION_IDS = [
  ...CWA_TIDE_LOCATION_IDS_V3,
  "I04100",
] as const;

export const CWA_TIDE_LOCATION_BY_SPOT_ID = {
  ...CWA_TIDE_LOCATION_BY_SPOT_ID_V3,
  "spot_waipu-fishing-harbor": "I04100",
} as const satisfies Record<string, typeof CWA_TIDE_LOCATION_IDS[number]>;

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
  peakPeriod: number | null;
}

export interface ForecastResponse {
  id: string;
  provider: string;
  model: string;
  sourceDisplayName: string;
  matchingRole: "active" | "collect-only";
  swellSemantics: "none" | "partitioned" | "total" | "unknown";
  snapshotKind: "forecast" | "historical_forecast";
  issuedAt: string;
  modelRunAt: string | null;
  validAt: string;
  leadHours: number | null;
  totalWave: ForecastMetricGroupResponse;
  totalSwell: ForecastMetricGroupResponse;
  primarySwell: ForecastMetricGroupResponse;
  secondarySwell: ForecastMetricGroupResponse;
  tertiarySwell: ForecastMetricGroupResponse;
  windWave: ForecastMetricGroupResponse;
  tide: {
    height: number | null;
    slope: number | null;
    state: string | null;
    sourceLocationId: string | null;
  };
  wind: { speed: number | null; direction: number | null; gust: number | null };
}

export interface CombinedMatchSourceResponse {
  provider: string;
  model: string;
  score: number;
  availableWeight: number;
  matchedWeight: number;
  coverage: number;
  swellPairing: Array<{
    target: "primary" | "secondary";
    candidate: "primary" | "secondary" | null;
  }>;
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
  diagnostic?: { traceId: string; emptyReason: "none" | "no_videos" | "missing_target" | "insufficient_history" };
  spot: { id: string; slug: string; name: string };
  targetTime: string;
  forecasts: ForecastResponse[];
  observations: ObservationResponse[];
  timeWindowObservations: ObservationResponse[];
  matches: CombinedMatchResponse[];
  ranking:
    | "equal-cwa-mfwam-composite-historical-forecast"
    | "mfwam-only-historical-forecast";
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
  searchTraceId: z.string().uuid().optional(),
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
export const forecastFreshnessResponseSchema = z.object({
  sources: z.array(z.object({
    name: z.enum(["CWA", "MFWAM"]), retrievedAt: z.iso.datetime().nullable(), stale: z.boolean(),
  })).max(2),
});
export type ForecastFreshnessResponse = z.infer<typeof forecastFreshnessResponseSchema>;
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

export const uploadDuplicateResponseSchema = z.object({
  error: z.literal("RECENT_DUPLICATE_UPLOAD"),
  message: z.string(),
  duplicate: z.object({ videoId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/) }),
});

export const uploadRequestSchema = z.object({
  spotId: z.string().min(1),
  capturedAt: z.string().datetime({ offset: true }),
  durationSeconds: z.number().min(MIN_VIDEO_DURATION_SECONDS).max(MAX_VIDEO_DURATION_SECONDS),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  fileName: z.string().min(1).max(255),
  contentType: z.string().startsWith("video/"),
  showUploader: z.boolean().optional(),
  // Client assertions for an advisory check, never proof of file ownership.
  fileSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

export const completeUploadSchema = z.object({
  providerVideoId: z.string().min(1),
});

export const updateVideoSchema = z.object({
  showUploader: z.boolean().optional(),
  isFavorite: z.boolean().optional(),
  uploaderNote: z.string().trim().max(100).nullable().optional(),
  funReaction: z.enum(["fun", "not_fun"]).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "至少提供一個更新欄位");

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

const cwaForecastIngestionSnapshotBaseSchema = z.object({
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
}).strict();

const cwaWaveProvenanceSchema = z.object({
  dataset: z.literal("F-A0020-001"),
  identifiers: cwaWaveIdentifiersSchema,
}).strict();

const cwaTideProvenanceV1Schema = z.object({
  dataset: z.literal("F-A0021-001"),
  locationId: z.literal("O00400"),
  datum: z.literal("AboveLocalMSL"),
  units: z.literal("m"),
  interpolation: z.literal("half-cosine-between-adjacent-extrema"),
}).strict();

const cwaTideProvenanceV2Schema = z.object({
  dataset: z.literal("F-A0021-001"),
  locationId: z.enum(CWA_TIDE_LOCATION_IDS_V2),
  datum: z.literal("AboveLocalMSL"),
  units: z.literal("m"),
  interpolation: z.literal("half-cosine-between-adjacent-extrema"),
}).strict();

const cwaTideProvenanceV3Schema = z.object({
  dataset: z.literal("F-A0021-001"),
  locationId: z.enum(CWA_TIDE_LOCATION_IDS_V3),
  datum: z.literal("AboveLocalMSL"),
  units: z.literal("m"),
  interpolation: z.literal("half-cosine-between-adjacent-extrema"),
}).strict();

const cwaTideProvenanceV4Schema = z.object({
  dataset: z.literal("F-A0021-001"),
  locationId: z.enum(CWA_TIDE_LOCATION_IDS),
  datum: z.literal("AboveLocalMSL"),
  units: z.literal("m"),
  interpolation: z.literal("half-cosine-between-adjacent-extrema"),
}).strict();

function hasCwaWaveMetric(snapshot: {
  waveHeight: number | null;
  waveDirection: number | null;
  wavePeriod: number | null;
}): boolean {
  return [snapshot.waveHeight, snapshot.waveDirection, snapshot.wavePeriod]
    .some((value) => value !== null);
}

export const cwaForecastIngestionV1SnapshotSchema = cwaForecastIngestionSnapshotBaseSchema.extend({
  provenance: z.object({
    wave: cwaWaveProvenanceSchema,
    tide: cwaTideProvenanceV1Schema.nullable(),
  }).strict(),
}).strict().refine(
  hasCwaWaveMetric,
  { message: "At least one CWA wave metric is required" },
);

export const cwaForecastIngestionV2SnapshotSchema = cwaForecastIngestionSnapshotBaseSchema.extend({
  provenance: z.object({
    wave: cwaWaveProvenanceSchema,
    tide: cwaTideProvenanceV2Schema.nullable(),
  }).strict(),
}).strict().refine(
  hasCwaWaveMetric,
  { message: "At least one CWA wave metric is required" },
);

export const cwaForecastIngestionV3SnapshotSchema = cwaForecastIngestionSnapshotBaseSchema.extend({
  provenance: z.object({
    wave: cwaWaveProvenanceSchema,
    tide: cwaTideProvenanceV3Schema.nullable(),
  }).strict(),
}).strict().refine(
  hasCwaWaveMetric,
  { message: "At least one CWA wave metric is required" },
);

export const cwaForecastIngestionSnapshotSchema = cwaForecastIngestionSnapshotBaseSchema.extend({
  provenance: z.object({
    wave: cwaWaveProvenanceSchema,
    tide: cwaTideProvenanceV4Schema.nullable(),
  }).strict(),
}).strict().refine(
  hasCwaWaveMetric,
  { message: "At least one CWA wave metric is required" },
);

export const cwaForecastIngestionV1BatchSchema = z.object({
  version: z.literal(1),
  snapshots: z.array(cwaForecastIngestionV1SnapshotSchema).min(1).max(5),
}).strict();

export const cwaForecastIngestionV2BatchSchema = z.object({
  version: z.literal(2),
  snapshots: z.array(cwaForecastIngestionV2SnapshotSchema).min(1).max(5),
}).strict();

export const cwaForecastIngestionV3BatchSchema = z.object({
  version: z.literal(3),
  snapshots: z.array(cwaForecastIngestionV3SnapshotSchema).min(1).max(5),
}).strict();

export const cwaForecastIngestionBatchSchema = z.object({
  version: z.literal(4),
  snapshots: z.array(cwaForecastIngestionSnapshotSchema).min(1).max(5),
}).strict();

export const acceptedCwaForecastIngestionBatchSchema = z.union([
  cwaForecastIngestionV1BatchSchema,
  cwaForecastIngestionV2BatchSchema,
  cwaForecastIngestionV3BatchSchema,
  cwaForecastIngestionBatchSchema,
]);

export const cwaForecastIngestionCompletionSchema = z.object({
  version: z.literal(1),
  provider: z.literal("cwa"),
  model: z.literal("cwa-wave-f-a0020-001"),
  issuedAt: z.string().datetime({ offset: true }),
  modelRunAt: z.string().datetime({ offset: true }),
}).strict();

export type ForecastIngestionSpot = z.infer<typeof forecastIngestionSpotSchema>;
export type CwaForecastIngestionSnapshot = z.infer<typeof cwaForecastIngestionSnapshotSchema>;
export type CwaForecastIngestionBatch = z.infer<typeof cwaForecastIngestionBatchSchema>;
export type AcceptedCwaForecastIngestionBatch = z.infer<typeof acceptedCwaForecastIngestionBatchSchema>;
export type AcceptedCwaForecastIngestionSnapshot = AcceptedCwaForecastIngestionBatch["snapshots"][number];
export type CwaForecastIngestionCompletion = z.infer<typeof cwaForecastIngestionCompletionSchema>;

export type UploadRequestInput = z.infer<typeof uploadRequestSchema>;
export type ProblemReportInput = z.infer<typeof problemReportSchema>;

export const clientDiagnosticSchema = z.object({
  traceId: z.string().uuid(),
  event: z.enum(["upload_step", "upload_failed", "playback_failed"]),
  details: z.object({
    stage: z.enum(["selection", "ticket", "transfer", "completion", "player", "sdk", "tracking"]),
    outcome: z.enum(["started", "success", "failed", "duplicate"]),
    durationMs: z.number().int().min(0).max(3_600_000),
    status: z.number().int().min(100).max(599).optional(),
    videoId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).optional(),
    version: z.string().regex(/^\d+\.\d+(?:\.\d+)?$/),
  }).strict(),
}).strict();
export type ClientDiagnostic = z.infer<typeof clientDiagnosticSchema>;

export const moderationDecisionSchema = z.object({
  reason: z.enum(["test", "no_violation", "privacy", "minor", "copyright", "irrelevant"]),
}).strict();
