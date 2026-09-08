// The browser claims this fingerprint: it may suggest a public duplicate,
// but must never grant ownership, expose private media or impose a global lock.
export const RECENT_UPLOAD_DUPLICATE_SQL = `SELECT id FROM videos
  WHERE client_file_sha256 IS NOT NULL AND client_file_sha256 = ?
    AND client_file_size_bytes = ? AND uploaded_at > ? AND uploaded_at <= ?
    AND status = 'ready' AND metadata_status = 'complete'
    AND public_at IS NOT NULL AND terms_version IS NOT NULL
    AND moderation_status = 'visible'
  ORDER BY uploaded_at DESC, id LIMIT 1`;

export async function findRecentPublicDuplicate(
  db: D1Database, fileSha256: string, sizeBytes: number, now: Date,
): Promise<{ id: string } | null> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  return db.prepare(RECENT_UPLOAD_DUPLICATE_SQL)
    .bind(fileSha256, sizeBytes, cutoff, now.toISOString()).first<{ id: string }>();
}
