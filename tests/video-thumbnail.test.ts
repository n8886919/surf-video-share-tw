import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/worker/api";
import type { AppEnv } from "../src/worker/db";
import { CloudflareStreamVideoProvider } from "../src/worker/providers/cloudflare-stream";

afterEach(() => {
  vi.unstubAllGlobals();
});

function streamDetails(thumbnail: string, requireSignedURLs = false): Response {
  return Response.json({
    success: true,
    errors: [],
    result: { thumbnail, requireSignedURLs },
  });
}

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

  it("does not return an unsigned thumbnail for signed-only videos", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamDetails(
      "https://customer-example.cloudflarestream.com/provider_video/thumbnails/thumbnail.jpg",
      true,
    )));
    const provider = new CloudflareStreamVideoProvider({ accountId: "account", apiToken: "token" });

    await expect(provider.getThumbnailUrl("provider_video")).resolves.toBeNull();
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
