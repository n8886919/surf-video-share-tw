import { assertWithinUploadWindow, PUBLIC_MEDIA_TERMS_VERSION } from "../../packages/domain/src";
import type { AppEnv } from "./db";
import type { UploadTicket } from "./providers/types";

/** Both clients create the same private video record, with the same capture/expiry policy. */
export function prepareVideoInsert(env: AppEnv, input: {
  id: string; userId: string; spotId: string; capturedAt: string; ticket: UploadTicket;
  durationSeconds: number | null; showUploader: boolean; fileSha256?: string; sizeBytes?: number;
  // LINE transfer keeps its provider asset private and outside videos until bytes are accepted.
  lineLease?: string;
}, now = new Date()): D1PreparedStatement {
  assertWithinUploadWindow(input.capturedAt, now);
  const guard = input.lineLease ? ` WHERE EXISTS (SELECT 1 FROM line_upload_drafts
    WHERE id = ? AND user_id = ? AND status = 'confirmed' AND transfer_status = 'processing'
      AND lease_token = ? AND expires_at > ?)` : "";
  const values = [input.id, input.userId, input.spotId, input.ticket.provider, input.ticket.providerVideoId,
    input.capturedAt, input.durationSeconds, "awaiting_upload", input.showUploader ? 1 : 0, "complete",
    new Date(now.getTime() + 7 * 86_400_000).toISOString(), 0, PUBLIC_MEDIA_TERMS_VERSION, "visible",
    now.toISOString(), now.toISOString(), input.fileSha256 ?? null, input.fileSha256 ? input.sizeBytes ?? null : null];
  if (input.lineLease) values.push(input.id, input.userId, input.lineLease, now.toISOString());
  return env.DB.prepare(`INSERT INTO videos (
      id, user_id, spot_id, video_provider, provider_video_id, captured_at,
      duration_seconds, status, show_uploader, metadata_status,
      metadata_expires_at, is_favorite, terms_version, moderation_status,
      created_at, updated_at, client_file_sha256, client_file_size_bytes
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${guard}
    ON CONFLICT(id) DO NOTHING`).bind(...values);
}
