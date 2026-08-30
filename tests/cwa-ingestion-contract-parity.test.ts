import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CWA_FORECAST_INGESTION_CONTRACT,
  cwaForecastIngestionBatchSchema,
} from "../packages/api-contract/src";

function snapshot() {
  return {
    spotId: "spot_wushi-harbor-north",
    provider: "cwa" as const,
    model: "cwa-wave-f-a0020-001" as const,
    issuedAt: "2026-08-30T00:20:00.000Z",
    modelRunAt: "2026-08-30T00:00:00.000Z",
    validAt: "2026-08-30T03:00:00.000Z",
    leadHours: 3,
    gridLatitude: 24.9,
    gridLongitude: 121.9,
    waveHeight: 0.82,
    waveDirection: 96,
    wavePeriod: 7.13,
    tideHeight: 0.2,
    tideSlope: -0.31,
    tideState: "falling" as const,
    provenance: {
      wave: {
        dataset: "F-A0020-001" as const,
        identifiers: { hs: "height-id", t: "period-id", dir: "direction-id" },
      },
      tide: {
        dataset: "F-A0021-001" as const,
        locationId: "O00400" as const,
        datum: "AboveLocalMSL" as const,
        units: "m" as const,
        interpolation: "half-cosine-between-adjacent-extrema" as const,
      },
    },
  };
}

describe("Home Assistant CWA ingestion contract parity", () => {
  it("pins the complete v1 structural contract fingerprint", () => {
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(z.toJSONSchema(cwaForecastIngestionBatchSchema)))
      .digest("hex");
    expect(CWA_FORECAST_INGESTION_CONTRACT).toEqual({
      version: "cwa-forecast-ingestion-v1",
      jsonSchemaSha256: fingerprint,
    });
  });

  it("pins refinements that JSON Schema cannot represent", () => {
    expect(cwaForecastIngestionBatchSchema.safeParse({ version: 1, snapshots: [snapshot()] }).success).toBe(true);
    expect(cwaForecastIngestionBatchSchema.safeParse({
      version: 1,
      snapshots: [{ ...snapshot(), leadHours: 4 }],
    }).success).toBe(false);
    expect(cwaForecastIngestionBatchSchema.safeParse({
      version: 1,
      snapshots: [{ ...snapshot(), waveHeight: null, waveDirection: null, wavePeriod: null }],
    }).success).toBe(false);
  });
});
