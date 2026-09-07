import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { moderationDecisionSchema } from "../../packages/api-contract/src";
import type { AppEnv, UserRow } from "./db";
import { createVideoProvider } from "./providers";
import { journeyDay } from "./journey-diagnostics";

type AdminEnv = { Bindings: AppEnv; Variables: { user: UserRow; authMode: "development" | "line" } };
export const adminApi = new Hono<AdminEnv>();
adminApi.use("*", async (c, next) => {
  c.header("cache-control", "no-store");
  const user = c.get("user");
  if (!user || !c.env.ADMIN_USER_ID || user.id !== c.env.ADMIN_USER_ID) {
    return c.json({ error: "FORBIDDEN", message: "沒有管理權限" }, 403);
  }
  if (c.req.method !== "GET") {
    // Require same-origin JSON writes. A hidden link is never an authorization boundary.
    if (c.req.header("origin") !== new URL(c.req.url).origin
      || c.req.header("sec-fetch-site") === "cross-site"
      || !c.req.header("content-type")?.startsWith("application/json")) {
      return c.json({ error: "FORBIDDEN", message: "請從管理頁面操作" }, 403);
    }
  }
  await next();
});

adminApi.get("/reports", async c => {
  const status = c.req.query("status") === "resolved" ? "resolved" : "open";
  const result = await c.env.DB.prepare(`SELECT r.id, r.video_id AS videoId, r.reason, r.status,
    r.created_at AS createdAt, r.resolved_at AS resolvedAt,
    r.resolution_action AS resolutionAction, r.resolution_reason AS resolutionReason,
    v.captured_at AS capturedAt, v.uploader_note AS uploaderNote,
    v.moderation_status AS moderationStatus, v.duration_seconds AS durationSeconds,
    COALESCE(s.name_zh, s.name_en) AS spotName
    FROM video_reports r JOIN videos v ON v.id = r.video_id LEFT JOIN spots s ON s.id = v.spot_id
    WHERE r.status = ? ORDER BY r.created_at DESC, r.id LIMIT 100`).bind(status).all();
  return c.json({ reports: result.results });
});

for (const action of ["resolve", "delist"] as const) {
  adminApi.post(`/reports/:id/${action}`, zValidator("json", moderationDecisionSchema), async c => {
    const report = await c.env.DB.prepare("SELECT id, video_id FROM video_reports WHERE id = ? AND status = 'open'")
      .bind(c.req.param("id")).first<{ id: string; video_id: string }>();
    if (!report) return c.json({ error: "REPORT_NOT_FOUND", message: "這筆檢舉已處理或不存在，請重新整理" }, 404);
    const reason = c.req.valid("json").reason;
    if ((action === "resolve") !== ["test", "no_violation"].includes(reason)) {
      return c.json({ error: "INVALID_REASON", message: "請選擇符合處理結果的原因" }, 422);
    }
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    // Atomic decision claim: a racing/replayed request cannot overwrite a prior decision.
    const statements = [c.env.DB.prepare(`UPDATE video_reports SET status = 'resolved', resolved_at = ?,
      resolved_by_user_id = ?, resolution_action = ?, resolution_reason = ?, resolution_id = ?
      WHERE video_id = ? AND status = 'open'
        AND EXISTS (SELECT 1 FROM video_reports WHERE id = ? AND status = 'open')`)
      .bind(now, c.get("user").id, action, reason, id, report.video_id, report.id)];
    if (action === "delist") statements.push(c.env.DB.prepare(`UPDATE videos SET moderation_status = 'delisted',
      public_at = NULL, delisted_at = ?, delisted_reason = ?, updated_at = ? WHERE id = ?
      AND EXISTS (SELECT 1 FROM video_reports WHERE id = ? AND resolution_id = ?)`)
      .bind(now, `report:${reason}`, now, report.video_id, report.id, id));
    statements.push(c.env.DB.prepare(`INSERT INTO moderation_actions
      (id, actor_user_id, target_type, target_id, action, reason, occurred_at)
      SELECT ?, ?, 'video', ?, ?, ?, ? WHERE EXISTS
        (SELECT 1 FROM video_reports WHERE id = ? AND resolution_id = ?)`)
      .bind(id, c.get("user").id, report.video_id, action, reason, now, report.id, id));
    const result = await c.env.DB.batch(statements);
    if (!result[0].meta.changes) return c.json({ error: "CONFLICT", message: "已有其他處理結果，請重新整理" }, 409);
    return c.json({ videoId: report.video_id, status: "resolved", action });
  });
}

