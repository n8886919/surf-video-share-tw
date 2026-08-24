import { describe, expect, it } from "vitest";
import type { MarineConditions } from "../packages/domain/src/conditions";
import { circularDirectionDistance, rankSimilarConditions } from "../packages/domain/src/matching";

const base: MarineConditions = {
  waveHeight: 1,
  waveDirection: 359,
  wavePeriod: 9,
  swellHeight: 0.8,
  swellDirection: 359,
  swellPeriod: 10,
  secondarySwellHeight: null,
  secondarySwellDirection: null,
  secondarySwellPeriod: null,
  windSpeed: 4,
  windDirection: 10,
  tideHeight: 0.5,
  tideState: "rising",
  validTime: "2026-08-24T02:00:00.000Z",
  provider: "test",
  model: null,
  modelRunTime: null,
  retrievedAt: "2026-08-24T00:00:00.000Z",
  schemaVersion: 1,
};

describe("condition matching", () => {
  it("uses circular direction distance", () => {
    expect(circularDirectionDistance(359, 1)).toBe(2);
    expect(circularDirectionDistance(0, 180)).toBe(180);
  });

  it("scores identical conditions as one", () => {
    expect(rankSimilarConditions(base, [{ id: "same", conditions: base }])[0].score).toBe(1);
  });

  it("handles missing values without treating them as zero", () => {
    const missing = Object.fromEntries(Object.keys(base).map((key) => [key, null])) as unknown as MarineConditions;
    missing.validTime = base.validTime;
    missing.provider = "test";
    missing.retrievedAt = base.retrievedAt;
    missing.schemaVersion = 1;
    expect(rankSimilarConditions(base, [{ id: "missing", conditions: missing }])[0]).toMatchObject({ score: 0, components: [] });
  });

  it("orders equal scores deterministically by id", () => {
    const ranked = rankSimilarConditions(base, [
      { id: "b", conditions: base },
      { id: "a", conditions: base },
    ]);
    expect(ranked.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("ranks extreme differences below a close circular direction", () => {
    const close = { ...base, swellDirection: 1 };
    const far = { ...base, swellDirection: 179, swellHeight: 3, windSpeed: 30 };
    const ranked = rankSimilarConditions(base, [
      { id: "far", conditions: far },
      { id: "close", conditions: close },
    ]);
    expect(ranked[0].id).toBe("close");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
});
