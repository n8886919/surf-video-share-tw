import { readFileSync } from "node:fs";
import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import {
  buildCwaForecastSnapshots,
  fetchCwaForecasts,
  interpolateCwaTide,
  parseCwaTidePayload,
  parseCwaWaveArchive,
  type CwaTideEvent,
} from "../src/worker/forecast/cwa";
import { parseOpenMeteoEcmwfWam } from "../src/worker/forecast/open-meteo";
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

function cwaWaveXml(input: {
  identifier: string;
  sent: string;
  validAt: string;
  elementName: string;
  value: number;
  measures: string;
}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<cwbopendata xmlns="urn:cwb:gov:tw:cwbcommon:0.1">
  <identifier>${input.identifier}</identifier>
  <sent>${input.sent}</sent>
  <dataset>
    <time><dataTime>${input.validAt}</dataTime></time>
    <location>
      <lat>25.50000</lat><lon>123.00000</lon>
      <weatherElement><elementName>${input.elementName}</elementName><elementValue><value>999</value><measures>${input.measures}</measures></elementValue></weatherElement>
    </location>
    <location>
      <lat>24.90000</lat><lon>121.90000</lon>
      <weatherElement><elementName>${input.elementName}</elementName><elementValue><value>${input.value}</value><measures>${input.measures}</measures></elementValue></weatherElement>
    </location>
  </dataset>
</cwbopendata>`;
}

function cwaWaveFixture() {
  const common = { sent: "2026-08-25T08:45:00+08:00", validAt: "2026-08-25T03:00:00+00:00" };
  return zipSync({
    "26082500-hs.003.xml": strToU8(cwaWaveXml({ ...common, identifier: "height-id", elementName: "浪高", value: 82, measures: "0.01m" })),
    "26082500-t.003.xml": strToU8(cwaWaveXml({ ...common, identifier: "period-id", elementName: "週期", value: 713, measures: "0.01s" })),
    "26082500-dir.003.xml": strToU8(cwaWaveXml({ ...common, identifier: "direction-id", elementName: "浪向", value: 96, measures: "1degr." })),
  });
}

function currentCwaWaveXml(input: {
  elementTag: string;
  value: number;
  measures: string;
}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<cwaopendata xmlns="urn:cwa:gov:tw:cwacommon:0.1">
  <Identifier>current-run-id</Identifier>
  <Sent>2026-08-25T14:58:36+08:00</Sent>
  <Dataset><DatasetInfo>
    <ForecastHour>3</ForecastHour><DateTime>2026-08-25T11:00:00+08:00</DateTime>
    <WeatherElements><WeatherElement><Measures>${input.measures}</Measures></WeatherElement></WeatherElements>
  </DatasetInfo><Data>
    <Location><Latitude>24.90000</Latitude><Longitude>121.90000</Longitude><${input.elementTag}>${input.value}</${input.elementTag}></Location>
  </Data></Dataset>
</cwaopendata>`;
}

function currentCwaWaveFixture() {
  return zipSync({
    "26082500-hs.003.xml": strToU8(currentCwaWaveXml({ elementTag: "WaveHeight", value: 1.7, measures: "0.01m" })),
    "26082500-t.003.xml": strToU8(currentCwaWaveXml({ elementTag: "WavePeriod", value: 9.9, measures: "0.01s" })),
    "26082500-dir.003.xml": strToU8(currentCwaWaveXml({ elementTag: "WaveDirection", value: 122, measures: "1degr." })),
    "26082500-hs.004.xml": strToU8(currentCwaWaveXml({ elementTag: "WaveHeight", value: 99, measures: "0.01m" })),
  });
}

