import { marineResponse } from "./helpers/marine-response";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectedForecastSlots, recordForecastUpdate, runDailyForecastReport } from "../src/worker/forecast/daily-report";
import { runScheduledForecastIngestion } from "../src/worker/forecast/ingest";
import { forecastFixture } from "./helpers/forecast-fixture";

const reportTime = new Date("2026-09-09T09:05:00+08:00");
const yesterday = "2026-09-08";
const fixtures: ReturnType<typeof forecastFixture>[] = [];
function fixture() {
  const value = forecastFixture(); fixtures.push(value); return value;
}
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks();
  for (const value of fixtures.splice(0)) value.sqlite.close();
});
function at(date: Date) { vi.useFakeTimers(); vi.setSystemTime(date); }
async function trackedFixture(cwa = 4, mfwam = 4) {
  const value = fixture();
  // A failed instrumented attempt still proves tracking began before the report day.
  await recordForecastUpdate(value.db, "mfwam", "2026-09-07T00:20:00Z", false, new Date("2026-09-07T00:20:00Z"));
  for (const [source, count] of [["cwa", cwa], ["mfwam", mfwam]] as const) {
    for (const slot of expectedForecastSlots(yesterday, source).slice(0, count)) {
      await recordForecastUpdate(value.db, source, slot, true, new Date(slot));
    }
  }
  return value;
}

