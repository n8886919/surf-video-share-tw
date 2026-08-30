import { z } from "zod";
import type { AppEnv } from "./db";

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const OPS_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
const EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const ANALYSIS_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const ERROR_BURST_WINDOW_MS = 5 * 60 * 1_000;
const ERROR_BURST_THRESHOLD = 3;
const INCIDENT_STALE_MS = 30 * 60 * 1_000;
const LINE_USER_ID_PATTERN = /^U[0-9a-f]{32}$/iu;

export type OpsEventSeverity = "info" | "warning" | "error" | "critical";
export type OpsEventSource = "api" | "scheduled" | "provider" | "system";

export interface OpsEventInput {
  code: string;
  severity: OpsEventSeverity;
  source: OpsEventSource;
  fingerprint?: string;
  requestId?: string;
  route?: string;
  errorName?: string;
  summary?: string;
  forceIncident?: boolean;
}

interface OpsIncidentRow {
  fingerprint: string;
  status: "open" | "recovered";
  severity: "error" | "critical";
  title: string;
  first_seen_at: string;
  last_seen_at: string;
  occurrences: number;
  notified_at: string | null;
  recovered_at: string | null;
  recovery_notified_at: string | null;
}

interface OpsAggregateRow {
  event_code: string;
  severity: string;
  source: string;
  fingerprint: string;
  route: string | null;
  error_name: string | null;
  event_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

const analysisSchema = z.object({
  severity: z.enum(["normal", "watch", "urgent"]),
  summaryZh: z.string().trim().min(1).max(500),
  patterns: z.array(z.object({
    eventCode: z.string().trim().min(1).max(100),
    count: z.number().int().nonnegative(),
    observationZh: z.string().trim().min(1).max(240),
  })).max(5),
  recommendedChecks: z.array(z.string().trim().min(1).max(240)).max(5),
});

export type OpsAnalysis = z.infer<typeof analysisSchema>;

function hasLineConfiguration(env: AppEnv): boolean {
  return Boolean(
    env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN?.trim()
    && env.OPS_LINE_USER_ID
    && LINE_USER_ID_PATTERN.test(env.OPS_LINE_USER_ID),
  );
}

function isHttpsUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function hasCoreProductionConfiguration(env: AppEnv): boolean {
  return Boolean(
    env.VIDEO_PROVIDER === "cloudflare-stream"
    && env.CLOUDFLARE_ACCOUNT_ID?.trim()
    && env.CLOUDFLARE_STREAM_API_TOKEN?.trim()
    && isHttpsUrl(env.PUBLIC_SITE_ORIGIN)
    && env.LINE_CHANNEL_ID?.trim()
    && env.LINE_CHANNEL_SECRET?.trim()
    && isHttpsUrl(env.LINE_CALLBACK_URL)
    && env.SESSION_SECRET?.trim()
    && env.ADMIN_USER_ID?.trim()
    && env.FORECAST_INGESTION_SECRET?.trim()
    && env.UPLOAD_RATE_LIMITER
    && env.PLAYBACK_RATE_LIMITER
    && env.DOWNLOAD_RATE_LIMITER
    && env.PUBLIC_WRITE_RATE_LIMITER
  );
}

function bounded(value: string | undefined, maximum: number): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maximum) : null;
}

export function sanitizeOpsSummary(value: string | undefined): string | null {
  const summary = bounded(value, 500);
  if (!summary) return null;
  return summary
    .replace(/(bearer\s+)[^\s]+/giu, "$1[REDACTED]")
    .replace(/([?&](?:authorization|code|key|secret|sig|signature|token)=)[^&\s]+/giu, "$1[REDACTED]")
    .replace(/https?:\/\/[^\s]+/giu, "[URL_REDACTED]")
    .slice(0, 300);
}

function normalizeCode(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_.:-]+/gu, "-");
  return (normalized || "ops.unknown").slice(0, 100);
}

function incidentTitle(code: string): string {
  return `系統事件：${code}`.slice(0, 160);
}

function structuredLog(level: "log" | "warn" | "error", payload: Record<string, unknown>): void {
  console[level](JSON.stringify(payload));
}

