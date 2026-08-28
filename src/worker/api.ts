import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  completeUploadSchema,
  MAX_UPLOAD_BYTES,
  matchQuerySchema,
  problemReportSchema,
  reportVideoSchema,
  updateMeSchema,
  updateVideoSchema,
  uploadRequestSchema,
  type ForecastResponse,
  type ObservationResponse,
  type PlaybackResponse,
  type PublicMatchesResponse,
  type VideoDownloadResponse,
} from "../../packages/api-contract/src";
import {
  assertWithinForecastWindow,
  assertWithinUploadWindow,
  PUBLIC_MEDIA_LICENSE,
  PUBLIC_MEDIA_TERMS_VERSION,
  rankSimilarConditions,
  type MarineConditions,
  type TideState,
} from "../../packages/domain/src";
import {
  ensureDevelopmentDatabase,
  type AppEnv,
  type SpotRow,
  type UserRow,
} from "./db";
import { createVideoProvider } from "./providers";
import { attachConditionsBestEffort } from "./enrichment";
import {
  beginLineLogin,
  finishLineLogin,
  getAuthenticatedUser,
  isLineAuthConfigured,
  logout,
} from "./auth";
import { cleanupExpiredPendingVideos } from "./video-lifecycle";
import { resolveVideoStatus } from "./video-status";

type Variables = { user: UserRow; authMode: "development" | "line" };

const RATE_LIMIT_RETRY_SECONDS = 60;

function rateLimitResponse(error: "RATE_LIMITED" | "RATE_LIMIT_UNAVAILABLE", message: string, status: 429 | 503) {
  return new Response(JSON.stringify({ error, message }), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
      ...(status === 429 ? { "retry-after": String(RATE_LIMIT_RETRY_SECONDS) } : {}),
    },
  });
}

async function enforceRateLimit(
  env: AppEnv,
  limiter: RateLimit | undefined,
  key: string,
): Promise<Response | null> {
  if (!limiter) {
    if (env.APP_ENV === "development") return null;
    console.error("Required rate-limit binding is missing");
    return rateLimitResponse("RATE_LIMIT_UNAVAILABLE", "目前暫時無法處理這個請求", 503);
  }
  try {
    const result = await limiter.limit({ key });
    return result.success
      ? null
      : rateLimitResponse("RATE_LIMITED", "操作太頻繁，請稍後再試", 429);
  } catch (error) {
    console.error("Rate-limit check failed", error);
    return rateLimitResponse("RATE_LIMIT_UNAVAILABLE", "目前暫時無法處理這個請求", 503);
  }
}

