import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/worker/api";
import type { AppEnv } from "../src/worker/db";
import { MockVideoProvider } from "../src/worker/providers/mock";
import { findRecentPublicDuplicate, RECENT_UPLOAD_DUPLICATE_SQL } from "../src/worker/upload-duplicate";
import { hashVideoBlob } from "../app/video-hash-core";
import { forecastFixture } from "./helpers/forecast-fixture";

const now = new Date("2026-09-08T04:00:00.000Z");
const hash = "a".repeat(64);
const fixtures: ReturnType<typeof forecastFixture>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.sqlite.close(); vi.restoreAllMocks(); vi.useRealTimers(); });

function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const f = forecastFixture(); fixtures.push(f);
  const env = { ...f.env, APP_ENV: "development", ENABLE_DEV_AUTH: "true", VIDEO_PROVIDER: "mock", CONDITIONS_PROVIDER: "mock" } as AppEnv;
  f.sqlite.exec("INSERT INTO users(id,line_subject,created_at,updated_at) VALUES('other','private-line-subject','2026-09-08','2026-09-08')");
  const seed = (id = "public_video", uploadedAt = new Date(now.getTime() - 60_000).toISOString()) => {
    f.sqlite.prepare(`INSERT INTO videos
      (id,user_id,video_provider,provider_video_id,status,metadata_status,spot_id,public_at,terms_version,
       show_uploader,created_at,updated_at,uploaded_at,client_file_sha256,client_file_size_bytes)
      VALUES(?,'other','mock',?,'ready','complete','spot_double-lions',?,'cc0',0,?,?,?,?,1000)`)
      .run(id, `provider_${id}`, uploadedAt, uploadedAt, uploadedAt, uploadedAt, hash);
  };
  const input = { spotId: "spot_double-lions", capturedAt: "2026-09-08T00:00:00Z", durationSeconds: 20, sizeBytes: 1000,
    fileName: "wave.mp4", contentType: "video/mp4", fileSha256: hash };
  const call = (body: unknown = input) => api.fetch(new Request("https://example.com/api/v1/videos/upload-request", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://example.com" }, body: JSON.stringify(body),
  }), env);
  return { ...f, env, seed, input, call };
}