export async function sendLineNotification(
  env: AppEnv,
  message: string,
  fetchImpl: typeof fetch = fetch,
): Promise<"sent" | "unconfigured"> {
  const token = env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
  const target = env.OPS_LINE_USER_ID;
  if (!hasLineConfiguration(env) || !token || !target) return "unconfigured";

  const response = await fetchImpl(LINE_PUSH_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({
      to: target,
      messages: [{ type: "text", text: message.trim().slice(0, 1_000) }],
    }),
  });
  if (!response.ok) {
    throw new Error(`LINE Messaging API rejected the operations alert (${response.status})`);
  }
  return "sent";
}

async function upsertOpenIncident(
  env: AppEnv,
  fingerprint: string,
  severity: "error" | "critical",
  title: string,
  occurredAt: string,
): Promise<{ incident: OpsIncidentRow; opened: boolean }> {
  const existing = await env.DB.prepare(
    `SELECT fingerprint, status, severity, title, first_seen_at, last_seen_at, occurrences,
            notified_at, recovered_at, recovery_notified_at
     FROM ops_incidents WHERE fingerprint = ?`,
  ).bind(fingerprint).first<OpsIncidentRow>();

  if (existing?.status === "open") {
    await env.DB.prepare(
      `UPDATE ops_incidents
       SET severity = ?, title = ?, last_seen_at = ?, occurrences = occurrences + 1, updated_at = ?
       WHERE fingerprint = ? AND status = 'open'`,
    ).bind(severity, title, occurredAt, occurredAt, fingerprint).run();
    return {
      incident: {
        ...existing,
        severity,
        title,
        last_seen_at: occurredAt,
        occurrences: existing.occurrences + 1,
      },
      opened: false,
    };
  }

  await env.DB.prepare(
    `INSERT INTO ops_incidents (
       fingerprint, status, severity, title, first_seen_at, last_seen_at, occurrences,
       notified_at, recovered_at, recovery_notified_at, updated_at
     ) VALUES (?, 'open', ?, ?, ?, ?, 1, NULL, NULL, NULL, ?)
     ON CONFLICT(fingerprint) DO UPDATE SET
       status = 'open', severity = excluded.severity, title = excluded.title,
       first_seen_at = excluded.first_seen_at, last_seen_at = excluded.last_seen_at,
       occurrences = 1, notified_at = NULL, recovered_at = NULL,
       recovery_notified_at = NULL, updated_at = excluded.updated_at`,
  ).bind(fingerprint, severity, title, occurredAt, occurredAt, occurredAt).run();

  return {
    incident: {
      fingerprint,
      status: "open",
      severity,
      title,
      first_seen_at: occurredAt,
      last_seen_at: occurredAt,
      occurrences: 1,
      notified_at: null,
      recovered_at: null,
      recovery_notified_at: null,
    },
    opened: true,
  };
}

async function notifyOpenIncident(
  env: AppEnv,
  incident: OpsIncidentRow,
  now: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const result = await sendLineNotification(
    env,
    [
      "🚨 彼日浪影系統緊急事件",
      incident.title,
      `首次發生：${incident.first_seen_at}`,
      `最近發生：${incident.last_seen_at}`,
      "請先查看 Cloudflare Workers Logs；通知未包含使用者資料或秘密。",
    ].join("\n"),
    fetchImpl,
  );
  if (result === "unconfigured") {
    structuredLog("error", { event: "ops_line_unconfigured", fingerprint: incident.fingerprint });
    return;
  }
  await env.DB.prepare(
    `UPDATE ops_incidents SET notified_at = ?, updated_at = ?
     WHERE fingerprint = ? AND status = 'open' AND notified_at IS NULL`,
  ).bind(now, now, incident.fingerprint).run();
}

async function notifyRecoveredIncident(
  env: AppEnv,
  incident: OpsIncidentRow,
  now: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const result = await sendLineNotification(
    env,
    [
      "✅ 彼日浪影系統事件暫未再發生",
      incident.title,
      `首次發生：${incident.first_seen_at}`,
      `最後發生：${incident.last_seen_at}`,
      `恢復判定：${incident.recovered_at ?? now}`,
      "判定依據：至少 30 分鐘沒有相同事件；仍請以服務狀態與 Logs 為準。",
    ].join("\n"),
    fetchImpl,
  );
  if (result === "unconfigured") return;
  await env.DB.prepare(
    `UPDATE ops_incidents SET recovery_notified_at = ?, updated_at = ?
     WHERE fingerprint = ? AND status = 'recovered' AND recovery_notified_at IS NULL`,
  ).bind(now, now, incident.fingerprint).run();
}

