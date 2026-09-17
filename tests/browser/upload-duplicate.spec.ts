import { createHash } from "node:crypto";
import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const bytes = Buffer.alloc(600_003, 7);
const sha256 = createHash("sha256").update(bytes).digest("hex");

// A minimal real MOV container timestamp, parsed by the application. Only media
// duration delivery is simulated; date extraction and the final request are real.
function datedVideo(iso: string) {
  const buffer = Buffer.alloc(36);
  buffer.writeUInt32BE(36, 0); buffer.write("moov", 4);
  buffer.writeUInt32BE(28, 8); buffer.write("mvhd", 12);
  buffer.writeUInt32BE(Math.floor(Date.parse(iso) / 1000) + 2_082_844_800, 20);
  return { name: `${iso.slice(0, 10)}.mov`, mimeType: "video/quicktime", buffer };
}

async function releaseMetadata(page: Page, index: number) {
  await page.evaluate(index => document.dispatchEvent(new CustomEvent("test:release-metadata", { detail: index })), index);
}

async function setCaptureTime(page: Page, value: string) {
  await page.getByRole("button", { name: "拍攝時間", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "拍攝時間", exact: true });
  await picker.getByLabel("拍攝日期", { exact: true }).selectOption(value.slice(0, 10));
  await picker.getByLabel("拍攝小時（24 小時制）", { exact: true }).selectOption(value.slice(11, 13));
  await picker.getByLabel("拍攝分鐘", { exact: true }).selectOption(value.slice(14, 16));
  await picker.getByRole("button", { name: "確認", exact: true }).click();
}

