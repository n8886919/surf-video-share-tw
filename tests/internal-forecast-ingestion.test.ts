import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { api } from "../src/worker/api";
import type { AppEnv } from "../src/worker/db";
import { canonicalForecastIngestionRequest } from "../src/worker/internal-forecast-ingestion";

const secret = "forecast-ingestion-test-secret-32-bytes";
const path = "/api/v1/internal/forecast-ingestion/cwa";
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

  prepare(sql: string) {
    const all = async () => ({
      results: [{
        id: "spot_wushi-harbor-north",
        slug: "wushi-harbor-north",
        latitude: 24.8731036,
        longitude: 121.8411446,
      }],
    });
    return {
      all,
      bind: (...values: unknown[]) => sql.includes("SELECT id FROM spots") ? { all } : { sql, values },
    };
  }

  async batch(statements: Array<{ values: unknown[] }>) {
    return statements.map((statement) => {
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

async function post(payload: unknown, appEnv: AppEnv, signedPath = path) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return api.fetch(new Request(`https://worker.example${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...signedHeaders("POST", signedPath, body) },
    body,
  }), appEnv);
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
