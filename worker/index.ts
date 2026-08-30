/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { api } from "../src/worker/api";
import type { AppEnv } from "../src/worker/db";
import { runScheduledForecastIngestion } from "../src/worker/forecast/ingest";
import { runScheduledExpiredVideoCleanup } from "../src/worker/video-lifecycle";
import { runScheduledPlaybackEventCleanup } from "../src/worker/playback-analytics";
import { withSecurityHeaders } from "../src/worker/security-headers";
import { recordOpsEvent, runHourlyOpsAnalysis } from "../src/worker/ops-observability";

const OPS_ANALYSIS_CRON = "5 * * * *";
const MAINTENANCE_CRON = "20 */6 * * *";

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    let response: Response;

    if (url.pathname.startsWith("/api/v1/")) {
      response = await api.fetch(request, env);
    } else if (url.pathname === "/_vinext/image" && env.IMAGES) {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      response = await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES!.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    } else {
      response = await handler.fetch(request, env, ctx);
    }

    return withSecurityHeaders(response);
  },
  async scheduled(controller: ScheduledController, env: AppEnv): Promise<void> {
    const scheduledAt = new Date(controller.scheduledTime);
    if (controller.cron === OPS_ANALYSIS_CRON) {
      try {
        await runHourlyOpsAnalysis(env, scheduledAt);
      } catch (error) {
        await recordOpsEvent(env, {
          code: "scheduled.ops_analysis_failed",
          severity: "critical",
          source: "scheduled",
          fingerprint: "scheduled.ops-analysis",
          errorName: error instanceof Error ? error.name : "UnknownError",
          summary: error instanceof Error ? error.message : undefined,
          forceIncident: true,
        }, { now: scheduledAt });
        throw error;
      }
      return;
    }

    if (controller.cron !== MAINTENANCE_CRON) {
      await recordOpsEvent(env, {
        code: "scheduled.unknown_cron",
        severity: "warning",
        source: "scheduled",
        fingerprint: "scheduled.unknown-cron",
        summary: `Unknown cron expression: ${controller.cron}`,
      }, { now: scheduledAt });
      return;
    }

    const tasks = [
      {
        code: "scheduled.forecast_ingestion_failed",
        fingerprint: "scheduled.forecast-ingestion",
        promise: runScheduledForecastIngestion(env, scheduledAt),
      },
      {
        code: "scheduled.expired_video_cleanup_failed",
        fingerprint: "scheduled.expired-video-cleanup",
        promise: runScheduledExpiredVideoCleanup(env, scheduledAt),
      },
      {
        code: "scheduled.playback_cleanup_failed",
        fingerprint: "scheduled.playback-cleanup",
        promise: runScheduledPlaybackEventCleanup(env, scheduledAt),
      },
    ] as const;
    const results = await Promise.allSettled(tasks.map((task) => task.promise));
    const failures: unknown[] = [];
    for (const [index, result] of results.entries()) {
      if (result.status !== "rejected") continue;
      failures.push(result.reason);
      const task = tasks[index];
      await recordOpsEvent(env, {
        code: task.code,
        severity: "critical",
        source: "scheduled",
        fingerprint: task.fingerprint,
        errorName: result.reason instanceof Error ? result.reason.name : "UnknownError",
        summary: result.reason instanceof Error ? result.reason.message : undefined,
        forceIncident: true,
      }, { now: scheduledAt });
    }
    if (failures.length) {
      throw new AggregateError(failures, "One or more scheduled tasks failed");
    }
  },
};

export default worker;
