import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/worker/api";
import type { AppEnv } from "../src/worker/db";
import { CloudflareStreamVideoProvider } from "../src/worker/providers/cloudflare-stream";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function streamDetails(
  thumbnail: string,
  requireSignedURLs = false,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json({
    success: true,
    errors: [],
    result: { thumbnail, requireSignedURLs, ...extra },
  });
}

function streamToken(token: string): Response {
  return Response.json({ success: true, errors: [], result: { token } });
}

describe("Cloudflare Stream protected uploads", () => {
  it("requires signed URLs and limits new uploads to the deployed site origin", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T10:00:00.000Z"));
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      success: true,
      result: { uid: "provider_video", uploadURL: "https://upload.example.com" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CloudflareStreamVideoProvider({
      accountId: "account",
      apiToken: "token",
      publicSiteOrigin: "https://surf.example.com",
    });

    await provider.createDirectUpload({ internalUserId: "user_internal", maxDurationSeconds: 60 });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toMatchObject({
      creator: "user_internal",
      maxDurationSeconds: 60,
      requireSignedURLs: true,
      allowedOrigins: ["surf.example.com"],
    });
  });

  it("fails before contacting Stream when the public origin is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CloudflareStreamVideoProvider({ accountId: "account", apiToken: "token" });

    await expect(provider.createDirectUpload({ internalUserId: "user", maxDurationSeconds: 60 }))
      .rejects.toThrow("PUBLIC_SITE_ORIGIN");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Cloudflare Stream thumbnails", () => {
  it("uses the official still-image parameters without exposing the API token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamDetails(
      "https://customer-example.cloudflarestream.com/provider_video/thumbnails/thumbnail.jpg",
    ));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CloudflareStreamVideoProvider({ accountId: "account", apiToken: "secret-token" });

    const thumbnailUrl = await provider.getThumbnailUrl("provider_video");

    expect(thumbnailUrl).toBe(
      "https://customer-example.cloudflarestream.com/provider_video/thumbnails/thumbnail.jpg?time=1s&height=270&fit=crop",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/account/stream/provider_video",
      { headers: { authorization: "Bearer secret-token" } },
    );
    expect(thumbnailUrl).not.toContain("secret-token");
  });

  it("uses a five-minute token instead of an unsigned ID for protected thumbnails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T10:00:00.000Z"));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(streamDetails(
        "https://customer-example.cloudflarestream.com/provider_video/thumbnails/thumbnail.jpg",
        true,
      ))
      .mockResolvedValueOnce(streamToken("signed-thumbnail-token"));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CloudflareStreamVideoProvider({ accountId: "account", apiToken: "token" });

    await expect(provider.getThumbnailUrl("provider_video")).resolves.toBe(
      "https://customer-example.cloudflarestream.com/signed-thumbnail-token/thumbnails/thumbnail.jpg?time=1s&height=270&fit=crop",
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account/stream/provider_video/token",
    );
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({
      exp: 1787911500,
    });
  });
});

