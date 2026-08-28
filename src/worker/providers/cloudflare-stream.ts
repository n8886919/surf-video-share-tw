import type {
  DownloadTicket,
  PlaybackTicket,
  UploadTicket,
  VideoProvider,
  VideoStatus,
} from "./types";

interface StreamConfig {
  accountId: string;
  apiToken: string;
  publicSiteOrigin?: string;
}

interface StreamEnvelope<T> {
  success: boolean;
  errors?: Array<{ message?: string }>;
  result: T;
}

interface StreamVideoDetails {
  readyToStream?: boolean;
  duration?: number;
  status?: { state?: string; errorReasonText?: string };
  thumbnail?: string;
  preview?: string;
  playback?: { hls?: string; dash?: string };
  requireSignedURLs?: boolean;
}

interface StreamDownloadDetails {
  status?: "inprogress" | "ready" | "error";
  percentComplete?: number;
  url?: string;
}

interface StreamDownloads {
  default?: StreamDownloadDetails;
}

const THUMBNAIL_TOKEN_SECONDS = 5 * 60;
const PLAYBACK_TOKEN_SECONDS = 15 * 60;
const DOWNLOAD_TOKEN_SECONDS = 15 * 60;

export class CloudflareStreamVideoProvider implements VideoProvider {
  readonly provider = "cloudflare-stream" as const;

  constructor(private readonly config: StreamConfig) {}

  private publicSiteHost(): string {
    if (!this.config.publicSiteOrigin) throw new Error("PUBLIC_SITE_ORIGIN is required for Stream uploads");
    const origin = new URL(this.config.publicSiteOrigin);
    if (
      origin.protocol !== "https:"
      || origin.username
      || origin.password
      || origin.pathname !== "/"
      || origin.search
      || origin.hash
    ) {
      throw new Error("PUBLIC_SITE_ORIGIN must be an HTTPS origin without credentials, path, query, or fragment");
    }
    return origin.host;
  }

