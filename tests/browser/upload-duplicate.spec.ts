import { createHash } from "node:crypto";
import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const bytes = Buffer.alloc(600_003, 7);
const sha256 = createHash("sha256").update(bytes).digest("hex");

async function fixture(page: Page) {
  await page.clock.setFixedTime(new Date("2026-09-09T04:00:00Z"));
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
  await page.getByLabel("拍攝時間", { exact: true }).fill("2026-09-08T08:00");
  await page.getByLabel("浪點", { exact: true }).selectOption("spot_double-lions");
  return { requests, otherCalls };
}

test("built hash worker detects a cross-account duplicate before transfer, preserving the selection without an override", async ({ page }) => {
  const f = await fixture(page);
  const upload = page.getByRole("button", { name: "確認上傳", exact: true });
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
  const upload = page.getByRole("button", { name: "確認上傳", exact: true });
  await upload.click();
  await expect(page.getByRole("status", { name: "重複影片提醒" })).toBeVisible();
  const changed = Buffer.from(bytes); changed[changed.length - 1] = 8;
  await page.getByLabel("選擇影片", { exact: true }).setInputFiles({ name: "another.mp4", mimeType: "video/mp4", buffer: changed });
  await expect(page.getByText("another.mp4", { exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "重複影片提醒" })).toHaveCount(0);
  await page.getByLabel("拍攝時間", { exact: true }).fill("2026-09-08T08:00");
  await upload.click();
  await expect(page.getByRole("status", { name: "重複影片提醒" })).toBeVisible();
  expect(f.requests[1]).toMatchObject({ fileSha256: createHash("sha256").update(changed).digest("hex") });
});

test("a blocked hash worker does not block the core upload flow", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "Worker", { configurable: true, value: class { constructor() { throw new Error("Unavailable"); } } });
  });
  const f = await fixture(page);
  await page.getByRole("button", { name: "確認上傳", exact: true }).click();
  await expect.poll(() => f.otherCalls.length).toBe(1);
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0].fileSha256).toBeUndefined();
});

test("requires a spot and a valid native Taipei date/time before requesting an upload", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const f = await fixture(page);
  const upload = page.getByRole("button", { name: "確認上傳", exact: true });
  await page.getByLabel("拍攝時間", { exact: true }).fill("");
  await expect(upload).toBeDisabled();
  await page.getByLabel("拍攝時間", { exact: true }).fill("2026-09-08T08:00");
  await page.getByLabel("浪點", { exact: true }).selectOption("");
  await expect(upload).toBeDisabled();
  await page.getByLabel("浪點", { exact: true }).selectOption("spot_double-lions");
  await page.getByLabel("拍攝時間").fill("2026-09-08T02:00");
  await expect(upload).toBeDisabled();
  await page.getByLabel("拍攝時間").fill("2026-09-08T08:00");
  await expect(upload).toBeEnabled();
  await expect(page.getByLabel("拍攝時間")).toHaveAttribute("type", "datetime-local");
  expect(f.requests).toEqual([]);
  await expect(page.locator(".topbar").getByRole("button", { name: "問題回報", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "問題回報", exact: true })).toHaveCount(1);
  await page.screenshot({ path: "outputs/upload-form-native.png", fullPage: true });
});

test("local preview and optional dialogs preserve the draft; confirmed navigation discards it", async ({ page }) => {
  const f = await fixture(page);
  await expect(page.getByRole("heading", { name: "上傳浪影", exact: true })).toBeVisible();
  await expect(page.getByLabel("已選影片預覽")).toBeVisible();
  await expect(page.getByText("尚未上傳", { exact: true })).toBeVisible();
  await expect(page.locator(".local-video-preview video")).not.toHaveAttribute("autoplay");
  const before = await page.locator(".upload-source-card").boundingBox();
  for (const name of ["查看人物入鏡與權利說明", "了解上傳影片如何成為浪況參考"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.locator("dialog.upload-info-dialog")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "影片尚未上傳", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog.upload-info-dialog")).toHaveCount(0);
    expect((await page.locator(".upload-source-card").boundingBox())?.y).toBe(before?.y);
  }
  // Cancelling a new picker must retain the existing File and selected fields.
  await page.getByLabel("選擇影片", { exact: true }).setInputFiles([]);
  await expect(page.getByText("wave.mp4", { exact: true })).toBeVisible();
  await page.getByLabel("選擇影片", { exact: true }).setInputFiles({ name: "invalid.txt", mimeType: "text/plain", buffer: Buffer.from("invalid") });
  await expect(page.getByText("wave.mp4", { exact: true })).toBeVisible();
  const warned = await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });
  expect(warned).toBe(true);
  await page.getByRole("button", { name: "我的浪影", exact: true }).click();
  const warning = page.getByRole("dialog", { name: "影片尚未上傳", exact: true });
  await expect(warning).toBeVisible();
  await page.getByRole("button", { name: "繼續編輯", exact: true }).click();
  await expect(page.getByText("wave.mp4", { exact: true })).toBeVisible();
  await expect(page.getByLabel("浪點", { exact: true })).toHaveValue("spot_double-lions");
  await expect(page.getByLabel("拍攝時間", { exact: true })).toHaveValue("2026-09-08T08:00");
  await page.getByRole("button", { name: "找浪", exact: true }).click();
  await expect(warning).toBeVisible();
  await page.getByRole("button", { name: "放棄並離開", exact: true }).click();
  await expect(page.getByRole("button", { name: "找浪", exact: true })).toHaveAttribute("aria-current", "page");
  expect(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(false);
  await page.getByRole("button", { name: "上傳", exact: true }).click();
  await expect(page.getByLabel("已選影片預覽")).toHaveCount(0);
  await expect(page.getByLabel("浪點", { exact: true })).toHaveValue("");
  expect(f.requests).toEqual([]);
  expect(f.otherCalls).toEqual([]);
});