async function anonymousClientKey(request: Request, env: AppEnv): Promise<string | null> {
  const clientAddress = request.headers.get("cf-connecting-ip");
  if (!clientAddress || !env.SESSION_SECRET) {
    return env.APP_ENV === "development" ? "development-client" : null;
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(clientAddress));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface ObservationRow {
  id: string;
  status: string;
  metadata_status: string;
  metadata_expires_at: string | null;
  public_at: string | null;
  captured_at: string | null;
  created_at: string;
  duration_seconds: number | null;
  show_uploader: number;
  is_favorite: number;
  uploader_note: string | null;
  fun_reaction: string | null;
  terms_version: string | null;
  moderation_status: string;
  delisted_at: string | null;
  provider_video_id: string;
  video_provider: string;
  spot_id: string | null;
  spot_slug: string | null;
  spot_name_en: string | null;
  spot_name_zh: string | null;
  display_id: string | null;
  wave_height: number | null;
  wave_direction: number | null;
  wave_period: number | null;
  swell_height: number | null;
  swell_direction: number | null;
  swell_period: number | null;
  secondary_swell_height: number | null;
  secondary_swell_direction: number | null;
  secondary_swell_period: number | null;
  wind_wave_height: number | null;
  wind_wave_direction: number | null;
  wind_wave_period: number | null;
  wind_speed: number | null;
  wind_direction: number | null;
  wind_gust: number | null;
  tide_height: number | null;
  tide_slope: number | null;
  tide_state: string | null;
}

interface ForecastRow {
  id: string;
  provider: string;
  model: string;
  issued_at: string;
  model_run_at: string | null;
  valid_at: string;
  lead_hours: number | null;
  wave_height: number | null;
  wave_direction: number | null;
  wave_period: number | null;
  swell_height: number | null;
  swell_direction: number | null;
  swell_period: number | null;
  secondary_swell_height: number | null;
  secondary_swell_direction: number | null;
  secondary_swell_period: number | null;
  wind_wave_height: number | null;
  wind_wave_direction: number | null;
  wind_wave_period: number | null;
  tide_height: number | null;
  tide_slope: number | null;
  tide_state: string | null;
  wind_speed: number | null;
  wind_direction: number | null;
  wind_gust: number | null;
}

interface HistoricalForecastRow extends ForecastRow {
  historical_video_id: string;
}

interface PublicVideoRow {
  id: string;
  provider_video_id: string;
  video_provider: string;
}

interface ReportRow {
  id: string;
  video_id: string;
  reason: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  spot_name_en: string | null;
  spot_name_zh: string | null;
  captured_at: string | null;
  uploader_note: string | null;
}

const observationSelect = `
  SELECT
    v.id, v.status, v.metadata_status, v.metadata_expires_at, v.public_at,
    v.captured_at, v.created_at, v.duration_seconds, v.show_uploader,
    v.is_favorite, v.uploader_note, v.fun_reaction, v.terms_version,
    v.moderation_status, v.delisted_at, v.provider_video_id, v.video_provider,
    v.spot_id, s.slug AS spot_slug, s.name_en AS spot_name_en,
    s.name_zh AS spot_name_zh, u.display_id,
    c.wave_height, c.wave_direction, c.wave_period,
    c.swell_height, c.swell_direction, c.swell_period,
    c.secondary_swell_height, c.secondary_swell_direction, c.secondary_swell_period,
    c.wind_wave_height, c.wind_wave_direction, c.wind_wave_period,
    c.wind_speed, c.wind_direction, c.wind_gust,
    c.tide_height, c.tide_slope, c.tide_state
  FROM videos v
  LEFT JOIN spots s ON s.id = v.spot_id
  JOIN users u ON u.id = v.user_id
  LEFT JOIN condition_snapshots c ON c.id = v.condition_snapshot_id`;

function serializeObservation(row: ObservationRow, ownerView = false): ObservationResponse {
  const hasPublicThumbnail = row.status === "ready"
    && row.metadata_status === "complete"
    && row.public_at !== null
    && row.terms_version !== null
    && row.moderation_status === "visible";
  return {
    id: row.id,
    status: row.status,
    metadataStatus: row.metadata_status === "complete" ? "complete" : "pending",
    metadataExpiresAt: ownerView ? row.metadata_expires_at : null,
    publicAt: row.public_at,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
    durationSeconds: row.duration_seconds,
    uploaderDisplayId: row.show_uploader ? row.display_id : null,
    uploaderNote: row.uploader_note,
    funReaction: row.fun_reaction === "fun" || row.fun_reaction === "not_fun"
      ? row.fun_reaction
      : null,
    license: row.terms_version ? PUBLIC_MEDIA_LICENSE : null,
    termsVersion: row.terms_version,
    moderationStatus: ownerView
      ? row.moderation_status === "delisted" ? "delisted" : "visible"
      : undefined,
    delistedAt: ownerView ? row.delisted_at : null,
    isFavorite: ownerView ? Boolean(row.is_favorite) : false,
    showUploader: ownerView ? Boolean(row.show_uploader) : undefined,
    video: {
      provider: row.video_provider,
      thumbnailUrl: hasPublicThumbnail
        ? `/api/v1/videos/${encodeURIComponent(row.id)}/thumbnail`
        : null,
    },
    spot: row.spot_id && row.spot_slug && row.spot_name_en
      ? {
          id: row.spot_id,
          slug: row.spot_slug,
          name: row.spot_name_zh || row.spot_name_en,
          nameEn: row.spot_name_en,
        }
      : null,
    conditions: {
      waveHeight: row.wave_height,
      waveDirection: row.wave_direction,
      wavePeriod: row.wave_period,
      swellHeight: row.swell_height,
      swellDirection: row.swell_direction,
      swellPeriod: row.swell_period,
      secondarySwellHeight: row.secondary_swell_height,
      secondarySwellDirection: row.secondary_swell_direction,
      secondarySwellPeriod: row.secondary_swell_period,
      windWaveHeight: row.wind_wave_height,
      windWaveDirection: row.wind_wave_direction,
      windWavePeriod: row.wind_wave_period,
      windSpeed: row.wind_speed,
      windDirection: row.wind_direction,
      windGust: row.wind_gust,
      tideHeight: row.tide_height,
      tideSlope: row.tide_slope,
      tideState: toTideState(row.tide_state),
    },
  };
}

function isAdmin(env: AppEnv, user: UserRow): boolean {
  return Boolean(env.ADMIN_USER_ID) && env.ADMIN_USER_ID === user.id;
}

function serializeForecast(row: ForecastRow): ForecastResponse {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    issuedAt: row.issued_at,
    modelRunAt: row.model_run_at,
    validAt: row.valid_at,
    leadHours: row.lead_hours,
    totalWave: { height: row.wave_height, direction: row.wave_direction, period: row.wave_period },
    primarySwell: { height: row.swell_height, direction: row.swell_direction, period: row.swell_period },
    secondarySwell: { height: row.secondary_swell_height, direction: row.secondary_swell_direction, period: row.secondary_swell_period },
    windWave: { height: row.wind_wave_height, direction: row.wind_wave_direction, period: row.wind_wave_period },
    tide: { height: row.tide_height, slope: row.tide_slope, state: row.tide_state },
    wind: { speed: row.wind_speed, direction: row.wind_direction, gust: row.wind_gust },
  };
}

function toTideState(value: string | null): TideState | null {
  return value === "rising" || value === "falling" || value === "high" || value === "low" || value === "unknown"
    ? value
    : null;
}

