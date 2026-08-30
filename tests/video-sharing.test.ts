import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/worker/api";
import type { AppEnv } from "../src/worker/db";

interface ShareDbState {
  used: number;
  budgetExists: boolean;
  videoProvider: "mock" | "cloudflare-stream";
}

function shareDb(state: ShareDbState): D1Database {
  const user = {
    id: "user_dev_local",
    line_display_name: "Wave Friend",
    display_id: "wave-friend",
    show_identity_default: 1,
  };
  return {
    prepare: (sql: string) => {
      let values: unknown[] = [];
      const statement = {
        bind: (...bound: unknown[]) => {
          values = bound;
          return statement;
        },
        first: async () => {
          if (sql.includes("SELECT id, line_display_name")) return user;
          if (sql.includes("SELECT id, user_id, provider_video_id")) {
            return {
              id: "video_public",
              user_id: "uploader_internal",
              provider_video_id: "provider_video",
              video_provider: state.videoProvider,
            };
          }
          if (sql.includes("SELECT used FROM share_playback_budgets")) {
            return state.budgetExists ? { used: state.used } : null;
          }
          return null;
        },
        run: async () => {
          if (sql.includes("INSERT OR IGNORE INTO share_playback_budgets")) {
            state.budgetExists = true;
          }
          if (sql.includes("UPDATE share_playback_budgets")) {
            const limit = values[2] as number;
            if (state.used >= limit) return { meta: { changes: 0 } };
            state.used += 1;
          }
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
    batch: async () => [],
  } as unknown as D1Database;
}

function developmentEnv(state: ShareDbState): AppEnv {
  return {
    APP_ENV: "development",
    ENABLE_DEV_AUTH: "true",
    DB: shareDb(state),
    VIDEO_PROVIDER: state.videoProvider,
    SESSION_SECRET: "share-link-test-secret",
  } as AppEnv;
}

async function createSharePath(env: AppEnv): Promise<string> {
  const response = await api.fetch(
    new Request("https://example.com/api/v1/videos/video_public/share-link", { method: "POST" }),
    env,
  );
  expect(response.status).toBe(201);
  const payload = await response.json() as { path: string };
  return payload.path;
}

function tokenFromPath(path: string): string {
  const token = new URL(path, "https://example.com").searchParams.get("share");
  if (!token) throw new Error("Share token missing from path");
  return token;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("responsibility-based video sharing", () => {
  it("creates distinct opaque links that expire in 24 hours and share one monthly budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T04:00:00.000Z"));
    const state: ShareDbState = { used: 7, budgetExists: true, videoProvider: "mock" };
    const env = developmentEnv(state);

    const first = await api.fetch(
      new Request("https://example.com/api/v1/videos/video_public/share-link", { method: "POST" }),
      env,
    );
    const second = await api.fetch(
      new Request("https://example.com/api/v1/videos/video_public/share-link", { method: "POST" }),
      env,
    );
    const firstPayload = await first.json() as {
      path: string;
      expiresAt: string;
      anonymousPlayLimit: number;
      remainingAnonymousPlays: number;
    };
    const secondPayload = await second.json() as typeof firstPayload;

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(firstPayload.expiresAt).toBe("2026-08-31T04:00:00.000Z");
    expect(firstPayload.anonymousPlayLimit).toBe(100);
    expect(firstPayload.remainingAnonymousPlays).toBe(93);
    expect(secondPayload.remainingAnonymousPlays).toBe(93);
    expect(firstPayload.path).not.toBe(secondPayload.path);
    expect(firstPayload.path).not.toContain("user_dev_local");
    expect(firstPayload.path).not.toContain("uploader_internal");
  });

  it("charges anonymous playback once while a logged-in playback uses no share budget", async () => {
    const state: ShareDbState = { used: 0, budgetExists: false, videoProvider: "mock" };
    const signedInEnv = developmentEnv(state);
    const shareToken = tokenFromPath(await createSharePath(signedInEnv));
    const body = JSON.stringify({ shareToken });

    const anonymousResponse = await api.fetch(
      new Request("https://example.com/api/v1/shared-videos/video_public/playback", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.10" },
        body,
      }),
      {
        APP_ENV: "development",
        DB: shareDb(state),
        VIDEO_PROVIDER: "mock",
        SESSION_SECRET: "share-link-test-secret",
      } as AppEnv,
    );
    expect(anonymousResponse.status).toBe(200);
    expect(state.used).toBe(1);
    await expect(anonymousResponse.json()).resolves.toMatchObject({
      type: "mock",
      width: null,
      height: null,
    });

    const signedInResponse = await api.fetch(
      new Request("https://example.com/api/v1/shared-videos/video_public/playback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
      signedInEnv,
    );
    expect(signedInResponse.status).toBe(200);
    expect(state.used).toBe(1);
  });

  it("stops an exhausted anonymous share before contacting the video provider", async () => {
    const state: ShareDbState = { used: 100, budgetExists: true, videoProvider: "cloudflare-stream" };
    const shareToken = tokenFromPath(await createSharePath(developmentEnv(state)));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await api.fetch(
      new Request("https://example.com/api/v1/shared-videos/video_public/playback", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.10" },
        body: JSON.stringify({ shareToken }),
      }),
      {
        APP_ENV: "production",
        DB: shareDb(state),
        VIDEO_PROVIDER: "cloudflare-stream",
        CLOUDFLARE_ACCOUNT_ID: "account",
        CLOUDFLARE_STREAM_API_TOKEN: "token",
        SESSION_SECRET: "share-link-test-secret",
        PLAYBACK_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) } as RateLimit,
      } as AppEnv,
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ error: "SHARE_PLAYBACK_BUDGET_EXHAUSTED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an expired share token without consuming budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T04:00:00.000Z"));
    const state: ShareDbState = { used: 0, budgetExists: false, videoProvider: "mock" };
    const shareToken = tokenFromPath(await createSharePath(developmentEnv(state)));
    vi.setSystemTime(new Date("2026-08-31T04:00:01.000Z"));

    const response = await api.fetch(
      new Request("https://example.com/api/v1/shared-videos/video_public/playback", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.10" },
        body: JSON.stringify({ shareToken }),
      }),
      {
        APP_ENV: "production",
        DB: shareDb(state),
        VIDEO_PROVIDER: "mock",
        SESSION_SECRET: "share-link-test-secret",
        PLAYBACK_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) } as RateLimit,
      } as AppEnv,
    );

    expect(response.status).toBe(410);
    expect(state.used).toBe(0);
  });
});
