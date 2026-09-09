import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveVideoStatus } from "../src/worker/video-status";
import { CloudflareStreamVideoProvider } from "../src/worker/providers/cloudflare-stream";

afterEach(() => vi.unstubAllGlobals());

describe("video status resolution", () => {
  it.each([
    ["pendingupload", false, -1, "awaiting_upload"],
    ["queued", false, 0, "pending"],
    ["inprogress", false, 0, "processing"],
    ["error", false, 0, "error"],
    ["ready", true, 20, "ready"],
  ] as const)("maps Stream %s without mistaking an empty upload for transcoding", async (state, readyToStream, duration, expected) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: true, result: { readyToStream, duration, status: { state } } })));
    const provider = new CloudflareStreamVideoProvider({ accountId: "test", apiToken: "fixture" });
    const status = await provider.getStatus("video");
    expect(status.state).toBe(expected);
    expect(resolveVideoStatus(provider.provider, status, 20).canPublish).toBe(expected === "ready");
  });
  it("treats a transient zero duration as unavailable while Stream is processing", () => {
    expect(resolveVideoStatus(
      "cloudflare-stream",
      { state: "processing", durationSeconds: 0 },
      20.1,
    )).toEqual({
      state: "processing",
      durationSeconds: 20.1,
      invalidDuration: false,
      canPublish: false,
    });
  });

  it("waits for a positive provider duration before publishing a ready Stream video", () => {
    expect(resolveVideoStatus(
      "cloudflare-stream",
      { state: "ready", durationSeconds: 0 },
      20.1,
    )).toEqual({
      state: "processing",
      durationSeconds: 20.1,
      invalidDuration: false,
      canPublish: false,
    });
  });

  it("publishes when Stream verifies an allowed duration", () => {
    expect(resolveVideoStatus(
      "cloudflare-stream",
      { state: "ready", durationSeconds: 20.1 },
      20.1,
    )).toEqual({
      state: "ready",
      durationSeconds: 20.1,
      invalidDuration: false,
      canPublish: true,
    });
  });

  it("fails closed when Stream verifies a video shorter than ten seconds", () => {
    expect(resolveVideoStatus(
      "cloudflare-stream",
      { state: "ready", durationSeconds: 9.9 },
      20.1,
    )).toEqual({
      state: "error",
      durationSeconds: 9.9,
      invalidDuration: true,
      canPublish: false,
    });
  });

  it("allows the development mock to use the validated request duration", () => {
    expect(resolveVideoStatus(
      "mock",
      { state: "ready", durationSeconds: null },
      20.1,
    )).toEqual({
      state: "ready",
      durationSeconds: 20.1,
      invalidDuration: false,
      canPublish: true,
    });
  });
});
