import { z } from "zod";
import type { AppEnv, UserRow } from "./db";
import { createVideoProvider } from "./providers";
import { getLineVideoContent } from "./providers/line-content";
import { transferToStream } from "./providers/stream-transfer";
import { readLineDraft, type LineDraftRow } from "./line-drafts";
import { prepareVideoInsert } from "./video-upload";
import { finalizeVideoUpload, type CompletingVideo } from "./video-completion";
import { resolveVideoStatus } from "./video-status";

const jobSchema = z.object({ draftId: z.string().uuid() }).strict();

async function removeCancelledAsset(env: AppEnv, row: LineDraftRow) {
  if (!row.provider_video_id) return;
  await createVideoProvider(env).deleteVideo(row.provider_video_id);
  await env.DB.prepare(`UPDATE line_upload_drafts SET provider_video_id=NULL,upload_url=NULL
    WHERE id=? AND provider_video_id=? AND status='cancelled'`).bind(row.id, row.provider_video_id).run();
}

/** Queue delivery is at least once. Lease + stable video ID + conditional insert make it idempotent. */
export async function processLineUpload(env: AppEnv, draftId: string): Promise<"done" | "retry"> {
  let row = await readLineDraft(env, draftId);
  if (!row) return "done";
  if (row.expires_at <= new Date().toISOString() && row.transfer_status !== "ready") {
    await env.DB.batch([
      env.DB.prepare("UPDATE line_upload_drafts SET status='cancelled' WHERE id=?").bind(row.id),
      env.DB.prepare("UPDATE videos SET public_at=NULL,metadata_status='deleting' WHERE id=? AND user_id=?").bind(row.id, row.user_id),
    ]);
    row = { ...row, status: "cancelled" };
  }
  if (row.status === "cancelled") { await removeCancelledAsset(env, row); return "done"; }
  if (row.status !== "confirmed" || row.transfer_status === "ready" || row.transfer_status === "failed") return "done";
  if (env.LINE_UPLOAD_ENABLED !== "true" || !env.LINE_UPLOAD_CHANNEL_ACCESS_TOKEN) return "retry";
  const lease = crypto.randomUUID();
  const now = new Date();
  const claimed = await env.DB.prepare(`UPDATE line_upload_drafts SET lease_token=?,lease_until=?
    WHERE id=? AND status='confirmed' AND transfer_status NOT IN ('ready','failed')
      AND (lease_until IS NULL OR lease_until<?) RETURNING *`)
    .bind(lease, new Date(now.getTime() + 180_000).toISOString(), row.id, now.toISOString()).first<LineDraftRow>();
  if (!claimed) return "done"; // Another delivery owns the lease; hourly recovery covers a crashed owner.
  row = claimed;
  const provider = createVideoProvider(env);
  try {
    if (row.transfer_status !== "processing") {
      if (row.transfer_attempts >= 3) throw new Error("LINE_TRANSFER_EXHAUSTED");
      // An uncertain interrupted multipart transfer is never published or reused.
      if (row.provider_video_id) await provider.deleteVideo(row.provider_video_id);
      const source = await getLineVideoContent(row.message_id, env.LINE_UPLOAD_CHANNEL_ACCESS_TOKEN, AbortSignal.timeout(120_000));
      if (source.state === "processing") return "retry";
      if (source.state === "expired") throw new Error("LINE_CONTENT_EXPIRED");
      let ticket;
      try { ticket = await provider.createDirectUpload({ internalUserId: row.user_id, maxDurationSeconds: 60 }); }
      catch (error) { await source.body.cancel(); throw error; }
      if (!ticket.uploadUrl || ticket.provider !== "cloudflare-stream") { await source.body.cancel(); throw new Error("LINE_PROVIDER_INVALID"); }
      const updated = await env.DB.prepare(`UPDATE line_upload_drafts SET provider_video_id=?,upload_url=?,
        transfer_status='transferring',transfer_attempts=transfer_attempts+1 WHERE id=? AND status='confirmed' AND lease_token=?`)
        .bind(ticket.providerVideoId, ticket.uploadUrl, row.id, lease).run();
      if (updated.meta.changes !== 1) { await source.body.cancel(); await provider.deleteVideo(ticket.providerVideoId); return "done"; }
      await transferToStream(ticket.uploadUrl, source.body, AbortSignal.timeout(120_000));
      await env.DB.prepare(`UPDATE line_upload_drafts SET transfer_status='processing',upload_url=NULL
        WHERE id=? AND status='confirmed' AND lease_token=?`).bind(row.id, lease).run();
      row = (await readLineDraft(env, row.id))!;
      if (row.status === "cancelled") { await removeCancelledAsset(env, row); return "done"; }
    }
    const user = await env.DB.prepare("SELECT id,show_identity_default FROM users WHERE id=?").bind(row.user_id).first<UserRow>();
    if (!row.spot_id || !row.captured_at || !row.provider_video_id || !user) throw new Error("LINE_DRAFT_INVALID");
    const exists = await env.DB.prepare("SELECT id FROM videos WHERE id=? AND user_id=?").bind(row.id, row.user_id).first();
    if (!exists) await prepareVideoInsert(env, {
      id: row.id, userId: row.user_id, spotId: row.spot_id, capturedAt: row.captured_at,
      ticket: { provider: provider.provider, providerVideoId: row.provider_video_id, uploadMethod: "POST", uploadUrl: null },
      durationSeconds: null, showUploader: Boolean(user.show_identity_default), lineLease: lease,
    }).run();
    const video = await env.DB.prepare(`SELECT v.id,v.captured_at,v.metadata_status,v.condition_snapshot_id,
      v.public_at,v.terms_version,v.moderation_status,s.latitude,s.longitude FROM videos v
      LEFT JOIN spots s ON s.id=v.spot_id WHERE v.id=? AND v.user_id=?`).bind(row.id, row.user_id).first<CompletingVideo>();
    if (!video || video.metadata_status === "deleting") return "done";
    const status = await provider.getStatus(row.provider_video_id);
    const resolved = resolveVideoStatus(provider.provider, status, null);
    await finalizeVideoUpload(env, row.user_id, video, resolved);
    if (resolved.invalidDuration || resolved.state === "error") throw new Error("LINE_VIDEO_REJECTED");
    if (!resolved.canPublish) return "retry";
    await env.DB.prepare(`UPDATE line_upload_drafts SET transfer_status='ready',upload_url=NULL,error_code=NULL
      WHERE id=? AND status='confirmed' AND lease_token=?`).bind(row.id, lease).run();
    return "done";
  } catch (error) {
    const terminal = error instanceof Error && ["LINE_CONTENT_EXPIRED", "LINE_TRANSFER_EXHAUSTED", "LINE_VIDEO_REJECTED", "LINE_VIDEO_TOO_LARGE", "LINE_VIDEO_CONTENT_INVALID"].includes(error.message);
    if (terminal) {
      await failLineUpload(env, row.id);
      return "done";
    }
    return "retry";
  } finally {
    await env.DB.prepare("UPDATE line_upload_drafts SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?").bind(row.id, lease).run();
  }
}

