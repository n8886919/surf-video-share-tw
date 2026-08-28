import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../src/worker/db";
import { CloudflareStreamVideoProvider } from "../src/worker/providers/cloudflare-stream";
import type { VideoProvider } from "../src/worker/providers/types";
import { cleanupExpiredPendingVideos } from "../src/worker/video-lifecycle";

interface TestVideo {
  id: string;
  video_provider: string;
  provider_video_id: string;
  metadata_status: "pending" | "deleting";
  updated_at: string;
}

function lifecycleDatabase(videos: TestVideo[], claimableIds = videos.map((video) => video.id)) {
  const claims: string[] = [];
  const deletions: string[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...values: unknown[]) => ({
        all: async () => ({ results: videos }),
        run: async () => {
          const videoId = String(values[1] ?? values[0]);
          if (sql.includes("UPDATE videos SET metadata_status = 'deleting'")) {
            if (!claimableIds.includes(videoId)) return { meta: { changes: 0 } };
            claims.push(videoId);
            return { meta: { changes: 1 } };
          }
          if (sql.includes("DELETE FROM videos")) {
            deletions.push(String(values[0]));
            return { meta: { changes: 1 } };
          }
          throw new Error(`Unexpected lifecycle SQL: ${sql}`);
        },
      }),
    }),
  } as unknown as D1Database;
  return { db, claims, deletions };
}

function video(id: string): TestVideo {
  return {
    id,
    video_provider: "cloudflare-stream",
    provider_video_id: `stream_${id}`,
    metadata_status: "pending",
    updated_at: "2026-08-20T00:00:00.000Z",
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("expired pending video cleanup", () => {
  it("claims and deletes expired videos across users", async () => {
    const fixture = lifecycleDatabase([video("video_1"), video("video_2")]);
    const provider = { deleteVideo: vi.fn().mockResolvedValue(undefined) } as unknown as VideoProvider;
    const env = { DB: fixture.db, VIDEO_PROVIDER: "cloudflare-stream" } as AppEnv;

    const summary = await cleanupExpiredPendingVideos(
      env,
      new Date("2026-08-28T00:00:00.000Z"),
      {},
      () => provider,
    );

    expect(provider.deleteVideo).toHaveBeenCalledTimes(2);
    expect(fixture.claims).toEqual(["video_1", "video_2"]);
    expect(fixture.deletions).toEqual(["video_1", "video_2"]);
    expect(summary).toMatchObject({ selected: 2, claimed: 2, deleted: 2, failed: 0, skipped: 0 });
  });

  it("keeps failed deletions leased for a later retry and continues the batch", async () => {
    const fixture = lifecycleDatabase([video("video_1"), video("video_2")]);
    const provider = {
      deleteVideo: vi.fn()
        .mockRejectedValueOnce(new Error("temporary Stream failure"))
        .mockResolvedValueOnce(undefined),
    } as unknown as VideoProvider;
    const env = { DB: fixture.db, VIDEO_PROVIDER: "cloudflare-stream" } as AppEnv;

    const summary = await cleanupExpiredPendingVideos(
      env,
      new Date("2026-08-28T00:00:00.000Z"),
      {},
      () => provider,
    );

    expect(fixture.deletions).toEqual(["video_2"]);
    expect(summary).toMatchObject({ claimed: 2, deleted: 1, failed: 1 });
    expect(summary.failures).toEqual([{ videoId: "video_1", message: "temporary Stream failure" }]);
  });

  it("skips a row when another request wins the cleanup claim", async () => {
    const fixture = lifecycleDatabase([video("video_1")], []);
    const provider = { deleteVideo: vi.fn() } as unknown as VideoProvider;
    const env = { DB: fixture.db, VIDEO_PROVIDER: "cloudflare-stream" } as AppEnv;

    const summary = await cleanupExpiredPendingVideos(
      env,
      new Date("2026-08-28T00:00:00.000Z"),
      {},
      () => provider,
    );

    expect(provider.deleteVideo).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ selected: 1, claimed: 0, deleted: 0, skipped: 1 });
  });

  it("does not require provider configuration when there is no expired work", async () => {
    const fixture = lifecycleDatabase([]);
    const providerFactory = vi.fn();

    const summary = await cleanupExpiredPendingVideos(
      { DB: fixture.db } as AppEnv,
      new Date("2026-08-28T00:00:00.000Z"),
      {},
      providerFactory,
    );

    expect(providerFactory).not.toHaveBeenCalled();
    expect(summary.selected).toBe(0);
  });
});

describe("Cloudflare Stream deletion", () => {
  it("treats an already absent video as deleted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    const provider = new CloudflareStreamVideoProvider({ accountId: "account", apiToken: "token" });

    await expect(provider.deleteVideo("missing-video")).resolves.toBeUndefined();
  });
});
