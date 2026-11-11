import { z } from "zod";
import { assertWithinUploadWindow } from "./time-policy";
import { PUBLIC_MEDIA_TERMS_VERSION } from "./public-terms";

export const lineUploadDraftSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  status: z.enum(["draft", "confirmed", "cancelled"]),
  spotId: z.string().min(1).nullable(),
  capturedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime(),
  termsVersion: z.string(),
}).strict();

export type LineUploadDraft = z.infer<typeof lineUploadDraftSchema>;

export const lineDraftActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm") }).strict(),
  z.object({ action: z.literal("spot"), spotId: z.string().min(1) }).strict(),
  z.object({ action: z.literal("time"), datetime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) }).strict(),
]);

/** Pure decision only. Persistence must CAS on owner + revision + draft status. */
export function applyLineDraftAction(input: {
  draft: LineUploadDraft; actorId: string; expectedRevision: number;
  action: z.infer<typeof lineDraftActionSchema>; activeSpotIds: readonly string[]; now: Date;
}): LineUploadDraft {
  const draft = lineUploadDraftSchema.parse(input.draft);
  const action = lineDraftActionSchema.parse(input.action);
  if (draft.userId !== input.actorId) throw new Error("DRAFT_NOT_FOUND");
  if (Date.parse(draft.expiresAt) <= input.now.getTime()) throw new Error("DRAFT_EXPIRED");
  if (draft.status !== "draft") throw new Error("DRAFT_CLOSED");
  if (draft.revision !== input.expectedRevision) throw new Error("DRAFT_STALE");
  const next = { ...draft, revision: draft.revision + 1 };
  if (action.action === "spot") next.spotId = action.spotId;
  if (action.action === "time") {
    const date = new Date(`${action.datetime}:00+08:00`);
    if (!Number.isFinite(date.getTime())
      || new Date(date.getTime() + 8 * 3_600_000).toISOString().slice(0, 16) !== action.datetime) {
      throw new Error("CAPTURE_TIME_INVALID");
    }
    next.capturedAt = date.toISOString();
    assertWithinUploadWindow(next.capturedAt, input.now);
  }
  if (next.spotId !== null && !input.activeSpotIds.includes(next.spotId)) throw new Error("SPOT_NOT_FOUND");
  if (action.action === "confirm") {
    if (!next.spotId || !next.capturedAt) throw new Error("DRAFT_INCOMPLETE");
    if (next.termsVersion !== PUBLIC_MEDIA_TERMS_VERSION) throw new Error("TERMS_CHANGED");
    assertWithinUploadWindow(next.capturedAt, input.now);
    next.status = "confirmed";
  }
  return next;
}
