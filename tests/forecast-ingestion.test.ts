import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  fetchOpenMeteoEcmwfWam,
  fetchOpenMeteoMarineModel,
  OPEN_METEO_WAVE_MODELS,
  parseOpenMeteoEcmwfWam,
  parseOpenMeteoMarineModel,
} from "../src/worker/forecast/open-meteo";
import { runForecastIngestion, runScheduledForecastIngestion } from "../src/worker/forecast/ingest";
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

const componentFixture = {
  ...openMeteoFixture,
  hourly: {
    ...openMeteoFixture.hourly,
    time: ["2026-08-25T02:00", "2026-08-25T03:00"],
    wave_height: [1.1, 1.2],
    wave_direction: [90, 95],
    wave_period: [7, 8],
    wave_peak_period: [8, 9],
    swell_wave_height: [0.8, 0.9],
    swell_wave_direction: [100, 105],
    swell_wave_period: [9, 10],
    swell_wave_peak_period: [11, 12],
    secondary_swell_wave_height: [0.3, 0.4],
    secondary_swell_wave_direction: [160, 165],
    secondary_swell_wave_period: [6, 7],
    tertiary_swell_wave_height: [0.1, 0.2],
    tertiary_swell_wave_direction: [220, 225],
    tertiary_swell_wave_period: [4, 5],
    wind_wave_height: [0.4, 0.5],
    wind_wave_direction: [40, 45],
    wind_wave_period: [3, 4],
    wind_wave_peak_period: [4, 5],
  },
};

function ingestionDb() {
  const seen = new Set<string>();
  return {
    prepare: (sql: string) => {
      if (sql.includes("FROM spots")) return { all: async () => ({ results: [spot] }) };
      return { bind: (...values: unknown[]) => ({ values }) };
    },
    batch: async (statements: Array<{ values: unknown[] }>) => statements.map((statement) => {
      expect(statement.values).toHaveLength(43);
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
      snapshotKind: "forecast",
      issuedAt: "2026-08-25T02:20:00.000Z",
      modelRunAt: null,
      validAt: "2026-08-25T03:00:00.000Z",
      gridLatitude: 24.850615,
      gridLongitude: 121.901184,
      waveHeight: 0.82,
      waveDirection: 91,
      wavePeriod: 7.1,
      totalSwellHeight: null,
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

  it("keeps model feature semantics independent and labels recent past rows", async () => {
    const retrievedAt = "2026-08-25T02:20:00.000Z";
    const [mfwam, ecmwf, gfs, gwam] = await Promise.all([
      parseOpenMeteoMarineModel(componentFixture, spot, retrievedAt, "meteofrance_wave"),
      parseOpenMeteoMarineModel(componentFixture, spot, retrievedAt, "ecmwf_wam"),
      parseOpenMeteoMarineModel(componentFixture, spot, retrievedAt, "ncep_gfswave016"),
      parseOpenMeteoMarineModel(componentFixture, spot, retrievedAt, "dwd_gwam"),
    ]);

    expect(mfwam[0]).toMatchObject({
      snapshotKind: "historical_forecast",
      swellHeight: 0.8,
      secondarySwellHeight: 0.3,
      totalSwellHeight: null,
    });
    expect(mfwam[1].snapshotKind).toBe("forecast");
    expect(ecmwf[0]).toMatchObject({
      swellHeight: null,
      secondarySwellHeight: null,
      tertiarySwellHeight: null,
      totalSwellHeight: null,
    });
    expect(gfs[0]).toMatchObject({
      swellHeight: 0.8,
      secondarySwellHeight: 0.3,
      tertiarySwellHeight: 0.1,
      totalSwellHeight: null,
    });
    expect(gwam[0]).toMatchObject({
      totalSwellHeight: 0.8,
      totalSwellPeakPeriod: 11,
      swellHeight: null,
      secondarySwellHeight: null,
    });
  });

  it("uses insert-or-ignore IDs so a provider retry does not duplicate a run", async () => {
    const snapshots = await parseOpenMeteoEcmwfWam(openMeteoFixture, spot, "2026-08-25T02:20:00.000Z");
    const db = ingestionDb();
    await expect(insertForecastSnapshots(db, snapshots)).resolves.toEqual({ attempted: 3, inserted: 3, duplicates: 0 });
    await expect(insertForecastSnapshots(db, snapshots)).resolves.toEqual({ attempted: 3, inserted: 0, duplicates: 3 });
  });

  it("ingests four Open-Meteo models as independent provider results", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify(openMeteoFixture), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
    const summary = await runForecastIngestion(
      { DB: ingestionDb() } as AppEnv,
      new Date("2026-08-25T02:20:00.000Z"),
      fetchImpl,
    );
    expect(summary.providers).toEqual(OPEN_METEO_WAVE_MODELS.map(({ model }) =>
      expect.objectContaining({
        provider: `open-meteo/${model}`,
        status: "complete",
        inserted: 3,
      })
    ));
  });

  it("sends the owner a LINE heartbeat after the scheduled Open-Meteo update", async () => {
    const lineRequests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://api.line.me/v2/bot/message/push") {
        lineRequests.push({ url, init });
        return new Response(null, { status: 200 });
      }
      return new Response(JSON.stringify(openMeteoFixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await runScheduledForecastIngestion({
      DB: ingestionDb(),
      LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: "channel-token",
      OPS_LINE_USER_ID: `U${"a".repeat(32)}`,
    } as AppEnv, new Date("2026-08-25T02:20:00.000Z"), fetchImpl);

    expect(lineRequests).toHaveLength(1);
    const body = JSON.parse(String(lineRequests[0].init?.body)) as {
      to: string;
      messages: Array<{ type: string; text: string }>;
    };
    expect(body.to).toBe(`U${"a".repeat(32)}`);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].text).toContain("✅ 彼日浪影氣象資料排程已跑完");
    expect(body.messages[0].text).toContain("浪點：1");
    expect(body.messages[0].text).toContain("MFWAM: complete（新增 3、重複 0）");
    expect(body.messages[0].text).toContain("此訊息僅代表 Cloudflare 的 Open-Meteo 更新");
  });

  it("requests match horizon only for MFWAM and a bounded collect-only horizon", async () => {
    const requestedUrls: URL[] = [];
    const fetchImpl = (async (input: URL | RequestInfo) => {
      requestedUrls.push(new URL(input instanceof Request ? input.url : String(input)));
      return new Response(JSON.stringify(openMeteoFixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await Promise.all(OPEN_METEO_WAVE_MODELS.map(({ model }) =>
      fetchOpenMeteoMarineModel(spot, "2026-08-25T02:20:00.000Z", model, fetchImpl)
    ));
    await fetchOpenMeteoEcmwfWam(spot, "2026-08-25T02:20:00.000Z", fetchImpl);

    for (const requestedUrl of requestedUrls) {
      const model = requestedUrl.searchParams.get("models");
      expect(requestedUrl.searchParams.get("past_hours")).toBe("6");
      expect(requestedUrl.searchParams.get("forecast_hours"))
        .toBe(model === "meteofrance_wave" ? "168" : "1");
      expect(requestedUrl.searchParams.get("hourly")).toContain("tertiary_swell_wave_height");
    }
  });
});
