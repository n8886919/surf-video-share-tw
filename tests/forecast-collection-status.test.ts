import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/worker/api";
import { forecastCollectionStatusSchema } from "../packages/api-contract/src";
import { latestDueMfwamSlot } from "../src/worker/forecast/schedule";
import { forecastFixture } from "./helpers/forecast-fixture";

const fixtures: ReturnType<typeof forecastFixture>[] = [];
afterEach(() => { vi.useRealTimers(); for (const f of fixtures.splice(0)) f.sqlite.close(); });
function fixture() { const f = forecastFixture(); fixtures.push(f); return f; }
function seed(f: ReturnType<typeof fixture>, source: string, slot: string, completed: string | null) {
  f.sqlite.prepare(`INSERT INTO forecast_update_runs (run_key,source,slot_at,started_at,completed_at)
    VALUES (?,?,?,?,?)`).run(`${source}:${slot}`, source, slot, slot, completed);
}
const request = () => new Request("https://example.com/api/v1/forecast-collection-status");
const checkedAt = "2026-09-09T11:47:46.000Z";

describe("public collection completion probe", () => {
  it("accepts all-spot completed legacy slots without requiring newly inserted snapshots or emitting diagnostics", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(checkedAt));
    const f = fixture();
    seed(f, "mfwam", "2026-09-09T06:20:05.000Z", "2026-09-09T06:20:09.717Z");
    seed(f, "mfwam_far", "2026-09-09T00:20:05.000Z", "2026-09-09T00:20:12.109Z");
    const response = await api.fetch(request(), f.env);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(forecastCollectionStatusSchema.parse(await response.json())).toEqual({ checkedAt,
      near: { slotAt: "2026-09-09T06:20:00.000Z", completedAt: "2026-09-09T06:20:09.717Z" },
      far: { slotAt: "2026-09-09T00:20:00.000Z", completedAt: "2026-09-09T00:20:12.109Z" },
    });
    expect(f.queries).toHaveLength(2);
    expect(f.queries.every(sql => sql.trim().startsWith("SELECT") && !/forecast_snapshots|ops_events|journey|users|videos/.test(sql))).toBe(true);
    const plan = f.sqlite.prepare(`EXPLAIN QUERY PLAN ${f.queries[0]}`)
      .all("mfwam", "2026-09-09T06:20:00.000Z", "2026-09-09T06:21:00.000Z");
    expect(JSON.stringify(plan)).toContain("SEARCH forecast_update_runs USING INDEX forecast_update_runs_source_slot_idx");
  });

  it.each(["missing", "partial", "stale", "future", "far-missing"])("returns 503 when collection is %s", async kind => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(checkedAt));
    const f = fixture();
    if (kind !== "far-missing") seed(f, "mfwam_far", "2026-09-09T00:20:00.000Z", "2026-09-09T00:20:12.000Z");
    if (kind === "partial") seed(f, "mfwam", "2026-09-09T06:20:05.000Z", null);
    if (kind === "stale") seed(f, "mfwam", "2026-09-09T00:20:05.000Z", "2026-09-09T00:20:12.000Z");
    if (kind === "future") seed(f, "mfwam", "2026-09-09T06:20:05.000Z", "2026-09-09T12:00:00.000Z");
    if (kind === "far-missing") seed(f, "mfwam", "2026-09-09T06:20:05.000Z", "2026-09-09T06:20:12.000Z");
    const response = await api.fetch(request(), f.env);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = forecastCollectionStatusSchema.parse(await response.json());
    expect(kind === "far-missing" ? body.far.completedAt : body.near.completedAt).toBeNull();
  });

  it("fails closed without exposing database errors", async () => {
    const f = fixture(); f.failNext("SELECT slot_at");
    const response = await api.fetch(request(), f.env);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "FORECAST_COLLECTION_STATUS_UNAVAILABLE" });
  });

  it.each([
    ["2026-09-09T06:34:59.999Z", "2026-09-09T00:20:00.000Z", "2026-09-09T00:20:00.000Z"],
    ["2026-09-09T06:35:00.000Z", "2026-09-09T06:20:00.000Z", "2026-09-09T00:20:00.000Z"],
    ["2026-09-10T00:34:59.999Z", "2026-09-09T18:20:00.000Z", "2026-09-09T12:20:00.000Z"],
    ["2026-09-10T00:35:00.000Z", "2026-09-10T00:20:00.000Z", "2026-09-10T00:20:00.000Z"],
    [checkedAt, "2026-09-09T06:20:00.000Z", "2026-09-09T00:20:00.000Z"],
  ])("handles grace, delayed checks and midnight at %s", (time, near, far) => {
    expect(latestDueMfwamSlot(new Date(time))).toBe(near);
    expect(latestDueMfwamSlot(new Date(time), true)).toBe(far);
  });
});
