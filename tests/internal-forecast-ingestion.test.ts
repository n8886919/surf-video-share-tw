import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { api } from "../src/worker/api";
import type { AppEnv } from "../src/worker/db";
import { forecastFixture } from "./helpers/forecast-fixture";
import { canonicalForecastIngestionRequest, CWA_RUN_COMPLETENESS_SQL } from "../src/worker/internal-forecast-ingestion";

const secret = "forecast-ingestion-test-secret-32-bytes";
const path = "/api/v1/internal/forecast-ingestion/cwa";
const completionPath = "/api/v1/internal/forecast-ingestion/cwa/complete";
const spotsPath = "/api/v1/internal/forecast-ingestion/spots";

function validSnapshot() {
  return {
    spotId: "spot_wushi-harbor-north",
    provider: "cwa",
    model: "cwa-wave-f-a0020-001",
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
    tideState: "falling",
    provenance: {
      wave: { dataset: "F-A0020-001", identifiers: { hs: "height-id", t: "period-id", dir: "direction-id" } },
      tide: {
        dataset: "F-A0021-001",
        locationId: "O00400",
        datum: "AboveLocalMSL",
        units: "m",
        interpolation: "half-cosine-between-adjacent-extrema",
      },
    },
  };
}

function signedHeaders(method: string, pathname: string, body: string, timestamp = Math.floor(Date.now() / 1_000)) {
  const version = "1";
  const nonce = "fixed_nonce_123456789";
  const bodySha256 = createHash("sha256").update(body).digest("hex");
  const canonical = canonicalForecastIngestionRequest({
    version,
    timestamp: String(timestamp),
    nonce,
    method,
    pathname,
    bodySha256,
  });
  return {
    "x-forecast-ingestion-version": version,
    "x-forecast-ingestion-timestamp": String(timestamp),
    "x-forecast-ingestion-nonce": nonce,
    "x-forecast-ingestion-signature": createHmac("sha256", secret).update(canonical).digest("hex"),
  };
}

class FakeD1 {
  readonly ids = new Set<string>();
  writes = 0;
  lastValues: unknown[] | null = null;

  constructor(private readonly spot = {
    id: "spot_wushi-harbor-north",
    slug: "wushi-harbor-north",
    latitude: 24.8731036,
    longitude: 121.8411446,
  }) {}

  prepare(sql: string) {
    const all = async () => ({
      results: [this.spot],
    });
    return {
      all,
      bind: (...values: unknown[]) => sql.includes("SELECT id FROM spots") ? { all } : { sql, values,
        all: async () => ({ results: values.filter(id => this.ids.has(String(id))).map(id => ({ id })) }) },
    };
  }

  async batch(statements: Array<{ values: unknown[] }>) {
    return statements.map((statement) => {
      this.lastValues = statement.values;
      const id = String(statement.values[0]);
      const changes = this.ids.has(id) ? 0 : 1;
      this.ids.add(id);
      this.writes += changes;
      return { meta: { changes } };
    });
  }
}

function env(db = new FakeD1(), configuredSecret: string | null = secret) {
  return {
    DB: db as unknown as D1Database,
    ...(configuredSecret === null ? {} : { FORECAST_INGESTION_SECRET: configuredSecret }),
  } as AppEnv;
}

