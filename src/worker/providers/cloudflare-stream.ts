import type { UploadTicket, VideoProvider, VideoStatus } from "./types";

interface StreamConfig {
  accountId: string;
  apiToken: string;
}

interface StreamEnvelope<T> {
  success: boolean;
  errors?: Array<{ message?: string }>;
  result: T;
}

export class CloudflareStreamVideoProvider implements VideoProvider {
  readonly provider = "cloudflare-stream" as const;

  constructor(private readonly config: StreamConfig) {}

  async createDirectUpload(input: {
    internalUserId: string;
    maxDurationSeconds: number;
  }): Promise<UploadTicket> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/stream/direct_upload`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          maxDurationSeconds: input.maxDurationSeconds,
          creator: input.internalUserId,
          expiry: new Date(Date.now() + 30 * 60_000).toISOString(),
        }),
      },
    );
    const payload = await response.json() as StreamEnvelope<{ uid: string; uploadURL: string }>;
    if (!response.ok || !payload.success) {
      throw new Error(payload.errors?.[0]?.message ?? "Cloudflare Stream upload URL 建立失敗");
    }
    return {
      provider: "cloudflare-stream",
      providerVideoId: payload.result.uid,
      uploadUrl: payload.result.uploadURL,
      uploadMethod: "POST",
    };
  }

  async getStatus(providerVideoId: string): Promise<VideoStatus> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/stream/${providerVideoId}`,
      { headers: { authorization: `Bearer ${this.config.apiToken}` } },
    );
    const payload = await response.json() as StreamEnvelope<{
      readyToStream: boolean;
      duration?: number;
      status?: { state?: string; errorReasonText?: string };
    }>;
    if (!response.ok || !payload.success) {
      throw new Error(payload.errors?.[0]?.message ?? "Cloudflare Stream 狀態查詢失敗");
    }
    const state = payload.result.status?.state;
    return {
      state: payload.result.readyToStream
        ? "ready"
        : state === "error"
          ? "error"
          : state === "queued" || state === "downloading"
            ? "pending"
            : "processing",
      durationSeconds: payload.result.duration ?? null,
    };
  }

  async getThumbnailUrl(providerVideoId: string): Promise<string | null> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/stream/${providerVideoId}`,
      { headers: { authorization: `Bearer ${this.config.apiToken}` } },
    );
    const payload = await response.json() as StreamEnvelope<{
      thumbnail?: string;
      requireSignedURLs?: boolean;
    }>;
    if (!response.ok || !payload.success) {
      throw new Error(payload.errors?.[0]?.message ?? "Cloudflare Stream 縮圖查詢失敗");
    }
    if (!payload.result.thumbnail || payload.result.requireSignedURLs) return null;
    const thumbnail = new URL(payload.result.thumbnail);
    if (thumbnail.protocol !== "https:") throw new Error("Cloudflare Stream 回傳了不安全的縮圖網址");
    thumbnail.searchParams.set("time", "1s");
    thumbnail.searchParams.set("height", "270");
    thumbnail.searchParams.set("fit", "crop");
    return thumbnail.toString();
  }

  async deleteVideo(providerVideoId: string): Promise<void> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/stream/${providerVideoId}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${this.config.apiToken}` },
      },
    );
    if (response.status === 404) return;
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as StreamEnvelope<unknown> | null;
      throw new Error(payload?.errors?.[0]?.message ?? "Cloudflare Stream 影片刪除失敗");
    }
  }
}