describe("24-hour cross-account upload reminder", () => {
  it.each([null, undefined, ""])("rejects missing capture time (%s) before provisioning or writing a video", async capturedAt => {
    const f = fixture();
    const create = vi.spyOn(MockVideoProvider.prototype, "createDirectUpload");
    expect((await f.call({ ...f.input, capturedAt })).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
    expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM videos").get()?.n).toBe(0);
  });
  it("uses a hash/size/time index and a rolling 24-hour window independent of calendar dates", async () => {
    const f = fixture();
    const cutoff = new Date(now.getTime() - 86_400_000).toISOString();
    f.seed("exact_cutoff", cutoff);
    expect(await findRecentPublicDuplicate(f.db, hash, 1000, now)).toBeNull();
    f.seed("within", new Date(Date.parse(cutoff) + 1).toISOString());
    expect(await findRecentPublicDuplicate(f.db, hash, 1000, now)).toEqual({ id: "within" });
    f.seed("future", new Date(now.getTime() + 1).toISOString());
    expect(await findRecentPublicDuplicate(f.db, hash, 1000, now)).toEqual({ id: "within" });
    expect(await findRecentPublicDuplicate(f.db, hash, 1001, now)).toBeNull();
    const plan = f.sqlite.prepare("EXPLAIN QUERY PLAN " + RECENT_UPLOAD_DUPLICATE_SQL).all(hash, 1000, cutoff, now.toISOString());
    expect(plan.some(row => String(row.detail).includes("SEARCH videos USING INDEX videos_recent_file_hash_idx"))).toBe(true);
    expect(plan.some(row => String(row.detail).includes("SCAN videos"))).toBe(false);
  });

  it.each([
    "public_at = NULL", "metadata_status = 'pending'", "status = 'processing'", "status = 'error'",
    "status = 'expired'", "moderation_status = 'delisted'", "terms_version = NULL", "client_file_sha256 = NULL",
  ])("does not reveal excluded media: %s", async patch => {
    const f = fixture(); f.seed(); f.sqlite.exec(`UPDATE videos SET ${patch}`);
    expect(await findRecentPublicDuplicate(f.db, hash, 1000, now)).toBeNull();
  });

  it("returns only a public video id across accounts before provisioning or writing another upload", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const f = fixture(); f.seed();
    const create = vi.spyOn(MockVideoProvider.prototype, "createDirectUpload");
    const response = await f.call(); expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = await response.json();
    expect(payload).toEqual({ error: "RECENT_DUPLICATE_UPLOAD", message: expect.any(String), duplicate: { videoId: "public_video" } });
    expect(create).not.toHaveBeenCalled();
    expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM videos").get()?.n).toBe(1);
  });

  it("ignores a legacy override and keeps the existing owner/video intact", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const f = fixture(); f.seed();
    const response = await f.call({ ...f.input, duplicateAcknowledged: true });
    expect(response.status).toBe(409);
    expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM videos").get()?.n).toBe(1);
    expect(f.sqlite.prepare("SELECT user_id,status FROM videos WHERE id='public_video'").get()).toMatchObject({ user_id: "other", status: "ready" });
  });

  it("keeps old clients and failed client-side hashing usable without fabricating a fingerprint", async () => {
    const f = fixture(); f.seed();
    const response = await f.call({ ...f.input, fileSha256: undefined });
    expect(response.status).toBe(201);
    const result = await response.json() as { videoId: string };
    expect(f.sqlite.prepare("SELECT client_file_sha256,client_file_size_bytes FROM videos WHERE id=?").get(result.videoId))
      .toMatchObject({ client_file_sha256: null, client_file_size_bytes: null });
  });

  it("requires login and rejects malformed hash/override claims before querying duplicate media", async () => {
    const f = fixture();
    const create = vi.spyOn(MockVideoProvider.prototype, "createDirectUpload");
    expect((await f.call({ ...f.input, fileSha256: "not-a-hash" })).status).toBe(400);
    f.env.APP_ENV = "production"; f.env.LINE_CHANNEL_ID = "123"; f.env.LINE_CHANNEL_SECRET = "test";
    f.env.LINE_CALLBACK_URL = "https://example.com/api/v1/auth/line/callback"; f.env.SESSION_SECRET = "test";
    expect((await f.call()).status).toBe(401);
    expect(create).not.toHaveBeenCalled();
    expect(f.queries.some(sql => sql === RECENT_UPLOAD_DUPLICATE_SQL)).toBe(false);
  });

  it("does not extend the window when completion is replayed", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const f = fixture();
    const ticket = await (await f.call()).json() as { videoId: string; providerVideoId: string };
    const complete = () => api.fetch(new Request(`https://example.com/api/v1/videos/${ticket.videoId}/complete`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ providerVideoId: ticket.providerVideoId }),
    }), f.env);
    expect((await complete()).status).toBe(200);
    const first = f.sqlite.prepare("SELECT uploaded_at FROM videos WHERE id=?").get(ticket.videoId)?.uploaded_at;
    vi.setSystemTime(new Date(now.getTime() + 3_600_000));
    expect((await complete()).status).toBe(200);
    expect(f.sqlite.prepare("SELECT uploaded_at FROM videos WHERE id=?").get(ticket.videoId)?.uploaded_at).toBe(first);
  });
});

describe("bounded whole-file SHA-256", () => {
  it("matches Node crypto across chunk boundaries, including changed bytes at the end", async () => {
    const bytes = new Uint8Array(256 * 1024 * 2 + 3);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 251;
    const expected = createHash("sha256").update(bytes).digest("hex");
    expect(await hashVideoBlob(new Blob([bytes]))).toBe(expected);
    bytes[bytes.length - 1] ^= 1;
    expect(await hashVideoBlob(new Blob([bytes]))).not.toBe(expected);
    expect(await hashVideoBlob(new Blob([]))).toBe(createHash("sha256").digest("hex"));
  });
});
