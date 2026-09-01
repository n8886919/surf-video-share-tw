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
  it("keeps the nineteen approved spots active with exact coordinates and provenance", () => {
    const activeSpots = readSpots().filter((spot) => spot.active === "true");
    const bySlug = Object.fromEntries(activeSpots.map((spot) => [spot.slug, spot]));

    expect(activeSpots).toHaveLength(19);
    expect(bySlug["double-lions"]).toMatchObject({ nameZh: "雙獅", latitude: "24.8887597", longitude: "121.8495724" });
    expect(bySlug["wushi-harbor-north"]).toMatchObject({ nameZh: "烏石港", latitude: "24.8731036", longitude: "121.8411446" });
    expect(bySlug["suao-wuwei-harbor"]).toMatchObject({ nameZh: "無尾", latitude: "24.6114709", longitude: "121.867805" });
    expect(bySlug.daxi).toMatchObject({ nameZh: "蜜月灣", latitude: "24.9333608", longitude: "121.885568" });
    expect(bySlug.jinzun).toMatchObject({ nameZh: "金樽", latitude: "22.9558919", longitude: "121.2942829" });
    expect(bySlug.donghe).toMatchObject({ nameZh: "北東河", latitude: "22.976243201721132", longitude: "121.31300650318626" });
    expect(bySlug.yuguangdao).toMatchObject({ nameZh: "漁光島", latitude: "22.980289143624113", longitude: "120.15516081806676" });
    expect(bySlug.nanwan).toMatchObject({ nameZh: "南灣", latitude: "21.958931664298785", longitude: "120.76328410357425" });
    expect(bySlug["zhongjiao-bay"]).toMatchObject({ nameZh: "中角灣", latitude: "25.239770", longitude: "121.633917" });
    expect(bySlug.fulong).toMatchObject({ nameZh: "福隆", latitude: "25.01950696642004", longitude: "121.94721228977903" });
    expect(bySlug["environmental-park"]).toMatchObject({ nameZh: "環保", latitude: "24.00893745298168", longitude: "121.64634373339165" });
    expect(bySlug["hualien-beibin"]).toMatchObject({ nameZh: "北濱", latitude: "23.976851157405616", longitude: "121.62119607489474" });
    expect(bySlug.jiqi).toMatchObject({ nameZh: "磯崎", latitude: "23.707389208134664", longitude: "121.54972184939969" });
    expect(bySlug.jiupeng).toMatchObject({ nameZh: "九棚", latitude: "22.10902017243464", longitude: "120.89123362409177" });
    expect(bySlug.jialeshui).toMatchObject({ nameZh: "佳樂水", latitude: "21.98728982582793", longitude: "120.84633938560528" });
    expect(bySlug["songbai-harbor"]).toMatchObject({ nameZh: "松柏港", latitude: "24.431933375413898", longitude: "120.61715426605767" });
    expect(bySlug["green-bay"]).toMatchObject({ nameZh: "翡翠灣", latitude: "25.1883162", longitude: "121.6652802" });
    expect(bySlug.wanli).toMatchObject({ nameZh: "萬里", latitude: "25.181926", longitude: "121.6875599" });
    expect(bySlug["waipu-fishing-harbor"]).toMatchObject({ nameZh: "外埔", latitude: "24.6506129", longitude: "120.7655767" });
    for (const spot of activeSpots.filter((spot) => !["double-lions", "wushi-harbor-north"].includes(spot.slug))) {
      expect(spot.coordinateSource).toBe("User-supplied coordinates");
    }
  });
});