  private async getVideoDetails(providerVideoId: string): Promise<StreamVideoDetails> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/stream/${providerVideoId}`,
      { headers: { authorization: `Bearer ${this.config.apiToken}` } },
    );
    const payload = await response.json() as StreamEnvelope<StreamVideoDetails>;
    if (!response.ok || !payload.success) {
      throw new Error(payload.errors?.[0]?.message ?? "Cloudflare Stream 影片資料查詢失敗");
    }
    return payload.result;
  }

  private async createSignedToken(
    providerVideoId: string,
    expiresAtSeconds: number,
    downloadable = false,
  ): Promise<string> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/stream/${providerVideoId}/token`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          exp: expiresAtSeconds,
          ...(downloadable ? { downloadable: true } : {}),
        }),
      },
    );
    const payload = await response.json() as StreamEnvelope<{ token?: string }>;
    if (!response.ok || !payload.success || !payload.result.token) {
      throw new Error(payload.errors?.[0]?.message ?? "Cloudflare Stream signed token 建立失敗");
    }
    return payload.result.token;
  }

  private async getOrCreateDownload(providerVideoId: string): Promise<StreamDownloadDetails> {
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/stream/${providerVideoId}/downloads`;
    const headers = { authorization: `Bearer ${this.config.apiToken}` };
    const currentResponse = await fetch(endpoint, { headers });
    const currentPayload = await currentResponse.json().catch(() => null) as StreamEnvelope<StreamDownloads> | null;
    if (currentResponse.ok && currentPayload?.success && currentPayload.result.default) {
      return currentPayload.result.default;
    }
    if (currentResponse.ok && currentPayload && !currentPayload.success) {
      throw new Error(currentPayload.errors?.[0]?.message ?? "Cloudflare Stream download lookup failed");
    }
    if (!currentResponse.ok && currentResponse.status !== 404) {
      throw new Error(currentPayload?.errors?.[0]?.message ?? "Cloudflare Stream download lookup failed");
    }

    const createResponse = await fetch(endpoint, { method: "POST", headers });
    const createPayload = await createResponse.json() as StreamEnvelope<StreamDownloads>;
    if (!createResponse.ok || !createPayload.success || !createPayload.result.default) {
      throw new Error(createPayload.errors?.[0]?.message ?? "Cloudflare Stream download preparation failed");
    }
    return createPayload.result.default;
  }

  private streamDeliveryOrigin(details: StreamVideoDetails): URL {
    const assetUrl = details.preview
      ?? details.thumbnail
      ?? details.playback?.hls
      ?? details.playback?.dash;
    if (!assetUrl) throw new Error("Cloudflare Stream 尚未提供播放網址");
    const origin = new URL(assetUrl);
    if (origin.protocol !== "https:") throw new Error("Cloudflare Stream 回傳了不安全的播放網址");
    return origin;
  }

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
          requireSignedURLs: true,
          allowedOrigins: [this.publicSiteHost()],
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
    const details = await this.getVideoDetails(providerVideoId);
    if (!details.thumbnail) return null;
    const thumbnail = new URL(details.thumbnail);
    if (thumbnail.protocol !== "https:") throw new Error("Cloudflare Stream 回傳了不安全的縮圖網址");
    if (details.requireSignedURLs) {
      const expiresAtSeconds = Math.floor(Date.now() / 1000) + THUMBNAIL_TOKEN_SECONDS;
      const token = await this.createSignedToken(providerVideoId, expiresAtSeconds);
      thumbnail.pathname = `/${encodeURIComponent(token)}/thumbnails/thumbnail.jpg`;
    }
    thumbnail.searchParams.set("time", "1s");
    thumbnail.searchParams.set("height", "270");
    thumbnail.searchParams.set("fit", "crop");
    return thumbnail.toString();
  }

  async createPlayback(providerVideoId: string, now = new Date()): Promise<PlaybackTicket> {
    const details = await this.getVideoDetails(providerVideoId);
    if (!details.readyToStream) throw new Error("Cloudflare Stream 影片尚未可播放");
    if (!details.requireSignedURLs) {
      throw new Error("Cloudflare Stream 影片尚未啟用 signed URL 保護");
    }
    const expiresAtSeconds = Math.floor(now.getTime() / 1000) + PLAYBACK_TOKEN_SECONDS;
    const token = await this.createSignedToken(providerVideoId, expiresAtSeconds);
    const iframeUrl = this.streamDeliveryOrigin(details);
    iframeUrl.pathname = `/${encodeURIComponent(token)}/iframe`;
    iframeUrl.search = "";
    iframeUrl.hash = "";
    return {
      type: "iframe",
      iframeUrl: iframeUrl.toString(),
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    };
  }

  async prepareDownload(providerVideoId: string, now = new Date()): Promise<DownloadTicket> {
    const details = await this.getVideoDetails(providerVideoId);
    if (!details.readyToStream) throw new Error("Cloudflare Stream video is not ready for download");
    if (!details.requireSignedURLs) {
      throw new Error("Cloudflare Stream video does not require signed URLs");
    }

    const download = await this.getOrCreateDownload(providerVideoId);
    if (download.status === "error") throw new Error("Cloudflare Stream MP4 preparation failed");
    if (download.status === "inprogress") {
      const rawPercent = download.percentComplete;
      return {
        type: "download",
        state: "preparing",
        percentComplete: typeof rawPercent === "number" && Number.isFinite(rawPercent)
          ? Math.min(99, Math.max(0, Math.round(rawPercent)))
          : null,
        downloadUrl: null,
        expiresAt: null,
      };
    }
    if (download.status !== "ready" || !download.url) {
      throw new Error("Cloudflare Stream returned an unknown download state");
    }

    const deliveryOrigin = this.streamDeliveryOrigin(details);
    const downloadUrl = new URL(download.url);
    if (downloadUrl.protocol !== "https:" || downloadUrl.origin !== deliveryOrigin.origin) {
      throw new Error("Cloudflare Stream returned an unexpected download URL");
    }
    const expiresAtSeconds = Math.floor(now.getTime() / 1000) + DOWNLOAD_TOKEN_SECONDS;
    const token = await this.createSignedToken(providerVideoId, expiresAtSeconds, true);
    downloadUrl.pathname = `/${encodeURIComponent(token)}/downloads/default.mp4`;
    downloadUrl.search = "";
    downloadUrl.searchParams.set("filename", "surf-video.mp4");
    downloadUrl.hash = "";
    return {
      type: "download",
      state: "ready",
      percentComplete: 100,
      downloadUrl: downloadUrl.toString(),
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    };
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
