import { z } from "zod";

// Strip unknown provider fields; never store the webhook, subjects or reply tokens in logs.
export const lineWebhookSchema = z.object({
  destination: z.string().regex(/^U[0-9a-f]{32}$/),
  events: z.array(z.object({
    type: z.string(), timestamp: z.number().int().nonnegative(),
    mode: z.enum(["active", "standby"]).optional(),
    webhookEventId: z.string().max(100),
    replyToken: z.string().max(100).optional(),
    source: z.object({ type: z.string(), userId: z.string().regex(/^U[0-9a-f]{32}$/).optional() }),
    message: z.object({ id: z.string().regex(/^\d{1,100}$/), type: z.string(),
      duration: z.number().nonnegative().optional(),
      contentProvider: z.object({ type: z.string() }).optional(),
    }).optional(),
    postback: z.object({ data: z.string().max(300), params: z.object({ datetime: z.string().max(20).optional() }).optional() }).optional(),
    unsend: z.object({ messageId: z.string().regex(/^\d{1,100}$/) }).optional(),
  })).max(100),
});

export const linePostbackSchema = z.object({
  draft: z.string().uuid(), revision: z.coerce.number().int().min(0).max(1_000_000),
  action: z.enum(["confirm", "spots", "spot", "time", "status"]),
  spot: z.string().min(1).max(100).optional(),
  page: z.coerce.number().int().min(0).max(3).optional(),
}).strict();
