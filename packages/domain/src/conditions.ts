export const CONDITION_SCHEMA_VERSION = 1;

export type TideState = "rising" | "falling" | "high" | "low" | "unknown";

export interface MarineConditions {
  waveHeight: number | null;
  waveDirection: number | null;
  wavePeriod: number | null;
  swellHeight: number | null;
  swellDirection: number | null;
  swellPeriod: number | null;
  secondarySwellHeight: number | null;
  secondarySwellDirection: number | null;
  secondarySwellPeriod: number | null;
  windWaveHeight: number | null;
  windWaveDirection: number | null;
  windWavePeriod: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  windGust: number | null;
  tideHeight: number | null;
  tideSlope: number | null;
  tideState: TideState | null;
  validTime: string;
  provider: string;
  model: string | null;
  modelRunTime: string | null;
  retrievedAt: string;
  schemaVersion: number;
}

export function normalizeDirection(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return ((value % 360) + 360) % 360;
}

export function nullableFinite(value: number | null | undefined): number | null {
  return value == null || !Number.isFinite(value) ? null : value;
}

export function normalizeConditions(input: MarineConditions): MarineConditions {
  return {
    ...input,
    waveHeight: nullableFinite(input.waveHeight),
    waveDirection: normalizeDirection(input.waveDirection),
    wavePeriod: nullableFinite(input.wavePeriod),
    swellHeight: nullableFinite(input.swellHeight),
    swellDirection: normalizeDirection(input.swellDirection),
    swellPeriod: nullableFinite(input.swellPeriod),
    secondarySwellHeight: nullableFinite(input.secondarySwellHeight),
    secondarySwellDirection: normalizeDirection(input.secondarySwellDirection),
    secondarySwellPeriod: nullableFinite(input.secondarySwellPeriod),
    windWaveHeight: nullableFinite(input.windWaveHeight),
    windWaveDirection: normalizeDirection(input.windWaveDirection),
    windWavePeriod: nullableFinite(input.windWavePeriod),
    windSpeed: nullableFinite(input.windSpeed),
    windDirection: normalizeDirection(input.windDirection),
    windGust: nullableFinite(input.windGust),
    tideHeight: nullableFinite(input.tideHeight),
    tideSlope: nullableFinite(input.tideSlope),
  };
}
