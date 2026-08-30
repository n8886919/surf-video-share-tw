import { Hono } from "hono";
import {
  acceptedCwaForecastIngestionBatchSchema,
  CWA_TIDE_LOCATION_BY_SPOT_ID,
  type AcceptedCwaForecastIngestionSnapshot,
} from "../../packages/api-contract/src";
import type { AppEnv } from "./db";
import { insertForecastSnapshots, stableForecastId } from "./forecast/store";
import type { ForecastSnapshotInput } from "./forecast/types";

const SIGNATURE_VERSION = "1";
const SIGNATURE_WINDOW_SECONDS = 5 * 60;
const MAX_BODY_BYTES = 128 * 1024;
const MAX_CWA_PUBLICATION_LAG_MS = 12 * 60 * 60_000;
const CWA_PROVIDER = "cwa";
const CWA_MODEL = "cwa-wave-f-a0020-001";
const LEGACY_CWA_TIDE_SPOT_IDS = new Set(["spot_wushi-harbor-north", "spot_double-lions"]);

const signatureHeaders = {
  version: "x-forecast-ingestion-version",
  timestamp: "x-forecast-ingestion-timestamp",
  nonce: "x-forecast-ingestion-nonce",
  signature: "x-forecast-ingestion-signature",
} as const;

type IngestionAuthFailure = {
  status: 401 | 413 | 503;
  error: "INGESTION_AUTH_UNAVAILABLE" | "INVALID_INGESTION_SIGNATURE" | "EXPIRED_INGESTION_SIGNATURE" | "INGESTION_BODY_TOO_LARGE";
};

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/u.test(value)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(value).buffer,
  )));
}

export function canonicalForecastIngestionRequest(input: {
  version: string;
  timestamp: string;
  nonce: string;
  method: string;
  pathname: string;
  bodySha256: string;
}): string {
  return [
    input.version,
    input.timestamp,
    input.nonce,
    input.method.toUpperCase(),
    input.pathname,
    input.bodySha256.toLowerCase(),
  ].join("\n");
}

export async function verifyForecastIngestionSignature(
  secret: string,
  canonical: string,
  signatureHex: string,
): Promise<boolean> {
  const signature = hexToBytes(signatureHex);
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    Uint8Array.from(signature).buffer,
    new TextEncoder().encode(canonical),
  );
}

async function readBoundedBody(request: Request): Promise<Uint8Array | IngestionAuthFailure> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    return { status: 413, error: "INGESTION_BODY_TOO_LARGE" };
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel("body limit exceeded");
      return { status: 413, error: "INGESTION_BODY_TOO_LARGE" };
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function authenticateIngestionRequest(
  request: Request,
  env: AppEnv,
  now = new Date(),
): Promise<{ body: Uint8Array } | IngestionAuthFailure> {
  if (!env.FORECAST_INGESTION_SECRET || env.FORECAST_INGESTION_SECRET.length < 32) {
    return { status: 503, error: "INGESTION_AUTH_UNAVAILABLE" };
  }
  const version = request.headers.get(signatureHeaders.version);
  const timestamp = request.headers.get(signatureHeaders.timestamp);
  const nonce = request.headers.get(signatureHeaders.nonce);
  const signature = request.headers.get(signatureHeaders.signature);
  if (
    version !== SIGNATURE_VERSION
    || !timestamp
    || !/^\d{10}$/u.test(timestamp)
    || !nonce
    || !/^[A-Za-z0-9_-]{16,64}$/u.test(nonce)
    || !signature
  ) return { status: 401, error: "INVALID_INGESTION_SIGNATURE" };

  const signedAtSeconds = Number(timestamp);
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  if (Math.abs(signedAtSeconds - nowSeconds) > SIGNATURE_WINDOW_SECONDS) {
    return { status: 401, error: "EXPIRED_INGESTION_SIGNATURE" };
  }
  const body = await readBoundedBody(request);
  if (!(body instanceof Uint8Array)) return body;
  const canonical = canonicalForecastIngestionRequest({
    version,
    timestamp,
    nonce,
    method: request.method,
    pathname: new URL(request.url).pathname,
    bodySha256: await sha256Hex(body),
  });
  return await verifyForecastIngestionSignature(
    env.FORECAST_INGESTION_SECRET,
    canonical,
    signature,
  ) ? { body } : { status: 401, error: "INVALID_INGESTION_SIGNATURE" };
}

function isAuthFailure(
  result: { body: Uint8Array } | IngestionAuthFailure,
): result is IngestionAuthFailure {
  return "error" in result;
}

function hasValidTimeRelationship(snapshot: AcceptedCwaForecastIngestionSnapshot): boolean {
  const issued = new Date(snapshot.issuedAt).getTime();
  const modelRun = new Date(snapshot.modelRunAt).getTime();
  const valid = new Date(snapshot.validAt).getTime();
  const expectedValid = modelRun + snapshot.leadHours * 3_600_000;
  return Math.abs(valid - expectedValid) <= 1_000
    && issued >= modelRun - 60 * 60_000
    && issued <= modelRun + MAX_CWA_PUBLICATION_LAG_MS
    && ((snapshot.gridLatitude === null) === (snapshot.gridLongitude === null))
    && (snapshot.provenance.tide !== null
      || [snapshot.tideHeight, snapshot.tideSlope, snapshot.tideState].every((value) => value === null));
}

