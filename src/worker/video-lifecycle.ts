import type { AppEnv } from "./db";
import { createVideoProvider } from "./providers";
import type { VideoProvider } from "./providers";
import { resolveVideoStatus } from "./video-status";

interface ExpiredVideoRow {
  id: string;
  video_provider: string;
  provider_video_id: string;
  metadata_status: "pending" | "complete" | "deleting";
  duration_seconds: number | null;
  terms_version: string | null;
  moderation_status: string;
  updated_at: string;
}

interface CleanupOptions {
  userId?: string;
  limit?: number;
}

export interface ExpiredVideoCleanupSummary {
  cutoff: string;
  selected: number;
  claimed: number;
  deleted: number;
  failed: number;
  skipped: number;
  failures: Array<{ videoId: string; message: string }>;
}

type VideoProviderFactory = (env: AppEnv) => VideoProvider;

const DEFAULT_CLEANUP_LIMIT = 50;
const MAX_CLEANUP_LIMIT = 100;
const CLEANUP_LEASE_MS = 15 * 60_000;

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

function cleanupLimit(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_CLEANUP_LIMIT;
  if (!Number.isInteger(requested) || requested < 1) {
    throw new Error("Expired video cleanup limit must be a positive integer");
  }
  return Math.min(requested, MAX_CLEANUP_LIMIT);
}

export async function cleanupExpiredPendingVideos(
  env: AppEnv,
  cutoff: Date,
  options: CleanupOptions = {},
  providerFactory: VideoProviderFactory = createVideoProvider,
): Promise<ExpiredVideoCleanupSummary> {
  const cutoffIso = cutoff.toISOString();
  const leaseExpiredAt = new Date(cutoff.getTime() - CLEANUP_LEASE_MS).toISOString();
  const limit = cleanupLimit(options.limit);
  const scope = options.userId ? "AND user_id = ?" : "";
  const statement = env.DB.prepare(
    `SELECT id, video_provider, provider_video_id, metadata_status, updated_at,
            duration_seconds, terms_version, moderation_status
     FROM videos
     WHERE (
       (metadata_status = 'pending' AND metadata_expires_at IS NOT NULL AND metadata_expires_at <= ?)
       OR (metadata_status = 'complete' AND status IN ('awaiting_upload', 'pending', 'processing', 'error')
           AND julianday(created_at) <= julianday(?) - 7)
       OR (metadata_status = 'deleting' AND updated_at <= ?)
     )
     ${scope}
     ORDER BY CASE
       WHEN metadata_status = 'deleting' THEN updated_at
       ELSE metadata_expires_at
     END ASC
     LIMIT ?`,
  );
  const expired = options.userId
    ? await statement.bind(cutoffIso, cutoffIso, leaseExpiredAt, options.userId, limit).all<ExpiredVideoRow>()
    : await statement.bind(cutoffIso, cutoffIso, leaseExpiredAt, limit).all<ExpiredVideoRow>();
  const summary: ExpiredVideoCleanupSummary = {
    cutoff: cutoffIso,
    selected: expired.results.length,
    claimed: 0,
    deleted: 0,
    failed: 0,
    skipped: 0,
    failures: [],
  };
  if (!expired.results.length) return summary;

  const provider = providerFactory(env);
  for (const video of expired.results) {
    const claimedAt = new Date().toISOString();
    // A lost completion request must not cause a successfully transferred video to be deleted.
    if (video.metadata_status === "complete") {
      try {
        if (video.video_provider !== provider.provider) throw new Error("Video provider mismatch");
        const resolved = resolveVideoStatus(provider.provider, await provider.getStatus(video.provider_video_id), video.duration_seconds);
        if (resolved.canPublish && video.terms_version) {
          await env.DB.prepare(`UPDATE videos SET status = 'ready', duration_seconds = ?,
            uploaded_at = COALESCE(uploaded_at, ?), metadata_expires_at = NULL,
            public_at = CASE WHEN moderation_status = 'visible' THEN COALESCE(public_at, ?) ELSE NULL END,
            updated_at = ? WHERE id = ? AND metadata_status = 'complete' AND updated_at = ?`)
            .bind(resolved.durationSeconds, claimedAt, claimedAt, claimedAt, video.id, video.updated_at).run();
          summary.skipped += 1;
          continue;
        }
      } catch {
        summary.failed += 1;
        summary.failures.push({ videoId: video.id, message: "Provider status could not be verified before cleanup" });
        continue;
      }
    }
    const claim = await env.DB.prepare(
      `UPDATE videos SET metadata_status = 'deleting', public_at = NULL, updated_at = ?
       WHERE id = ? AND metadata_status = ? AND updated_at = ?`,
    ).bind(claimedAt, video.id, video.metadata_status, video.updated_at).run();
    if (claim.meta.changes !== 1) {
      summary.skipped += 1;
      continue;
    }
    summary.claimed += 1;

    try {
      if (video.video_provider !== env.VIDEO_PROVIDER) {
        throw new Error(`Configured video provider does not match stored provider ${video.video_provider}`);
      }
      await provider.deleteVideo(video.provider_video_id);
      const deletion = await env.DB.prepare(
        `DELETE FROM videos WHERE id = ? AND metadata_status = 'deleting' AND updated_at = ?`,
      ).bind(video.id, claimedAt).run();
      if (deletion.meta.changes !== 1) {
        throw new Error("Expired video changed after cleanup claim");
      }
      summary.deleted += 1;
    } catch (error) {
      summary.failed += 1;
      summary.failures.push({ videoId: video.id, message: safeErrorMessage(error) });
    }
  }
  return summary;
}

export async function runScheduledExpiredVideoCleanup(
  env: AppEnv,
  scheduledAt: Date,
): Promise<ExpiredVideoCleanupSummary> {
  try {
    const summary = await cleanupExpiredPendingVideos(env, scheduledAt);
    const log = JSON.stringify({ event: "expired_video_cleanup", scheduledAt: scheduledAt.toISOString(), ...summary });
    if (summary.failed) console.warn(log);
    else console.log(log);
    return summary;
  } catch (error) {
    console.error(JSON.stringify({
      event: "expired_video_cleanup",
      scheduledAt: scheduledAt.toISOString(),
      status: "failed",
      message: safeErrorMessage(error),
    }));
    throw error;
  }
}
