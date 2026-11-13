import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lineLoginFixture } from "./helpers/line-login-fixture";
import { lineWebhookApi, handleLineEvents } from "../src/worker/line-webhook";
import { lineWebhookSchema } from "../packages/api-contract/src/line-webhook";
import { processLineUpload, maintainLineDrafts } from "../src/worker/line-upload-job";
import type { LineDraftRow } from "../src/worker/line-drafts";

const subject = `U${"a".repeat(32)}`;
const bot = `U${"b".repeat(32)}`;
const now = new Date("2026-11-11T06:00:00.000Z");
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function setup() {
  const f = lineLoginFixture();
  f.sqlite.prepare(`INSERT OR IGNORE INTO spots (id,slug,name_en,name_zh,region,active,created_at,updated_at)
    VALUES ('test-spot','test-spot','Test','測試浪點','test',1,?,?)`).run(now.toISOString(), now.toISOString());
  const send = vi.fn().mockResolvedValue(undefined);
  const inbox: unknown[] = [];
  Object.assign(f.env, { LINE_UPLOAD_ENABLED: "true", LINE_UPLOAD_CHANNEL_SECRET: "fixture-secret",
    LINE_UPLOAD_CHANNEL_ACCESS_TOKEN: "fixture-access-token", LINE_UPLOAD_BOT_ID: bot,
    LINE_UPLOAD_QUEUE: { send }, UPLOAD_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    LINE_EVENT_QUEUE: { sendBatch: vi.fn(async (messages: { body: unknown }[]) => { inbox.push(...messages.map(m => m.body)); }) },
    VIDEO_PROVIDER: "cloudflare-stream", CLOUDFLARE_ACCOUNT_ID: "fixture-account", CLOUDFLARE_STREAM_API_TOKEN: "fixture-stream-token",
    PUBLIC_SITE_ORIGIN: "https://example.com" });
  const replies: Array<{ messages: unknown[] }> = [];
  let transfers = 0;
  let duration = 16;
  let breakTransfer = false;
  let duringTransfer: (() => void) | undefined;
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const path = String(url);
    if (path.endsWith("/message/reply")) { replies.push(JSON.parse(String(init?.body))); return Response.json({}); }
    if (path.includes("api-data.line.me")) return new Response(new Uint8Array([0, 0, 0, 8, 102, 116, 121, 112]), { headers: { "content-type": "video/mp4" } });
    if (path.endsWith("/direct_upload")) return Response.json({ success: true, result: { uid: `provider-${transfers + 1}`, uploadURL: "https://upload.videodelivery.net/fixture" } });
    if (path.includes("upload.videodelivery.net")) {
      transfers++;
      const payload = await new Response(init?.body).text();
      expect(payload).toContain('name="file"');
      duringTransfer?.();
      return new Response(null, { status: breakTransfer ? 503 : 200 });
    }
    if (init?.method === "DELETE") return new Response(null, { status: 200 });
    if (path.includes("api.cloudflare.com")) return Response.json({ success: true,
      result: { readyToStream: true, duration, status: { state: "ready" } } });
    throw new Error("Unexpected fixture endpoint");
  });
  async function webhook(event: Record<string, unknown>, actor = subject, signatureValid = true, drain = true) {
    const body = JSON.stringify({ destination: bot, events: [{ mode: "active", timestamp: now.getTime(), webhookEventId: crypto.randomUUID(),
      replyToken: "fixture-reply", source: { type: "user", userId: actor }, ...event }] });
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("fixture-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))));
    const response = await lineWebhookApi.request("https://example.com/webhook", { method: "POST", body,
      headers: { "x-line-signature": signatureValid ? signature : "invalid", "content-type": "application/json" } }, f.env);
    if (drain) for (const payload of inbox.splice(0)) await handleLineEvents(f.env, lineWebhookSchema.parse(payload));
    return response;
  }
  const videoEvent = { type: "message", message: { id: "12345", type: "video", duration: 16_000, contentProvider: { type: "line" } } };
  const row = () => f.sqlite.prepare("SELECT * FROM line_upload_drafts WHERE message_id='12345'").get() as unknown as LineDraftRow;
  async function action(action: string, extra: Record<string, string> = {}, actor = subject, revision = row().revision) {
    return webhook({ type: "postback", postback: {
      data: new URLSearchParams({ draft: row().id, revision: String(revision), action, ...extra }).toString(),
      params: { datetime: "2026-11-11T10:00" },
    } }, actor);
  }
  async function confirmed() {
    expect((await webhook(videoEvent)).status).toBe(200);
    await action("spot", { spot: "test-spot" });
    await action("time");
    await action("confirm");
    expect(row().status).toBe("confirmed");
    return row();
  }
  return { ...f, webhook, videoEvent, row, action, confirmed, send, replies, fetchMock,
    transfers: () => transfers, setDuration: (value: number) => { duration = value; },
    setBroken: (value: boolean) => { breakTransfer = value; }, onTransfer: (callback: () => void) => { duringTransfer = callback; } };
}

