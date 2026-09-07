import { expect, test, type Page } from "@playwright/test";

const me = { id: "fixture-user", suggestedDisplayName: "Fixture", displayId: "測試浪人",
  showIdentityDefault: false, authMode: "line", isAdmin: false };

async function fixture(page: Page, options: {
  complete?: () => { status: string };
  authenticated?: () => boolean;
  videosFail?: boolean;
  completionFail?: boolean;
} = {}) {
  const calls = { completion: 0, me: 0, videos: 0 };
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let status = 200; let body: unknown;
    if (path === "/api/v1/spots") body = { spots: [] };
    else if (path === "/api/v1/auth/line/complete") {
      calls.completion++;
      expect(route.request().method()).toBe("POST");
      expect(route.request().postData()).toBe("{}");
      body = options.complete?.() ?? { status: "none" };
      if (options.completionFail) status = 503;
    } else if (path === "/api/v1/me") {
      calls.me++;
      if (options.authenticated?.()) body = me;
      else { status = 401; body = { error: "UNAUTHENTICATED", message: "尚未登入" }; }
    } else if (path === "/api/v1/videos") {
      calls.videos++; body = { observations: [] };
      if (options.videosFail) { status = 503; body = { error: "TEMPORARY", message: "Fixture outage" }; }
    } else { status = 404; body = { error: "NOT_FOUND" }; }
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  return calls;
}

test("a duplicate callback waits for the single result, confirms /me, and removes stale failure parameters", async ({ page }) => {
  let attempts = 0;
  const calls = await fixture(page, { complete: () => ({ status: ++attempts < 2 ? "pending" : "ready" }), authenticated: () => attempts >= 2 });
  await page.goto(`/?login=completing&auth_trace=${"a".repeat(32)}`);
  await expect(page.getByRole("heading", { name: "正在完成 LINE 登入" })).toBeVisible();
  await expect(page.getByText("公開名稱: 測試浪人", { exact: false })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect(calls).toEqual({ completion: 2, me: 1, videos: 1 });
  await page.screenshot({ path: "outputs/line-completion-success.png", fullPage: true });
});

test("a returned ready response is not presented as signed in when the session cookie is absent", async ({ page }) => {
  await fixture(page, { complete: () => ({ status: "ready" }) });
  await page.goto("/?login=completing");
  await expect(page.getByText(/LINE 驗證已完成，但這個入口沒有帶回登入 Cookie/)).toBeVisible();
  await expect(page.getByRole("link", { name: "使用 LINE 登入", exact: true })).toHaveAttribute("href", "/api/v1/auth/line");
  await expect(page.getByText("公開名稱: 測試浪人", { exact: false })).toHaveCount(0);
});

test("a different container is told to return to the original entry, with no automatic password fallback", async ({ page }) => {
  const calls = await fixture(page);
  await page.goto("/?login=completing");
  await expect(page.getByText(/請回到原本開始登入的 Chrome、Safari 或桌面捷徑/)).toBeVisible();
  await expect(page.getByRole("link", { name: /需帳號密碼/ })).toHaveCount(0);
  expect(calls.completion).toBe(1);
  await page.screenshot({ path: "outputs/line-completion-original-entry.png", fullPage: true });
});

test("the original home-screen entry checks again on foreground and coalesces duplicate pageshow events", async ({ page }) => {
  let ready = false;
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));
  const calls = await fixture(page, { complete: () => ({ status: ready ? "ready" : "none" }), authenticated: () => ready });
  await page.goto("/?login=completing");
  await expect(page.getByRole("button", { name: "再次確認登入" })).toBeVisible();
  ready = true;
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByText("公開名稱: 測試浪人", { exact: false })).toBeVisible();
  expect(calls.completion).toBe(2); expect(calls.me).toBe(2);
});

test("a failing owner video list does not hide a confirmed login", async ({ page }) => {
  await fixture(page, { authenticated: () => true, videosFail: true });
  await page.goto("/?login=expired");
  await expect(page.getByText(/已登入，但影片清單暫時無法載入/)).toBeVisible();
  await expect(page.getByText("公開名稱: 測試浪人", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "LINE 登入未完成" })).toHaveCount(0);
});

test("a completion outage does not block an existing authenticated session", async ({ page }) => {
  const calls = await fixture(page, { authenticated: () => true, completionFail: true });
  await page.goto("/?login=expired");
  await expect(page.getByText("公開名稱: 測試浪人", { exact: false })).toBeVisible();
  expect(calls.me).toBe(1);
});
