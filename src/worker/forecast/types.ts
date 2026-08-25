export interface ForecastSpot {
  id: string;
  slug: string;
  latitude: number;
  longitude: number;
}
export interface ForecastSnapshotInput {
  id: string;
  spotId: string;
  provider: string;
  model: string;
  issuedAt: string;
  modelRunAt: string | null;
  validAt: string;
  leadHours: number | null;
  gridLatitude: number | null;
  gridLongitude: number | null;
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
  tideHeight: number | null;
  tideSlope: number | null;
  tideState: string | null;
  windSpeed: number | null;
  windDirection: number | null;
  windGust: number | null;
  retrievedAt: string;
  schemaVersion: number;
  rawPayload: string | null;
}

export interface ForecastWriteResult {
  attempted: number;
  inserted: number;
  duplicates: number;
}

export interface ForecastProviderResult extends ForecastWriteResult {
  provider: string;
  status: "complete" | "partial" | "skipped" | "failed";
  message?: string;
}
