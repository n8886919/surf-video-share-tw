import { z } from "zod";
import type { AppEnv } from "./db";
import { PROJECT_VERSION } from "../../packages/domain/src/project-purpose";
import { PRODUCT_TIME_ZONE } from "../../packages/domain/src/time-policy";

export function journeyDay(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: PRODUCT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export const journeyDetailsSchema = z.object({
  stage: z.enum(["selection", "ticket", "transfer", "completion", "player", "sdk", "tracking", "search"]).optional(),
  outcome: z.enum(["started", "success", "failed", "none", "no_videos", "missing_target", "insufficient_history"]).optional(),
  durationMs: z.number().int().min(0).max(3_600_000).optional(),
  status: z.number().int().min(100).max(599).optional(),
  spotId: z.string().regex(/^spot_[a-z0-9-]{1,70}$/).optional(),
  targetTime: z.string().datetime().optional(),
  resultCount: z.number().int().min(0).max(100_000).optional(),
  videoId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).optional(),
  searchTraceId: z.string().uuid().optional(),
  os: z.enum(["android", "ios", "windows", "macos", "other"]).optional(),
  browser: z.enum(["line", "chrome", "safari", "edge", "firefox", "other"]).optional(),
  version: z.string().regex(/^\d+\.\d+(?:\.\d+)?$/).optional(),
}).strict();

export type JourneyDetails = z.infer<typeof journeyDetailsSchema>;

/** Fixed fields only; never accept an arbitrary error, URL, filename, identity or request body. */
export async function recordJourney(env: AppEnv, event: string, traceId: string, details: JourneyDetails,
  source: "server" | "client" = "server", now = new Date()): Promise<void> {
  const parsed = journeyDetailsSchema.safeParse(details);
  if (!parsed.success) return;
  const occurredAt = now.toISOString();
  const day = journeyDay(now);
  const safe = { ...parsed.data, ...(source === "server" ? { version: PROJECT_VERSION } : {}) };
  const outcome = safe.stage ? `${safe.stage}:${safe.outcome ?? "unknown"}` : safe.outcome ?? "unknown";
  console.info(JSON.stringify({ event: "journey", kind: event, traceId, source, occurredAt, ...safe }));
  try {
    // One budget row per Taipei day and source. Saturation leaves console evidence and
    // must never block the product. Client events are explicitly untrusted reports.
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO journey_events (id, trace_id, event, source, details_json, occurred_at)
        SELECT ?, ?, ?, ?, ?, ? WHERE COALESCE((SELECT SUM(count) FROM journey_daily
          WHERE day = ? AND source = ?), 0) < 2000`)
        .bind(id, traceId, event, source, JSON.stringify(safe), occurredAt, day, source),
      env.DB.prepare(`INSERT INTO journey_daily (day, source, event, outcome, count)
        SELECT ?, ?, ?, ?, 1 WHERE EXISTS (SELECT 1 FROM journey_events WHERE id = ?)
        ON CONFLICT(day, source, event, outcome) DO UPDATE SET count = count + 1`)
        .bind(day, source, event, outcome, id),
    ]);
  } catch {
    console.warn(JSON.stringify({ event: "journey_storage_unavailable", kind: event, traceId }));
  }
}

export async function cleanupJourneys(env: AppEnv, now: Date): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM journey_events WHERE id IN
      (SELECT id FROM journey_events WHERE occurred_at < ? ORDER BY occurred_at LIMIT 500)`)
      .bind(new Date(now.getTime() - 7 * 86_400_000).toISOString()),
    env.DB.prepare("DELETE FROM journey_daily WHERE day < ?")
      .bind(journeyDay(new Date(now.getTime() - 30 * 86_400_000))),
  ]);
}
