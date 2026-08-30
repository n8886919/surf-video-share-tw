import type { AppEnv } from "../db";
import { fetchOpenMeteoEcmwfWam } from "./open-meteo";
import { insertForecastSnapshots, listActiveForecastSpots } from "./store";
import type { ForecastProviderResult } from "./types";

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

async function ingestOpenMeteo(
  env: AppEnv,
  spots: Awaited<ReturnType<typeof listActiveForecastSpots>>,
  retrievedAt: string,
  fetchImpl: typeof fetch,
): Promise<ForecastProviderResult> {
  const results = await Promise.allSettled(spots.map(async (spot) => {
    const snapshots = await fetchOpenMeteoEcmwfWam(spot, retrievedAt, fetchImpl);
    if (!snapshots.length) throw new Error("Open-Meteo returned no usable ECMWF WAM forecasts");
    return insertForecastSnapshots(env.DB, snapshots);
  }));
  const successful = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const failures = results.flatMap((result, index) => result.status === "rejected"
    ? [`${spots[index].slug}: ${safeErrorMessage(result.reason)}`]
    : []);
  return {
    provider: "open-meteo/ecmwf_wam",
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

  const openMeteo = await ingestOpenMeteo(env, spots, retrievalStartedAt, fetchImpl);
  return {
    scheduledAt: scheduledInstant,
    finishedAt: new Date().toISOString(),
    spots: spots.length,
    providers: [openMeteo],
  };
}

export async function runScheduledForecastIngestion(
  env: AppEnv,
  scheduledAt: Date,
): Promise<void> {
  const summary = await runForecastIngestion(env, scheduledAt);
  const usableProviders = summary.providers.filter((provider) =>
    provider.status === "complete" || provider.status === "partial"
  );
  const log = JSON.stringify({ event: "forecast_ingestion", ...summary });
  if (summary.providers.some((provider) => provider.status === "failed" || provider.status === "partial")) {
    console.warn(log);
  } else {
    console.log(log);
  }
  if (!usableProviders.length) throw new Error("All configured forecast providers failed");
}