describe("scheduled forecast normalization", () => {
  it("normalizes ECMWF WAM without inventing unavailable component fields", async () => {
    const snapshots = await parseOpenMeteoEcmwfWam(
      openMeteoFixture,
      spot,
      "2026-08-25T02:20:00.000Z",
    );

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

  it("extracts and scales the nearest CWA sea grid from the real archive shape", () => {
    const points = parseCwaWaveArchive(cwaWaveFixture(), [spot]);

    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      issuedAt: "2026-08-25T00:45:00.000Z",
      modelRunAt: "2026-08-25T00:00:00.000Z",
      validAt: "2026-08-25T03:00:00.000Z",
      leadHours: 3,
      gridLatitude: 24.9,
      gridLongitude: 121.9,
      waveHeight: 0.82,
      waveDirection: 96,
      wavePeriod: 7.13,
    });
  });

  it("supports the current CWA schema and keeps only three-hourly leads", () => {
    const points = parseCwaWaveArchive(currentCwaWaveFixture(), [spot]);

    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      issuedAt: "2026-08-25T06:58:36.000Z",
      modelRunAt: "2026-08-25T00:00:00.000Z",
      validAt: "2026-08-25T03:00:00.000Z",
      waveHeight: 1.7,
      waveDirection: 122,
      wavePeriod: 9.9,
    });
  });

  it("parses local-mean-sea-level tide heights and interpolates between extrema", async () => {
    const tidePayload = {
      records: {
        TideForecasts: [{
          Location: {
            LocationId: "O00400",
            Latitude: 24.88,
            Longitude: 121.846,
            TimePeriods: {
              Daily: [{
                Time: [
                  { DateTime: "2026-08-25T14:00:00+08:00", Tide: "乾潮", TideHeights: { AboveLocalMSL: -40 } },
                  { DateTime: "2026-08-25T08:00:00+08:00", Tide: "滿潮", TideHeights: { AboveLocalMSL: "80" } },
                ],
              }],
            },
          },
        }],
      },
    };
    const events = parseCwaTidePayload(tidePayload);
    const tide = interpolateCwaTide(events, "2026-08-25T03:00:00.000Z");
    expect(events.map((event) => event.heightMeters)).toEqual([0.8, -0.4]);
    expect(tide).toEqual({ heightMeters: 0.2, slopeMetersPerHour: -0.3142, state: "falling" });

    const snapshots = await buildCwaForecastSnapshots(
      parseCwaWaveArchive(cwaWaveFixture(), [spot]),
      events,
      "2026-08-25T02:20:00.000Z",
    );
    expect(snapshots[0]).toMatchObject({
      provider: "cwa",
      model: "cwa-wave-f-a0020-001",
      tideHeight: 0.2,
      tideSlope: -0.3142,
      tideState: "falling",
    });
  });

  it("uses insert-or-ignore IDs so a provider retry does not duplicate a run", async () => {
    const snapshots = await parseOpenMeteoEcmwfWam(
      openMeteoFixture,
      spot,
      "2026-08-25T02:20:00.000Z",
    );
    const seen = new Set<string>();
    const db = {
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => ({ sql, values }),
      }),
      batch: async (statements: Array<{ values: unknown[] }>) => statements.map((statement) => {
        const id = String(statement.values[0]);
        const changes = seen.has(id) ? 0 : 1;
        seen.add(id);
        return { meta: { changes } };
      }),
    } as unknown as D1Database;

    await expect(insertForecastSnapshots(db, snapshots)).resolves.toEqual({
      attempted: 3,
      inserted: 3,
      duplicates: 0,
    });
    await expect(insertForecastSnapshots(db, snapshots)).resolves.toEqual({
      attempted: 3,
      inserted: 0,
      duplicates: 3,
    });
  });

  it("returns no tide estimate without two surrounding extrema", () => {
    const events: CwaTideEvent[] = [{
      validAt: "2026-08-25T00:00:00.000Z",
      heightMeters: 0.5,
      state: "high",
      latitude: 24.88,
      longitude: 121.846,
    }];
    expect(interpolateCwaTide(events, "2026-08-25T03:00:00.000Z")).toBeNull();
  });

  it("keeps ECMWF ingestion running when the optional CWA secret is absent", async () => {
    const seen = new Set<string>();
    const db = {
      prepare: (sql: string) => {
        if (sql.includes("FROM spots")) {
          return { all: async () => ({ results: [spot] }) };
        }
        return { bind: (...values: unknown[]) => ({ values }) };
      },
      batch: async (statements: Array<{ values: unknown[] }>) => statements.map((statement) => {
        const id = String(statement.values[0]);
        const changes = seen.has(id) ? 0 : 1;
        seen.add(id);
        return { meta: { changes } };
      }),
    } as unknown as D1Database;
    const fetchImpl = (async () => new Response(JSON.stringify(openMeteoFixture), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

    const summary = await runForecastIngestion(
      { DB: db } as AppEnv,
      new Date("2026-08-25T02:20:00.000Z"),
      fetchImpl,
    );

    expect(summary.providers).toEqual([
      expect.objectContaining({ provider: "open-meteo/ecmwf_wam", status: "complete", inserted: 3 }),
      expect.objectContaining({ provider: "cwa/F-A0020-001+F-A0021-001", status: "skipped" }),
    ]);
  });

  it("skips CWA when its key exists but query-string redaction is not verified", async () => {
    const seen = new Set<string>();
    const db = {
      prepare: (sql: string) => {
        if (sql.includes("FROM spots")) {
          return { all: async () => ({ results: [spot] }) };
        }
        return { bind: (...values: unknown[]) => ({ values }) };
      },
      batch: async (statements: Array<{ values: unknown[] }>) => statements.map((statement) => {
        const id = String(statement.values[0]);
        const changes = seen.has(id) ? 0 : 1;
        seen.add(id);
        return { meta: { changes } };
      }),
    } as unknown as D1Database;
    let fetchCalls = 0;
    const fetchImpl = (async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify(openMeteoFixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const summary = await runForecastIngestion(
      { DB: db, CWA_API_KEY: "configured-but-guarded" } as AppEnv,
      new Date("2026-08-25T02:20:00.000Z"),
      fetchImpl,
    );

    expect(summary.providers[1]).toMatchObject({
      provider: "cwa/F-A0020-001+F-A0021-001",
      status: "skipped",
      message: "CWA query-string redaction is not verified",
    });
    expect(fetchCalls).toBe(1);
  });

  it("streams CWA ZIP and tide responses through the provider boundary", async () => {
    const tidePayload = {
      records: {
        TideForecasts: [{
          Location: {
            LocationId: "O00400",
            Latitude: 24.88,
            Longitude: 121.846,
            TimePeriods: { Daily: [{ Time: [
              { DateTime: "2026-08-25T08:00:00+08:00", Tide: "滿潮", TideHeights: { AboveLocalMSL: 80 } },
              { DateTime: "2026-08-25T14:00:00+08:00", Tide: "乾潮", TideHeights: { AboveLocalMSL: -40 } },
            ] }] },
          },
        }],
      },
    };
    const fetchImpl = (async (input: URL | RequestInfo) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname.includes("fileapi")) {
        const archive = cwaWaveFixture();
        const body = archive.buffer.slice(
          archive.byteOffset,
          archive.byteOffset + archive.byteLength,
        ) as ArrayBuffer;
        return new Response(body, {
          status: 200,
          headers: { "content-length": String(archive.byteLength) },
        });
      }
      return new Response(JSON.stringify(tidePayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const snapshots = await fetchCwaForecasts(
      [spot],
      "test-key",
      "2026-08-25T02:20:00.000Z",
      fetchImpl,
    );
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ waveHeight: 0.82, tideHeight: 0.2 });
  });

  it("redacts the CWA key from partial tide warnings", async () => {
    const apiKey = "sensitive-cwa-test-key";
    const warnings: string[] = [];
    const fetchImpl = (async (input: URL | RequestInfo) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (!url.pathname.includes("fileapi")) {
        throw new Error(`tide fetch failed: ${url.toString()} key=${apiKey}`);
      }
      const archive = cwaWaveFixture();
      const body = archive.buffer.slice(
        archive.byteOffset,
        archive.byteOffset + archive.byteLength,
      ) as ArrayBuffer;
      return new Response(body, { status: 200 });
    }) as typeof fetch;

    const snapshots = await fetchCwaForecasts(
      [spot],
      apiKey,
      "2026-08-25T02:20:00.000Z",
      fetchImpl,
      (message) => warnings.push(message),
    );

    expect(snapshots).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("[redacted]");
    expect(warnings[0]).not.toContain(apiKey);
  });
});