function forecastConditions(row: ForecastRow): MarineConditions {
  return {
    waveHeight: row.wave_height,
    waveDirection: row.wave_direction,
    wavePeriod: row.wave_period,
    swellHeight: row.swell_height,
    swellDirection: row.swell_direction,
    swellPeriod: row.swell_period,
    secondarySwellHeight: row.secondary_swell_height,
    secondarySwellDirection: row.secondary_swell_direction,
    secondarySwellPeriod: row.secondary_swell_period,
    windWaveHeight: row.wind_wave_height,
    windWaveDirection: row.wind_wave_direction,
    windWavePeriod: row.wind_wave_period,
    windSpeed: row.wind_speed,
    windDirection: row.wind_direction,
    windGust: row.wind_gust,
    tideHeight: row.tide_height,
    tideSlope: row.tide_slope,
    tideState: toTideState(row.tide_state),
    validTime: row.valid_at,
    provider: row.provider,
    model: row.model,
    modelRunTime: row.model_run_at,
    retrievedAt: row.issued_at,
    schemaVersion: 1,
  };
}

async function findOwnedObservation(env: AppEnv, videoId: string, userId: string) {
  return env.DB.prepare(`${observationSelect} WHERE v.id = ? AND v.user_id = ?`)
    .bind(videoId, userId)
    .first<ObservationRow>();
}

async function findActiveSpot(env: AppEnv, spotId: string | null | undefined) {
  if (!spotId) return null;
  return env.DB.prepare(
    `SELECT id, slug, name_en, name_zh, region, latitude, longitude
     FROM spots WHERE id = ? AND active = 1`,
  ).bind(spotId).first<SpotRow>();
}

async function cleanupOwnerExpiredVideos(env: AppEnv, userId: string) {
  try {
    const summary = await cleanupExpiredPendingVideos(env, new Date(), { userId, limit: 10 });
    if (summary.failed) {
      console.warn("Expired pending video cleanup had failures", summary.failures);
    }
  } catch (error) {
    console.warn("Expired pending video cleanup is unavailable", error);
  }
}

interface ProblemReportRow {
  id: string;
  message: string;
  view: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
}

async function findPublicVideo(env: AppEnv, videoId: string): Promise<PublicVideoRow | null> {
  return env.DB.prepare(
    `SELECT id, provider_video_id, video_provider FROM videos
     WHERE id = ? AND metadata_status = 'complete' AND status = 'ready'
       AND public_at IS NOT NULL AND terms_version IS NOT NULL
       AND moderation_status = 'visible'`,
  ).bind(videoId).first<PublicVideoRow>();
}

