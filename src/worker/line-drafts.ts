import type { AppEnv } from "./db";
import { lineUploadDraftSchema, type LineUploadDraft } from "../../packages/domain/src/line-upload-draft";

export interface LineDraftRow {
  id: string; user_id: string; message_id: string; revision: number; status: "draft" | "confirmed" | "cancelled";
  spot_id: string | null; captured_at: string | null; terms_version: string; expires_at: string;
  transfer_status: string; provider_video_id: string | null; upload_url: string | null;
  lease_token: string | null; lease_until: string | null; transfer_attempts: number;
  error_code: string | null; created_at: string; updated_at: string;
}
export function toLineDraft(row: LineDraftRow): LineUploadDraft {
  return lineUploadDraftSchema.parse({ id: row.id, userId: row.user_id, revision: row.revision,
    status: row.status, spotId: row.spot_id, capturedAt: row.captured_at,
    expiresAt: row.expires_at, termsVersion: row.terms_version });
}
export function readLineDraft(env: AppEnv, id: string) {
  return env.DB.prepare("SELECT * FROM line_upload_drafts WHERE id = ?").bind(id).first<LineDraftRow>();
}
export async function enqueueLineDraft(env: AppEnv, row: LineDraftRow) {
  if (row.status === "confirmed" && !["ready", "failed"].includes(row.transfer_status)) {
    if (!env.LINE_UPLOAD_QUEUE) throw new Error("LINE_QUEUE_NOT_CONFIGURED");
    if (row.lease_until && row.lease_until > new Date().toISOString()) return;
    if (!env.UPLOAD_RATE_LIMITER || !(await env.UPLOAD_RATE_LIMITER.limit({ key: `line-job:${row.user_id}` })).success) return;
    await env.LINE_UPLOAD_QUEUE.send({ draftId: row.id });
  }
}
