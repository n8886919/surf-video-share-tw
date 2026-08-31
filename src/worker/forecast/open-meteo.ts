import { z } from "zod";
import { stableForecastId } from "./store";
import type { ForecastSnapshotInput, ForecastSpot } from "./types";

const OPEN_METEO_MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
const OPEN_METEO_PROVIDER = "open-meteo";
const RECENT_PAST_HOURS = 6;

export const OPEN_METEO_WAVE_MODELS = [
  {
    model: "meteofrance_wave",
    displayName: "Météo-France MFWAM",
    forecastHours: 168,
    swellSemantics: "partitioned",
  },
  {
    model: "ecmwf_wam",
    displayName: "ECMWF WAM 9 km",
    forecastHours: 1,
    swellSemantics: "none",
  },
  {
    model: "ncep_gfswave016",
    displayName: "NOAA GFS Wave 0.16°",
    forecastHours: 1,
    swellSemantics: "partitioned",
  },
  {
    model: "dwd_gwam",
    displayName: "DWD GWAM",
    forecastHours: 1,
    swellSemantics: "total",
  },
] as const;

export type OpenMeteoWaveModel = typeof OPEN_METEO_WAVE_MODELS[number]["model"];
type OpenMeteoSwellSemantics = typeof OPEN_METEO_WAVE_MODELS[number]["swellSemantics"];

const hourlyVariables = [
  "wave_height",
  "wave_direction",
  "wave_period",
  "wave_peak_period",
  "swell_wave_height",
  "swell_wave_direction",
  "swell_wave_period",
  "swell_wave_peak_period",
  "secondary_swell_wave_height",
  "secondary_swell_wave_direction",
  "secondary_swell_wave_period",
  "tertiary_swell_wave_height",
  "tertiary_swell_wave_direction",
  "tertiary_swell_wave_period",
  "wind_wave_height",
  "wind_wave_direction",
  "wind_wave_period",
  "wind_wave_peak_period",
] as const;

const nullableNumberArray = z.array(z.number().nullable());
const openMeteoResponseSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  hourly: z.object({
    time: z.array(z.string()),
    wave_height: nullableNumberArray,
    wave_direction: nullableNumberArray,
    wave_period: nullableNumberArray,
    wave_peak_period: nullableNumberArray.optional(),
    swell_wave_height: nullableNumberArray.optional(),
    swell_wave_direction: nullableNumberArray.optional(),
    swell_wave_period: nullableNumberArray.optional(),
    swell_wave_peak_period: nullableNumberArray.optional(),
    secondary_swell_wave_height: nullableNumberArray.optional(),
    secondary_swell_wave_direction: nullableNumberArray.optional(),
    secondary_swell_wave_period: nullableNumberArray.optional(),
    tertiary_swell_wave_height: nullableNumberArray.optional(),
    tertiary_swell_wave_direction: nullableNumberArray.optional(),
    tertiary_swell_wave_period: nullableNumberArray.optional(),
    wind_wave_height: nullableNumberArray.optional(),
    wind_wave_direction: nullableNumberArray.optional(),
    wind_wave_period: nullableNumberArray.optional(),
    wind_wave_peak_period: nullableNumberArray.optional(),
  }).passthrough(),
}).passthrough();

type OpenMeteoResponse = z.infer<typeof openMeteoResponseSchema>;

function modelConfig(model: OpenMeteoWaveModel) {
  const config = OPEN_METEO_WAVE_MODELS.find((candidate) => candidate.model === model);
  if (!config) throw new Error(`Unsupported Open-Meteo wave model: ${model}`);
  return config;
}

