import type { AppEnv } from "../db";
import { fetchCwaForecasts } from "./cwa";
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

async function ingestCwa(
  env: AppEnv,
  spots: Awaited<ReturnType<typeof listActiveForecastSpots>>,
  retrievedAt: string,
  fetchImpl: typeof fetch,
): Promise<ForecastProviderResult> {
  if (!env.CWA_API_KEY) {
    return {
      provider: "cwa/F-A0020-001+F-A0021-001",
      status: "skipped",
      attempted: 0,
      inserted: 0,
      duplicates: 0,
      message: "CWA_API_KEY is not configured",
    };
  }
  const warnings: string[] = [];
  try {
    const snapshots = await fetchCwaForecasts(
      spots,
      env.CWA_API_KEY,
      retrievedAt,
      fetchImpl,
      (message) => warnings.push(message),
    );
    const write = await insertForecastSnapshots(env.DB, snapshots);
    return {
      provider: "cwa/F-A0020-001+F-A0021-001",
      status: warnings.length ? "partial" : "complete",
      ...write,
      ...(warnings.length ? { message: warnings.join("; ") } : {}),
    };
  } catch (error) {
    return {
      provider: "cwa/F-A0020-001+F-A0021-001",
      status: "failed",
      attempted: 0,
      inserted: 0,
      duplicates: 0,
      message: safeErrorMessage(error, env.CWA_API_KEY),
    };
  }
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

  const [openMeteo, cwa] = await Promise.all([
    ingestOpenMeteo(env, spots, retrievalStartedAt, fetchImpl),
    ingestCwa(env, spots, retrievalStartedAt, fetchImpl),
  ]);
  return {
    scheduledAt: scheduledInstant,
    finishedAt: new Date().toISOString(),
    spots: spots.length,
    providers: [openMeteo, cwa],
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
