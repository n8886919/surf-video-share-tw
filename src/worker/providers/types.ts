import type { MarineConditions } from "../../../packages/domain/src";

export interface UploadTicket {
  provider: "mock" | "cloudflare-stream";
  providerVideoId: string;
  uploadUrl: string | null;
  uploadMethod: "POST" | "mock";
}

export interface VideoStatus {
  state: "pending" | "processing" | "ready" | "error";
  durationSeconds: number | null;
}

export type PlaybackTicket =
  | {
      type: "iframe";
      iframeUrl: string;
      expiresAt: string;
      width: number | null;
      height: number | null;
    }
  | { type: "mock"; iframeUrl: null; expiresAt: null; width: null; height: null };

export type DownloadTicket =
  | {
      type: "download";
      state: "preparing";
      percentComplete: number | null;
      downloadUrl: null;
      expiresAt: null;
    }
  | {
      type: "download";
      state: "ready";
      percentComplete: 100;
      downloadUrl: string;
      expiresAt: string;
    }
  | {
      type: "mock";
      state: "ready";
      percentComplete: 100;
      downloadUrl: null;
      expiresAt: null;
    };

export interface VideoProvider {
  readonly provider: "mock" | "cloudflare-stream";
  createDirectUpload(input: {
    internalUserId: string;
    maxDurationSeconds: number;
  }): Promise<UploadTicket>;
  getStatus(providerVideoId: string): Promise<VideoStatus>;
  getThumbnailUrl(providerVideoId: string): Promise<string | null>;
  createPlayback(providerVideoId: string, now?: Date): Promise<PlaybackTicket>;
  prepareDownload(providerVideoId: string, now?: Date): Promise<DownloadTicket>;
  deleteVideo(providerVideoId: string): Promise<void>;
}

export interface ConditionsQuery {
  latitude: number | null;
  longitude: number | null;
  validTime: string;
}

export interface MarineConditionsProvider {
  getConditions(input: ConditionsQuery): Promise<MarineConditions>;
  getForecast(input: ConditionsQuery): Promise<MarineConditions[]>;
}

export interface TideProvider {
  getTide(input: ConditionsQuery): Promise<Pick<MarineConditions, "tideHeight" | "tideState">>;
}