async function maybeOpenIncident(
  env: AppEnv,
  event: Required<Pick<OpsEventInput, "code" | "severity">> & { fingerprint: string },
  occurredAt: string,
  fetchImpl: typeof fetch,
  forceIncident: boolean,
): Promise<boolean> {
  let shouldOpen = forceIncident || event.severity === "critical";
  if (!shouldOpen && event.severity === "error") {
    const windowStart = new Date(new Date(occurredAt).getTime() - ERROR_BURST_WINDOW_MS).toISOString();
    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM ops_events
       WHERE fingerprint = ? AND occurred_at >= ? AND occurred_at <= ?`,
    ).bind(event.fingerprint, windowStart, occurredAt).first<{ count: number }>();
    shouldOpen = Number(count?.count ?? 0) >= ERROR_BURST_THRESHOLD;
  }
  if (!shouldOpen) return false;

  const severity = event.severity === "critical" ? "critical" : "error";
  const { incident, opened } = await upsertOpenIncident(
    env,
    event.fingerprint,
    severity,
    incidentTitle(event.code),
    occurredAt,
  );
  if (opened) {
    try {
      await notifyOpenIncident(env, incident, occurredAt, fetchImpl);
    } catch (error) {
      structuredLog("error", {
        event: "ops_line_delivery_failed",
        fingerprint: incident.fingerprint,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
  return opened;
}

export async function recordOpsEvent(
  env: AppEnv,
  input: OpsEventInput,
  options: { now?: Date; fetchImpl?: typeof fetch } = {},
): Promise<{ recorded: boolean; incidentOpened: boolean }> {
  const now = options.now ?? new Date();
  const occurredAt = now.toISOString();
  const code = normalizeCode(input.code);
  const fingerprint = normalizeCode(input.fingerprint ?? `${code}:${input.route ?? "global"}`);
  const event = {
    id: crypto.randomUUID(),
    code,
    severity: input.severity,
    source: input.source,
    fingerprint,
    requestId: bounded(input.requestId, 100),
    route: bounded(input.route, 160),
    errorName: bounded(input.errorName, 100),
    summary: sanitizeOpsSummary(input.summary),
  };

  try {
    await env.DB.prepare(
      `INSERT INTO ops_events (
         id, event_code, severity, source, fingerprint, request_id, route,
         error_name, summary, occurred_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      event.id,
      event.code,
      event.severity,
      event.source,
      event.fingerprint,
      event.requestId,
      event.route,
      event.errorName,
      event.summary,
      occurredAt,
      occurredAt,
    ).run();
    structuredLog(event.severity === "critical" || event.severity === "error" ? "warn" : "log", {
      event: "ops_event",
      eventCode: event.code,
      severity: event.severity,
      source: event.source,
      fingerprint: event.fingerprint,
      requestId: event.requestId,
      route: event.route,
      errorName: event.errorName,
      occurredAt,
    });
    const incidentOpened = await maybeOpenIncident(
      env,
      { code: event.code, severity: event.severity, fingerprint: event.fingerprint },
      occurredAt,
      options.fetchImpl ?? fetch,
      input.forceIncident === true,
    );
    return { recorded: true, incidentOpened };
  } catch (error) {
    structuredLog("error", {
      event: "ops_event_record_failed",
      eventCode: code,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { recorded: false, incidentOpened: false };
  }
}

function extractAiResponse(result: unknown): unknown {
  if (!result || typeof result !== "object" || !("response" in result)) return result;
  const response = (result as { response: unknown }).response;
  if (typeof response !== "string") return response;
  try {
    return JSON.parse(response) as unknown;
  } catch {
    return response;
  }
}

async function analyzeAggregates(env: AppEnv, rows: OpsAggregateRow[]): Promise<OpsAnalysis> {
  if (!env.AI) throw new Error("Workers AI binding is unavailable");
  const result = await env.AI.run(OPS_AI_MODEL, {
    messages: [
      {
        role: "system",
        content: [
          "你是唯讀的系統維運分析器。只分析提供的去識別化事件統計。",
          "不可假設不存在的使用者資料、秘密或外部狀態。",
          "normal 表示沒有值得注意的模式；watch 表示需人工留意；urgent 表示可能影響登入、上傳、播放、資料庫或排程。",
          "輸出繁體中文並嚴格符合 JSON schema。",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify(rows.map((row) => ({
          eventCode: row.event_code,
          severity: row.severity,
          source: row.source,
          fingerprint: row.fingerprint,
          route: row.route,
          errorName: row.error_name,
          count: Number(row.event_count),
          firstSeenAt: row.first_seen_at,
          lastSeenAt: row.last_seen_at,
        }))),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "summaryZh", "patterns", "recommendedChecks"],
        properties: {
          severity: { type: "string", enum: ["normal", "watch", "urgent"] },
          summaryZh: { type: "string", maxLength: 500 },
          patterns: {
            type: "array",
            maxItems: 5,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["eventCode", "count", "observationZh"],
              properties: {
                eventCode: { type: "string", maxLength: 100 },
                count: { type: "integer", minimum: 0 },
                observationZh: { type: "string", maxLength: 240 },
              },
            },
          },
          recommendedChecks: {
            type: "array",
            maxItems: 5,
            items: { type: "string", maxLength: 240 },
          },
        },
      },
    },
    max_tokens: 700,
    temperature: 0.1,
  });
  return analysisSchema.parse(extractAiResponse(result));
}

async function resolveStaleIncidents(env: AppEnv, now: Date): Promise<void> {
  const recoveredAt = now.toISOString();
  const staleBefore = new Date(now.getTime() - INCIDENT_STALE_MS).toISOString();
  await env.DB.prepare(
    `UPDATE ops_incidents
     SET status = 'recovered', recovered_at = ?, updated_at = ?
     WHERE status = 'open' AND last_seen_at < ?`,
  ).bind(recoveredAt, recoveredAt, staleBefore).run();
}

async function retryPendingIncidentNotifications(
  env: AppEnv,
  now: Date,
  fetchImpl: typeof fetch,
): Promise<void> {
  const result = await env.DB.prepare(
    `SELECT fingerprint, status, severity, title, first_seen_at, last_seen_at, occurrences,
            notified_at, recovered_at, recovery_notified_at
     FROM ops_incidents
     WHERE (status = 'open' AND notified_at IS NULL)
        OR (status = 'recovered' AND notified_at IS NOT NULL AND recovery_notified_at IS NULL)
     ORDER BY updated_at ASC LIMIT 10`,
  ).all<OpsIncidentRow>();
  for (const incident of result.results) {
    try {
      if (incident.status === "open") {
        await notifyOpenIncident(env, incident, now.toISOString(), fetchImpl);
      } else {
        await notifyRecoveredIncident(env, incident, now.toISOString(), fetchImpl);
      }
    } catch (error) {
      structuredLog("error", {
        event: "ops_line_delivery_failed",
        fingerprint: incident.fingerprint,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
}

async function retainBoundedOpsHistory(env: AppEnv, now: Date): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM ops_events WHERE occurred_at < ?")
      .bind(new Date(now.getTime() - EVENT_RETENTION_MS).toISOString()),
    env.DB.prepare("DELETE FROM ops_analysis_runs WHERE created_at < ?")
      .bind(new Date(now.getTime() - ANALYSIS_RETENTION_MS).toISOString()),
  ]);
}

export async function runHourlyOpsAnalysis(
  env: AppEnv,
  scheduledAt: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const windowEnd = scheduledAt.toISOString();
  const windowStart = new Date(scheduledAt.getTime() - 60 * 60 * 1_000).toISOString();
  await retryPendingIncidentNotifications(env, scheduledAt, fetchImpl);
  await resolveStaleIncidents(env, scheduledAt);
  await retryPendingIncidentNotifications(env, scheduledAt, fetchImpl);
  await retainBoundedOpsHistory(env, scheduledAt);

  const existing = await env.DB.prepare(
    "SELECT id FROM ops_analysis_runs WHERE window_start = ? AND window_end = ?",
  ).bind(windowStart, windowEnd).first<{ id: string }>();
  if (existing) {
    structuredLog("log", { event: "ops_analysis", status: "duplicate", windowStart, windowEnd });
    return;
  }

  const aggregates = await env.DB.prepare(
    `SELECT event_code, severity, source, fingerprint, route, error_name,
            COUNT(*) AS event_count, MIN(occurred_at) AS first_seen_at,
            MAX(occurred_at) AS last_seen_at
     FROM ops_events
     WHERE occurred_at >= ? AND occurred_at < ?
     GROUP BY event_code, severity, source, fingerprint, route, error_name
     ORDER BY event_count DESC, last_seen_at DESC
     LIMIT 100`,
  ).bind(windowStart, windowEnd).all<OpsAggregateRow>();
  const eventCount = aggregates.results.reduce((sum, row) => sum + Number(row.event_count), 0);
  const analysisId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  if (eventCount === 0) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO ops_analysis_runs (
         id, window_start, window_end, status, severity, event_count, summary_zh,
         patterns_json, recommended_checks_json, notified_at, created_at
       ) VALUES (?, ?, ?, 'skipped', 'normal', 0, ?, '[]', '[]', NULL, ?)`,
    ).bind(analysisId, windowStart, windowEnd, "本時段沒有結構化維運事件。", createdAt).run();
    structuredLog("log", { event: "ops_analysis", status: "skipped", windowStart, windowEnd, eventCount: 0 });
    return;
  }

  try {
    const analysis = await analyzeAggregates(env, aggregates.results);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO ops_analysis_runs (
         id, window_start, window_end, status, severity, event_count, summary_zh,
         patterns_json, recommended_checks_json, notified_at, created_at
       ) VALUES (?, ?, ?, 'complete', ?, ?, ?, ?, ?, NULL, ?)`,
    ).bind(
      analysisId,
      windowStart,
      windowEnd,
      analysis.severity,
      eventCount,
      analysis.summaryZh,
      JSON.stringify(analysis.patterns),
      JSON.stringify(analysis.recommendedChecks),
      createdAt,
    ).run();

    if (analysis.severity !== "normal") {
      try {
        const notification = await sendLineNotification(
          env,
          [
            `📊 彼日浪影每小時 log 分析（${analysis.severity}）`,
            analysis.summaryZh,
            ...analysis.recommendedChecks.slice(0, 3).map((check, index) => `${index + 1}. ${check}`),
            "此為 AI 輔助摘要；緊急事故仍由固定規則判定。",
          ].join("\n"),
          fetchImpl,
        );
        if (notification === "sent") {
          await env.DB.prepare("UPDATE ops_analysis_runs SET notified_at = ? WHERE id = ?")
            .bind(new Date().toISOString(), analysisId).run();
        }
      } catch (error) {
        structuredLog("error", {
          event: "ops_line_delivery_failed",
          source: "hourly_analysis",
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }
    structuredLog(analysis.severity === "normal" ? "log" : "warn", {
      event: "ops_analysis",
      status: "complete",
      severity: analysis.severity,
      windowStart,
      windowEnd,
      eventCount,
    });
  } catch (error) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO ops_analysis_runs (
         id, window_start, window_end, status, severity, event_count, summary_zh,
         patterns_json, recommended_checks_json, notified_at, created_at
       ) VALUES (?, ?, ?, 'failed', 'watch', ?, ?, '[]', '[]', NULL, ?)`,
    ).bind(analysisId, windowStart, windowEnd, eventCount, "Workers AI 無法完成本時段分析。", createdAt).run();
    await recordOpsEvent(env, {
      code: "ops.ai_analysis_failed",
      severity: "error",
      source: "system",
      errorName: error instanceof Error ? error.name : "UnknownError",
      summary: error instanceof Error ? error.message : undefined,
    }, { now: scheduledAt, fetchImpl });
  }
}

export async function checkOpsReadiness(env: AppEnv): Promise<boolean> {
  try {
    const result = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    if (Number(result?.ok) !== 1) return false;
    if (env.APP_ENV === "production") {
      return Boolean(env.AI && hasLineConfiguration(env) && hasCoreProductionConfiguration(env));
    }
    return true;
  } catch {
    return false;
  }
}
