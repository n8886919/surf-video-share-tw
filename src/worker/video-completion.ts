import type { AppEnv } from "./db";
import { attachConditionsBestEffort } from "./enrichment";
import type { ResolvedVideoStatus } from "./video-status";

export interface CompletingVideo {
  id: string; captured_at: string | null; metadata_status: string;
  condition_snapshot_id: string | null; public_at: string | null;
  terms_version: string | null; moderation_status: string;
  latitude: number | null; longitude: number | null;
}

/** Publication follows provider-verified duration; a concurrent removal always wins. */
export async function finalizeVideoUpload(env: AppEnv, userId: string, video: CompletingVideo, resolved: ResolvedVideoStatus) {
  let conditionSnapshotId: string | null = null;
  if (!video.condition_snapshot_id && video.captured_at && video.latitude != null && video.longitude != null) {
    conditionSnapshotId = await attachConditionsBestEffort(env, {
      latitude: video.latitude, longitude: video.longitude, validTime: video.captured_at, videoId: video.id,
    });
  }
  const now = new Date().toISOString();
  const publicAt = video.metadata_status === "complete" && video.terms_version
    && video.moderation_status === "visible" && resolved.canPublish ? video.public_at ?? now : null;
  await env.DB.prepare(`UPDATE videos SET status = ?, duration_seconds = ?, uploaded_at = COALESCE(uploaded_at, ?),
     condition_snapshot_id = COALESCE(?, condition_snapshot_id),
     public_at = CASE WHEN moderation_status = 'visible' THEN ? ELSE NULL END, updated_at = ?,
     metadata_expires_at = CASE WHEN ? = 'ready' AND metadata_status = 'complete' THEN NULL ELSE metadata_expires_at END
     WHERE id = ? AND user_id = ? AND metadata_status <> 'deleting'`)
    .bind(resolved.state, resolved.durationSeconds, now, conditionSnapshotId, publicAt, now, resolved.state, video.id, userId).run();
  return { conditionsAttached: Boolean(conditionSnapshotId) };
}
