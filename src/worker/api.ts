import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  completeUploadSchema,
  updateMeSchema,
  updateVideoSchema,
  uploadRequestSchema,
} from "../../packages/api-contract/src";
import { assertTodayInTaipei } from "../../packages/domain/src";
import {
  ensureDevelopmentDatabase,
  insertConditionSnapshot,
  type AppEnv,
  type SpotRow,
  type UserRow,
} from "./db";
import { createConditionsProvider, createVideoProvider } from "./providers";
import {
  beginLineLogin,
  finishLineLogin,
  getAuthenticatedUser,
  isLineAuthConfigured,
  logout,
} from "./auth";

type Variables = { user: UserRow; authMode: "development" | "line" };

interface ObservationRow {
  id: string;
  status: string;
  captured_at: string;
  duration_seconds: number | null;
  show_uploader: number;
  provider_video_id: string;
  video_provider: string;
  spot_id: string;
  spot_slug: string;
  spot_name_en: string;
  spot_name_zh: string | null;
  display_id: string | null;
  wave_height: number | null;
  swell_height: number | null;
  swell_period: number | null;
  wind_speed: number | null;
  tide_height: number | null;
  tide_state: string | null;
}

function serializeObservation(row: ObservationRow) {
  return {
    id: row.id,
    status: row.status,
    capturedAt: row.captured_at,
    durationSeconds: row.duration_seconds,
    uploaderDisplayId: row.show_uploader ? row.display_id : null,
    video: { provider: row.video_provider, providerVideoId: row.provider_video_id },
    spot: {
      id: row.spot_id,
      slug: row.spot_slug,
      name: row.spot_name_zh || row.spot_name_en,
      nameEn: row.spot_name_en,
    },
    conditions: {
      waveHeight: row.wave_height,
      swellHeight: row.swell_height,
      swellPeriod: row.swell_period,
      windSpeed: row.wind_speed,
      tideHeight: row.tide_height,
      tideState: row.tide_state,
    },
  };
}

async function findObservation(env: AppEnv, videoId: string, userId: string) {
  return env.DB.prepare(
    `SELECT
       v.id, v.status, v.captured_at, v.duration_seconds, v.show_uploader,
       v.provider_video_id, v.video_provider, v.spot_id,
       s.slug AS spot_slug, s.name_en AS spot_name_en, s.name_zh AS spot_name_zh,
       u.display_id,
       c.wave_height, c.swell_height, c.swell_period, c.wind_speed,
       c.tide_height, c.tide_state
     FROM videos v
     JOIN spots s ON s.id = v.spot_id
     JOIN users u ON u.id = v.user_id
     LEFT JOIN condition_snapshots c ON c.id = v.condition_snapshot_id
     WHERE v.id = ? AND v.user_id = ?`,
  ).bind(videoId, userId).first<ObservationRow>();
}

export const api = new Hono<{ Bindings: AppEnv; Variables: Variables }>()
  .basePath("/api/v1");

api.get("/health", (context) => context.json({ ok: true }));
api.get("/auth/line", (context) => beginLineLogin(context.env));
api.get("/auth/line/callback", (context) => finishLineLogin(context.req.raw, context.env));
api.post("/auth/logout", (context) => logout(context.req.raw, context.env));

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
    displayId: user.display_id,
    showIdentityDefault: Boolean(user.show_identity_default),
    authMode: context.get("authMode"),
  });
});

api.patch("/me", zValidator("json", updateMeSchema), async (context) => {
  const user = context.get("user");
  const input = context.req.valid("json");
  const now = new Date().toISOString();
  await context.env.DB.prepare(
    `UPDATE users SET display_id = ?, show_identity_default = ?, updated_at = ? WHERE id = ?`,
  ).bind(input.displayId, input.showIdentityDefault ? 1 : 0, now, user.id).run();
  return context.json({
    id: user.id,
    displayId: input.displayId,
    showIdentityDefault: input.showIdentityDefault,
  });
});