describe("daily forecast reporting", () => {
  it("uses four Taipei slots across the UTC date boundary", () => {
    expect(expectedForecastSlots(yesterday, "cwa")).toEqual([
      "2026-09-07T18:00:00.000Z", "2026-09-08T00:00:00.000Z",
      "2026-09-08T06:00:00.000Z", "2026-09-08T12:00:00.000Z",
    ]);
    expect(expectedForecastSlots(yesterday, "mfwam")[0]).toBe("2026-09-07T18:20:00.000Z");
  });

  it("counts successes once, excludes out-of-day/manual slots, and sends one combined report", async () => {
    at(reportTime);
    const value = await trackedFixture(4, 3);
    await recordForecastUpdate(value.db, "mfwam", expectedForecastSlots(yesterday, "mfwam")[0], true);
    await recordForecastUpdate(value.db, "mfwam", "2026-09-08T12:21:00Z", true);
    await recordForecastUpdate(value.db, "mfwam", "2026-09-08T18:20:00Z", true);
    const line = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    await runDailyForecastReport(value.env, reportTime, line);
    await runDailyForecastReport(value.env, reportTime, line);
    expect(line).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(line.mock.calls[0][1]?.body));
    expect(body.messages[0].text).toBe("昨日預報更新（2026-09-08）\nCWA：應更新 4 次，成功 4 次\nMFWAM 近兩天：應更新 4 次，成功 3 次\nMFWAM 後三天：尚未累積完整一天\n成功指全浪點收錄完成（含相同資料），不是官方發布新版本次數。");
    expect(value.queries.some(sql => sql.includes("forecast_snapshots"))).toBe(false);
    const readQuery = value.queries.find(sql => sql.includes("SELECT slot_at, completed_at"));
    const plan = value.sqlite.prepare(`EXPLAIN QUERY PLAN ${readQuery}`)
      .all("mfwam", "2026-09-07T18:20:00.000Z", "2026-09-08T12:21:00.000Z");
    expect(JSON.stringify(plan)).toContain("SEARCH forecast_update_runs USING INDEX forecast_update_runs_source_slot_idx");
  });

  it("counts legacy Cron seconds and canonical replays once without changing stored history", async () => {
    at(reportTime);
    const value = await trackedFixture(3, 0);
    await recordForecastUpdate(value.db, "mfwam_far", "2026-09-07T00:20:05Z", true, new Date("2026-09-07T00:20:10Z"));
    const insert = value.sqlite.prepare(`INSERT INTO forecast_update_runs
      (run_key, source, slot_at, started_at, completed_at) VALUES (?, ?, ?, ?, ?)`);
    for (const [index, slot] of expectedForecastSlots(yesterday, "mfwam").entries()) {
      const jittered = new Date(Date.parse(slot) + [5000, 49123, 2000, 59999][index]).toISOString();
      insert.run(`legacy:${slot}`, "mfwam", jittered, jittered, jittered);
      if (new Date(slot).getUTCHours() % 12 === 0) insert.run(`far:${slot}`, "mfwam_far", jittered, jittered, jittered);
      if (index === 0) await recordForecastUpdate(value.db, "mfwam", slot, true);
      await recordForecastUpdate(value.db, "mfwam", jittered, false); // A later failure cannot erase success.
    }
    insert.run("off-minute", "mfwam", "2026-09-08T06:21:00.000Z", "ignored", "ignored");
    insert.run("off-far-hour", "mfwam_far", "2026-09-08T06:20:02.000Z", "ignored", "ignored");
    const before = value.sqlite.prepare("SELECT * FROM forecast_update_runs ORDER BY run_key").all();
    const line = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    await runDailyForecastReport(value.env, reportTime, line);
    const text = String(line.mock.calls[0][1]?.body);
    expect(text).toContain("CWA：應更新 4 次，成功 3 次");
    expect(text).toContain("MFWAM 近兩天：應更新 4 次，成功 4 次");
    expect(text).toContain("MFWAM 後三天：應更新 2 次，成功 2 次");
    expect(value.sqlite.prepare("SELECT * FROM forecast_update_runs ORDER BY run_key").all()).toEqual(before);
  });

  it("canonicalizes only valid MFWAM schedule minutes and preserves actual attempt times", async () => {
    const value = fixture();
    const now = new Date("2026-09-09T06:20:51.234Z");
    await recordForecastUpdate(value.db, "mfwam", "2026-09-09T06:20:49.123Z", false, now);
    await recordForecastUpdate(value.db, "mfwam", "2026-09-09T06:20:02.000Z", true, now);
    for (const slot of ["invalid", "2026-09-09T06:21:00Z", "2026-09-09T07:20:00Z"]) {
      await recordForecastUpdate(value.db, "mfwam", slot, true, now);
    }
    await recordForecastUpdate(value.db, "mfwam_far", "2026-09-09T06:20:05Z", true, now);
    await recordForecastUpdate(value.db, "cwa", "2026-09-09T06:00:05Z", true, now);
    expect(value.sqlite.prepare("SELECT source,slot_at,started_at,completed_at FROM forecast_update_runs").all()).toEqual([
      { source: "mfwam", slot_at: "2026-09-09T06:20:00.000Z", started_at: now.toISOString(), completed_at: now.toISOString() },
      { source: "cwa", slot_at: "2026-09-09T06:00:05.000Z", started_at: now.toISOString(), completed_at: now.toISOString() },
    ]);
  });

  it("reports zero when no slot completed and tracking already existed", async () => {
    at(reportTime);
    const value = await trackedFixture(0, 0);
    const line = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    await runDailyForecastReport(value.env, reportTime, line);
    expect(String(line.mock.calls[0][1]?.body).match(/成功 0 次/gu)).toHaveLength(2);
  });

  it("skips the partial launch day instead of fabricating historical failure counts", async () => {
    at(reportTime);
    const value = fixture();
    await recordForecastUpdate(value.db, "mfwam", expectedForecastSlots(yesterday, "mfwam")[0], false,
      new Date("2026-09-08T02:20:00+08:00"));
    const line = vi.fn<typeof fetch>();
    await runDailyForecastReport(value.env, reportTime, line);
    expect(line).not.toHaveBeenCalled();
  });

  it("stays silent before 09:05 and for a previous day's delayed cron", async () => {
    const value = await trackedFixture();
    const line = vi.fn<typeof fetch>();
    at(new Date("2026-09-09T08:05:00+08:00"));
    await runDailyForecastReport(value.env, reportTime, line);
    at(reportTime);
    await runDailyForecastReport(value.env, new Date("2026-09-08T23:05:00+08:00"), line);
    expect(line).not.toHaveBeenCalled();
  });

  it("uses one claim and retry key for concurrent invocations", async () => {
    at(reportTime);
    const value = await trackedFixture();
    const line = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    await Promise.all([runDailyForecastReport(value.env, reportTime, line), runDailyForecastReport(value.env, reportTime, line)]);
    expect(line).toHaveBeenCalledTimes(1);
    expect(new Headers(line.mock.calls[0][1]?.headers).get("X-Line-Retry-Key")).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("retries a lost acknowledgement with the frozen body/key and accepts LINE's confirmed 409", async () => {
    at(reportTime);
    const value = await trackedFixture(4, 3);
    value.failNext("SET status = 'sent'");
    const line = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 409, headers: { "x-line-accepted-request-id": "accepted-id" } }));
    await expect(runDailyForecastReport(value.env, reportTime, line)).rejects.toThrow("Simulated D1");
    // A late success after the first send must not change the payload attached to that retry key.
    await recordForecastUpdate(value.db, "mfwam", expectedForecastSlots(yesterday, "mfwam")[3], true);
    const retryAt = new Date("2026-09-09T10:05:00+08:00"); at(retryAt);
    await runDailyForecastReport(value.env, retryAt, line);
    expect(line.mock.calls[1][1]?.body).toBe(line.mock.calls[0][1]?.body);
    expect(line.mock.calls[1][1]?.headers).toEqual(line.mock.calls[0][1]?.headers);
    expect(value.sqlite.prepare("SELECT status FROM forecast_daily_reports").get()?.status).toBe("sent");
  });

  it("reclaims a crashed sender, retries 5xx, and never retries yesterday's report on a new day", async () => {
    at(reportTime);
    const value = await trackedFixture();
    const line = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 500 }));
    await expect(runDailyForecastReport(value.env, reportTime, line)).rejects.toThrow("500");
    value.sqlite.prepare("UPDATE forecast_daily_reports SET status = 'sending'").run();
    await runDailyForecastReport(value.env, reportTime, line);
    expect(line).toHaveBeenCalledTimes(1);
    const retryAt = new Date("2026-09-09T10:05:00+08:00"); at(retryAt);
    line.mockResolvedValue(new Response(null, { status: 200 }));
    await runDailyForecastReport(value.env, retryAt, line);
    expect(line).toHaveBeenCalledTimes(2);
    const nextDay = new Date("2026-09-10T09:05:00+08:00"); at(nextDay);
    value.sqlite.exec("UPDATE forecast_daily_reports SET status = 'failed'");
    await runDailyForecastReport(value.env, nextDay, line);
    expect(line).toHaveBeenCalledTimes(3);
    expect(line.mock.calls[2][1]?.body).not.toBe(line.mock.calls[1][1]?.body);
  });

  it("does not treat an ordinary 409 as accepted or retry an invalid request", async () => {
    at(reportTime);
    const value = await trackedFixture();
    const line = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 409 }));
    await expect(runDailyForecastReport(value.env, reportTime, line)).rejects.toThrow("409");
    await runDailyForecastReport(value.env, reportTime, line);
    expect(line).toHaveBeenCalledTimes(1);
    expect(value.sqlite.prepare("SELECT status FROM forecast_daily_reports").get()?.status).toBe("rejected");
  });
});