describe("durable LINE intake", () => {
  it("replies to rich-menu upload help without registering a user or creating a draft", async () => {
    const f = setup();
    await f.webhook({ type: "postback", postback: { data: "action=upload-help" } });
    expect(JSON.stringify(f.replies)).toContain("直接在聊天室傳送");
    expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM users").get()?.n).toBe(0);
    expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM line_upload_drafts").get()?.n).toBe(0);
    expect(f.send).not.toHaveBeenCalled();
    f.sqlite.close();
  });
  it("acknowledges durable enqueue without waiting on content, replies or database work", async () => {
    const f = setup();
    expect((await f.webhook(f.videoEvent, subject, true, false)).status).toBe(200);
    expect(f.fetchMock).not.toHaveBeenCalled();
    expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM users").get()?.n).toBe(0);
    expect(f.env.LINE_EVENT_QUEUE!.sendBatch).toHaveBeenCalledTimes(1);
    f.sqlite.close();
  });
  it("returns a retryable failure when durable enqueue fails, without provider side effects", async () => {
    const f = setup();
    vi.mocked(f.env.LINE_EVENT_QUEUE!.sendBatch).mockRejectedValueOnce(new Error("private provider error"));
    const response = await f.webhook(f.videoEvent);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private provider error");
    expect(f.fetchMock).not.toHaveBeenCalled();
    f.sqlite.close();
  });
  it("rejects unsigned payloads before identity, content retrieval or persistence", async () => {
    const f = setup();
    expect((await f.webhook(f.videoEvent, subject, false)).status).toBe(401);
    expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM users").get()?.n).toBe(0);
    expect(f.fetchMock).not.toHaveBeenCalled();
    f.sqlite.close();
  });
  it("deduplicates messages, preserves web identity and requires both fields before explicit confirmation", async () => {
    const f = setup();
    await f.webhook(f.videoEvent); await f.webhook(f.videoEvent);
    expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM line_upload_drafts").get()?.n).toBe(1);
    f.sqlite.exec("UPDATE users SET line_picture_url='https://example.com/avatar.png'");
    await f.action("confirm");
    expect(f.row().status).toBe("draft");
    expect(f.send).not.toHaveBeenCalled();
    expect(f.sqlite.prepare("SELECT line_picture_url FROM users").get()?.line_picture_url).toContain("avatar.png");
    expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM videos").get()?.n).toBe(0);
    f.sqlite.close();
  });
  it("rejects another owner's card and returns the current card for stale actions", async () => {
    const f = setup(); await f.webhook(f.videoEvent);
    await f.action("spot", { spot: "test-spot" }, `U${"c".repeat(32)}`);
    expect(f.row().spot_id).toBeNull();
    await f.action("spot", { spot: "test-spot" });
    await f.action("time", {}, subject, 0);
    expect(f.row().captured_at).toBeNull();
    expect(f.row().revision).toBe(1);
    f.sqlite.close();
  });
  it("atomically confirms once and converges duplicate queue deliveries on one public video", async () => {
    const f = setup(); const draft = await f.confirmed();
    await Promise.all([f.action("confirm", {}, subject, draft.revision - 1), f.action("confirm", {}, subject, draft.revision - 1)]);
    expect(f.row().revision).toBe(draft.revision);
    expect(await processLineUpload(f.env, draft.id)).toBe("done");
    expect(await processLineUpload(f.env, draft.id)).toBe("done");
    expect(f.transfers()).toBe(1);
    const video = f.sqlite.prepare("SELECT * FROM videos").get()!;
    expect(video.user_id).toBe(draft.user_id);
    expect(video.captured_at).toBe("2026-11-11T02:00:00.000Z");
    expect(video.status).toBe("ready"); expect(video.public_at).toBeTruthy();
    expect(f.row().upload_url).toBeNull();
    f.sqlite.close();
  });
  it("keeps interrupted transfers outside videos and safely retries using a new private asset", async () => {
    const f = setup(); const draft = await f.confirmed(); f.setBroken(true);
    expect(await processLineUpload(f.env, draft.id)).toBe("retry");
    expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM videos").get()?.n).toBe(0);
    f.setBroken(false);
    expect(await processLineUpload(f.env, draft.id)).toBe("done");
    expect(f.transfers()).toBe(2);
    expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM videos").get()?.n).toBe(1);
    expect(f.fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
    f.sqlite.close();
  });
  it("never publishes a provider-verified invalid duration", async () => {
    const f = setup(); const draft = await f.confirmed(); f.setDuration(61);
    expect(await processLineUpload(f.env, draft.id)).toBe("done");
    expect(f.row().transfer_status).toBe("failed");
    expect(f.sqlite.prepare("SELECT public_at FROM videos").get()?.public_at).toBeNull();
    f.sqlite.close();
  });
  it("honours unsend before original message delivery without downloading content", async () => {
    const f = setup();
    await f.webhook({ type: "unsend", unsend: { messageId: "12345" } });
    await f.webhook(f.videoEvent);
    expect(f.row().status).toBe("cancelled");
    expect(f.fetchMock.mock.calls.some(([url]) => String(url).includes("api-data.line.me"))).toBe(false);
    f.sqlite.close();
  });
  it("honours cancellation while bytes are transferring and never creates a public video", async () => {
    const f = setup(); const draft = await f.confirmed();
    f.onTransfer(() => f.sqlite.prepare("UPDATE line_upload_drafts SET status='cancelled' WHERE id=?").run(draft.id));
    expect(await processLineUpload(f.env, draft.id)).toBe("done");
    expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM videos").get()?.n).toBe(0);
    expect(f.row().provider_video_id).toBeNull();
    f.sqlite.close();
  });
  it("retracts published videos on unsend, while expired successful drafts leave videos intact", async () => {
    const f = setup(); const draft = await f.confirmed(); await processLineUpload(f.env, draft.id);
    await f.webhook({ type: "unsend", unsend: { messageId: "12345" } });
    expect(f.sqlite.prepare("SELECT public_at FROM videos").get()?.public_at).toBeNull();
    expect(await processLineUpload(f.env, draft.id)).toBe("done");
    f.sqlite.close();
  });
  it("removes expired successful draft credentials without deleting the published video", async () => {
    const f = setup(); const draft = await f.confirmed(); await processLineUpload(f.env, draft.id);
    await maintainLineDrafts(f.env, new Date(now.getTime() + 8 * 86_400_000));
    expect(f.row()).toBeUndefined();
    expect(f.sqlite.prepare("SELECT public_at FROM videos").get()?.public_at).toBeTruthy();
    f.sqlite.close();
  });
});
