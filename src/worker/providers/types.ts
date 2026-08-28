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
  | { type: "iframe"; iframeUrl: string; expiresAt: string }
  | { type: "mock"; iframeUrl: null; expiresAt: null };

export interface VideoProvider {
  readonly provider: "mock" | "cloudflare-stream";
  createDirectUpload(input: {
    internalUserId: string;
    maxDurationSeconds: number;
  }): Promise<UploadTicket>;
  getStatus(providerVideoId: string): Promise<VideoStatus>;
  getThumbnailUrl(providerVideoId: string): Promise<string | null>;
  createPlayback(providerVideoId: string, now?: Date): Promise<PlaybackTicket>;
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
