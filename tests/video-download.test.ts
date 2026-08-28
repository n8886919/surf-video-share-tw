import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/worker/api";
import type { AppEnv } from "../src/worker/db";
import { CloudflareStreamVideoProvider } from "../src/worker/providers/cloudflare-stream";

afterEach(() => {
  vi.unstubAllGlobals();
});

function streamDetails(): Response {
  return Response.json({
    success: true,
    errors: [],
    result: {
      readyToStream: true,
      requireSignedURLs: true,
      preview: "https://customer-example.cloudflarestream.com/provider_video/watch",
    },
  });
}

function streamDownloads(result: Record<string, unknown>, status = 200): Response {
  return Response.json({ success: status < 400, errors: [], result }, { status });
}

describe("Cloudflare Stream MP4 downloads", () => {
  it("starts MP4 preparation when Stream has no generated download yet", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(streamDetails())
      .mockResolvedValueOnce(streamDownloads({}, 404))
      .mockResolvedValueOnce(streamDownloads({
        default: { status: "inprogress", percentComplete: 18.4 },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CloudflareStreamVideoProvider({ accountId: "account", apiToken: "token" });

    await expect(provider.prepareDownload("provider_video")).resolves.toEqual({
      type: "download",
      state: "preparing",
      percentComplete: 18,
      downloadUrl: null,
      expiresAt: null,
    });
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "POST" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns a 15-minute download-only token without exposing the Stream UID", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(streamDetails())
      .mockResolvedValueOnce(streamDownloads({
        default: {
          status: "ready",
          percentComplete: 100,
          url: "https://customer-example.cloudflarestream.com/provider_video/downloads/default.mp4",
        },
      }))
      .mockResolvedValueOnce(Response.json({
        success: true,
        errors: [],
        result: { token: "signed-download-token" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CloudflareStreamVideoProvider({ accountId: "account", apiToken: "secret-token" });

    const result = await provider.prepareDownload(
      "provider_video",
      new Date("2026-08-29T10:00:00.000Z"),
    );
    expect(result).toEqual({
      type: "download",
      state: "ready",
      percentComplete: 100,
      downloadUrl: "https://customer-example.cloudflarestream.com/signed-download-token/downloads/default.mp4?filename=surf-video.mp4",
      expiresAt: "2026-08-29T10:15:00.000Z",
    });
    expect(JSON.parse((fetchMock.mock.calls[2]?.[1] as RequestInit).body as string)).toEqual({
      exp: 1787998500,
      downloadable: true,
    });
    expect(result.downloadUrl).not.toContain("provider_video");
    expect(result.downloadUrl).not.toContain("secret-token");
  });

  it("refuses unsigned legacy videos before enabling an MP4 download", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      success: true,
      errors: [],
      result: {
        readyToStream: true,
        requireSignedURLs: false,
        preview: "https://customer-example.cloudflarestream.com/provider_video/watch",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CloudflareStreamVideoProvider({ accountId: "account", apiToken: "token" });

    await expect(provider.prepareDownload("provider_video")).rejects.toThrow("signed URLs");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a ready download URL from an unexpected delivery origin", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(streamDetails())
      .mockResolvedValueOnce(streamDownloads({
        default: {
          status: "ready",
          percentComplete: 100,
          url: "https://downloads.example.net/provider_video/downloads/default.mp4",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CloudflareStreamVideoProvider({ accountId: "account", apiToken: "token" });

    await expect(provider.prepareDownload("provider_video")).rejects.toThrow("unexpected download URL");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function developmentDb(eligible: boolean, statements: string[]): D1Database {
  const user = {
    id: "user_dev_local",
    line_display_name: "Wave Friend",
    display_id: "wave-friend",
    show_identity_default: 1,
  };
  return {
    prepare: (sql: string) => {
      statements.push(sql);
      const statement = {
        bind: () => statement,
        run: async () => ({ meta: { changes: 1 } }),
        first: async () => sql.includes("FROM videos")
          ? eligible
            ? {
                id: "video_public",
                provider_video_id: "mock_video",
                video_provider: "mock",
              }
            : null
          : user,
      };
      return statement;
    },
    batch: async () => [],
  } as unknown as D1Database;
}

describe("owner download API boundary", () => {
  it("returns no-store data only after the owner-public lifecycle check", async () => {
    const statements: string[] = [];
    const limit = vi.fn().mockResolvedValue({ success: true });
    const response = await api.fetch(
      new Request("https://example.com/api/v1/videos/video_public/download", { method: "POST" }),
      {
        APP_ENV: "development",
        ENABLE_DEV_AUTH: "true",
        DB: developmentDb(true, statements),
        VIDEO_PROVIDER: "mock",
        DOWNLOAD_RATE_LIMITER: { limit } as unknown as RateLimit,
      } as AppEnv,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(limit).toHaveBeenCalledWith({ key: "user_dev_local" });
    await expect(response.json()).resolves.toMatchObject({ type: "mock", state: "ready" });
    const lifecycleSql = statements.find((sql) => sql.includes("FROM videos"));
    expect(lifecycleSql).toContain("user_id = ?");
    expect(lifecycleSql).toContain("metadata_status = 'complete'");
    expect(lifecycleSql).toContain("status = 'ready'");
    expect(lifecycleSql).toContain("public_at IS NOT NULL");
    expect(lifecycleSql).toContain("terms_version IS NOT NULL");
    expect(lifecycleSql).toContain("moderation_status = 'visible'");
  });

  it("does not consume a download limit for an ineligible or non-owned video", async () => {
    const statements: string[] = [];
    const limit = vi.fn();
    const response = await api.fetch(
      new Request("https://example.com/api/v1/videos/video_private/download", { method: "POST" }),
      {
        APP_ENV: "development",
        ENABLE_DEV_AUTH: "true",
        DB: developmentDb(false, statements),
        VIDEO_PROVIDER: "mock",
        DOWNLOAD_RATE_LIMITER: { limit } as unknown as RateLimit,
      } as AppEnv,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "VIDEO_NOT_DOWNLOADABLE" });
    expect(limit).not.toHaveBeenCalled();
  });

  it("rejects a download burst before any Stream request", async () => {
    const statements: string[] = [];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await api.fetch(
      new Request("https://example.com/api/v1/videos/video_public/download", { method: "POST" }),
      {
        APP_ENV: "development",
        ENABLE_DEV_AUTH: "true",
        DB: developmentDb(true, statements),
        VIDEO_PROVIDER: "cloudflare-stream",
        CLOUDFLARE_ACCOUNT_ID: "account",
        CLOUDFLARE_STREAM_API_TOKEN: "token",
        DOWNLOAD_RATE_LIMITER: {
          limit: vi.fn().mockResolvedValue({ success: false }),
        } as unknown as RateLimit,
      } as AppEnv,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
