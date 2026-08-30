import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fetchOpenMeteoEcmwfWam, parseOpenMeteoEcmwfWam } from "../src/worker/forecast/open-meteo";
import { runForecastIngestion } from "../src/worker/forecast/ingest";
import { insertForecastSnapshots } from "../src/worker/forecast/store";
import type { AppEnv } from "../src/worker/db";
import type { ForecastSpot } from "../src/worker/forecast/types";

const spot: ForecastSpot = {
  id: "spot_wushi-harbor-north",
  slug: "wushi-harbor-north",
  latitude: 24.8731036,
  longitude: 121.8411446,
};

const openMeteoFixture = JSON.parse(readFileSync(
  new URL("./fixtures/open-meteo-ecmwf-wam.json", import.meta.url),
  "utf8",
));

function ingestionDb() {
  const seen = new Set<string>();
  return {
    prepare: (sql: string) => {
      if (sql.includes("FROM spots")) return { all: async () => ({ results: [spot] }) };
      return { bind: (...values: unknown[]) => ({ values }) };
    },
    batch: async (statements: Array<{ values: unknown[] }>) => statements.map((statement) => {
      const id = String(statement.values[0]);
      const changes = seen.has(id) ? 0 : 1;
      seen.add(id);
      return { meta: { changes } };
    }),
  } as unknown as D1Database;
}

describe("scheduled forecast normalization", () => {
  it("normalizes ECMWF WAM without inventing unavailable component fields", async () => {
    const snapshots = await parseOpenMeteoEcmwfWam(openMeteoFixture, spot, "2026-08-25T02:20:00.000Z");
    expect(snapshots).toHaveLength(3);
    expect(snapshots[0]).toMatchObject({
      provider: "open-meteo",
      model: "ecmwf_wam",
      issuedAt: "2026-08-25T02:20:00.000Z",
      modelRunAt: null,
      validAt: "2026-08-25T03:00:00.000Z",
      gridLatitude: 24.850615,
      gridLongitude: 121.901184,
      waveHeight: 0.82,
      waveDirection: 91,
      wavePeriod: 7.1,
      swellHeight: null,
      windWaveHeight: null,
    });
    const retry = await parseOpenMeteoEcmwfWam(
      { ...openMeteoFixture, generationtime_ms: 99 },
      spot,
      "2026-08-25T02:21:00.000Z",
    );
    expect(retry[0].id).toBe(snapshots[0].id);
  });

  it("uses insert-or-ignore IDs so a provider retry does not duplicate a run", async () => {
    const snapshots = await parseOpenMeteoEcmwfWam(openMeteoFixture, spot, "2026-08-25T02:20:00.000Z");
    const db = ingestionDb();
    await expect(insertForecastSnapshots(db, snapshots)).resolves.toEqual({ attempted: 3, inserted: 3, duplicates: 0 });
    await expect(insertForecastSnapshots(db, snapshots)).resolves.toEqual({ attempted: 3, inserted: 0, duplicates: 3 });
  });

  it("keeps the six-hour Worker Cron responsible for ECMWF only", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify(openMeteoFixture), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
    const summary = await runForecastIngestion(
      { DB: ingestionDb() } as AppEnv,
      new Date("2026-08-25T02:20:00.000Z"),
      fetchImpl,
    );
    expect(summary.providers).toEqual([
      expect.objectContaining({ provider: "open-meteo/ecmwf_wam", status: "complete", inserted: 3 }),
    ]);
  });

  it("requests seven calendar days of hourly ECMWF WAM coverage", async () => {
    const requestedUrls: URL[] = [];
    await fetchOpenMeteoEcmwfWam(
      spot,
      "2026-08-25T02:20:00.000Z",
      (async (input: URL | RequestInfo) => {
        requestedUrls.push(new URL(input instanceof Request ? input.url : String(input)));
        return new Response(JSON.stringify(openMeteoFixture), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    );
    const requestedUrl = requestedUrls[0];
    if (!requestedUrl) throw new Error("Open-Meteo request was not made");
    expect(requestedUrl.searchParams.get("forecast_hours")).toBe("168");
    expect(requestedUrl.searchParams.get("models")).toBe("ecmwf_wam");
  });
});
