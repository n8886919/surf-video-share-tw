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
    model: "ecmwf_wam",
    issuedAt: "2026-08-30T00:00:00.000Z",
    modelRunAt: null,
    validAt: "2026-08-30T01:00:00.000Z",
    leadHours: 1,
    totalWave: { height: 1.5, direction: 80, period: 10 },
    primarySwell: primary,
    secondarySwell: secondary,
    windWave: { height: 0.3, direction: 20, period: 4 },
    tide: { height: 0.5, slope: 0.1, state: "rising" },
    wind: { speed: 4, direction: 10, gust: 6 },
  };
}

function matchesResponse(requestUrl: string, spotId: string, spotName: string) {
  const url = new URL(requestUrl);
  const item = observation(`video_${spotId}`, spotId, spotName);
  const primary = { height: 1.2, direction: 40, period: 11 };
  const secondary = { height: 0.8, direction: 120, period: 8 };
  return {
    spot: { id: spotId, slug: spotId.replace(/^spot_/, ""), name: spotName },
    targetTime: url.searchParams.get("targetTime"),
    forecasts: [],
    observations: [item],
    matches: [{
      score: 0.91,
      availableWeight: 1,
      matchedWeight: 0.91,
      coverage: 1,
      observation: item,
      sources: [{
        provider: "open-meteo",
        model: "ecmwf_wam",
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
    ranking: "equal-provider-composite-historical-forecast",
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

  await expect(page.getByRole("button", { name: /播放 烏石港/ })).toBeVisible();
  await page.getByRole("button", { name: "雙獅", exact: true }).click();

  await expect(page.getByRole("button", { name: /播放 烏石港/ })).toHaveCount(0);
  await expect(page.getByText("比對中", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /播放 雙獅/ })).toBeVisible();
});

test("shows the exact swapped swell assignment used by matching", async ({ page }) => {
  await mockPublicApi(page);
  await page.goto("/");

  const primaryRow = page.locator('[data-swell-pairing="primary:secondary"]');
  const secondaryRow = page.locator('[data-swell-pairing="secondary:primary"]');
  await expect(primaryRow).toContainText("主湧浪");
  await expect(primaryRow).toContainText("次湧浪 · 1.2m · 40° · 11.0s");
  await expect(secondaryRow).toContainText("次湧浪");
  await expect(secondaryRow).toContainText("主湧浪 · 0.8m · 120° · 8.0s");
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
