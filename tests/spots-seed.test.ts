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
    .split("\n")
    .slice(1);

  return rows.map((row) =>
    Object.fromEntries(row.split(",").map((value, index) => [columns[index], value])),
  );
}

describe("spot seed", () => {
  it("keeps 烏石港 as the only active spot with exact provenance", () => {
    const activeSpots = readSpots().filter((spot) => spot.active === "true");

    expect(activeSpots).toEqual([
      expect.objectContaining({
        slug: "wushi-harbor-north",
        nameEn: "Wushi Harbor",
        nameZh: "烏石港",
        latitude: "24.8731036",
        longitude: "121.8411446",
        coordinateSource: "https://maps.app.goo.gl/4SENnqZuYGGe8Gco7",
      }),
    ]);
  });
});
