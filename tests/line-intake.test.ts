import { afterEach, describe, expect, it, vi } from "vitest";
import { applyLineDraftAction, type LineUploadDraft } from "../packages/domain/src/line-upload-draft";
import { PUBLIC_MEDIA_TERMS_VERSION } from "../packages/domain/src/public-terms";
import { getLineVideoContent, limitVideoBytes, verifyLineSignature } from "../src/worker/providers/line-content";
import { lineUploadCard, lineSpotCard } from "../src/worker/line-upload-card";
import { lineVideoHints } from "../packages/domain/src/line-video-hints";

afterEach(() => vi.unstubAllGlobals());
const now = new Date("2026-11-11T04:00:00Z");
function draft(): LineUploadDraft {
  return { id: "89ea0acd-3daf-471a-86d4-ae60b580bcea", userId: "owner", revision: 2, status: "draft",
    spotId: "wushi", capturedAt: "2026-11-11T00:32:00.000Z", expiresAt: "2026-11-18T04:00:00.000Z",
    termsVersion: PUBLIC_MEDIA_TERMS_VERSION };
}
function apply(value = draft(), action: Parameters<typeof applyLineDraftAction>[0]["action"] = { action: "confirm" }, actorId = "owner", revision = 2) {
  return applyLineDraftAction({ draft: value, actorId, expectedRevision: revision, action, activeSpotIds: ["wushi", "double-lions"], now });
}

describe("LINE explicit confirmation", () => {
  it("does not prefill capture time from a transcoded container timestamp", () => {
    const metadata = { recordedAt: null, containerCreatedAt: new Date("2026-11-11T00:32:00Z"), location: null, bytesRead: 100 };
    expect(lineVideoHints(metadata, [], now)).toEqual({ capturedAt: null, spotId: null });
    expect(lineVideoHints({ ...metadata, recordedAt: new Date("2026-11-11T00:32:00Z") }, [], now).capturedAt)
      .toBe("2026-11-11T00:32:00.000Z");
  });
  it("confirms a complete draft without altering the input; rejects a second confirmation", () => {
    const original = draft();
    const result = apply(original);
    expect(original.status).toBe("draft");
    expect(result).toMatchObject({ status: "confirmed", revision: 3 });
    expect(() => apply(result, { action: "confirm" }, "owner", 3)).toThrow("DRAFT_CLOSED");
  });
  it("isolates ownership and stale cards", () => {
    expect(() => apply(draft(), { action: "confirm" }, "other")).toThrow("DRAFT_NOT_FOUND");
    expect(() => apply(draft(), { action: "confirm" }, "owner", 1)).toThrow("DRAFT_STALE");
  });
  it.each(["spotId", "capturedAt"] as const)("requires missing %s to be supplied", key => {
    expect(() => apply({ ...draft(), [key]: null })).toThrow("DRAFT_INCOMPLETE");
  });
  it("rechecks expiry, terms and active spots at confirmation", () => {
    expect(() => apply({ ...draft(), expiresAt: now.toISOString() })).toThrow("DRAFT_EXPIRED");
    expect(() => apply({ ...draft(), termsVersion: "old" })).toThrow("TERMS_CHANGED");
    expect(() => apply({ ...draft(), spotId: "inactive" })).toThrow("SPOT_NOT_FOUND");
  });
  it("interprets datetime picker values in Taipei and rejects normalized invalid dates", () => {
    expect(apply(draft(), { action: "time", datetime: "2026-11-11T09:10" }).capturedAt).toBe("2026-11-11T01:10:00.000Z");
    expect(() => apply(draft(), { action: "time", datetime: "2026-02-30T09:10" })).toThrow("CAPTURE_TIME_INVALID");
  });
  it.each(["2026-11-11T13:00", "2026-11-01T09:00", "2026-11-11T02:00"])("rejects disallowed capture %s", datetime => {
    expect(() => apply(draft(), { action: "time", datetime })).toThrow();
  });
  it("includes three persistent actions and public contribution disclosure, never private identity", () => {
    const card = lineUploadCard(draft(), "烏石港");
    const serialized = JSON.stringify(card);
    for (const label of ["確認上傳", "更改浪點", "更改時間"]) expect(serialized).toContain(`"label":"${label}"`);
    expect(serialized).toContain("CC0");
    expect(serialized).not.toContain("不用回覆");
    expect(serialized).not.toContain('"owner"');
    expect(lineUploadCard({ ...draft(), capturedAt: null }, null).altText).toContain("請選擇");
  });
  it.each([[null, null], ["wushi", null], [null, "2026-11-11T00:32:00.000Z"]])("omits confirmation until both capture fields exist", (spotId, capturedAt) => {
    const serialized = JSON.stringify(lineUploadCard({ ...draft(), spotId, capturedAt }, spotId ? "烏石港" : null));
    expect(serialized).not.toContain("確認上傳");
    expect(serialized).not.toContain("action=confirm");
    expect(serialized).toContain("action=spots");
    expect(serialized).toContain("datetimepicker");
  });
  it("keeps every spot selectable across compact two-column pages with revision-bound actions", () => {
    const spots = Array.from({ length: 20 }, (_, i) => ({ id: `spot-${i}`, name_zh: `浪點${i}`, name_en: `Spot ${i}` }));
    for (const page of [0, 1]) {
      const card = lineSpotCard(draft(), spots, page);
      const serialized = JSON.stringify(card);
      expect(serialized.match(/"layout":"horizontal"/g)).toHaveLength(5);
      for (const spot of spots.slice(page * 10, page * 10 + 10)) {
        expect(serialized).toContain(`spot=${spot.id}\"`);
        expect(serialized).toContain(`"label":"${spot.name_zh}"`);
      }
      expect(serialized).toContain(`revision=${draft().revision}`);
      expect(serialized).toContain(page ? "上一頁" : "下一頁");
    }
  });
});