async function reconcileOwnerProcessingVideos(env: AppEnv, userId: string) {
  const pending = await env.DB.prepare(
    `SELECT id, provider_video_id, video_provider, duration_seconds,
            metadata_status, public_at, terms_version, moderation_status FROM videos
     WHERE user_id = ? AND status IN ('pending', 'processing') LIMIT 5`,
  ).bind(userId).all<{
    id: string;
    provider_video_id: string;
    video_provider: "mock" | "cloudflare-stream";
    duration_seconds: number | null;
    metadata_status: string;
    public_at: string | null;
    terms_version: string | null;
    moderation_status: string;
  }>();
  if (!pending.results.length) return;
  let provider: ReturnType<typeof createVideoProvider>;
  try {
    provider = createVideoProvider(env);
  } catch (error) {
    console.warn("Video status reconciliation is unavailable", error);
    return;
  }
  for (const video of pending.results) {
    try {
      if (provider.provider !== video.video_provider) {
        console.warn("Video status reconciliation skipped provider mismatch", video.id);
        continue;
      }
      const status = await provider.getStatus(video.provider_video_id);
      const resolved = resolveVideoStatus(provider.provider, status, video.duration_seconds);
      const now = new Date().toISOString();
      const publicAt = video.metadata_status === "complete"
        && video.terms_version
        && video.moderation_status === "visible"
        && resolved.canPublish
        ? video.public_at ?? now
        : null;
      await env.DB.prepare(
        `UPDATE videos SET status = ?, duration_seconds = COALESCE(?, duration_seconds),
         public_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      ).bind(resolved.state, resolved.durationSeconds, publicAt, now, video.id, userId).run();
    } catch (error) {
      console.warn("Video status reconciliation failed", video.id, error);
    }
  }
}

export const api = new Hono<{ Bindings: AppEnv; Variables: Variables }>()
  .basePath("/api/v1");

api.get("/health", (context) => context.json({ ok: true }));
api.get("/auth/line", (context) => beginLineLogin(context.env));
api.get("/auth/line/callback", (context) => finishLineLogin(context.req.raw, context.env));
api.post("/auth/logout", (context) => logout(context.req.raw, context.env));

api.get("/spots", async (context) => {
  await ensureDevelopmentDatabase(context.env);
  const result = await context.env.DB.prepare(
    `SELECT id, slug, name_en, name_zh, region, latitude, longitude
     FROM spots WHERE active = 1 ORDER BY name_en`,
  ).all<SpotRow>();
  return context.json({
    spots: result.results.map((spot) => ({
      id: spot.id,
      slug: spot.slug,
      name: spot.name_zh || spot.name_en,
      nameEn: spot.name_en,
      nameZh: spot.name_zh,
      region: spot.region,
      latitude: spot.latitude,
      longitude: spot.longitude,
    })),
  });
});

api.post("/problem-reports", zValidator("json", problemReportSchema), async (context) => {
  await ensureDevelopmentDatabase(context.env);
  const clientKey = await anonymousClientKey(context.req.raw, context.env);
  if (!clientKey) {
    console.error("Problem-report rate-limit client key is unavailable");
    return rateLimitResponse("RATE_LIMIT_UNAVAILABLE", "目前暫時無法送出問題回報", 503);
  }
  const limited = await enforceRateLimit(
    context.env,
    context.env.PROBLEM_REPORT_RATE_LIMITER,
    clientKey,
  );
  if (limited) return limited;

  const input = context.req.valid("json");
  const reportId = crypto.randomUUID();
  await context.env.DB.prepare(
    `INSERT INTO problem_reports (id, message, view, status, created_at)
     VALUES (?, ?, ?, 'open', ?)`,
  ).bind(reportId, input.message, input.view, new Date().toISOString()).run();
  return context.json({ reportId, status: "open" }, 201);
});

api.post("/videos/:id/reports", zValidator("json", reportVideoSchema), async (context) => {
  await ensureDevelopmentDatabase(context.env);
  const video = await context.env.DB.prepare(
    `SELECT id FROM videos
     WHERE id = ? AND metadata_status = 'complete' AND status = 'ready'
       AND public_at IS NOT NULL AND terms_version IS NOT NULL
       AND moderation_status = 'visible'`,
  ).bind(context.req.param("id")).first<{ id: string }>();
  if (!video) return context.json({ error: "VIDEO_NOT_FOUND", message: "找不到公開影片" }, 404);

  const input = context.req.valid("json");
  const reportId = crypto.randomUUID();
  await context.env.DB.prepare(
    `INSERT INTO video_reports (id, video_id, reason, status, created_at)
     VALUES (?, ?, ?, 'open', ?)`,
  ).bind(reportId, video.id, input.reason, new Date().toISOString()).run();
  return context.json({ reportId, status: "open" }, 201);
});

api.get("/videos/:id/thumbnail", async (context) => {
  await ensureDevelopmentDatabase(context.env);
  const video = await findPublicVideo(context.env, context.req.param("id"));
  if (!video) return context.json({ error: "VIDEO_NOT_FOUND", message: "找不到公開影片" }, 404);

  try {
    const provider = createVideoProvider(context.env);
    if (provider.provider !== video.video_provider) {
      return context.json({ error: "VIDEO_PROVIDER_MISMATCH", message: "影片縮圖暫時無法使用" }, 503);
    }
    const thumbnailUrl = await provider.getThumbnailUrl(video.provider_video_id);
    if (!thumbnailUrl) {
      return context.json({ error: "THUMBNAIL_UNAVAILABLE", message: "影片縮圖尚未提供" }, 404);
    }
    const redirectTarget = new URL(thumbnailUrl, context.req.url);
    if (redirectTarget.protocol !== "https:" && redirectTarget.protocol !== "http:") {
      throw new Error("Video provider returned an invalid thumbnail URL");
    }
    return new Response(null, {
      status: 302,
      headers: {
        location: redirectTarget.toString(),
        "cache-control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.warn("Public video thumbnail lookup failed", video.id, error);
    return context.json({ error: "THUMBNAIL_UNAVAILABLE", message: "影片縮圖暫時無法使用" }, 503);
  }
});

api.post("/videos/:id/playback", async (context) => {
  await ensureDevelopmentDatabase(context.env);
  const video = await findPublicVideo(context.env, context.req.param("id"));
  if (!video) return context.json({ error: "VIDEO_NOT_FOUND", message: "找不到公開影片" }, 404);

  const clientKey = await anonymousClientKey(context.req.raw, context.env);
  if (!clientKey) {
    console.error("Playback rate-limit client key is unavailable");
    return rateLimitResponse("RATE_LIMIT_UNAVAILABLE", "目前暫時無法處理這個請求", 503);
  }
  const limited = await enforceRateLimit(context.env, context.env.PLAYBACK_RATE_LIMITER, clientKey);
  if (limited) return limited;

  try {
    const provider = createVideoProvider(context.env);
    if (provider.provider !== video.video_provider) {
      return context.json({ error: "VIDEO_PROVIDER_MISMATCH", message: "影片播放暫時無法使用" }, 503);
    }
    const playback: PlaybackResponse = await provider.createPlayback(video.provider_video_id);
    return context.json(playback, 200, { "cache-control": "no-store" });
  } catch (error) {
    console.warn("Public video playback creation failed", video.id, error);
    return context.json({ error: "PLAYBACK_UNAVAILABLE", message: "影片播放暫時無法使用" }, 503);
  }
});

api.get("/matches", zValidator("query", matchQuerySchema), async (context) => {
  await ensureDevelopmentDatabase(context.env);
  const input = context.req.valid("query");
  const spot = await findActiveSpot(context.env, input.spotId);
  if (!spot) return context.json({ error: "SPOT_NOT_FOUND", message: "找不到浪點" }, 404);
  try {
    assertWithinForecastWindow(input.targetTime);
  } catch {
    return context.json({ error: "TARGET_OUT_OF_RANGE", message: "請選擇現在至未來 72 小時內的時間" }, 422);
  }
  const now = new Date().toISOString();

  const [forecastResult, videoResult, historyResult] = await Promise.all([
    context.env.DB.prepare(
      `SELECT * FROM (
         SELECT fs.*,
           ABS(strftime('%s', valid_at) - strftime('%s', ?)) AS valid_distance_seconds,
           ROW_NUMBER() OVER (
           PARTITION BY provider, model
           ORDER BY issued_at DESC,
             ABS(strftime('%s', valid_at) - strftime('%s', ?)), id
         ) AS source_rank
         FROM forecast_snapshots fs
         WHERE spot_id = ? AND issued_at <= ?
           AND ABS(strftime('%s', valid_at) - strftime('%s', ?)) <= 14400
       ) WHERE source_rank = 1 LIMIT 8`,
    ).bind(input.targetTime, input.targetTime, spot.id, now, input.targetTime).all<ForecastRow>(),
    context.env.DB.prepare(
      `${observationSelect}
       WHERE v.spot_id = ? AND v.metadata_status = 'complete'
         AND v.public_at IS NOT NULL AND v.status = 'ready'
         AND v.terms_version IS NOT NULL AND v.moderation_status = 'visible'
       ORDER BY v.captured_at DESC LIMIT 20`,
    ).bind(spot.id).all<ObservationRow>(),
    context.env.DB.prepare(
      `WITH candidate_videos AS (
         SELECT id, captured_at FROM videos
         WHERE spot_id = ? AND metadata_status = 'complete'
           AND public_at IS NOT NULL AND status = 'ready'
           AND terms_version IS NOT NULL AND moderation_status = 'visible'
         ORDER BY captured_at DESC LIMIT 20
       ), ranked_history AS (
         SELECT fs.*, candidate_videos.id AS historical_video_id,
           ROW_NUMBER() OVER (
             PARTITION BY candidate_videos.id, fs.provider, fs.model
             ORDER BY fs.issued_at DESC,
               ABS(strftime('%s', fs.valid_at) - strftime('%s', candidate_videos.captured_at)),
               fs.id
           ) AS historical_rank
         FROM candidate_videos
         JOIN forecast_snapshots fs ON fs.spot_id = ?
         WHERE fs.issued_at <= candidate_videos.captured_at
           AND ABS(strftime('%s', fs.valid_at) - strftime('%s', candidate_videos.captured_at)) <= 14400
       )
       SELECT * FROM ranked_history WHERE historical_rank = 1`,
    ).bind(spot.id, spot.id).all<HistoricalForecastRow>(),
  ]);

  const observationById = new Map(videoResult.results.map((row) => [row.id, row]));
  const historicalByVideoAndSource = new Map(historyResult.results.map((row) => [
    `${row.historical_video_id}:${row.provider}:${row.model}`,
    row,
  ]));
  const matchesBySource = forecastResult.results.map((targetForecast) => {
    const candidates = videoResult.results.flatMap((video) => {
      const historical = historicalByVideoAndSource.get(
        `${video.id}:${targetForecast.provider}:${targetForecast.model}`,
      );
      return historical ? [{ id: video.id, conditions: forecastConditions(historical) }] : [];
    });
    return {
      provider: targetForecast.provider,
      model: targetForecast.model,
      targetForecast: serializeForecast(targetForecast),
      observations: rankSimilarConditions(forecastConditions(targetForecast), candidates)
        .map((match) => {
          const historicalForecast = historicalByVideoAndSource.get(
            `${match.id}:${targetForecast.provider}:${targetForecast.model}`,
          )!;
          return {
            score: match.score,
            availableWeight: match.availableWeight,
            matchedWeight: match.matchedWeight,
            coverage: match.coverage,
            candidateForecast: serializeForecast(historicalForecast),
            observation: serializeObservation(observationById.get(match.id)!),
          };
        }),
    };
  }).filter((group) => group.observations.length > 0);

  const response: PublicMatchesResponse = {
    spot: { id: spot.id, slug: spot.slug, name: spot.name_zh || spot.name_en },
    targetTime: input.targetTime,
    forecasts: forecastResult.results.map(serializeForecast),
    observations: videoResult.results.map((row) => serializeObservation(row)),
    matchesBySource,
    ranking: matchesBySource.length
      ? "provider-separated-historical-forecast"
      : "same-spot-recent-until-forecast-history-is-available",
  };
  return context.json(response);
});

api.use("*", async (context, next) => {
  await ensureDevelopmentDatabase(context.env);
  const authenticated = await getAuthenticatedUser(context.req.raw, context.env);
  if (!authenticated) {
    const configured = isLineAuthConfigured(context.env);
    return context.json(
      configured
        ? { error: "UNAUTHENTICATED", message: "請先使用 LINE 登入" }
        : { error: "AUTH_NOT_CONFIGURED", message: "目前尚未完成 LINE Login 部署設定" },
      configured ? 401 : 503,
    );
  }
  context.set("user", authenticated.user);
  context.set("authMode", authenticated.authMode);
  await next();
});

api.get("/me", (context) => {
  const user = context.get("user");
  return context.json({
    id: user.id,
    suggestedDisplayName: user.line_display_name,
    displayId: user.display_id,
    showIdentityDefault: Boolean(user.show_identity_default),
    authMode: context.get("authMode"),
    isAdmin: isAdmin(context.env, user),
  });
});

api.patch("/me", zValidator("json", updateMeSchema), async (context) => {
  const user = context.get("user");
  const input = context.req.valid("json");
  const now = new Date().toISOString();
  await context.env.DB.prepare(
    `UPDATE users SET display_id = ?, show_identity_default = ?, updated_at = ? WHERE id = ?`,
  ).bind(input.displayId, input.showIdentityDefault ? 1 : 0, now, user.id).run();
  return context.json({ id: user.id, displayId: input.displayId, showIdentityDefault: input.showIdentityDefault });
});

api.get("/videos", async (context) => {
  const user = context.get("user");
  await cleanupOwnerExpiredVideos(context.env, user.id);
  await reconcileOwnerProcessingVideos(context.env, user.id);
  const result = await context.env.DB.prepare(
    `${observationSelect} WHERE v.user_id = ?
     ORDER BY COALESCE(v.captured_at, v.created_at) DESC LIMIT 50`,
  ).bind(user.id).all<ObservationRow>();
  return context.json({ observations: result.results.map((row) => serializeObservation(row, true)) });
});

api.post("/videos/:id/download", async (context) => {
  const user = context.get("user");
  const video = await context.env.DB.prepare(
    `SELECT id, provider_video_id, video_provider FROM videos
     WHERE id = ? AND user_id = ?
       AND metadata_status = 'complete' AND status = 'ready'
       AND public_at IS NOT NULL AND terms_version IS NOT NULL
       AND moderation_status = 'visible'`,
  ).bind(context.req.param("id"), user.id).first<PublicVideoRow>();
  if (!video) {
    return context.json({ error: "VIDEO_NOT_DOWNLOADABLE", message: "這段影片目前不能下載" }, 404);
  }

  const limited = await enforceRateLimit(context.env, context.env.DOWNLOAD_RATE_LIMITER, user.id);
  if (limited) return limited;

  try {
    const provider = createVideoProvider(context.env);
    if (provider.provider !== video.video_provider) {
      return context.json({ error: "VIDEO_PROVIDER_MISMATCH", message: "影片下載目前無法使用" }, 503);
    }
    const download: VideoDownloadResponse = await provider.prepareDownload(video.provider_video_id);
    return context.json(download, download.state === "preparing" ? 202 : 200, {
      "cache-control": "no-store",
    });
  } catch (error) {
    console.warn("Owner video download preparation failed", video.id, error);
    return context.json({ error: "DOWNLOAD_UNAVAILABLE", message: "影片下載目前無法使用" }, 503);
  }
});

api.post("/videos/upload-request", zValidator("json", uploadRequestSchema), async (context) => {
  const user = context.get("user");
  const input = context.req.valid("json");
  const capturedAt = input.capturedAt ?? null;
  if (capturedAt) assertWithinUploadWindow(capturedAt);
  const spot = await findActiveSpot(context.env, input.spotId);
  if (input.spotId && !spot) return context.json({ error: "SPOT_NOT_FOUND", message: "找不到浪點" }, 404);

  const limited = await enforceRateLimit(context.env, context.env.UPLOAD_RATE_LIMITER, user.id);
  if (limited) return limited;

  const provider = createVideoProvider(context.env);
  const ticket = await provider.createDirectUpload({ internalUserId: user.id, maxDurationSeconds: 60 });
  const id = crypto.randomUUID();
  const now = new Date();
  const complete = Boolean(spot && capturedAt);
  const showUploader = input.showUploader ?? Boolean(user.show_identity_default);
  await context.env.DB.prepare(
    `INSERT INTO videos (
      id, user_id, spot_id, video_provider, provider_video_id, captured_at,
      duration_seconds, status, show_uploader, metadata_status,
      metadata_expires_at, is_favorite, terms_version, moderation_status,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    user.id,
    spot?.id ?? null,
    ticket.provider,
    ticket.providerVideoId,
    capturedAt,
    input.durationSeconds,
    "awaiting_upload",
    showUploader ? 1 : 0,
    complete ? "complete" : "pending",
    complete ? null : new Date(now.getTime() + 7 * 24 * 60 * 60_000).toISOString(),
    0,
    PUBLIC_MEDIA_TERMS_VERSION,
    "visible",
    now.toISOString(),
    now.toISOString(),
  ).run();
  return context.json({ videoId: id, ...ticket, metadataStatus: complete ? "complete" : "pending", limits: { maxBytes: MAX_UPLOAD_BYTES, maxDurationSeconds: 60 } }, 201);
});

api.post("/videos/:id/complete", zValidator("json", completeUploadSchema), async (context) => {
  const user = context.get("user");
  const input = context.req.valid("json");
  const video = await context.env.DB.prepare(
    `SELECT v.id, v.provider_video_id, v.captured_at, v.duration_seconds,
            v.metadata_status, v.condition_snapshot_id, v.public_at,
            v.terms_version, v.moderation_status,
            s.latitude, s.longitude
     FROM videos v LEFT JOIN spots s ON s.id = v.spot_id
     WHERE v.id = ? AND v.user_id = ?`,
  ).bind(context.req.param("id"), user.id).first<{
    id: string;
    provider_video_id: string;
    captured_at: string | null;
    duration_seconds: number | null;
    metadata_status: string;
    condition_snapshot_id: string | null;
    public_at: string | null;
    terms_version: string | null;
    moderation_status: string;
    latitude: number | null;
    longitude: number | null;
  }>();
  if (!video) return context.json({ error: "VIDEO_NOT_FOUND", message: "找不到影片" }, 404);
  if (video.provider_video_id !== input.providerVideoId) {
    return context.json({ error: "UPLOAD_MISMATCH", message: "上傳識別碼不相符" }, 409);
  }

  const provider = createVideoProvider(context.env);
  const status = await provider.getStatus(input.providerVideoId);
  const resolved = resolveVideoStatus(provider.provider, status, video.duration_seconds);
  if (resolved.invalidDuration || resolved.durationSeconds == null) {
    return context.json({ error: "INVALID_DURATION", message: "影片長度必須為 5–60 秒" }, 422);
  }

  let conditionSnapshotId: string | null = null;
  if (!video.condition_snapshot_id && video.captured_at && video.latitude != null && video.longitude != null) {
    conditionSnapshotId = await attachConditionsBestEffort(context.env, {
      latitude: video.latitude,
      longitude: video.longitude,
      validTime: video.captured_at,
      videoId: video.id,
    });
  }

  const now = new Date().toISOString();
  const publicAt = video.metadata_status === "complete"
    && video.terms_version
    && video.moderation_status === "visible"
    && resolved.canPublish
    ? video.public_at ?? now
    : null;
  await context.env.DB.prepare(
    `UPDATE videos SET status = ?, duration_seconds = ?, uploaded_at = ?,
     condition_snapshot_id = COALESCE(?, condition_snapshot_id), public_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  ).bind(resolved.state, resolved.durationSeconds, now, conditionSnapshotId, publicAt, now, video.id, user.id).run();
  const observation = await findOwnedObservation(context.env, video.id, user.id);
  return context.json({ observation: observation ? serializeObservation(observation, true) : null, conditionsAttached: Boolean(conditionSnapshotId) });
});

api.get("/videos/:id", async (context) => {
  const user = context.get("user");
  const observation = await findOwnedObservation(context.env, context.req.param("id"), user.id);
  if (!observation) return context.json({ error: "VIDEO_NOT_FOUND", message: "找不到影片" }, 404);
  return context.json({ observation: serializeObservation(observation, true) });
});

api.patch("/videos/:id", zValidator("json", updateVideoSchema), async (context) => {
  const user = context.get("user");
  const input = context.req.valid("json");
  const current = await context.env.DB.prepare(
    `SELECT id, spot_id, captured_at, status, show_uploader, is_favorite, uploader_note,
            fun_reaction, terms_version, moderation_status, metadata_status,
            metadata_expires_at, public_at, condition_snapshot_id, created_at, updated_at
     FROM videos WHERE id = ? AND user_id = ?`,
  ).bind(context.req.param("id"), user.id).first<{
    id: string;
    spot_id: string | null;
    captured_at: string | null;
    status: string;
    show_uploader: number;
    is_favorite: number;
    uploader_note: string | null;
    fun_reaction: string | null;
    terms_version: string | null;
    moderation_status: string;
    metadata_status: string;
    metadata_expires_at: string | null;
    public_at: string | null;
    condition_snapshot_id: string | null;
    created_at: string;
    updated_at: string;
  }>();
  if (!current) return context.json({ error: "VIDEO_NOT_FOUND", message: "找不到影片" }, 404);

  const now = new Date();
  if (current.metadata_status !== "complete"
    && current.metadata_expires_at
    && current.metadata_expires_at <= now.toISOString()) {
    return context.json({ error: "VIDEO_EXPIRED", message: "這支待補影片已超過七天期限" }, 410);
  }

  const capturedAt = input.capturedAt === undefined ? current.captured_at : input.capturedAt;
  if (capturedAt) assertWithinUploadWindow(capturedAt, new Date(current.created_at));
  const requestedSpotId = input.spotId === undefined ? current.spot_id : input.spotId;
  const spot = await findActiveSpot(context.env, requestedSpotId);
  if (requestedSpotId && !spot) return context.json({ error: "SPOT_NOT_FOUND", message: "找不到浪點" }, 404);
  const complete = Boolean(spot && capturedAt);
  const publicAt = complete
    && current.status === "ready"
    && current.terms_version
    && current.moderation_status === "visible"
    ? current.public_at ?? now.toISOString()
    : null;
  const update = await context.env.DB.prepare(
    `UPDATE videos SET spot_id = ?, captured_at = ?, show_uploader = ?, is_favorite = ?,
     uploader_note = ?, fun_reaction = ?, metadata_status = ?, metadata_expires_at = ?, public_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND metadata_status = ? AND updated_at = ?`,
  ).bind(
    spot?.id ?? null,
    capturedAt,
    input.showUploader === undefined ? current.show_uploader : input.showUploader ? 1 : 0,
    input.isFavorite === undefined ? current.is_favorite : input.isFavorite ? 1 : 0,
    input.uploaderNote === undefined ? current.uploader_note : input.uploaderNote,
    input.funReaction === undefined ? current.fun_reaction : input.funReaction,
    complete ? "complete" : "pending",
    complete ? null : current.metadata_expires_at ?? new Date(new Date(current.created_at).getTime() + 7 * 24 * 60 * 60_000).toISOString(),
    publicAt,
    now.toISOString(),
    current.id,
    user.id,
    current.metadata_status,
    current.updated_at,
  ).run();
  if (update.meta.changes !== 1) {
    return context.json({ error: "VIDEO_CHANGED", message: "影片狀態已更新，請重新載入" }, 409);
  }
  if (complete && !current.condition_snapshot_id && capturedAt && spot?.latitude != null && spot.longitude != null) {
    const snapshotId = await attachConditionsBestEffort(context.env, {
      latitude: spot.latitude,
      longitude: spot.longitude,
      validTime: capturedAt,
      videoId: current.id,
    });
    if (snapshotId) {
      await context.env.DB.prepare(`UPDATE videos SET condition_snapshot_id = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
        .bind(snapshotId, new Date().toISOString(), current.id, user.id)
        .run();
    }
  }
  const observation = await findOwnedObservation(context.env, current.id, user.id);
  return context.json({ observation: observation ? serializeObservation(observation, true) : null });
});

api.get("/admin/reports", async (context) => {
  const user = context.get("user");
  if (!isAdmin(context.env, user)) {
    return context.json({ error: "FORBIDDEN", message: "沒有管理權限" }, 403);
  }
  const result = await context.env.DB.prepare(
    `SELECT r.id, r.video_id, r.reason, r.status, r.created_at, r.resolved_at,
            s.name_en AS spot_name_en, s.name_zh AS spot_name_zh,
            v.captured_at, v.uploader_note
     FROM video_reports r
     JOIN videos v ON v.id = r.video_id
     LEFT JOIN spots s ON s.id = v.spot_id
     WHERE r.status = 'open'
     ORDER BY r.created_at ASC LIMIT 100`,
  ).all<ReportRow>();
  return context.json({
    reports: result.results.map((report) => ({
      id: report.id,
      videoId: report.video_id,
      reason: report.reason,
      status: report.status,
      createdAt: report.created_at,
      resolvedAt: report.resolved_at,
      capturedAt: report.captured_at,
      spotName: report.spot_name_zh || report.spot_name_en,
      uploaderNote: report.uploader_note,
    })),
  });
});

api.post("/admin/reports/:id/delist", async (context) => {
  const user = context.get("user");
  if (!isAdmin(context.env, user)) {
    return context.json({ error: "FORBIDDEN", message: "沒有管理權限" }, 403);
  }
  const report = await context.env.DB.prepare(
    `SELECT id, video_id, reason FROM video_reports WHERE id = ? AND status = 'open'`,
  ).bind(context.req.param("id")).first<{ id: string; video_id: string; reason: string }>();
  if (!report) return context.json({ error: "REPORT_NOT_FOUND", message: "找不到待處理檢舉" }, 404);

  const now = new Date().toISOString();
  await context.env.DB.batch([
    context.env.DB.prepare(
      `UPDATE videos SET moderation_status = 'delisted', public_at = NULL,
       delisted_at = ?, delisted_reason = ?, updated_at = ? WHERE id = ?`,
    ).bind(now, `report:${report.reason}`, now, report.video_id),
    context.env.DB.prepare(
      `UPDATE video_reports SET status = 'resolved', resolved_at = ?, resolved_by_user_id = ?
       WHERE video_id = ? AND status = 'open'`,
    ).bind(now, user.id, report.video_id),
  ]);
  return context.json({ videoId: report.video_id, moderationStatus: "delisted" });
});

api.get("/admin/problem-reports", async (context) => {
  const user = context.get("user");
  if (!isAdmin(context.env, user)) {
    return context.json({ error: "FORBIDDEN", message: "沒有管理員權限" }, 403);
  }
  const result = await context.env.DB.prepare(
    `SELECT id, message, view, status, created_at, resolved_at
     FROM problem_reports WHERE status = 'open'
     ORDER BY created_at ASC LIMIT 100`,
  ).all<ProblemReportRow>();
  return context.json({
    reports: result.results.map((report) => ({
      id: report.id,
      message: report.message,
      view: report.view,
      status: report.status,
      createdAt: report.created_at,
      resolvedAt: report.resolved_at,
    })),
  });
});

api.post("/admin/problem-reports/:id/resolve", async (context) => {
  const user = context.get("user");
  if (!isAdmin(context.env, user)) {
    return context.json({ error: "FORBIDDEN", message: "沒有管理員權限" }, 403);
  }
  const now = new Date().toISOString();
  const result = await context.env.DB.prepare(
    `UPDATE problem_reports
     SET status = 'resolved', resolved_at = ?, resolved_by_user_id = ?
     WHERE id = ? AND status = 'open'`,
  ).bind(now, user.id, context.req.param("id")).run();
  if (result.meta.changes !== 1) {
    return context.json({ error: "PROBLEM_REPORT_NOT_FOUND", message: "找不到待處理問題回報" }, 404);
  }
  return context.json({ reportId: context.req.param("id"), status: "resolved", resolvedAt: now });
});

api.onError((error, context) => {
  console.error(error);
  const message = error instanceof Error ? error.message : "系統暫時無法處理請求";
  const status = message.includes("168 小時") ? 422 : 500;
  return context.json({ error: "REQUEST_FAILED", message }, status);
});
