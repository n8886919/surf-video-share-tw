import { Hono } from "hono";
import { lineWebhookSchema, linePostbackSchema } from "../../packages/api-contract/src/line-webhook";
import { PUBLIC_MEDIA_TERMS_VERSION } from "../../packages/domain/src/public-terms";
import { applyLineDraftAction } from "../../packages/domain/src/line-upload-draft";
import { parseQuickTimeMetadata, MAX_VIDEO_METADATA_ATOM_BYTES } from "../../packages/domain/src/video-metadata";
import { lineVideoHints } from "../../packages/domain/src/line-video-hints";
import { getOrCreateLineUser, RegistrationCapacityError } from "./auth";
import { ensureDevelopmentDatabase, type AppEnv, type SpotRow } from "./db";
import { getLineVideoContent, verifyLineSignature } from "./providers/line-content";
import { replyToLine } from "./providers/line-messaging";
import { lineUploadCard, lineSpotCard, lineProgressCard } from "./line-upload-card";
import { enqueueLineDraft, readLineDraft, toLineDraft, type LineDraftRow } from "./line-drafts";

const text = (message: string) => ({ type: "text", text: message });
const WEEK = 7 * 86_400_000;

/** Best-effort prefix only. Tail metadata is deliberately unknown, never guessed from send/container time. */
async function metadataHints(env: AppEnv, messageId: string, spots: SpotRow[], now: Date) {
  const source = await getLineVideoContent(messageId, env.LINE_UPLOAD_CHANNEL_ACCESS_TOKEN!, AbortSignal.timeout(2_000));
  if (source.state !== "ready") return null;
  const reader = source.body.getReader();
  const bytes = new Uint8Array(MAX_VIDEO_METADATA_ATOM_BYTES);
  let count = 0;
  try {
    while (count < bytes.length) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const part = chunk.value.subarray(0, bytes.length - count);
      bytes.set(part, count); count += part.length;
    }
  } finally { await reader.cancel().catch(() => {}); }
  return lineVideoHints({ ...parseQuickTimeMetadata(bytes.subarray(0, count)), bytesRead: count }, spots, now);
}

function draftCard(row: LineDraftRow, spots: SpotRow[], origin: string) {
  if (row.status === "cancelled" || row.expires_at <= new Date().toISOString()) return text("這支影片的草稿已失效，請重新傳送影片。");
  const draft = toLineDraft(row);
  return row.status === "confirmed" ? lineProgressCard(draft, row.transfer_status, origin)
    : lineUploadCard(draft, spots.find(s => s.id === row.spot_id)?.name_zh ?? null, origin);
}

