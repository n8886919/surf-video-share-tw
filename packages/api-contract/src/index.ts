import { z } from "zod";

export const updateMeSchema = z.object({
  displayId: z.string().trim().min(2).max(24).regex(/^[A-Za-z0-9._-]+$/).nullable(),
  showIdentityDefault: z.boolean(),
});

export const uploadRequestSchema = z.object({
  spotId: z.string().min(1),
  capturedAt: z.string().datetime({ offset: true }),
  durationSeconds: z.number().min(5).max(60),
  sizeBytes: z.number().int().positive().max(200 * 1024 * 1024),
  fileName: z.string().min(1).max(255),
  contentType: z.string().startsWith("video/"),
  showUploader: z.boolean().optional(),
});

export const completeUploadSchema = z.object({
  providerVideoId: z.string().min(1),
});

export const updateVideoSchema = z.object({ showUploader: z.boolean() });

export type UploadRequestInput = z.infer<typeof uploadRequestSchema>;
