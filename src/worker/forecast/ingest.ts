import type { AppEnv } from "../db";
import { recordForecastUpdate } from "./daily-report";
import {
  fetchOpenMeteoMarineModel,
  OPEN_METEO_WAVE_MODELS,
  type OpenMeteoWaveModel,
} from "./open-meteo";
import { insertForecastSnapshots, listActiveForecastSpots } from "./store";
import type { ForecastProviderResult } from "./types";
import { isFarForecastSlot, mfwamForecastHours } from "./schedule";
import { readMfwamVersion } from "./model-update";
import { hasHourlyCoverage } from "./coverage";

export interface ForecastIngestionSummary {
  scheduledAt: string;
  finishedAt: string;
  spots: number;
  providers: ForecastProviderResult[];
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
  forecastHours?: number,
  sourceVersion?: string,
): Promise<ForecastProviderResult> {
  const results = await Promise.allSettled(spots.map(async (spot) => {
    const snapshots = await fetchOpenMeteoMarineModel(spot, retrievedAt, model, fetchImpl, { forecastHours, sourceVersion });
    if (!snapshots.length) throw new Error(`Open-Meteo returned no usable ${model} forecasts`);
    if (model === "meteofrance_wave" && !hasHourlyCoverage(snapshots, retrievedAt, forecastHours ?? 126)) {
      throw new Error("MFWAM response does not cover the requested hourly collection window");
    }
    return insertForecastSnapshots(env.DB, snapshots, true);
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
    ...(successful.length && successful.every(result => result.rowsWritten !== undefined) ? {
      rowsRead: successful.reduce((sum, result) => sum + (result.rowsRead ?? 0), 0),
      rowsWritten: successful.reduce((sum, result) => sum + (result.rowsWritten ?? 0), 0),
    } : {}),
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
  const mfwamVersion = await readMfwamVersion(new Date(retrievalStartedAt), fetchImpl);

  const openMeteo = await Promise.all(OPEN_METEO_WAVE_MODELS.map(({ model }) =>
    ingestOpenMeteoModel(env, spots, retrievalStartedAt, model, fetchImpl,
      model === "meteofrance_wave" ? mfwamForecastHours(new Date(retrievalStartedAt), isFarForecastSlot(scheduledAt)) : undefined,
      model === "meteofrance_wave" ? mfwamVersion : undefined)
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
  await recordForecastUpdate(env.DB, "mfwam", scheduledAt.toISOString(), false);
  if (isFarForecastSlot(scheduledAt)) await recordForecastUpdate(env.DB, "mfwam_far", scheduledAt.toISOString(), false);
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
  if (!requiredMfwam || requiredMfwam.status !== "complete") {
    throw new Error("Required Météo-France MFWAM ingestion incomplete");
  }
  await recordForecastUpdate(env.DB, "mfwam", scheduledAt.toISOString(), true);
  if (isFarForecastSlot(scheduledAt)) await recordForecastUpdate(env.DB, "mfwam_far", scheduledAt.toISOString(), true);
}
