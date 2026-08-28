import { describe, expect, it } from "vitest";
import { resolveVideoStatus } from "../src/worker/video-status";

describe("video status resolution", () => {
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

  it("fails closed when Stream verifies a video shorter than five seconds", () => {
    expect(resolveVideoStatus(
      "cloudflare-stream",
      { state: "ready", durationSeconds: 4.9 },
      20.1,
    )).toEqual({
      state: "error",
      durationSeconds: 4.9,
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