api.get("/spots", async (context) => {
  const result = await context.env.DB.prepare(
    `SELECT id, slug, name_en, name_zh, region, latitude, longitude
     FROM spots WHERE active = 1 ORDER BY
       CASE region WHEN 'North' THEN 1 WHEN 'Northeast' THEN 2 WHEN 'East' THEN 3 WHEN 'South' THEN 4 ELSE 5 END,
       name_en`,
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

api.get("/videos", async (context) => {
  const user = context.get("user");
  const result = await context.env.DB.prepare(
    `SELECT
       v.id, v.status, v.captured_at, v.duration_seconds, v.show_uploader,
       v.provider_video_id, v.video_provider, v.spot_id,
       s.slug AS spot_slug, s.name_en AS spot_name_en, s.name_zh AS spot_name_zh,
       u.display_id,
       c.wave_height, c.swell_height, c.swell_period, c.wind_speed,
       c.tide_height, c.tide_state
     FROM videos v
     JOIN spots s ON s.id = v.spot_id
     JOIN users u ON u.id = v.user_id
     LEFT JOIN condition_snapshots c ON c.id = v.condition_snapshot_id
     WHERE v.user_id = ?
     ORDER BY v.captured_at DESC LIMIT 20`,
  ).bind(user.id).all<ObservationRow>();
  return context.json({ observations: result.results.map(serializeObservation) });
});

api.post(
  "/videos/upload-request",
  zValidator("json", uploadRequestSchema),
  async (context) => {
    const user = context.get("user");
    const input = context.req.valid("json");
    assertTodayInTaipei(input.capturedAt);
    const spot = await context.env.DB.prepare(
      `SELECT id, slug, name_en, name_zh, region, latitude, longitude
       FROM spots WHERE id = ? AND active = 1`,
    ).bind(input.spotId).first<SpotRow>();
    if (!spot) return context.json({ error: "SPOT_NOT_FOUND", message: "找不到浪點" }, 404);

    const provider = createVideoProvider(context.env);
    const ticket = await provider.createDirectUpload({
      internalUserId: user.id,
      maxDurationSeconds: 60,
    });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const showUploader = input.showUploader ?? Boolean(user.show_identity_default);
    await context.env.DB.prepare(
      `INSERT INTO videos (
        id, user_id, spot_id, video_provider, provider_video_id, captured_at,
        duration_seconds, status, show_uploader, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      user.id,
      spot.id,
      ticket.provider,
      ticket.providerVideoId,
      input.capturedAt,
      input.durationSeconds,
      "awaiting_upload",
      showUploader ? 1 : 0,
      now,
      now,
    ).run();
    return context.json({
      videoId: id,
      ...ticket,
      limits: { maxBytes: 200 * 1024 * 1024, maxDurationSeconds: 60 },
    }, 201);
  },
);

api.post(
  "/videos/:id/complete",
  zValidator("json", completeUploadSchema),
  async (context) => {
    const user = context.get("user");
    const input = context.req.valid("json");
    const video = await context.env.DB.prepare(
      `SELECT v.id, v.user_id, v.provider_video_id, v.captured_at, v.duration_seconds,
              s.latitude, s.longitude
       FROM videos v JOIN spots s ON s.id = v.spot_id
       WHERE v.id = ? AND v.user_id = ?`,
    ).bind(context.req.param("id"), user.id).first<{
      id: string;
      user_id: string;
      provider_video_id: string;
      captured_at: string;
      duration_seconds: number | null;
      latitude: number | null;
      longitude: number | null;
    }>();
    if (!video) return context.json({ error: "VIDEO_NOT_FOUND", message: "找不到影片" }, 404);
    if (video.provider_video_id !== input.providerVideoId) {
      return context.json({ error: "UPLOAD_MISMATCH", message: "上傳識別碼不相符" }, 409);
    }

    const provider = createVideoProvider(context.env);
    const status = await provider.getStatus(input.providerVideoId);
    const verifiedDuration = status.durationSeconds ?? video.duration_seconds;
    if (verifiedDuration == null || verifiedDuration < 5 || verifiedDuration > 60) {
      return context.json({ error: "INVALID_DURATION", message: "影片長度必須為 5–60 秒" }, 422);
    }

    const conditionSnapshotId = crypto.randomUUID();
    const conditionsProvider = createConditionsProvider(context.env);
    const conditions = await conditionsProvider.getConditions({
      latitude: video.latitude,
      longitude: video.longitude,
      validTime: video.captured_at,
    });
    await insertConditionSnapshot(context.env.DB, conditionSnapshotId, conditions);
    const now = new Date().toISOString();
    await context.env.DB.prepare(
      `UPDATE videos SET status = ?, duration_seconds = ?, uploaded_at = ?,
       condition_snapshot_id = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    ).bind(
      status.state,
      verifiedDuration,
      now,
      conditionSnapshotId,
      now,
      video.id,
      user.id,
    ).run();
    const observation = await findObservation(context.env, video.id, user.id);
    return context.json({ observation: observation ? serializeObservation(observation) : null });
  },
);

api.get("/videos/:id", async (context) => {
  const user = context.get("user");
  const observation = await findObservation(context.env, context.req.param("id"), user.id);
  if (!observation) return context.json({ error: "VIDEO_NOT_FOUND", message: "找不到影片" }, 404);
  return context.json({ observation: serializeObservation(observation) });
});

api.patch(
  "/videos/:id",
  zValidator("json", updateVideoSchema),
  async (context) => {
    const user = context.get("user");
    const input = context.req.valid("json");
    const result = await context.env.DB.prepare(
      `UPDATE videos SET show_uploader = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    ).bind(
      input.showUploader ? 1 : 0,
      new Date().toISOString(),
      context.req.param("id"),
      user.id,
    ).run();
    if (!result.meta.changes) {
      return context.json({ error: "VIDEO_NOT_FOUND", message: "找不到影片" }, 404);
    }
    const observation = await findObservation(
      context.env,
      context.req.param("id"),
      user.id,
    );
    return context.json({ observation: observation ? serializeObservation(observation) : null });
  },
);

api.onError((error, context) => {
  console.error(error);
  const message = error instanceof Error ? error.message : "系統暫時無法處理請求";
  const status = message.includes("台北時區") ? 422 : 500;
  return context.json({ error: "REQUEST_FAILED", message }, status);
});