test("upload layout keeps two fields and full-width icon tabs on a narrow phone", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await fixture(page);
  await page.getByLabel("拍攝時間", { exact: true }).blur();
  const layout = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    const notice = rect(".public-notice"), name = rect(".upload-name"), card = rect(".upload-source-card");
    const spot = rect(".upload-fields select"), time = rect(".capture-time-field");
    const submit = rect(".upload-submit"), reminder = rect("#upload-final-reminder");
    const nav = rect(".bottom-nav"), tabs = Array.from(document.querySelectorAll(".bottom-nav button")).map(el=>el.getBoundingClientRect());
    return { ordered: notice.bottom <= name.top && name.bottom <= card.top, sameRow: Math.abs(spot.top-time.top)<1,
      reminderInside: reminder.top > submit.top && reminder.bottom < submit.bottom,
      navFilled: Math.abs(tabs[0].width+tabs[1].width-nav.width)<1,
      tabRadius: getComputedStyle(document.querySelector(".bottom-nav button")!).borderRadius,
      overflow: document.documentElement.scrollWidth > window.innerWidth };
  });
  expect(layout).toEqual({ordered:true,sameRow:true,reminderInside:true,navFilled:true,tabRadius:"0px",overflow:false});
  await expect(page.locator(".public-notice")).not.toContainText("公開提醒");
  await expect(page.locator(".upload-fields")).not.toContainText("台北時間");
  await expect(page.locator(".topbar .account-label")).toHaveText("我的浪影");
  await page.screenshot({ path: "outputs/release-033-upload.png", fullPage: true });
});

for (const outcome of ["success", "network-error"] as const) {
  test(`upload modal blocks navigation and Escape until ${outcome}, then releases the page`, async ({ page }) => {
    await fixture(page);
    let uploadRoute: Route | undefined;
    let completionRoute: Route | undefined;
    let submitted: Record<string, unknown> | undefined;
    await page.route("**/api/v1/videos/upload-request", async route => {
      submitted = route.request().postDataJSON();
      await route.fulfill({ json: { videoId: "new-video", providerVideoId: "stream-new", uploadMethod: "POST", uploadUrl: "http://127.0.0.1:4173/test-video-transfer" } });
    });
    await page.route("**/test-video-transfer", route => { uploadRoute = route; });
    await page.route("**/api/v1/videos/new-video/complete", route => { completionRoute = route; });
    await page.getByRole("button", { name: "確認上傳", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "影片上傳中", exact: true });
    await expect(dialog).toBeVisible();
    await expect.poll(() => Boolean(uploadRoute)).toBe(true);
    expect(submitted?.capturedAt).toBe("2026-09-08T00:00:00.000Z");
    await expect(dialog).toContainText("正在傳送影片");
    await expect(dialog).toContainText("請保持在此頁面");
    await page.keyboard.press("Escape");
    for (const name of ["我的浪影", "找浪"]) {
      const rect = await page.locator(`button[aria-label="${name}"]`).boundingBox();
      await page.mouse.click(rect!.x + rect!.width / 2, rect!.y + rect!.height / 2);
      await expect(dialog).toBeVisible();
    }
    for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("dialog")) || document.activeElement === document.body)).toBe(true);
    const preventsUnload = () => page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented;
    });
    expect(await preventsUnload()).toBe(true);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `outputs/upload-progress-${outcome}.png`, fullPage: true });
    if (outcome === "network-error") {
      await uploadRoute!.abort("failed");
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText(/影片傳送中斷/)).toBeVisible();
      await expect(page.getByLabel("選擇影片", { exact: true })).toBeEnabled();
      expect(completionRoute).toBeUndefined();
    } else {
      await uploadRoute!.fulfill({ status: 200, body: "" });
      await expect.poll(() => Boolean(completionRoute)).toBe(true);
      await expect(dialog.getByRole("progressbar")).toHaveAttribute("value", "100");
      await expect(dialog).toContainText("確認接收狀態");
      await completionRoute!.fulfill({ json: { observation: { id: "new-video", status: "processing", metadataStatus: "complete", publicAt: null, termsVersion: "cc0", capturedAt: "2026-09-08T00:00:00Z", video: { thumbnailUrl: null }, spot: { name: "雙獅" }, conditions: {} } } });
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText("影片轉檔中", { exact: true })).toBeVisible();
    }
    expect(await preventsUnload()).toBe(outcome === "network-error");
    await page.getByRole("button", { name: "找浪", exact: true }).click();
    if (outcome === "network-error") {
      await expect(page.getByRole("dialog", { name: "影片尚未上傳", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "放棄並離開", exact: true }).click();
      expect(await preventsUnload()).toBe(false);
    }
    await expect(page.getByRole("button", { name: "找影片", exact: true })).toBeVisible();
  });
}