async function post(payload: unknown, appEnv: AppEnv, signedPath = path, requestPath = path) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return api.fetch(new Request(`https://worker.example${requestPath}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...signedHeaders("POST", signedPath, body) },
    body,
  }), appEnv);
}

function validCompletion() {
  return {
    version: 1,
    provider: "cwa",
    model: "cwa-wave-f-a0020-001",
    issuedAt: "2026-08-30T06:25:15.000Z",
    modelRunAt: "2026-08-30T00:00:00.000Z",
  };
}

describe("internal forecast ingestion API", () => {
  it("authenticates spots without exposing a public browser route", async () => {
    const unauthenticated = await api.fetch(new Request(`https://worker.example${spotsPath}`), env());
    expect(unauthenticated.status).toBe(401);
    const response = await api.fetch(new Request(`https://worker.example${spotsPath}`, {
      headers: signedHeaders("GET", spotsPath, ""),
    }), env());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ spots: [{
      id: "spot_wushi-harbor-north",
      slug: "wushi-harbor-north",
      latitude: 24.8731036,
      longitude: 121.8411446,
    }] });
  });

  it("uses WebCrypto verification, recomputes a stable ID, and makes replay idempotent", async () => {
    const db = new FakeD1();
    const verify = vi.spyOn(crypto.subtle, "verify");
    const payload = { version: 1, snapshots: [validSnapshot()] };
    const first = await post(payload, env(db));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ attempted: 1, inserted: 1, duplicates: 0 });
    const second = await post(payload, env(db));
    expect(await second.json()).toEqual({ attempted: 1, inserted: 0, duplicates: 1 });
    expect(Array.from(db.ids)[0]).toMatch(/^forecast_[0-9a-f]{32}$/u);
    expect(verify).toHaveBeenCalled();
    verify.mockRestore();
  });

  it("accepts the observed bounded CWA publication lag", async () => {
    const response = await post({
      version: 1,
      snapshots: [{ ...validSnapshot(), issuedAt: "2026-08-30T06:25:15.000Z" }],
    }, env());
    expect(response.status).toBe(200);
  });

  it("records a complete CWA run without LINE and skips snapshot reads on replay", async () => {
    const fixture = forecastFixture();
    fixture.seedCwaRun();
    const lineFetch = vi.fn();
    vi.stubGlobal("fetch", lineFetch);
    try {
      // Completion no longer depends on Messaging API configuration/delivery.
      delete fixture.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
      const first = await post(validCompletion(), fixture.env, completionPath, completionPath);
      expect(first.status).toBe(200);
      await expect(first.json()).resolves.toEqual({ notification: "sent" });
      const second = await post(validCompletion(), fixture.env, completionPath, completionPath);
      await expect(second.json()).resolves.toEqual({ notification: "duplicate" });
      expect(lineFetch).not.toHaveBeenCalled();
      expect(fixture.queries.filter(sql => sql.includes("FROM forecast_snapshots"))).toHaveLength(1);
      const plan = fixture.sqlite.prepare("EXPLAIN QUERY PLAN " + CWA_RUN_COMPLETENESS_SQL)
        .all("cwa", "cwa-wave-f-a0020-001", validCompletion().modelRunAt);
      expect(JSON.stringify(plan)).toContain("SEARCH f USING COVERING INDEX forecast_completion_run_idx");
      expect(JSON.stringify(plan)).not.toMatch(/SCAN (?:f|forecast_snapshots)(?:"| )/u);
    } finally { vi.unstubAllGlobals(); fixture.sqlite.close(); }
  });

  it.each(["spot", "lead"])("rejects completion with a missing active %s", async missing => {
    const fixture = forecastFixture();
    fixture.seedCwaRun();
    fixture.sqlite.exec(missing === "spot"
      ? "DELETE FROM forecast_snapshots WHERE spot_id = 'spot_double-lions'"
      : "DELETE FROM forecast_snapshots WHERE spot_id = 'spot_double-lions' AND lead_hours = 72");
    try {
      const response = await post(validCompletion(), fixture.env, completionPath, completionPath);
      expect(response.status).toBe(409);
      expect(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM forecast_update_runs").get()?.count).toBe(0);
    } finally { fixture.sqlite.close(); }
  });

  it("keeps failed completion persistence retryable without a LINE dependency", async () => {
    const fixture = forecastFixture();
    fixture.seedCwaRun();
    fixture.failNext("INSERT INTO forecast_update_runs");
    try {
      const failed = await post(validCompletion(), fixture.env, completionPath, completionPath);
      expect(failed.status).toBe(502);
      const retried = await post(validCompletion(), fixture.env, completionPath, completionPath);
      await expect(retried.json()).resolves.toEqual({ notification: "sent" });
      expect(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM forecast_update_runs").get()?.count).toBe(1);
    } finally { fixture.sqlite.close(); }
  });

  it("keeps legacy v1 behavior by dropping fixed O00400 tide outside the two launch spots", async () => {
    const db = new FakeD1({
      id: "spot_jinzun",
      slug: "jinzun",
      latitude: 22.9558919,
      longitude: 121.2942829,
    });
    const response = await post({
      version: 1,
      snapshots: [{ ...validSnapshot(), spotId: "spot_jinzun" }],
    }, env(db));
    expect(response.status).toBe(200);
    expect(db.lastValues).toHaveLength(43);
    expect(db.lastValues?.slice(33, 36)).toEqual([null, null, null]);
    expect(JSON.parse(String(db.lastValues?.[41]))).toMatchObject({ tide: null });
  });

  it.each([
    ["spot_wushi-harbor-north", "O00400"],
    ["spot_double-lions", "O00400"],
    ["spot_suao-wuwei-harbor", "10002030"],
    ["spot_daxi", "O01200"],
    ["spot_jinzun", "O01300"],
    ["spot_donghe", "O01300"],
    ["spot_yuguangdao", "B02400"],
    ["spot_nanwan", "O00700"],
  ])("continues accepting legacy v2 tide provenance for %s at %s", async (spotId, locationId) => {
    const db = new FakeD1({ id: spotId, slug: spotId.slice(5), latitude: 24, longitude: 121 });
    const snapshot = validSnapshot();
    snapshot.spotId = spotId;
    snapshot.provenance.tide.locationId = locationId;
    const response = await post({ version: 2, snapshots: [snapshot] }, env(db));
    expect(response.status).toBe(200);
    expect(db.lastValues).toHaveLength(43);
    expect(db.lastValues?.slice(33, 36)).toEqual([0.2, -0.31, "falling"]);
    expect(JSON.parse(String(db.lastValues?.[41]))).toMatchObject({
      tide: { dataset: "F-A0021-001", locationId },
    });
  });

  it.each([
    ["spot_wushi-harbor-north", "10002040"],
    ["spot_double-lions", "O00400"],
    ["spot_suao-wuwei-harbor", "10002030"],
    ["spot_daxi", "I02200"],
    ["spot_jinzun", "I00900"],
    ["spot_donghe", "I00900"],
    ["spot_yuguangdao", "I00500"],
    ["spot_nanwan", "O00700"],
    ["spot_zhongjiao-bay", "O00100"],
    ["spot_fulong", "I03800"],
    ["spot_environmental-park", "I06100"],
    ["spot_hualien-beibin", "10015010"],
    ["spot_jiqi", "A00200"],
    ["spot_jiupeng", "10013330"],
    ["spot_jialeshui", "O01000"],
    ["spot_songbai-harbor", "10005020"],
    ["spot_green-bay", "A01500"],
    ["spot_wanli", "A01500"],
    ["spot_waipu-fishing-harbor", "I04100"],
  ])("retains nearest-location v4 tide provenance for %s at %s", async (spotId, locationId) => {
    const db = new FakeD1({ id: spotId, slug: spotId.slice(5), latitude: 24, longitude: 121 });
    const snapshot = validSnapshot();
    snapshot.spotId = spotId;
    snapshot.provenance.tide.locationId = locationId;
    const response = await post({ version: 4, snapshots: [snapshot] }, env(db));
    expect(response.status).toBe(200);
    expect(db.lastValues?.slice(33, 36)).toEqual([0.2, -0.31, "falling"]);
    expect(JSON.parse(String(db.lastValues?.[41]))).toMatchObject({
      tide: { dataset: "F-A0021-001", locationId },
    });
  });

  it("rejects a v2 tide location that is not allowlisted for the submitted spot", async () => {
    const db = new FakeD1({
      id: "spot_jinzun",
      slug: "jinzun",
      latitude: 22.9558919,
      longitude: 121.2942829,
    });
    const response = await post({
      version: 2,
      snapshots: [{ ...validSnapshot(), spotId: "spot_jinzun" }],
    }, env(db));
    expect(response.status).toBe(422);
    expect(db.writes).toBe(0);
  });

  it.each([
    ["wrong provider", { ...validSnapshot(), provider: "open-meteo" }],
    ["wrong model", { ...validSnapshot(), model: "other" }],
    ["invalid lead", { ...validSnapshot(), leadHours: 4 }],
    ["invalid run relationship", { ...validSnapshot(), validAt: "2026-08-30T04:00:00.000Z" }],
    ["publication lag over twelve hours", { ...validSnapshot(), issuedAt: "2026-08-30T12:00:00.001Z" }],
    ["arbitrary schema", { ...validSnapshot(), schemaVersion: 99 }],
  ])("rejects %s before a D1 write", async (_label, snapshot) => {
    const db = new FakeD1();
    const response = await post({ version: 1, snapshots: [snapshot] }, env(db));
    expect(response.status).toBe(422);
    expect(db.writes).toBe(0);
  });

  it("rejects an inactive or unknown spot before a D1 write", async () => {
    const db = new FakeD1();
    db.prepare = () => ({
      all: async () => ({ results: [] }),
      bind: () => ({ all: async () => ({ results: [] }) }),
    });
    const response = await post({ version: 1, snapshots: [validSnapshot()] }, env(db));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "INVALID_INGESTION_SPOT" });
    expect(db.writes).toBe(0);
  });

  it("rejects batches larger than five", async () => {
    const snapshots = Array.from({ length: 6 }, () => validSnapshot());
    expect((await post({ version: 1, snapshots }, env())).status).toBe(422);
  });

  it("fails closed when the dedicated secret is absent", async () => {
    const db = new FakeD1();
    const response = await post({ version: 1, snapshots: [validSnapshot()] }, env(db, null));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "INGESTION_AUTH_UNAVAILABLE" });
    expect(db.writes).toBe(0);
  });

  it("fails closed when the dedicated secret is too short", async () => {
    const db = new FakeD1();
    const response = await post({ version: 1, snapshots: [validSnapshot()] }, env(db, "too-short"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "INGESTION_AUTH_UNAVAILABLE" });
    expect(db.writes).toBe(0);
  });

  it("rejects expired, wrong-signature, and wrong-path requests before D1", async () => {
    const db = new FakeD1();
    const payload = { version: 1, snapshots: [validSnapshot()] };
    const body = JSON.stringify(payload);
    const expired = await api.fetch(new Request(`https://worker.example${path}`, {
      method: "POST",
      headers: signedHeaders("POST", path, body, Math.floor(Date.now() / 1_000) - 301),
      body,
    }), env(db));
    expect(expired.status).toBe(401);
    expect(await expired.json()).toEqual({ error: "EXPIRED_INGESTION_SIGNATURE" });

    const wrongSignatureHeaders = signedHeaders("POST", path, body);
    wrongSignatureHeaders["x-forecast-ingestion-signature"] = "0".repeat(64);
    const wrongSignature = await api.fetch(new Request(`https://worker.example${path}`, {
      method: "POST", headers: wrongSignatureHeaders, body,
    }), env(db));
    expect(wrongSignature.status).toBe(401);
    expect((await post(payload, env(db), "/wrong-path")).status).toBe(401);
    expect(db.writes).toBe(0);
  });

  it("rejects oversized and malformed bodies before D1", async () => {
    const db = new FakeD1();
    const oversized = await api.fetch(new Request(`https://worker.example${path}`, {
      method: "POST",
      headers: {
        ...signedHeaders("POST", path, "{}"),
        "content-length": String(128 * 1024 + 1),
      },
      body: "{}",
    }), env(db));
    expect(oversized.status).toBe(413);
    expect((await post("not-json", env(db))).status).toBe(400);
    expect(db.writes).toBe(0);
  });
});