function utcInstant(value: string): string {
  const explicitZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`;
  const date = new Date(explicitZone);
  if (!Number.isFinite(date.getTime())) throw new Error(`Open-Meteo returned an invalid time: ${value}`);
  return date.toISOString();
}

function valueAt(values: Array<number | null> | undefined, index: number): number | null {
  const value = values?.[index];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizedRunPayload(response: OpenMeteoResponse): string {
  const hourly = response.hourly;
  return JSON.stringify({
    latitude: response.latitude,
    longitude: response.longitude,
    time: hourly.time,
    wave_height: hourly.wave_height,
    wave_direction: hourly.wave_direction,
    wave_period: hourly.wave_period,
    wave_peak_period: hourly.wave_peak_period ?? null,
    swell_wave_height: hourly.swell_wave_height ?? null,
    swell_wave_direction: hourly.swell_wave_direction ?? null,
    swell_wave_period: hourly.swell_wave_period ?? null,
    swell_wave_peak_period: hourly.swell_wave_peak_period ?? null,
    secondary_swell_wave_height: hourly.secondary_swell_wave_height ?? null,
    secondary_swell_wave_direction: hourly.secondary_swell_wave_direction ?? null,
    secondary_swell_wave_period: hourly.secondary_swell_wave_period ?? null,
    tertiary_swell_wave_height: hourly.tertiary_swell_wave_height ?? null,
    tertiary_swell_wave_direction: hourly.tertiary_swell_wave_direction ?? null,
    tertiary_swell_wave_period: hourly.tertiary_swell_wave_period ?? null,
    wind_wave_height: hourly.wind_wave_height ?? null,
    wind_wave_direction: hourly.wind_wave_direction ?? null,
    wind_wave_period: hourly.wind_wave_period ?? null,
    wind_wave_peak_period: hourly.wind_wave_peak_period ?? null,
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizedSwellPoint(
  response: OpenMeteoResponse,
  index: number,
  semantics: OpenMeteoSwellSemantics,
) {
  const swellHeight = valueAt(response.hourly.swell_wave_height, index);
  const swellDirection = valueAt(response.hourly.swell_wave_direction, index);
  const swellPeriod = valueAt(response.hourly.swell_wave_period, index);
  const swellPeakPeriod = valueAt(response.hourly.swell_wave_peak_period, index);
  return {
    totalSwellHeight: semantics === "total" ? swellHeight : null,
    totalSwellDirection: semantics === "total" ? swellDirection : null,
    totalSwellPeriod: semantics === "total" ? swellPeriod : null,
    totalSwellPeakPeriod: semantics === "total" ? swellPeakPeriod : null,
    swellHeight: semantics === "partitioned" ? swellHeight : null,
    swellDirection: semantics === "partitioned" ? swellDirection : null,
    swellPeriod: semantics === "partitioned" ? swellPeriod : null,
    swellPeakPeriod: semantics === "partitioned" ? swellPeakPeriod : null,
    secondarySwellHeight: semantics === "partitioned"
      ? valueAt(response.hourly.secondary_swell_wave_height, index)
      : null,
    secondarySwellDirection: semantics === "partitioned"
      ? valueAt(response.hourly.secondary_swell_wave_direction, index)
      : null,
    secondarySwellPeriod: semantics === "partitioned"
      ? valueAt(response.hourly.secondary_swell_wave_period, index)
      : null,
    tertiarySwellHeight: semantics === "partitioned"
      ? valueAt(response.hourly.tertiary_swell_wave_height, index)
      : null,
    tertiarySwellDirection: semantics === "partitioned"
      ? valueAt(response.hourly.tertiary_swell_wave_direction, index)
      : null,
    tertiarySwellPeriod: semantics === "partitioned"
      ? valueAt(response.hourly.tertiary_swell_wave_period, index)
      : null,
  };
}

export async function parseOpenMeteoMarineModel(
  payload: unknown,
  spot: ForecastSpot,
  retrievedAt: string,
  model: OpenMeteoWaveModel,
): Promise<ForecastSnapshotInput[]> {
  const config = modelConfig(model);
  const response = openMeteoResponseSchema.parse(payload);
  const issuedAt = new Date(retrievedAt).toISOString();
  const issuedMs = new Date(issuedAt).getTime();
  const sourceRunKey = await sha256Hex(normalizedRunPayload(response));

  const snapshots = await Promise.all(response.hourly.time.map(async (time, index) => {
    const validAt = utcInstant(time);
    const validMs = new Date(validAt).getTime();
    const point = {
      waveHeight: valueAt(response.hourly.wave_height, index),
      waveDirection: valueAt(response.hourly.wave_direction, index),
      wavePeriod: valueAt(response.hourly.wave_period, index),
      wavePeakPeriod: valueAt(response.hourly.wave_peak_period, index),
      ...normalizedSwellPoint(response, index, config.swellSemantics),
      windWaveHeight: valueAt(response.hourly.wind_wave_height, index),
      windWaveDirection: valueAt(response.hourly.wind_wave_direction, index),
      windWavePeriod: valueAt(response.hourly.wind_wave_period, index),
      windWavePeakPeriod: valueAt(response.hourly.wind_wave_peak_period, index),
    };
    const id = await stableForecastId([
      OPEN_METEO_PROVIDER,
      model,
      sourceRunKey,
      spot.id,
      validAt,
    ]);
    return {
      id,
      spotId: spot.id,
      provider: OPEN_METEO_PROVIDER,
      model,
      snapshotKind: validMs < issuedMs ? "historical_forecast" : "forecast",
      issuedAt,
      modelRunAt: null,
      validAt,
      leadHours: Number(((validMs - issuedMs) / 3_600_000).toFixed(3)),
      gridLatitude: response.latitude,
      gridLongitude: response.longitude,
      ...point,
      tideHeight: null,
      tideSlope: null,
      tideState: null,
      windSpeed: null,
      windDirection: null,
      windGust: null,
      retrievedAt: issuedAt,
      schemaVersion: 2,
      rawPayload: JSON.stringify({
        sourceRunKey,
        apiMode: "forecast",
        pastHours: RECENT_PAST_HOURS,
        forecastHours: config.forecastHours,
        swellSemantics: config.swellSemantics,
        requestedSpot: { latitude: spot.latitude, longitude: spot.longitude },
        grid: { latitude: response.latitude, longitude: response.longitude },
      }),
    } satisfies ForecastSnapshotInput;
  }));
  return snapshots.filter((snapshot) => [
    snapshot.waveHeight,
    snapshot.waveDirection,
    snapshot.wavePeriod,
    snapshot.wavePeakPeriod,
    snapshot.totalSwellHeight,
    snapshot.totalSwellDirection,
    snapshot.totalSwellPeriod,
    snapshot.totalSwellPeakPeriod,
    snapshot.swellHeight,
    snapshot.swellDirection,
    snapshot.swellPeriod,
    snapshot.swellPeakPeriod,
    snapshot.secondarySwellHeight,
    snapshot.secondarySwellDirection,
    snapshot.secondarySwellPeriod,
    snapshot.tertiarySwellHeight,
    snapshot.tertiarySwellDirection,
    snapshot.tertiarySwellPeriod,
    snapshot.windWaveHeight,
    snapshot.windWaveDirection,
    snapshot.windWavePeriod,
    snapshot.windWavePeakPeriod,
  ].some((value) => value !== null));
}

export async function parseOpenMeteoEcmwfWam(
  payload: unknown,
  spot: ForecastSpot,
  retrievedAt: string,
): Promise<ForecastSnapshotInput[]> {
  return parseOpenMeteoMarineModel(payload, spot, retrievedAt, "ecmwf_wam");
}

export async function fetchOpenMeteoMarineModel(
  spot: ForecastSpot,
  retrievedAt: string,
  model: OpenMeteoWaveModel,
  fetchImpl: typeof fetch = fetch,
): Promise<ForecastSnapshotInput[]> {
  const config = modelConfig(model);
  const url = new URL(OPEN_METEO_MARINE_URL);
  url.searchParams.set("latitude", String(spot.latitude));
  url.searchParams.set("longitude", String(spot.longitude));
  url.searchParams.set("hourly", hourlyVariables.join(","));
  url.searchParams.set("models", model);
  url.searchParams.set("forecast_hours", String(config.forecastHours));
  url.searchParams.set("past_hours", String(RECENT_PAST_HOURS));
  url.searchParams.set("timezone", "GMT");
  url.searchParams.set("cell_selection", "sea");

  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Open-Meteo ${config.displayName} returned HTTP ${response.status}`);
  }
  return parseOpenMeteoMarineModel(await response.json(), spot, retrievedAt, model);
}

export async function fetchOpenMeteoEcmwfWam(
  spot: ForecastSpot,
  retrievedAt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ForecastSnapshotInput[]> {
  return fetchOpenMeteoMarineModel(spot, retrievedAt, "ecmwf_wam", fetchImpl);
}