function hasValidTideMapping(
  snapshot: AcceptedCwaForecastIngestionSnapshot,
  contractVersion: 1 | 2,
): boolean {
  if (snapshot.provenance.tide === null || contractVersion === 1) return true;
  const expected = CWA_TIDE_LOCATION_BY_SPOT_ID[
    snapshot.spotId as keyof typeof CWA_TIDE_LOCATION_BY_SPOT_ID
  ];
  return expected !== undefined && snapshot.provenance.tide.locationId === expected;
}

async function normalizedSnapshot(
  snapshot: AcceptedCwaForecastIngestionSnapshot,
  contractVersion: 1 | 2,
  receivedAt: string,
): Promise<ForecastSnapshotInput> {
  const issuedAt = new Date(snapshot.issuedAt).toISOString();
  const modelRunAt = new Date(snapshot.modelRunAt).toISOString();
  const validAt = new Date(snapshot.validAt).toISOString();
  const expectedTideLocation = CWA_TIDE_LOCATION_BY_SPOT_ID[
    snapshot.spotId as keyof typeof CWA_TIDE_LOCATION_BY_SPOT_ID
  ];
  const retainVerifiedTide = snapshot.provenance.tide !== null && (
    contractVersion === 1
      ? LEGACY_CWA_TIDE_SPOT_IDS.has(snapshot.spotId)
      : snapshot.provenance.tide.locationId === expectedTideLocation
  );
  return {
    id: await stableForecastId([CWA_PROVIDER, CWA_MODEL, snapshot.spotId, issuedAt, validAt]),
    spotId: snapshot.spotId,
    provider: CWA_PROVIDER,
    model: CWA_MODEL,
    issuedAt,
    modelRunAt,
    validAt,
    leadHours: snapshot.leadHours,
    gridLatitude: snapshot.gridLatitude,
    gridLongitude: snapshot.gridLongitude,
    waveHeight: snapshot.waveHeight,
    waveDirection: snapshot.waveDirection,
    wavePeriod: snapshot.wavePeriod,
    swellHeight: null,
    swellDirection: null,
    swellPeriod: null,
    secondarySwellHeight: null,
    secondarySwellDirection: null,
    secondarySwellPeriod: null,
    windWaveHeight: null,
    windWaveDirection: null,
    windWavePeriod: null,
    tideHeight: retainVerifiedTide ? snapshot.tideHeight : null,
    tideSlope: retainVerifiedTide ? snapshot.tideSlope : null,
    tideState: retainVerifiedTide ? snapshot.tideState : null,
    windSpeed: null,
    windDirection: null,
    windGust: null,
    retrievedAt: receivedAt,
    schemaVersion: 1,
    rawPayload: JSON.stringify({
      wave: snapshot.provenance.wave,
      tide: retainVerifiedTide && snapshot.provenance.tide ? {
        ...snapshot.provenance.tide,
        sourceRetrievedAt: receivedAt,
      } : null,
    }),
  };
}

export const internalForecastIngestionApi = new Hono<{ Bindings: AppEnv }>();

internalForecastIngestionApi.get("/spots", async (context) => {
  const authenticated = await authenticateIngestionRequest(context.req.raw, context.env);
  if (isAuthFailure(authenticated)) {
    return context.json({ error: authenticated.error }, authenticated.status);
  }
  const spots = await context.env.DB.prepare(
    `SELECT id, slug, latitude, longitude FROM spots
     WHERE active = 1 AND latitude IS NOT NULL AND longitude IS NOT NULL
     ORDER BY slug`,
  ).all<{ id: string; slug: string; latitude: number; longitude: number }>();
  return context.json({ spots: spots.results });
});

internalForecastIngestionApi.post("/cwa", async (context) => {
  const authenticated = await authenticateIngestionRequest(context.req.raw, context.env);
  if (isAuthFailure(authenticated)) {
    return context.json({ error: authenticated.error }, authenticated.status);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(authenticated.body));
  } catch {
    return context.json({ error: "INVALID_INGESTION_BODY" }, 400);
  }
  const parsed = acceptedCwaForecastIngestionBatchSchema.safeParse(payload);
  if (!parsed.success || !parsed.data.snapshots.every((snapshot) =>
    hasValidTimeRelationship(snapshot) && hasValidTideMapping(snapshot, parsed.data.version)
  )) {
    return context.json({ error: "INVALID_INGESTION_BODY" }, 422);
  }

  const requestedSpotIds = Array.from(new Set(parsed.data.snapshots.map((snapshot) => snapshot.spotId)));
  const placeholders = requestedSpotIds.map(() => "?").join(", ");
  const activeSpots = await context.env.DB.prepare(
    `SELECT id FROM spots WHERE active = 1
     AND latitude IS NOT NULL AND longitude IS NOT NULL
     AND id IN (${placeholders})`,
  ).bind(...requestedSpotIds).all<{ id: string }>();
  const activeSpotIds = new Set(activeSpots.results.map((spot) => spot.id));
  if (requestedSpotIds.some((spotId) => !activeSpotIds.has(spotId))) {
    return context.json({ error: "INVALID_INGESTION_SPOT" }, 422);
  }

  const receivedAt = new Date().toISOString();
  const snapshots = await Promise.all(parsed.data.snapshots.map((snapshot) =>
    normalizedSnapshot(snapshot, parsed.data.version, receivedAt)
  ));
  const result = await insertForecastSnapshots(context.env.DB, snapshots);
  return context.json(result);
});