async function fixture(page: Page, { selectFile = true, holdMetadata = false } = {}) {
  await page.clock.setFixedTime(new Date("2026-09-09T04:00:00Z"));
  // Media decoding is unrelated to this test; exercise the real built hash
  // worker with deterministic bytes, and simulate a valid 20-second selection.
  await page.addInitScript(({ holdMetadata }) => {
    let metadataIndex = 0;
    Object.defineProperty(HTMLMediaElement.prototype, "duration", { configurable: true, get: () => 20 });
    const src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src")!;
    Object.defineProperty(HTMLMediaElement.prototype, "src", {
      configurable: true, get: src.get,
      set(value: string) {
        if (value.startsWith("blob:")) {
          if (!holdMetadata || this.isConnected) queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
          else {
            const index = ++metadataIndex;
            const release = (event: Event) => {
              if ((event as CustomEvent<number>).detail !== index) return;
              document.removeEventListener("test:release-metadata", release);
              this.dispatchEvent(new Event("loadedmetadata"));
            };
            document.addEventListener("test:release-metadata", release);
          }
        }
        else src.set!.call(this, value);
      },
    });
  }, { holdMetadata });
  const requests: Array<{ fileSha256?: string; duplicateAcknowledged?: boolean; capturedAt: string }> = [];
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
  if (!selectFile) return { requests, otherCalls };
  await page.getByLabel("選擇影片", { exact: true }).setInputFiles({ name: "wave.mp4", mimeType: "video/mp4", buffer: bytes });
  await expect(page.getByText("wave.mp4", { exact: true })).toBeVisible();
  await setCaptureTime(page, "2026-09-08T08:00");
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
  await setCaptureTime(page, "2026-09-08T08:00");
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

test("requires a spot and a valid 24-hour Taipei date/time before requesting an upload", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const f = await fixture(page, { selectFile: false });
  await page.getByLabel("選擇影片", { exact: true }).setInputFiles({ name: "wave.mp4", mimeType: "video/mp4", buffer: bytes });
  const upload = page.getByRole("button", { name: "確認上傳", exact: true });
  await expect(upload).toBeDisabled();
  await setCaptureTime(page, "2026-09-08T08:00");
  await expect(upload).toBeDisabled();
  await page.getByLabel("浪點", { exact: true }).selectOption("spot_double-lions");
  await page.getByRole("button", { name: "拍攝時間", exact: true }).click();
  await expect(page.getByLabel("拍攝小時（24 小時制）").locator('option[value="02"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(upload).toBeEnabled();
  await expect(page.getByRole("button", { name: "拍攝時間", exact: true })).toContainText("09/08 08:00");
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
  for (const name of ["查看人物入鏡與權利說明", "了解上傳影片如何成為浪況參考"]) {
    const trigger = page.getByRole("button", { name, exact: true });
    // Opening the time picker can leave the form scrolled down. Compare layout
    // only after scrolling to this help trigger, not across that normal scroll.
    await trigger.scrollIntoViewIfNeeded();
    const before = await page.locator(".upload-source-card").boundingBox();
    await trigger.click();
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
  await expect(page.getByRole("button", { name: "拍攝時間", exact: true })).toContainText("09/08 08:00");
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

test.describe("capture-time regression", () => {
  // English/US settings and a non-Taipei device time zone must not change HH:mm
  // labels or the UTC timestamp sent for a chosen Taipei capture time.
  test.use({ locale: "en-US", timezoneId: "America/Los_Angeles" });

  for (const sequence of ["before selection", "during inspection", "after inspection"] as const) {
    test(`retains a manual six-day-old capture time chosen ${sequence}`, async ({ page }) => {
      const f = await fixture(page, { selectFile: false, holdMetadata: true });
      const time = page.getByRole("button", { name: "拍攝時間", exact: true });
      if (sequence === "before selection") await setCaptureTime(page, "2026-09-03T12:00");
      const file = datedVideo("2026-09-09T03:15:00Z");
      await page.getByLabel("選擇影片", { exact: true }).setInputFiles(file);
      if (sequence === "during inspection") await setCaptureTime(page, "2026-09-03T12:00");
      await expect(page.getByRole("button", { name: "確認上傳", exact: true })).toBeDisabled();
      await releaseMetadata(page, 1);
      await expect(page.getByText(file.name, { exact: true })).toBeVisible();
      if (sequence === "after inspection") {
        await expect(time).toContainText("09/09 11:15");
        await setCaptureTime(page, "2026-09-03T12:00");
      }
      await expect(time).toContainText("09/03 12:00");
      await page.getByLabel("浪點", { exact: true }).selectOption("spot_double-lions");
      expect(f.requests).toEqual([]);
      await page.getByRole("button", { name: "確認上傳", exact: true }).click();
      await expect.poll(() => f.requests.length).toBe(1);
      expect(f.requests[0].capturedAt).toBe("2026-09-03T04:00:00.000Z");
    });
  }

  test("replaces automatic metadata, ignores an older file finishing late, and preserves manual time on another replacement", async ({ page }) => {
    await fixture(page, { selectFile: false, holdMetadata: true });
    const time = page.getByRole("button", { name: "拍攝時間", exact: true });
    const input = page.getByLabel("選擇影片", { exact: true });
    await input.setInputFiles(datedVideo("2026-09-09T03:15:00Z"));
    await input.setInputFiles(datedVideo("2026-09-08T00:30:00Z"));
    await releaseMetadata(page, 2);
    await expect(time).toContainText("09/08 08:30");
    await releaseMetadata(page, 1);
    await expect(page.getByText("2026-09-08.mov", { exact: true })).toBeVisible();
    await expect(time).toContainText("09/08 08:30");
    await setCaptureTime(page, "2026-09-03T12:00");
    await input.setInputFiles(datedVideo("2026-09-07T00:30:00Z"));
    await releaseMetadata(page, 3);
    await expect(page.getByText("2026-09-07.mov", { exact: true })).toBeVisible();
    await expect(time).toContainText("09/03 12:00");
    await expect(page.getByText("保留手選拍攝時間，請確認與這支影片相符")).toBeVisible();
  });

  test("resets manual time when discarding a draft and does not prefill from file lastModified", async ({ page }) => {
    await fixture(page, { selectFile: false, holdMetadata: true });
    await setCaptureTime(page, "2026-09-03T12:00");
    await page.getByLabel("選擇影片", { exact: true }).setInputFiles(datedVideo("2026-09-09T03:15:00Z"));
    await releaseMetadata(page, 1);
    await expect(page.getByText("2026-09-09.mov", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "拍攝時間", exact: true })).toContainText("09/03 12:00");
    await page.getByRole("button", { name: "找浪", exact: true }).click();
    await page.getByRole("button", { name: "放棄並離開", exact: true }).click();
    await page.getByRole("button", { name: "上傳", exact: true }).click();
    await page.getByLabel("選擇影片", { exact: true }).setInputFiles({ name: "stripped.mp4", mimeType: "video/mp4", buffer: bytes });
    await releaseMetadata(page, 2);
    await expect(page.getByText("stripped.mp4", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "拍攝時間", exact: true })).toHaveText("拍攝時間⌄");
    await expect(page.getByRole("button", { name: "確認上傳", exact: true })).toBeDisabled();
  });

  test("keeps an open picker draft through metadata completion and cancels later edits without changing the saved time", async ({ page }) => {
    await fixture(page, { selectFile: false, holdMetadata: true });
    await page.getByLabel("選擇影片", { exact: true }).setInputFiles(datedVideo("2026-09-09T03:15:00Z"));
    const time = page.getByRole("button", { name: "拍攝時間", exact: true });
    await time.click();
    await page.getByLabel("拍攝日期", { exact: true }).selectOption("2026-09-03");
    await releaseMetadata(page, 1);
    await expect(page.getByLabel("拍攝日期", { exact: true })).toHaveValue("2026-09-03");
    await expect(page.getByLabel("拍攝小時（24 小時制）")).toHaveValue("");
    await page.getByLabel("拍攝小時（24 小時制）").selectOption("12");
    await page.getByLabel("拍攝分鐘").selectOption("00");
    await page.getByRole("button", { name: "確認", exact: true }).click();
    await expect(time).toContainText("09/03 12:00");
    await time.click();
    await page.getByLabel("拍攝日期").selectOption("2026-09-08");
    await page.keyboard.press("Escape");
    await expect(time).toContainText("09/03 12:00");
    await expect(time).toBeFocused();
  });

  test("offers last Tuesday through Monday and only elapsed hours/minutes today", async ({ page }) => {
    const f = await fixture(page, { selectFile: false });
    await page.clock.setFixedTime(new Date("2026-09-14T06:15:00Z"));
    // Refresh the parent clock, just as reopening the upload page would.
    await page.getByRole("button", { name: "找浪", exact: true }).click();
    await page.getByRole("button", { name: "上傳", exact: true }).click();
    await page.getByRole("button", { name: "拍攝時間", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "拍攝時間", exact: true });
    const date = picker.getByLabel("拍攝日期"), hour = picker.getByLabel("拍攝小時（24 小時制）"), minute = picker.getByLabel("拍攝分鐘");
    const confirm = picker.getByRole("button", { name: "確認", exact: true });
    expect(await date.locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual([
      "", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14",
    ]);
    await expect(confirm).toBeDisabled();
    await date.selectOption("2026-09-08"); await hour.selectOption("05"); await minute.selectOption("00");
    await expect(confirm).toBeEnabled();
    await hour.selectOption("19"); await minute.selectOption("59");
    await expect(confirm).toBeEnabled();
    await date.selectOption("2026-09-14");
    await expect(hour).toHaveValue(""); await expect(minute).toHaveValue("");
    await expect(confirm).toBeDisabled();
    await expect(hour.locator('option[value="15"]')).toHaveCount(0);
    await hour.selectOption("14");
    await expect(minute.locator('option[value="16"]')).toHaveCount(0);
    await minute.selectOption("15");
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.getByRole("button", { name: "拍攝時間", exact: true })).toContainText("09/14 14:15");
    expect(f.requests).toEqual([]);
  });

  test("rechecks the Taipei calendar at confirmation and never substitutes an expired draft date", async ({ page }) => {
    await fixture(page, { selectFile: false });
    const time = page.getByRole("button", { name: "拍攝時間", exact: true });
    await time.click();
    const date = page.getByLabel("拍攝日期"), hour = page.getByLabel("拍攝小時（24 小時制）"), minute = page.getByLabel("拍攝分鐘");
    await date.selectOption("2026-09-03"); await hour.selectOption("05"); await minute.selectOption("00");
    // Cross midnight before the parent's next 30-second clock refresh.
    await page.clock.setFixedTime(new Date("2026-09-09T16:00:00Z"));
    await page.getByRole("button", { name: "確認", exact: true }).click();
    await expect(date).toHaveValue("");
    await expect(date.locator('option[value="2026-09-03"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "確認", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(time).toHaveText("拍攝時間⌄");
    await expect(time).toBeFocused();
  });

  test("shows numeric 24-hour options and remains accessible on a narrow phone in a US locale", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await fixture(page);
    await page.getByRole("button", { name: "拍攝時間", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "拍攝時間", exact: true });
    const hourLabels = await picker.getByLabel("拍攝小時（24 小時制）").locator("option").allTextContents();
    expect(hourLabels.slice(1)).toEqual(Array.from({ length: 15 }, (_, i) => String(i + 5).padStart(2, "0")));
    expect(await picker.getByLabel("拍攝分鐘").locator("option").allTextContents()).toEqual(["分", ...Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"))]);
    expect(await picker.getByLabel("拍攝日期").locator("option").count()).toBe(8);
    await expect(picker.getByRole("button")).toHaveCount(1);
    await expect(picker.getByRole("button", { name: "確認", exact: true })).toBeVisible();
    await expect(picker.getByRole("status")).toHaveCount(0);
    await expect(picker.locator("p")).toHaveCount(0);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
    expect(await picker.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: "outputs/upload-capture-time-24h.png", fullPage: true });
    // The close icon is absent; clicking the backdrop still cancels edits.
    await page.mouse.click(1, 1);
    await expect(page.getByRole("button", { name: "拍攝時間", exact: true })).toContainText("09/08 08:00");
    await expect(page.getByRole("button", { name: "拍攝時間", exact: true })).toHaveAccessibleDescription("09/08 08:00");
  });
});