describe("LINE authenticated content boundary", () => {
  it("verifies the exact raw body, not reserialized JSON", async () => {
    const body = new TextEncoder().encode('{ "events": [] }');
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("fixture"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, body))));
    expect(await verifyLineSignature(body, signature, "fixture")).toBe(true);
    expect(await verifyLineSignature(new TextEncoder().encode('{"events":[]}'), signature, "fixture")).toBe(false);
    expect(await verifyLineSignature(body, "malformed", "fixture")).toBe(false);
    expect(await verifyLineSignature(body, signature, "")).toBe(false);
  });
  it.each([[202, "processing"], [404, "expired"], [410, "expired"]])("handles provider status %s", async (status, state) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: Number(status) })));
    expect(await getLineVideoContent("123", "fixture")).toEqual({ state });
  });
  it("uses the fixed data host, authorization header and refuses redirects", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2]), { headers: { "content-type": "video/mp4" } }));
    vi.stubGlobal("fetch", fetcher);
    const result = await getLineVideoContent("123", "fixture");
    expect(fetcher).toHaveBeenCalledWith("https://api-data.line.me/v2/bot/message/123/content", expect.objectContaining({ redirect: "manual", headers: { authorization: "Bearer fixture" } }));
    expect(result.state).toBe("ready");
    if (result.state === "ready") expect(new Uint8Array(await new Response(result.body).arrayBuffer())).toEqual(new Uint8Array([1, 2]));
    await expect(getLineVideoContent("https://attacker.example", "fixture")).rejects.toThrow("LINE_MESSAGE_ID_INVALID");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each<Record<string, string>>([{ "content-type": "text/html" }, { "content-type": "video/mp4", "content-length": "999999999" }])("rejects unsuitable content", async headers => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad", { headers })));
    await expect(getLineVideoContent("123", "fixture")).rejects.toThrow("LINE_VIDEO_CONTENT_INVALID");
  });
  it("counts streamed bytes even without a length header", async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(3)); controller.enqueue(new Uint8Array(3)); controller.close(); } });
    await expect(new Response(limitVideoBytes(body, 5)).arrayBuffer()).rejects.toThrow("LINE_VIDEO_TOO_LARGE");
  });
  it("does not expose provider error bodies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private provider detail", { status: 500 })));
    await expect(getLineVideoContent("123", "fixture")).rejects.toThrow(/^LINE_CONTENT_UNAVAILABLE$/);
  });
});
