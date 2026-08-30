import type { VideoProvider, VideoStatus } from "./providers/types";
import {
  MAX_VIDEO_DURATION_SECONDS,
  MIN_VIDEO_DURATION_SECONDS,
} from "../../packages/api-contract/src";

export interface ResolvedVideoStatus {
  state: VideoStatus["state"];
  durationSeconds: number | null;
  invalidDuration: boolean;
  canPublish: boolean;
}

function isPositiveFinite(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function isAllowedDuration(value: number | null): value is number {
  return isPositiveFinite(value)
    && value >= MIN_VIDEO_DURATION_SECONDS
    && value <= MAX_VIDEO_DURATION_SECONDS;
}

export function resolveVideoStatus(
  provider: VideoProvider["provider"],
  status: VideoStatus,
  fallbackDurationSeconds: number | null,
): ResolvedVideoStatus {
  const hasProviderDuration = isPositiveFinite(status.durationSeconds);
  const durationSeconds = hasProviderDuration
    ? status.durationSeconds
    : fallbackDurationSeconds;
  const invalidDuration = hasProviderDuration && !isAllowedDuration(status.durationSeconds);
  const waitingForVerifiedDuration = provider !== "mock"
    && status.state === "ready"
    && !hasProviderDuration;
  const state = invalidDuration
    ? "error"
    : waitingForVerifiedDuration
      ? "processing"
      : status.state;

  return {
    state,
    durationSeconds,
    invalidDuration,
    canPublish: state === "ready"
      && isAllowedDuration(durationSeconds)
      && (provider === "mock" || hasProviderDuration),
  };
}
