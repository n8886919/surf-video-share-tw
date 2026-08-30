import { z } from "zod";
import { stableForecastId } from "./store";
import type { ForecastSnapshotInput, ForecastSpot } from "./types";

const OPEN_METEO_MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
const OPEN_METEO_MODEL = "ecmwf_wam";
const OPEN_METEO_PROVIDER = "open-meteo";
const FORECAST_HOURS = 168;

const hourlyVariables = [
  "wave_height",
  "wave_direction",
  "wave_period",
  "swell_wave_height",
  "swell_wave_direction",
  "swell_wave_period",
  "secondary_swell_wave_height",
  "secondary_swell_wave_direction",
  "secondary_swell_wave_period",
  "wind_wave_height",
  "wind_wave_direction",
  "wind_wave_period",
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
    swell_wave_height: nullableNumberArray.optional(),
    swell_wave_direction: nullableNumberArray.optional(),
    swell_wave_period: nullableNumberArray.optional(),
    secondary_swell_wave_height: nullableNumberArray.optional(),
    secondary_swell_wave_direction: nullableNumberArray.optional(),
    secondary_swell_wave_period: nullableNumberArray.optional(),
    wind_wave_height: nullableNumberArray.optional(),
    wind_wave_direction: nullableNumberArray.optional(),
    wind_wave_period: nullableNumberArray.optional(),
  }).passthrough(),
}).passthrough();

type OpenMeteoResponse = z.infer<typeof openMeteoResponseSchema>;

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
    swell_wave_height: hourly.swell_wave_height ?? null,
    swell_wave_direction: hourly.swell_wave_direction ?? null,
    swell_wave_period: hourly.swell_wave_period ?? null,
    secondary_swell_wave_height: hourly.secondary_swell_wave_height ?? null,
    secondary_swell_wave_direction: hourly.secondary_swell_wave_direction ?? null,
    secondary_swell_wave_period: hourly.secondary_swell_wave_period ?? null,
    wind_wave_height: hourly.wind_wave_height ?? null,
    wind_wave_direction: hourly.wind_wave_direction ?? null,
    wind_wave_period: hourly.wind_wave_period ?? null,
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function parseOpenMeteoEcmwfWam(
  payload: unknown,
  spot: ForecastSpot,
  retrievedAt: string,
): Promise<ForecastSnapshotInput[]> {
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
      swellHeight: valueAt(response.hourly.swell_wave_height, index),
      swellDirection: valueAt(response.hourly.swell_wave_direction, index),
      swellPeriod: valueAt(response.hourly.swell_wave_period, index),
      secondarySwellHeight: valueAt(response.hourly.secondary_swell_wave_height, index),
      secondarySwellDirection: valueAt(response.hourly.secondary_swell_wave_direction, index),
      secondarySwellPeriod: valueAt(response.hourly.secondary_swell_wave_period, index),
      windWaveHeight: valueAt(response.hourly.wind_wave_height, index),
      windWaveDirection: valueAt(response.hourly.wind_wave_direction, index),
      windWavePeriod: valueAt(response.hourly.wind_wave_period, index),
    };
    const id = await stableForecastId([
      OPEN_METEO_PROVIDER,
      OPEN_METEO_MODEL,
      sourceRunKey,
      spot.id,
      validAt,
    ]);
    return {
      id,
      spotId: spot.id,
      provider: OPEN_METEO_PROVIDER,
      model: OPEN_METEO_MODEL,
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
      schemaVersion: 1,
      rawPayload: JSON.stringify({
        sourceRunKey,
        requestedSpot: { latitude: spot.latitude, longitude: spot.longitude },
        grid: { latitude: response.latitude, longitude: response.longitude },
      }),
    } satisfies ForecastSnapshotInput;
  }));
  return snapshots.filter((snapshot) => [
    snapshot.waveHeight,
    snapshot.waveDirection,
    snapshot.wavePeriod,
  ].some((value) => value !== null));
}

export async function fetchOpenMeteoEcmwfWam(
  spot: ForecastSpot,
  retrievedAt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ForecastSnapshotInput[]> {
  const url = new URL(OPEN_METEO_MARINE_URL);
  url.searchParams.set("latitude", String(spot.latitude));
  url.searchParams.set("longitude", String(spot.longitude));
  url.searchParams.set("hourly", hourlyVariables.join(","));
  url.searchParams.set("models", OPEN_METEO_MODEL);
  url.searchParams.set("forecast_hours", String(FORECAST_HOURS));
  url.searchParams.set("timezone", "GMT");
  url.searchParams.set("cell_selection", "sea");

  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Open-Meteo ECMWF WAM returned HTTP ${response.status}`);
  return parseOpenMeteoEcmwfWam(await response.json(), spot, retrievedAt);
}
