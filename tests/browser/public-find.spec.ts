import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const spots = [
  ["spot_wushi-harbor-north", "wushi-harbor-north", "烏石港"],
  ["spot_double-lions", "double-lions", "雙獅"],
  ["spot_suao-wuwei-harbor", "suao-wuwei-harbor", "無尾"],
  ["spot_daxi", "daxi", "蜜月灣"],
  ["spot_jinzun", "jinzun", "金樽"],
  ["spot_donghe", "donghe", "北東河"],
  ["spot_yuguangdao", "yuguangdao", "漁光島"],
  ["spot_nanwan", "nanwan", "南灣"],
].map(([id, slug, name]) => ({
  id,
  slug,
  name,
  nameEn: "",
  nameZh: name,
  region: "Taiwan",
  latitude: null,
  longitude: null,
}));

const emptyConditions = {
  waveHeight: null,
  waveDirection: null,
  wavePeriod: null,
  swellHeight: null,
  swellDirection: null,
  swellPeriod: null,
  secondarySwellHeight: null,
  secondarySwellDirection: null,
  secondarySwellPeriod: null,
  windWaveHeight: null,
  windWaveDirection: null,
  windWavePeriod: null,
  windSpeed: null,
  windDirection: null,
  windGust: null,
  tideHeight: null,
  tideSlope: null,
  tideState: null,
};

function observation(id: string, spotId: string, spotName: string) {
  return {
    id,
    status: "ready",
    metadataStatus: "complete",
    metadataExpiresAt: null,
    publicAt: "2026-08-30T02:00:00.000Z",
    capturedAt: "2026-08-30T01:00:00.000Z",
    createdAt: "2026-08-30T02:00:00.000Z",
    durationSeconds: 20,
    uploaderDisplayId: null,
    uploaderNote: null,
    funReaction: null,
    license: "CC0-1.0",
    termsVersion: "2026-08-01",
    delistedAt: null,
    isFavorite: false,
    video: { provider: "cloudflare-stream", thumbnailUrl: null },
    spot: { id: spotId, slug: spotId.replace(/^spot_/, ""), name: spotName, nameEn: "" },
    conditions: emptyConditions,
  };
}

function forecast(
  id: string,
  primary: { height: number; direction: number; period: number },
  secondary: { height: number; direction: number; period: number },
) {
  return {
    id,
    provider: "open-meteo",
    model: "meteofrance_wave",
    sourceDisplayName: "Météo-France MFWAM",
    matchingRole: "active",
    swellSemantics: "partitioned",
    snapshotKind: "forecast",
    issuedAt: "2026-08-30T00:00:00.000Z",
    modelRunAt: null,
    validAt: "2026-08-30T01:00:00.000Z",
    leadHours: 1,
    totalWave: { height: 1.5, direction: 80, period: 10, peakPeriod: null },
    totalSwell: { height: null, direction: null, period: null, peakPeriod: null },
    primarySwell: { ...primary, peakPeriod: null },
    secondarySwell: { ...secondary, peakPeriod: null },
    tertiarySwell: { height: null, direction: null, period: null, peakPeriod: null },
    windWave: { height: 0.3, direction: 20, period: 4, peakPeriod: null },
    tide: { height: 0.5, slope: 0.1, state: "rising", sourceLocationId: null },
    wind: { speed: 4, direction: 10, gust: 6 },
  };
}

function ownerForecast(
  id: string,
  provider: string,
  model: string,
  sourceDisplayName: string,
  matchingRole: "active" | "collect-only",
) {
  return {
    ...forecast(
      id,
      { height: 1.2, direction: 40, period: 11 },
      { height: 0.8, direction: 120, period: 8 },
    ),
    provider,
    model,
    sourceDisplayName,
    matchingRole,
    snapshotKind: "historical_forecast",
    tide: {
      height: 0.5,
      slope: 0.1,
      state: "rising",
      sourceLocationId: provider === "cwa" ? "O00400" : null,
    },
  };
}

function matchesResponse(requestUrl: string, spotId: string, spotName: string) {
  const url = new URL(requestUrl);
  const item = observation(`video_${spotId}`, spotId, spotName);
  const recentItem = {
    ...observation(`video_recent_${spotId}`, spotId, spotName),
    capturedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
  };
  const recentOnlyItem = {
    ...observation(`video_recent_only_${spotId}`, spotId, spotName),
    capturedAt: new Date(Date.now() - 90 * 60_000).toISOString(),
  };
  const primary = { height: 1.2, direction: 40, period: 11 };
  const secondary = { height: 0.8, direction: 120, period: 8 };
  return {
    spot: { id: spotId, slug: spotId.replace(/^spot_/, ""), name: spotName },
    targetTime: url.searchParams.get("targetTime"),
    forecasts: [],
    observations: [item],
    timeWindowObservations: [recentItem, recentOnlyItem],
    matches: [{
      score: 0.91,
      availableWeight: 1,
      matchedWeight: 0.91,
      coverage: 1,
      observation: item,
      sources: [{
        provider: "open-meteo",
        model: "meteofrance_wave",
        score: 1,
        availableWeight: 3.45,
        matchedWeight: 3.45,
        coverage: 1,
        swellPairing: [
          { target: "primary", candidate: "secondary" },
          { target: "secondary", candidate: "primary" },
        ],
        targetForecast: forecast("target", primary, secondary),
        candidateForecast: forecast("candidate", secondary, primary),
      }],
    }],
    ranking: "equal-cwa-mfwam-composite-historical-forecast",
  };
}

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(body),
  });
}