export const lineWebhookApi = new Hono<{ Bindings: AppEnv }>();
lineWebhookApi.post("/webhook", async context => {
  const env = context.env;
  if (env.LINE_UPLOAD_ENABLED !== "true" || !env.LINE_UPLOAD_CHANNEL_SECRET
    || !env.LINE_UPLOAD_CHANNEL_ACCESS_TOKEN || !env.LINE_UPLOAD_BOT_ID || !env.LINE_UPLOAD_QUEUE || !env.LINE_EVENT_QUEUE
    || !env.UPLOAD_RATE_LIMITER || !env.PUBLIC_SITE_ORIGIN) return context.json({ error: "LINE_UNAVAILABLE" }, 503);
  // Read incrementally; do not trust Content-Length on an unauthenticated request.
  const reader = context.req.raw.body?.getReader();
  if (!reader) return context.json({ error: "INVALID_BODY" }, 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.length;
    if (length > 256_000) { await reader.cancel(); return context.json({ error: "BODY_TOO_LARGE" }, 413); }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (!await verifyLineSignature(bytes, context.req.header("x-line-signature") ?? null, env.LINE_UPLOAD_CHANNEL_SECRET)) {
    return context.json({ error: "INVALID_SIGNATURE" }, 401);
  }
  let json: unknown;
  try { json = JSON.parse(new TextDecoder().decode(bytes)); } catch { return context.json({ error: "INVALID_BODY" }, 400); }
  const payload = lineWebhookSchema.safeParse(json);
  if (!payload.success || payload.data.destination !== env.LINE_UPLOAD_BOT_ID) return context.json({ error: "INVALID_EVENT" }, 400);
  if (!payload.data.events.length) return context.json({ ok: true });
  // Acknowledge only after durable enqueue; never wait on content downloads or reply APIs.
  try {
    await env.LINE_EVENT_QUEUE.sendBatch(payload.data.events.map(event => ({ body: {
      destination: payload.data.destination, events: [event],
    } })));
  } catch { return context.json({ error: "LINE_RETRY" }, 503); }
  return context.json({ ok: true });
});

/** Validated minimal events are private queue data, never analytics/logs. */
export async function handleLineEvents(env: AppEnv, payload: ReturnType<typeof lineWebhookSchema.parse>) {
  await ensureDevelopmentDatabase(env);
  const spots = (await env.DB.prepare("SELECT id, slug, name_en, name_zh, region, latitude, longitude FROM spots WHERE active = 1 ORDER BY rowid").all<SpotRow>()).results;
  try {
    for (const event of payload.events) {
      const now = new Date();
      if (event.mode === "standby" || event.source.type !== "user" || !event.source.userId
        || now.getTime() - event.timestamp > WEEK || event.timestamp > now.getTime() + 300_000) continue;
      const reply = async (messages: unknown[]) => {
        if (event.replyToken) await replyToLine(env.LINE_UPLOAD_CHANNEL_ACCESS_TOKEN!, event.replyToken, messages);
        else console.warn("LINE_REPLY_TOKEN_MISSING");
      };
      if (!["message", "postback", "unsend"].includes(event.type)) {
        if (event.type === "follow") await reply([text("直接傳送 10–60 秒的浪況影片，選好拍攝時間與浪點後，按「確認上傳」。")]);
        continue;
      }
      if (event.type === "message" && (event.message?.type !== "video" || event.message.contentProvider?.type !== "line")) {
        const latest = await env.DB.prepare(`SELECT d.* FROM line_upload_drafts d JOIN users u ON u.id=d.user_id
          WHERE u.line_subject=? AND d.status<>'cancelled' AND d.expires_at>? ORDER BY d.created_at DESC LIMIT 1`)
          .bind(event.source.userId, now.toISOString()).first<LineDraftRow>();
        if (latest) {
          await enqueueLineDraft(env, latest);
          await reply([draftCard(latest, spots, env.PUBLIC_SITE_ORIGIN!)]);
        } else await reply([text("請直接傳送 10–60 秒、200 MB 內的浪況影片。")]);
        continue;
      }
      let user;
      try { user = await getOrCreateLineUser(env, event.source.userId, null, null, true); }
      catch (error) {
        if (!(error instanceof RegistrationCapacityError)) throw error;
        await reply([text("目前測試名額已滿，暫時無法接收新帳號上傳。")]); continue;
      }
      if (event.type === "unsend" && event.unsend) {
        // A cancellation tombstone also prevents an out-of-order message from recreating a draft.
        await env.DB.batch([
          env.DB.prepare(`INSERT INTO line_upload_drafts (id,user_id,message_id,status,terms_version,expires_at,created_at,updated_at)
            VALUES (?,?,?,'cancelled',?,?,?,?) ON CONFLICT(message_id) DO UPDATE SET status='cancelled',
            revision=revision+1,updated_at=excluded.updated_at WHERE user_id=excluded.user_id`)
            .bind(crypto.randomUUID(), user.id, event.unsend.messageId, PUBLIC_MEDIA_TERMS_VERSION,
              new Date(now.getTime() + WEEK).toISOString(), now.toISOString(), now.toISOString()),
          env.DB.prepare(`UPDATE videos SET public_at=NULL,metadata_status='deleting',updated_at=?
            WHERE id IN (SELECT id FROM line_upload_drafts WHERE message_id=? AND user_id=?) AND user_id=?`)
            .bind(now.toISOString(), event.unsend.messageId, user.id, user.id),
        ]);
        const cancelled = await env.DB.prepare("SELECT * FROM line_upload_drafts WHERE message_id=? AND user_id=?")
          .bind(event.unsend.messageId, user.id).first<LineDraftRow>();
        if (cancelled) await env.LINE_UPLOAD_QUEUE!.send({ draftId: cancelled.id });
        continue;
      }
      if (event.type === "message" && event.message) {
        let row = await env.DB.prepare("SELECT * FROM line_upload_drafts WHERE message_id=? AND user_id=?")
          .bind(event.message.id, user.id).first<LineDraftRow>();
        if (!row) {
          if (!(await env.UPLOAD_RATE_LIMITER!.limit({ key: user.id })).success) {
            await reply([text("上傳稍密集，請稍後再試。")]); continue;
          }
          if (event.message.duration !== undefined && (event.message.duration < 10_000 || event.message.duration > 60_000)) {
            await reply([text("影片長度必須為 10–60 秒，請剪輯後再傳送。")]); continue;
          }
          const id = crypto.randomUUID();
          await env.DB.prepare(`INSERT INTO line_upload_drafts (id,user_id,message_id,terms_version,expires_at,created_at,updated_at)
            SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM line_upload_drafts
              WHERE user_id=? AND status='draft' AND expires_at>?) < 5 ON CONFLICT(message_id) DO NOTHING`)
            .bind(id, user.id, event.message.id, PUBLIC_MEDIA_TERMS_VERSION, new Date(event.timestamp + WEEK).toISOString(),
              now.toISOString(), now.toISOString(), user.id, now.toISOString()).run();
          row = await env.DB.prepare("SELECT * FROM line_upload_drafts WHERE message_id=? AND user_id=?")
            .bind(event.message.id, user.id).first<LineDraftRow>();
          if (!row) { await reply([text("請先完成現有影片的確認，再傳送新影片。")]); continue; }
          if (row.id === id) {
            const hints = await metadataHints(env, event.message.id, spots, now).catch(() => null);
            if (hints) await env.DB.prepare(`UPDATE line_upload_drafts SET spot_id=?,captured_at=?
              WHERE id=? AND revision=0 AND status='draft'`).bind(hints.spotId, hints.capturedAt, id).run();
            row = (await readLineDraft(env, id))!;
          }
        }
        await reply([draftCard(row, spots, env.PUBLIC_SITE_ORIGIN!)]); continue;
      }
      if (event.type !== "postback" || !event.postback) continue;
      const parsed = linePostbackSchema.safeParse(Object.fromEntries(new URLSearchParams(event.postback.data)));
      if (!parsed.success) { await reply([text("請使用最新影片卡片的按鈕。")]); continue; }
      const input = parsed.data;
      let row = await readLineDraft(env, input.draft);
      if (!row || row.user_id !== user.id) { await reply([text("找不到這支影片的草稿。")]); continue; }
      if (row.status !== "draft" || row.expires_at <= now.toISOString() || row.revision !== input.revision) {
        await enqueueLineDraft(env, row);
        await reply([draftCard(row, spots, env.PUBLIC_SITE_ORIGIN!)]); continue;
      }
      if (input.action === "spots") { await reply([lineSpotCard(toLineDraft(row), spots, input.page ?? 0)]); continue; }
      if (input.action === "status") { await reply([draftCard(row, spots, env.PUBLIC_SITE_ORIGIN!)]); continue; }
      let next;
      try {
        next = applyLineDraftAction({ draft: toLineDraft(row), actorId: user.id, expectedRevision: input.revision,
          action: input.action === "spot" ? { action: "spot", spotId: input.spot! }
            : input.action === "time" ? { action: "time", datetime: event.postback.params?.datetime ?? "" } : { action: "confirm" },
          activeSpotIds: spots.map(s => s.id), now });
      } catch {
        await reply([text("請選擇浪點，以及七天內、台北時間 05:00–19:59 的拍攝時間。"), draftCard(row, spots, env.PUBLIC_SITE_ORIGIN!)]);
        continue;
      }
      await env.DB.prepare(`UPDATE line_upload_drafts SET spot_id=?,captured_at=?,status=?,revision=?,updated_at=?
        WHERE id=? AND user_id=? AND status='draft' AND revision=? AND expires_at>?`)
        .bind(next.spotId, next.capturedAt, next.status, next.revision, now.toISOString(), row.id, user.id, row.revision, now.toISOString()).run();
      row = (await readLineDraft(env, row.id))!;
      await enqueueLineDraft(env, row);
      await reply([draftCard(row, spots, env.PUBLIC_SITE_ORIGIN!)]);
    }
  } catch (error) {
    // Classification only: exception bodies may contain private database/provider values.
    console.warn("LINE_EVENT_FAILED", error instanceof Error ? error.name : "UnknownError");
    throw new Error("LINE_EVENT_RETRY");
  }
}

export async function consumeLineEvents(batch: MessageBatch<unknown>, env: AppEnv) {
  for (const message of batch.messages) {
    const parsed = lineWebhookSchema.safeParse(message.body);
    if (!parsed.success || parsed.data.destination !== env.LINE_UPLOAD_BOT_ID) { message.ack(); continue; }
    try { await handleLineEvents(env, parsed.data); message.ack(); }
    catch { message.retry({ delaySeconds: 5 }); }
  }
}
