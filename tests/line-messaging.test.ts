import { afterEach, describe, expect, it, vi } from "vitest";
import { replyToLine } from "../src/worker/providers/line-messaging";

afterEach(() => vi.restoreAllMocks());

describe("LINE reply failure handling", () => {
  it("does not silently discard invalid message HTTP 400 errors or disclose provider details", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ message: "Invalid messages", details: [{ message: "private-recipient" }] }, { status: 400 }));
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(replyToLine("private-token", "private-reply-token", [])).rejects.toThrow("LINE_REPLY_UNAVAILABLE");
    expect(log).toHaveBeenCalledWith("LINE_REPLY_REJECTED", 400);
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  });

  it("acknowledges explicitly expired/consumed reply tokens without a push fallback", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ message: "Invalid reply token" }, { status: 400 }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(replyToLine("token", "reply-token", [])).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("https://api.line.me/v2/bot/message/reply");
  });

  it("retries unavailable provider responses even when their body is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("private gateway response", { status: 503 }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(replyToLine("token", "reply-token", [])).rejects.toThrow("LINE_REPLY_UNAVAILABLE");
  });
});