adminApi.post("/videos/:id/restore", async c => {
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  const result = await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO moderation_actions (id, actor_user_id, target_type, target_id, action, reason, occurred_at)
      SELECT ?, ?, 'video', id, 'restore', 'reviewed', ? FROM videos
      WHERE id = ? AND moderation_status = 'delisted' AND metadata_status = 'complete'
        AND status = 'ready' AND terms_version IS NOT NULL`)
      .bind(id, c.get("user").id, now, c.req.param("id")),
    c.env.DB.prepare(`UPDATE videos SET moderation_status = 'visible', public_at = ?, delisted_at = NULL,
      delisted_reason = NULL, updated_at = ? WHERE id = ?
      AND EXISTS (SELECT 1 FROM moderation_actions WHERE id = ?)`)
      .bind(now, now, c.req.param("id"), id),
  ]);
  if (!result[0].meta.changes) return c.json({ error: "NOT_RESTORABLE", message: "影片狀態無法恢復公開" }, 409);
  return c.json({ videoId: c.req.param("id"), moderationStatus: "visible" });
});

// Review media is private, including after delisting. Never expose provider IDs or signed
// thumbnail redirects. Review playback does not create public playback-count events.
for (const kind of ["thumbnail", "playback"] as const) {
  const handler = async (c: Context<AdminEnv>) => {
    const limiter = c.env.PLAYBACK_RATE_LIMITER;
    if (!limiter && c.env.APP_ENV !== "development") return c.json({ error: "UNAVAILABLE" }, 503);
    if (limiter && !(await limiter.limit({ key: `admin-review:${c.get("user").id}` })).success) {
      return c.json({ error: "RATE_LIMITED", message: "操作太頻繁，請稍後再試" }, 429, { "retry-after": "60" });
    }
    const video = await c.env.DB.prepare(`SELECT provider_video_id, video_provider FROM videos
      WHERE id = ? AND status = 'ready' AND metadata_status = 'complete' AND terms_version IS NOT NULL
      AND EXISTS (SELECT 1 FROM video_reports WHERE video_id = videos.id)`)
      .bind(c.req.param("id")).first<{ provider_video_id: string; video_provider: string }>();
    if (!video) return c.json({ error: "VIDEO_NOT_FOUND", message: "影片目前無法預覽" }, 404);
    const provider = createVideoProvider(c.env);
    if (provider.provider !== video.video_provider) return c.json({ error: "PROVIDER_UNAVAILABLE" }, 503);
    if (kind === "playback") return c.json(await provider.createPlayback(video.provider_video_id));
    const url = await provider.getThumbnailUrl(video.provider_video_id);
    if (!url) return c.body(null, 404);
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) return c.body(null, 502);
    return new Response(response.body, { headers: { "content-type": response.headers.get("content-type")!, "cache-control": "no-store" } });
  };
  if (kind === "thumbnail") adminApi.get(`/videos/:id/${kind}`, handler);
  else adminApi.post(`/videos/:id/${kind}`, handler);
}

adminApi.get("/history", async c => {
  const result = await c.env.DB.prepare(`SELECT id, actor_user_id AS actorUserId, target_type AS targetType,
    target_id AS targetId, action, reason, occurred_at AS occurredAt
    FROM moderation_actions ORDER BY occurred_at DESC LIMIT 100`).all();
  return c.json({ actions: result.results });
});

adminApi.get("/problem-reports", async c => {
  const status = c.req.query("status") === "resolved" ? "resolved" : "open";
  const result = await c.env.DB.prepare(`SELECT id, message, view, status, created_at AS createdAt, resolved_at AS resolvedAt
    FROM problem_reports WHERE status = ? ORDER BY created_at DESC LIMIT 100`).bind(status).all();
  return c.json({ reports: result.results });
});
adminApi.post("/problem-reports/:id/resolve", async c => {
  const now = new Date().toISOString(); const id = crypto.randomUUID();
  const result = await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO moderation_actions (id, actor_user_id, target_type, target_id, action, reason, occurred_at)
      SELECT ?, ?, 'problem', id, 'resolve', 'reviewed', ? FROM problem_reports WHERE id = ? AND status = 'open'`)
      .bind(id, c.get("user").id, now, c.req.param("id")),
    c.env.DB.prepare(`UPDATE problem_reports SET status = 'resolved', resolved_at = ?, resolved_by_user_id = ?
      WHERE id = ? AND EXISTS (SELECT 1 FROM moderation_actions WHERE id = ?)`)
      .bind(now, c.get("user").id, c.req.param("id"), id),
  ]);
  if (!result[0].meta.changes) return c.json({ error: "PROBLEM_REPORT_NOT_FOUND", message: "這筆回報已處理或不存在" }, 404);
  return c.json({ reportId: c.req.param("id"), status: "resolved", resolvedAt: now });
});

adminApi.get("/diagnostics", async c => {
  const since = journeyDay(new Date(Date.now() - 30 * 86_400_000));
  const result = await c.env.DB.prepare(`SELECT day, source, event, outcome, count FROM journey_daily
    WHERE day >= ? ORDER BY day DESC, source, event, outcome LIMIT 1000`).bind(since).all();
  return c.json({ days: result.results, note: "用戶端事件為盡力回報，可能遺漏；不是使用人數或帳單。每天每來源最多保存 2,000 個事件。" });
});
