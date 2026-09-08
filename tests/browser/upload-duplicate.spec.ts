import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const bytes = Buffer.alloc(600_003, 7);
const sha256 = createHash("sha256").update(bytes).digest("hex");

async function fixture(page: Page) {
  // Media decoding is unrelated to this test; exercise the real built hash
  // worker with deterministic bytes, and simulate a valid 20-second selection.
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "duration", { configurable: true, get: () => 20 });
    const src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src")!;
    Object.defineProperty(HTMLMediaElement.prototype, "src", {
      configurable: true, get: src.get,
      set(value: string) {
        if (value.startsWith("blob:")) queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
        else src.set!.call(this, value);
      },
    });
  });
  const requests: Array<{ fileSha256?: string; duplicateAcknowledged?: boolean }> = [];
  const otherCalls: string[] = [];
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {}; let status = 200;
    if (path.endsWith("/auth/line/complete")) body = { status: "none" };
    else if (path.endsWith("/me")) body = { id: "uploader", displayId: "測試浪友", isAdmin: false, authMode: "line" };
    else if (path.endsWith("/spots")) body = { spots: [{ id: "spot_double-lions", slug: "double-lions", name: "雙獅", nameZh: "雙獅", nameEn: "", latitude: null, longitude: null }] };
    else if (path.endsWith("/videos")) body = { observations: [] };
    else if (path.endsWith("/public-videos/existing-public")) body = { observation: {
      id: "existing-public", capturedAt: "2026-09-08T00:00:00.000Z", uploaderDisplayId: null,
      spot: { name: "雙獅" }, video: { provider: "mock", thumbnailUrl: null },
    } };
    else if (path.endsWith("/videos/existing-public/playback")) body = { type: "mock", iframeUrl: null };
    else if (path.endsWith("/diagnostics")) { await route.fulfill({ status: 204 }); return; }
    else if (path.endsWith("/videos/upload-request")) {
      const payload = route.request().postDataJSON(); requests.push(payload);
      if (payload.fileSha256 && !payload.duplicateAcknowledged) {
        status = 409; body = { error: "RECENT_DUPLICATE_UPLOAD", message: "重複影片", duplicate: { videoId: "existing-public" } };
      } else body = { videoId: "new-video", providerVideoId: "mock-new", uploadMethod: "mock", uploadUrl: null };
    } else if (path.endsWith("/videos/new-video/complete")) {
      otherCalls.push(path);
      body = { observation: { id: "new-video", status: "ready", metadataStatus: "pending", publicAt: null,
        metadataExpiresAt: new Date(Date.now() + 86_400_000).toISOString(), capturedAt: null,
        createdAt: new Date().toISOString(), durationSeconds: 20, uploaderDisplayId: null, uploaderNote: null,
        funReaction: null, isFavorite: false, video: { provider: "mock", thumbnailUrl: null },
        spot: { id: "spot_double-lions", slug: "double-lions", name: "雙獅" }, conditions: {}, historicalForecasts: [],
      } };
    } else { status = 404; body = { error: "NOT_FOUND" }; }
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "上傳", exact: true }).click();
  await page.getByLabel("選擇影片", { exact: true }).setInputFiles({ name: "wave.mp4", mimeType: "video/mp4", buffer: bytes });
  await expect(page.getByText("wave.mp4", { exact: true })).toBeVisible();
  await page.getByLabel(/^拍攝時間/).fill("");
  return { requests, otherCalls };
}

test("built hash worker detects a cross-account duplicate before transfer, preserving the selection without an override", async ({ page }) => {
  const f = await fixture(page);
  const upload = page.getByRole("button", { name: "上傳影片", exact: true });
  await upload.click();
  const notice = page.getByRole("status", { name: "重複影片提醒" });
  await expect(notice).toBeVisible();
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0]).toMatchObject({ fileSha256: sha256 });
  expect(f.otherCalls).toEqual([]);
  await expect(upload).toHaveCount(0);
  await page.getByRole("button", { name: "查看已有影片" }).click();
  await expect(page.getByText("Mock 播放已啟動")).toBeVisible();
  await page.getByRole("button", { name: "關閉影片" }).click();
  await expect(page.getByText("wave.mp4", { exact: true })).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations).toEqual([]);
  await page.screenshot({ path: "outputs/upload-duplicate.png", fullPage: true });
  await expect(page.getByRole("button", { name: "仍要上傳" })).toHaveCount(0);
  expect(f.requests).toHaveLength(1);
});

test("a new file clears the old duplicate decision and computes a new whole-file hash", async ({ page }) => {
  const f = await fixture(page);
  const upload = page.getByRole("button", { name: "上傳影片", exact: true });
  await upload.click();
  await expect(page.getByRole("status", { name: "重複影片提醒" })).toBeVisible();
  const changed = Buffer.from(bytes); changed[changed.length - 1] = 8;
  await page.getByLabel("選擇影片", { exact: true }).setInputFiles({ name: "another.mp4", mimeType: "video/mp4", buffer: changed });
  await expect(page.getByText("another.mp4", { exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "重複影片提醒" })).toHaveCount(0);
  await page.getByLabel(/^拍攝時間/).fill("");
  await upload.click();
  await expect(page.getByRole("status", { name: "重複影片提醒" })).toBeVisible();
  expect(f.requests[1]).toMatchObject({ fileSha256: createHash("sha256").update(changed).digest("hex") });
});

test("a blocked hash worker does not block the core upload flow", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "Worker", { configurable: true, value: class { constructor() { throw new Error("Unavailable"); } } });
  });
  const f = await fixture(page);
  await page.getByRole("button", { name: "上傳影片", exact: true }).click();
  await expect.poll(() => f.otherCalls.length).toBe(1);
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0].fileSha256).toBeUndefined();
});
