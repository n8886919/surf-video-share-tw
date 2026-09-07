import { afterEach, describe, expect, it, vi } from "vitest";
import { recoverLineLogin } from "../app/line-login";

describe("bounded browser login recovery", () => {
  afterEach(() => { vi.useRealTimers(); });
  it("validates the completion response and sends no token or trace as a credential", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ status: "ready", traceId: "a".repeat(32) }));
    const onProgress = vi.fn();
    expect(await recoverLineLogin({ fetchImpl, signal: new AbortController().signal, onProgress })).toBe("ready");
    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/auth/line/complete", expect.objectContaining({
      method: "POST", credentials: "same-origin", cache: "no-store", body: "{}",
    }));
    expect(onProgress).toHaveBeenCalledWith("ready", "a".repeat(32));
  });
  it("stops after ten pending requests instead of polling forever", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockImplementation(async () => Response.json({ status: "pending" }));
    const result = recoverLineLogin({ fetchImpl, signal: new AbortController().signal, onProgress: vi.fn() });
    await vi.runAllTimersAsync();
    expect(await result).toBe("waiting"); expect(fetchImpl).toHaveBeenCalledTimes(10);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels a hidden/unmounted page's timer and cannot send a late completion", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ status: "pending" }));
    const result = recoverLineLogin({ fetchImpl, signal: controller.signal, onProgress: vi.fn() });
    const rejected = expect(result).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(50); controller.abort(); await rejected;
    await vi.runAllTimersAsync(); expect(fetchImpl).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("aborts a hung completion request after eight seconds", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const result = recoverLineLogin({ fetchImpl, signal: new AbortController().signal, onProgress: vi.fn() });
    const rejected = expect(result).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(8_000); await rejected;
    expect(fetchImpl).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it.each([{ status: "unknown" }, { status: "ready", traceId: "not-a-trace" }])("rejects malformed server status %j", async body => {
    const onProgress = vi.fn();
    await expect(recoverLineLogin({ fetchImpl: vi.fn().mockResolvedValue(Response.json(body)),
      signal: new AbortController().signal, onProgress })).rejects.toThrow();
    expect(onProgress).not.toHaveBeenCalled();
  });
});