async function mockPublicApi(page: Page, delayedSpotId?: string) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/spots") {
      await fulfillJson(route, 200, { spots });
      return;
    }
    if (url.pathname === "/api/v1/me") {
      await fulfillJson(route, 401, { error: "UNAUTHENTICATED", message: "尚未登入" });
      return;
    }
    if (url.pathname === "/api/v1/matches") {
      const spotId = url.searchParams.get("spotId") ?? spots[0].id;
      if (spotId === delayedSpotId) await new Promise((resolve) => setTimeout(resolve, 900));
      const spotName = spots.find((spot) => spot.id === spotId)?.name ?? "浪點";
      await fulfillJson(route, 200, matchesResponse(route.request().url(), spotId, spotName));
      return;
    }
    await fulfillJson(route, 404, { error: "NOT_FOUND", message: "找不到資源" });
  });
}

test("switching spots hides the previous result until the new query resolves", async ({ page }) => {
  await mockPublicApi(page, "spot_double-lions");
  await page.goto("/");

  await expect(page.getByRole("button", { name: /播放 烏石港.*相似度/ })).toBeVisible();
  await page.getByRole("button", { name: "雙獅", exact: true }).click();

  await expect(page.getByRole("button", { name: /播放 烏石港.*相似度/ })).toHaveCount(0);
  await expect(page.getByText("比對中", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /播放 雙獅.*相似度/ })).toBeVisible();
});

test("shows every same-spot public video captured in the last two hours without requiring a match", async ({ page }) => {
  await mockPublicApi(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "即時影片（近 2 小時）" })).toBeVisible();
  const timeWindowRail = page.getByRole("region", { name: "近兩小時的即時影片" });
  await expect(timeWindowRail.getByRole("button")).toHaveCount(2);
  await expect(page.locator(".candidate-play-button")).toHaveCount(1);
});

test("shows the exact swapped swell assignment used by matching", async ({ page }) => {
  await mockPublicApi(page);
  await page.goto("/");

  await expect(page.getByText("目標預報", { exact: true })).toHaveCount(1);
  await expect(page.locator(".target-forecast-card")).toContainText("1.2m · 40° · 11.0s");
  await expect(page.locator(".candidate-forecast-card .combined-metric-header")).not.toContainText("目標");
  const primaryRow = page.locator('[data-swell-pairing="primary:secondary"]');
  const secondaryRow = page.locator('[data-swell-pairing="secondary:primary"]');
  await expect(primaryRow).toContainText("主湧浪");
  await expect(primaryRow).toContainText("次湧浪 · 1.2m · 40° · 11.0s");
  await expect(secondaryRow).toContainText("次湧浪");
  await expect(secondaryRow).toContainText("主湧浪 · 0.8m · 120° · 8.0s");
});

test("owner video shows active sources first and every collect-only model", async ({ page }) => {
  const ownerItem = {
    ...observation("video_owner_models", spots[0].id, spots[0].name),
    showUploader: false,
    playbackCount90d: 0,
    historicalForecasts: [
      ownerForecast("cwa", "cwa", "cwa-wave-f-a0020-001", "CWA", "active"),
      ownerForecast("mfwam", "open-meteo", "meteofrance_wave", "Météo-France MFWAM", "active"),
      ownerForecast("ecmwf", "open-meteo", "ecmwf_wam", "ECMWF WAM 9 km", "collect-only"),
      ownerForecast("gfs", "open-meteo", "ncep_gfswave016", "NOAA GFS Wave 0.16°", "collect-only"),
      ownerForecast("gwam", "open-meteo", "dwd_gwam", "DWD GWAM", "collect-only"),
    ],
  };
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/spots") return fulfillJson(route, 200, { spots });
    if (url.pathname === "/api/v1/me") {
      return fulfillJson(route, 200, {
        id: "user_owner",
        suggestedDisplayName: null,
        displayId: "浪人",
        showIdentityDefault: false,
        authMode: "line",
        isAdmin: false,
      });
    }
    if (url.pathname === "/api/v1/videos") {
      return fulfillJson(route, 200, { observations: [ownerItem] });
    }
    if (url.pathname === "/api/v1/matches") {
      return fulfillJson(route, 200, matchesResponse(route.request().url(), spots[0].id, spots[0].name));
    }
    return fulfillJson(route, 404, { error: "NOT_FOUND", message: "找不到資源" });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "上傳", exact: true }).click();
  await expect(page.getByText("7天內,10-60秒的浪況或衝浪影片", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "顯示公開名稱" })).toBeChecked();
  await expect(page.getByText("上傳你也希望在找浪時看到的影片", { exact: true })).toHaveCount(0);
  await expect(page.getByText("可從相簿選擇，或使用裝置相機錄影", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "我的", exact: true }).click();
  await page.getByRole("button", { name: "更多資訊", exact: true }).click();

  await expect(page.getByRole("heading", { name: "影片時間的模型資料" })).toBeVisible();
  const headers = page.locator(".owner-forecast-header span");
  await expect(headers.filter({ hasText: "總湧浪" })).toBeVisible();
  await expect(headers.filter({ hasText: "第三浪" })).toBeVisible();
  const rows = page.locator(".owner-forecast-row");
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toContainText("CWA");
  await expect(rows.nth(0)).toContainText("O00400");
  await expect(rows.nth(1)).toContainText("Météo-France MFWAM");
  await expect(rows.nth(2)).toContainText("ECMWF WAM 9 km");
  await expect(rows.nth(3)).toContainText("NOAA GFS Wave 0.16°");
  await expect(rows.nth(4)).toContainText("DWD GWAM");
  await expect(page.getByText("僅蒐集，不影響相似度", { exact: true })).toHaveCount(3);
});

test("public Find has no automatically detectable WCAG A/AA violations", async ({ page }) => {
  await mockPublicApi(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "相似歷史實拍" })).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const summary = results.violations
    .map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.length})`)
    .join("\n");

  expect(results.violations, summary).toEqual([]);
});
