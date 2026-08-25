import { z } from "zod";

export const updateMeSchema = z.object({
  displayId: z.string().trim().min(2).max(24).regex(/^[A-Za-z0-9._-]+$/).nullable(),
  showIdentityDefault: z.boolean(),
});

export const uploadRequestSchema = z.object({
  spotId: z.string().min(1).nullable().optional(),
  capturedAt: z.string().datetime({ offset: true }).nullable().optional(),
  durationSeconds: z.number().min(5).max(60),
  sizeBytes: z.number().int().positive().max(200 * 1024 * 1024),
  fileName: z.string().min(1).max(255),
  contentType: z.string().startsWith("video/"),
  showUploader: z.boolean().optional(),
});

export const completeUploadSchema = z.object({
  providerVideoId: z.string().min(1),
});

export const updateVideoSchema = z.object({
  spotId: z.string().min(1).nullable().optional(),
  capturedAt: z.string().datetime({ offset: true }).nullable().optional(),
  showUploader: z.boolean().optional(),
  isFavorite: z.boolean().optional(),
  uploaderNote: z.string().trim().max(100).nullable().optional(),
  funReaction: z.enum(["fun", "not_fun"]).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, "至少提供一個更新欄位");

export const matchQuerySchema = z.object({
  spotId: z.string().min(1),
  targetTime: z.string().datetime({ offset: true }),
});

export const reportVideoSchema = z.object({
  reason: z.enum(["privacy", "minor", "copyright", "irrelevant"]),
});

export type UploadRequestInput = z.infer<typeof uploadRequestSchema>;