async function failLineUpload(env: AppEnv, id: string) {
  // Keep provider ID for bounded maintenance cleanup, even if deletion fails now.
  await env.DB.batch([
    env.DB.prepare("UPDATE line_upload_drafts SET transfer_status='failed',upload_url=NULL,error_code='UPLOAD_FAILED' WHERE id=? AND transfer_status<>'ready'").bind(id),
    env.DB.prepare("UPDATE videos SET public_at=NULL,metadata_status='deleting' WHERE id=? AND EXISTS (SELECT 1 FROM line_upload_drafts WHERE id=? AND transfer_status='failed')").bind(id, id),
  ]);
}

export async function consumeLineUploads(batch: MessageBatch<unknown>, env: AppEnv) {
  for (const message of batch.messages) {
    const job = jobSchema.safeParse(message.body);
    if (!job.success) { message.ack(); continue; }
    try {
      if (await processLineUpload(env, job.data.draftId) === "done") message.ack();
      else if (message.attempts >= 20) { await failLineUpload(env, job.data.draftId); message.ack(); }
      else message.retry({ delaySeconds: 30 });
    } catch { message.retry({ delaySeconds: 60 }); }
  }
}

/** Piggyback existing maintenance; bounded recovery of enqueue failures and expired/private assets. */
export async function maintainLineDrafts(env: AppEnv, now = new Date()) {
  if (!env.LINE_UPLOAD_QUEUE) return;
  const rows = (await env.DB.prepare(`SELECT * FROM line_upload_drafts WHERE
    (status='confirmed' AND transfer_status NOT IN ('ready','failed')) OR
    expires_at<=? OR ((status='cancelled' OR transfer_status='failed') AND provider_video_id IS NOT NULL)
    ORDER BY created_at LIMIT 10`)
    .bind(now.toISOString()).all<LineDraftRow>()).results;
  for (const row of rows) {
    if (row.transfer_status === "ready" && row.status !== "cancelled") {
      await env.DB.prepare("DELETE FROM line_upload_drafts WHERE id=? AND transfer_status='ready' AND status<>'cancelled'").bind(row.id).run();
    } else if (row.expires_at <= now.toISOString() || row.status === "cancelled" || row.transfer_status === "failed") {
      // Preserve a failed card until expiry, while immediately reclaiming the private asset.
      if (row.transfer_status !== "failed") await env.DB.prepare("UPDATE line_upload_drafts SET status='cancelled' WHERE id=?").bind(row.id).run();
      if (row.provider_video_id) await createVideoProvider(env).deleteVideo(row.provider_video_id);
      await env.DB.batch([
        env.DB.prepare("UPDATE videos SET public_at=NULL,metadata_status='deleting' WHERE id=? AND user_id=?").bind(row.id, row.user_id),
        env.DB.prepare("UPDATE line_upload_drafts SET provider_video_id=NULL,upload_url=NULL WHERE id=?").bind(row.id),
      ]);
      if (row.expires_at <= now.toISOString()) await env.DB.prepare("DELETE FROM line_upload_drafts WHERE id=? AND expires_at<=?").bind(row.id, now.toISOString()).run();
    } else await env.LINE_UPLOAD_QUEUE.send({ draftId: row.id });
  }
}
