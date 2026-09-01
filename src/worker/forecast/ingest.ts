import type { AppEnv } from "../db";
import { sendLineNotification } from "../ops-observability";
import {
  fetchOpenMeteoMarineModel,
  OPEN_METEO_WAVE_MODELS,
  type OpenMeteoWaveModel,
} from "./open-meteo";
import { insertForecastSnapshots, listActiveForecastSpots } from "./store";
import type { ForecastProviderResult } from "./types";

export interface ForecastIngestionSummary {
  scheduledAt: string;
  finishedAt: string;
  spots: number;
  providers: ForecastProviderResult[];
}

const FORECAST_PROVIDER_LABELS: Record<string, string> = {
  "open-meteo/meteofrance_wave": "MFWAM",
  "open-meteo/ecmwf_wam": "ECMWF WAM",
  "open-meteo/ncep_gfswave016": "GFS Wave",
  "open-meteo/dwd_gwam": "GWAM",
};

function forecastHeartbeatMessage(summary: ForecastIngestionSummary): string {
  const degraded = summary.providers.some((provider) => provider.status !== "complete");
  const providerLines = summary.providers.map((provider) => {
    const label = FORECAST_PROVIDER_LABELS[provider.provider] ?? provider.provider;
    return `${label}: ${provider.status}（新增 ${provider.inserted}、重複 ${provider.duplicates}）`;
  });
  return [
    `${degraded ? "⚠️" : "✅"} 彼日浪影氣象資料排程已跑完`,
    `排程時間：${summary.scheduledAt}`,
    `浪點：${summary.spots}`,
    ...providerLines,
    "此訊息僅代表 Cloudflare 的 Open-Meteo 更新；CWA 由 Home Assistant 另行收集。",
  ].join("\n");
}

function safeErrorMessage(error: unknown, sensitiveValue?: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const redacted = sensitiveValue ? message.replaceAll(sensitiveValue, "[redacted]") : message;
  return redacted
    .replace(/Authorization=[^&\s]+/gi, "Authorization=[redacted]")
    .slice(0, 500);
}

async function ingestOpenMeteoModel(
  env: AppEnv,
  spots: Awaited<ReturnType<typeof listActiveForecastSpots>>,
  retrievedAt: string,
  model: OpenMeteoWaveModel,
  fetchImpl: typeof fetch,
): Promise<ForecastProviderResult> {
  const results = await Promise.allSettled(spots.map(async (spot) => {
    const snapshots = await fetchOpenMeteoMarineModel(spot, retrievedAt, model, fetchImpl);
    if (!snapshots.length) throw new Error(`Open-Meteo returned no usable ${model} forecasts`);
    return insertForecastSnapshots(env.DB, snapshots);
  }));
  const successful = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const failures = results.flatMap((result, index) => result.status === "rejected"
    ? [`${spots[index].slug}: ${safeErrorMessage(result.reason)}`]
    : []);
  return {
    provider: `open-meteo/${model}`,
    status: failures.length === 0 ? "complete" : successful.length ? "partial" : "failed",
    attempted: successful.reduce((sum, result) => sum + result.attempted, 0),
    inserted: successful.reduce((sum, result) => sum + result.inserted, 0),
    duplicates: successful.reduce((sum, result) => sum + result.duplicates, 0),
    ...(failures.length ? { message: failures.join("; ") } : {}),
  };
}

export async function runForecastIngestion(
  env: AppEnv,
  scheduledAt: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<ForecastIngestionSummary> {
  const scheduledInstant = scheduledAt.toISOString();
  const retrievalStartedAt = new Date().toISOString();
  const spots = await listActiveForecastSpots(env.DB);
  if (!spots.length) throw new Error("Forecast ingestion has no active spots with coordinates");

  const openMeteo = await Promise.all(OPEN_METEO_WAVE_MODELS.map(({ model }) =>
    ingestOpenMeteoModel(env, spots, retrievalStartedAt, model, fetchImpl)
  ));
  return {
    scheduledAt: scheduledInstant,
    finishedAt: new Date().toISOString(),
    spots: spots.length,
    providers: openMeteo,
  };
}

export async function runScheduledForecastIngestion(
  env: AppEnv,
  scheduledAt: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const summary = await runForecastIngestion(env, scheduledAt, fetchImpl);
  const requiredMfwam = summary.providers.find(
    (provider) => provider.provider === "open-meteo/meteofrance_wave",
  );
  const log = JSON.stringify({ event: "forecast_ingestion", ...summary });
  if (summary.providers.some((provider) => provider.status === "failed" || provider.status === "partial")) {
    console.warn(log);
  } else {
    console.log(log);
  }
  if (!requiredMfwam || requiredMfwam.status === "failed") {
    throw new Error("Required Météo-France MFWAM ingestion failed");
  }
  try {
    const notification = await sendLineNotification(env, forecastHeartbeatMessage(summary), fetchImpl);
    if (notification === "unconfigured") {
      console.warn(JSON.stringify({ event: "forecast_ingestion_line_unconfigured" }));
    }
  } catch (error) {
    console.error(JSON.stringify({
      event: "forecast_ingestion_line_delivery_failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
    }));
  }
}