describe("scheduled MFWAM success accounting", () => {
  it.each(["complete", "partial", "failed"])("counts only complete MFWAM slots: %s", async status => {
    const value = fixture();
    let mfwamCalls = 0;
    const line = vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input));
      expect(url.host).not.toBe("api.line.me");
      if (url.searchParams.get("models") === "meteofrance_wave") {
        mfwamCalls++;
        if (status === "failed" || (status === "partial" && mfwamCalls === 1)) return new Response(null, { status: 500 });
        return Response.json(marineResponse(url));
      }
      // Collect-only failures cannot turn a complete MFWAM run into a failure.
      return new Response(null, { status: 500 });
    });
    const scheduledAt = new Date("2026-09-08T00:20:00Z");
    if (status === "complete") {
      await runScheduledForecastIngestion(value.env, scheduledAt, line);
      await runScheduledForecastIngestion(value.env, scheduledAt, line); // Identical rows still complete the slot.
    } else await expect(runScheduledForecastIngestion(value.env, scheduledAt, line)).rejects.toThrow("incomplete");
    const row = value.sqlite.prepare("SELECT COUNT(*) AS count, completed_at FROM forecast_update_runs WHERE source = 'mfwam'").get();
    expect(row?.count).toBe(1);
    expect(Boolean(row?.completed_at)).toBe(status === "complete");
    const far = value.sqlite.prepare("SELECT COUNT(*) AS count, completed_at FROM forecast_update_runs WHERE source = 'mfwam_far'").get();
    expect(far?.count).toBe(1);
    expect(Boolean(far?.completed_at)).toBe(status === "complete");
  });
});