describe("Cloudflare Stream playback", () => {
  it("creates a 15-minute iframe token only for ready signed videos", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(streamDetails(
        "https://customer-example.cloudflarestream.com/provider_video/thumbnails/thumbnail.jpg",
        true,
        {
          readyToStream: true,
          preview: "https://customer-example.cloudflarestream.com/provider_video/watch",
          input: { width: 1080, height: 1920 },
        },
      ))
      .mockResolvedValueOnce(streamToken("signed-playback-token"));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CloudflareStreamVideoProvider({ accountId: "account", apiToken: "token" });

    await expect(provider.createPlayback(
      "provider_video",
      new Date("2026-08-28T10:00:00.000Z"),
    )).resolves.toEqual({
      type: "iframe",
      iframeUrl: "https://customer-example.cloudflarestream.com/signed-playback-token/iframe",
      expiresAt: "2026-08-28T10:15:00.000Z",
      width: 1080,
      height: 1920,
    });
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({
      exp: 1787912100,
    });
  });

  it("does not fall back to a public UID for an unsigned legacy video", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamDetails(
      "https://customer-example.cloudflarestream.com/provider_video/thumbnails/thumbnail.jpg",
      false,
      { readyToStream: true },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CloudflareStreamVideoProvider({ accountId: "account", apiToken: "token" });

    await expect(provider.createPlayback("provider_video")).rejects.toThrow("signed URL");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("public thumbnail API boundary", () => {
  it("redirects only after a public-ready D1 row is found", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamDetails(
      "https://customer-example.cloudflarestream.com/provider_video/thumbnails/thumbnail.jpg",
    ));
    vi.stubGlobal("fetch", fetchMock);
    const db = {
      prepare: () => ({
        bind: () => ({
          first: async () => ({
            id: "video_public",
            provider_video_id: "provider_video",
            video_provider: "cloudflare-stream",
          }),
        }),
      }),
    } as unknown as D1Database;

    const response = await api.fetch(
      new Request("https://example.com/api/v1/videos/video_public/thumbnail"),
      {
        APP_ENV: "production",
        DB: db,
        VIDEO_PROVIDER: "cloudflare-stream",
        CLOUDFLARE_ACCOUNT_ID: "account",
        CLOUDFLARE_STREAM_API_TOKEN: "token",
      } as AppEnv,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/provider_video/thumbnails/thumbnail.jpg?time=1s");
    expect(response.headers.get("cache-control")).toBe("private, max-age=300");
  });

  it("does not contact Stream when the video is not public", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const db = {
      prepare: () => ({ bind: () => ({ first: async () => null }) }),
    } as unknown as D1Database;

    const response = await api.fetch(
      new Request("https://example.com/api/v1/videos/video_private/thumbnail"),
      { APP_ENV: "production", DB: db } as AppEnv,
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("public playback API boundary", () => {
  it("returns no-store playback data for a public-ready video", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(streamDetails(
        "https://customer-example.cloudflarestream.com/provider_video/thumbnails/thumbnail.jpg",
        true,
        {
          readyToStream: true,
          preview: "https://customer-example.cloudflarestream.com/provider_video/watch",
        },
      ))
      .mockResolvedValueOnce(streamToken("signed-playback-token"));
    vi.stubGlobal("fetch", fetchMock);
    const limit = vi.fn().mockResolvedValue({ success: true });
    const db = {
      prepare: () => ({
        bind: () => ({
          first: async () => ({
            id: "video_public",
            provider_video_id: "provider_video",
            video_provider: "cloudflare-stream",
          }),
        }),
      }),
    } as unknown as D1Database;

    const response = await api.fetch(
      new Request("https://example.com/api/v1/videos/video_public/playback", {
        method: "POST",
        headers: { "cf-connecting-ip": "203.0.113.10" },
      }),
      {
        APP_ENV: "production",
        DB: db,
        SESSION_SECRET: "playback-rate-limit-test-secret",
        PLAYBACK_RATE_LIMITER: { limit } as RateLimit,
        VIDEO_PROVIDER: "cloudflare-stream",
        CLOUDFLARE_ACCOUNT_ID: "account",
        CLOUDFLARE_STREAM_API_TOKEN: "token",
      } as AppEnv,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(limit).toHaveBeenCalledOnce();
    expect(limit.mock.calls[0]?.[0].key).toMatch(/^[a-f0-9]{64}$/);
    expect(limit.mock.calls[0]?.[0].key).not.toContain("203.0.113.10");
    await expect(response.json()).resolves.toMatchObject({
      type: "iframe",
      iframeUrl: "https://customer-example.cloudflarestream.com/signed-playback-token/iframe",
    });
  });

  it("rejects a playback burst before contacting Stream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const db = {
      prepare: () => ({
        bind: () => ({
          first: async () => ({
            id: "video_public",
            provider_video_id: "provider_video",
            video_provider: "cloudflare-stream",
          }),
        }),
      }),
    } as unknown as D1Database;

    const response = await api.fetch(
      new Request("https://example.com/api/v1/videos/video_public/playback", {
        method: "POST",
        headers: { "cf-connecting-ip": "203.0.113.10" },
      }),
      {
        APP_ENV: "production",
        DB: db,
        SESSION_SECRET: "playback-rate-limit-test-secret",
        PLAYBACK_RATE_LIMITER: {
          limit: vi.fn().mockResolvedValue({ success: false }),
        } as unknown as RateLimit,
      } as AppEnv,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    await expect(response.json()).resolves.toMatchObject({ error: "RATE_LIMITED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never generates a token for a non-public row", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const preparedSql: string[] = [];
    const db = {
      prepare: (sql: string) => {
        preparedSql.push(sql);
        return { bind: () => ({ first: async () => null }) };
      },
    } as unknown as D1Database;

    const response = await api.fetch(
      new Request("https://example.com/api/v1/videos/video_private/playback", { method: "POST" }),
      { APP_ENV: "production", DB: db } as AppEnv,
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(preparedSql).toHaveLength(1);
    expect(preparedSql[0]).toContain("metadata_status = 'complete'");
    expect(preparedSql[0]).toContain("status = 'ready'");
    expect(preparedSql[0]).toContain("public_at IS NOT NULL");
    expect(preparedSql[0]).toContain("terms_version IS NOT NULL");
    expect(preparedSql[0]).toContain("moderation_status = 'visible'");
  });
});
