import type { AppEnv } from "./db";

const PLAYBACK_EVENT_RETENTION_DAYS = 90;
const PLAYBACK_EVENT_CLEANUP_BATCH = 500;

export interface PlaybackEventCleanupResult {
  selected: number;
  deleted: number;
  cutoff: string;
}

export async function cleanupExpiredPlaybackEvents(
  env: Pick<AppEnv, "DB">,
  now = new Date(),
): Promise<PlaybackEventCleanupResult> {
  const cutoff = new Date(now.getTime() - PLAYBACK_EVENT_RETENTION_DAYS * 86_400_000).toISOString();
  const expired = await env.DB.prepare(
    `SELECT id FROM video_playback_events WHERE started_at < ? ORDER BY started_at LIMIT ?`,
  ).bind(cutoff, PLAYBACK_EVENT_CLEANUP_BATCH).all<{ id: string }>();
  if (!expired.results.length) return { selected: 0, deleted: 0, cutoff };
  const results = await env.DB.batch(expired.results.map((event) =>
    env.DB.prepare(`DELETE FROM video_playback_events WHERE id = ? AND started_at < ?`)
      .bind(event.id, cutoff),
  ));
  return {
    selected: expired.results.length,
    deleted: results.reduce((total, result) => total + Number(result.meta.changes ?? 0), 0),
    cutoff,
  };
}

export async function runScheduledPlaybackEventCleanup(
  env: Pick<AppEnv, "DB">,
  now = new Date(),
): Promise<PlaybackEventCleanupResult> {
  const result = await cleanupExpiredPlaybackEvents(env, now);
  console.log(JSON.stringify({ event: "playback_event_cleanup", ...result }));
  return result;
}
