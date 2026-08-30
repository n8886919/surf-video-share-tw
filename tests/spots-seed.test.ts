import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const columns = [
  "slug",
  "nameEn",
  "nameZh",
  "region",
  "latitude",
  "longitude",
  "coordinateSource",
  "sourceNotes",
  "active",
] as const;

function readSpots() {
  const rows = readFileSync(new URL("../data/spots.csv", import.meta.url), "utf8")
    .trim()
    .split(/\r?\n/)
    .slice(1);

  return rows.map((row) =>
    Object.fromEntries(row.split(",").map((value, index) => [columns[index], value])),
  );
}

describe("spot seed", () => {
  it("keeps the eight approved spots active with exact coordinates and provenance", () => {
    const activeSpots = readSpots().filter((spot) => spot.active === "true");
    const bySlug = Object.fromEntries(activeSpots.map((spot) => [spot.slug, spot]));

    expect(activeSpots).toHaveLength(8);
    expect(bySlug["double-lions"]).toMatchObject({ nameZh: "雙獅", latitude: "24.8887597", longitude: "121.8495724" });
    expect(bySlug["wushi-harbor-north"]).toMatchObject({ nameZh: "烏石港", latitude: "24.8731036", longitude: "121.8411446" });
    expect(bySlug["suao-wuwei-harbor"]).toMatchObject({ nameZh: "無尾", latitude: "24.6114709", longitude: "121.867805" });
    expect(bySlug.daxi).toMatchObject({ nameZh: "蜜月灣", latitude: "24.9333608", longitude: "121.885568" });
    expect(bySlug.jinzun).toMatchObject({ nameZh: "金樽", latitude: "22.9558919", longitude: "121.2942829" });
    expect(bySlug.donghe).toMatchObject({ nameZh: "北東河", latitude: "22.976243201721132", longitude: "121.31300650318626" });
    expect(bySlug.yuguangdao).toMatchObject({ nameZh: "漁光島", latitude: "22.980289143624113", longitude: "120.15516081806676" });
    expect(bySlug.nanwan).toMatchObject({ nameZh: "南灣", latitude: "21.95878467673781", longitude: "120.76046672044414" });
    for (const spot of activeSpots.filter((spot) => !["double-lions", "wushi-harbor-north"].includes(spot.slug))) {
      expect(spot.coordinateSource).toBe("User-supplied coordinates");
    }
  });
});
