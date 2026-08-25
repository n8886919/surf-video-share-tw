import { describe, expect, it, vi } from "vitest";
import { attachConditionsBestEffort } from "../src/worker/enrichment";
import type { AppEnv } from "../src/worker/db";

describe("condition enrichment", () => {
  it("returns null instead of rejecting when no real provider is configured", async () => {
    const onError = vi.fn();
    const result = await attachConditionsBestEffort(
      { APP_ENV: "production", DB: {} as D1Database } as AppEnv,
      { latitude: 24.88, longitude: 121.85, validTime: "2026-08-25T01:00:00.000Z", videoId: "video_1" },
      onError,
    );
    expect(result).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
  });
});
