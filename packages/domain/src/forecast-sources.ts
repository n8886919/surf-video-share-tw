export type ForecastMatchingRole = "active" | "collect-only";
export type ForecastSwellSemantics = "none" | "partitioned" | "total" | "unknown";

export interface ForecastSourceDefinition {
  provider: string;
  model: string;
  displayName: string;
  matchingRole: ForecastMatchingRole;
  swellSemantics: ForecastSwellSemantics;
  displayOrder: number;
}

export const FORECAST_SOURCES = [
  {
    provider: "cwa",
    model: "cwa-wave-f-a0020-001",
    displayName: "CWA",
    matchingRole: "active",
    swellSemantics: "none",
    displayOrder: 0,
  },
  {
    provider: "open-meteo",
    model: "meteofrance_wave",
    displayName: "Météo-France MFWAM",
    matchingRole: "active",
    swellSemantics: "partitioned",
    displayOrder: 1,
  },
  {
    provider: "open-meteo",
    model: "ecmwf_wam",
    displayName: "ECMWF WAM 9 km",
    matchingRole: "collect-only",
    swellSemantics: "none",
    displayOrder: 2,
  },
  {
    provider: "open-meteo",
    model: "ncep_gfswave016",
    displayName: "NOAA GFS Wave 0.16°",
    matchingRole: "collect-only",
    swellSemantics: "partitioned",
    displayOrder: 3,
  },
  {
    provider: "open-meteo",
    model: "dwd_gwam",
    displayName: "DWD GWAM",
    matchingRole: "collect-only",
    swellSemantics: "total",
    displayOrder: 4,
  },
] as const satisfies readonly ForecastSourceDefinition[];

export const ACTIVE_MATCH_SOURCES = FORECAST_SOURCES.filter(
  (source) => source.matchingRole === "active",
);

export function forecastSourceKey(provider: string, model: string): string {
  return `${provider}:${model}`;
}

export function findForecastSource(
  provider: string,
  model: string,
): ForecastSourceDefinition | null {
  return FORECAST_SOURCES.find(
    (source) => source.provider === provider && source.model === model,
  ) ?? null;
}
