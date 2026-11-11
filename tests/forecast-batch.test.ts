import { afterEach, describe, expect, it, vi } from "vitest";
import { runForecastIngestion } from "../src/worker/forecast/ingest";
import { fetchOpenMeteoMarineModelBatch, OPEN_METEO_WAVE_MODELS } from "../src/worker/forecast/open-meteo";
import { listActiveForecastSpots } from "../src/worker/forecast/store";
import { forecastFixture } from "./helpers/forecast-fixture";
import { marineBatchResponse } from "./helpers/marine-response";

const fixtures: ReturnType<typeof forecastFixture>[] = [];
const now = new Date("2026-09-24T12:20:41.172Z");
function fixture() { const value = forecastFixture(); fixtures.push(value); return value; }
afterEach(() => {
  for (const value of fixtures.splice(0)) value.sqlite.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("multi-location forecast collection", () => {
  it.each([false, true])("collects twenty spots and four independent models within the request budget (retry: %s)", async retry => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const value = fixture();
    const spots = await listActiveForecastSpots(value.db);
    expect(spots).toHaveLength(20);
    const attempts = new Map<string, number>();
    const fetcher = vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input));
      if (!url.searchParams.has("models")) return new Response(null, { status: 503 });
      const model = url.searchParams.get("models")!;
      const count = (attempts.get(model) ?? 0) + 1; attempts.set(model, count);
      if (retry && count % 2 === 1) return new Response(null, { status: 503 });
      expect(url.searchParams.get("latitude")).toBe(spots.map(spot => spot.latitude).join(","));
      expect(url.searchParams.get("longitude")).toBe(spots.map(spot => spot.longitude).join(","));
      const payload = marineBatchResponse(url, now);
      expect(Array.isArray(payload)).toBe(true);
      if (!Array.isArray(payload)) throw new Error("Expected multiple locations");
      payload.forEach((entry, index) => { entry.hourly.wave_height.fill(index + 1); });
      return Response.json(payload);
    });
    const summary = await runForecastIngestion(value.env, now, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(retry ? 9 : 5); // One metadata lookup plus bounded marine requests.
    expect(summary.providers).toEqual(OPEN_METEO_WAVE_MODELS.map(({ model }) => expect.objectContaining({
      provider: `open-meteo/${model}`, status: "complete", inserted: model === "meteofrance_wave" ? 2640 : 140,
    })));
    const rows = value.sqlite.prepare(`SELECT spot_id, model, MIN(wave_height) AS height,
      MIN(grid_latitude) AS latitude, COUNT(*) AS count FROM forecast_snapshots GROUP BY spot_id, model`).all();
    expect(rows).toHaveLength(80);
    for (const [index, spot] of spots.entries()) for (const { model } of OPEN_METEO_WAVE_MODELS) {
      expect(rows.find(row => row.spot_id === spot.id && row.model === model)).toMatchObject({
        height: index + 1, latitude: spot.latitude, count: model === "meteofrance_wave" ? 132 : 7,
      });
    }
    const repeated = await runForecastIngestion(value.env, now, fetcher);
    expect(repeated.providers.every(provider => provider.status === "complete" && provider.inserted === 0)).toBe(true);
    expect(value.sqlite.prepare("SELECT COUNT(*) AS count FROM forecast_snapshots").get()?.count).toBe(3060);
  });

  it("keeps one incomplete location from discarding valid locations or other models", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const value = fixture();
    const spots = await listActiveForecastSpots(value.db);
    const fetcher = vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input));
      if (!url.searchParams.has("models")) return new Response(null, { status: 503 });
      const payload = marineBatchResponse(url, now);
      if (Array.isArray(payload) && url.searchParams.get("models") === "meteofrance_wave") {
        payload[2].hourly.wave_height[0] = null;
      }
      return Response.json(payload);
    });
    const summary = await runForecastIngestion(value.env, now, fetcher);
    expect(summary.providers[0]).toMatchObject({ status: "partial", inserted: 19 * 132, message: `${spots[2].slug}: MFWAM response does not cover the requested hourly collection window` });
    expect(summary.providers.slice(1).every(provider => provider.status === "complete")).toBe(true);
    expect(value.sqlite.prepare("SELECT COUNT(*) AS count FROM forecast_snapshots WHERE spot_id=? AND model='meteofrance_wave'").get(spots[2].id)?.count).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it.each(["missing location", "wrong order"])("rejects ambiguous batch mapping: %s", async kind => {
    const spots = (await listActiveForecastSpots(fixture().db)).slice(0, 2);
    const fetcher = vi.fn<typeof fetch>(async input => {
      const payload = marineBatchResponse(new URL(String(input)), now);
      if (!Array.isArray(payload)) throw new Error("Expected multiple locations");
      return Response.json(kind === "missing location" ? payload.slice(1) : payload.reverse());
    });
    const results = await fetchOpenMeteoMarineModelBatch(spots, now.toISOString(), "meteofrance_wave", fetcher);
    expect(results).toHaveLength(2);
    expect(results.every(result => result.status === "rejected")).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([502, 503, 504, 429, 500])("bounds retry after HTTP %s", async status => {
    const spots = (await listActiveForecastSpots(fixture().db)).slice(0, 2);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status }))
      .mockImplementation(async input => Response.json(marineBatchResponse(new URL(String(input)), now)));
    const results = await fetchOpenMeteoMarineModelBatch(spots, now.toISOString(), "meteofrance_wave", fetcher);
    const retries = [502, 503, 504].includes(status);
    expect(fetcher).toHaveBeenCalledTimes(retries ? 2 : 1);
    expect(results.every(result => result.status === (retries ? "fulfilled" : "rejected"))).toBe(true);
  });

  it("honors Retry-After and never retries subrequest exhaustion", async () => {
    const spots = (await listActiveForecastSpots(fixture().db)).slice(0, 2);
    const limited = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503, headers: { "retry-after": "60" } }));
    const exhausted = vi.fn<typeof fetch>().mockRejectedValue(new Error("Too many subrequests by single Worker invocation"));
    for (const fetcher of [limited, exhausted]) {
      const results = await fetchOpenMeteoMarineModelBatch(spots, now.toISOString(), "meteofrance_wave", fetcher);
      expect(results.every(result => result.status === "rejected")).toBe(true);
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });

  it.each(["headers", "body", "both attempts"])("retries a local timeout once: %s", async stage => {
    const spots = (await listActiveForecastSpots(fixture().db)).slice(0, 2);
    const controllers: AbortController[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController(); controllers.push(controller); return controller.signal;
    });
    let calls = 0;
    const fetcher = vi.fn<typeof fetch>(async input => {
      calls++;
      if (calls === 1 || stage === "both attempts") {
        const error = new DOMException("The operation was aborted due to timeout", "TimeoutError");
        controllers.at(-1)!.abort(error);
        if (stage === "body") return new Response(new ReadableStream({ start(controller) { controller.error(error); } }));
        throw error;
      }
      return Response.json(marineBatchResponse(new URL(String(input)), now));
    });
    const results = await fetchOpenMeteoMarineModelBatch(spots, now.toISOString(), "meteofrance_wave", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(controllers[0].signal).not.toBe(controllers[1].signal);
    expect(results.every(result => result.status === (stage === "both attempts" ? "rejected" : "fulfilled"))).toBe(true);
  });
});
