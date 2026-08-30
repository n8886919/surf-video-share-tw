import { describe, expect, it } from "vitest";
import type { MarineConditions } from "../packages/domain/src/conditions";
import {
  circularDirectionDistance,
  combineRequiredSourceScores,
  MATCH_WEIGHTS,
  normalizedCircularDirectionDifference,
  rankSimilarConditions,
  selectLatestAvailableForecast,
} from "../packages/domain/src/matching";

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
  windWaveHeight: 0.3,
  windWaveDirection: 20,
  windWavePeriod: 4,
  windSpeed: 4,
  windDirection: 10,
  windGust: 6,
  tideHeight: 0.5,
  tideSlope: 0.1,
  tideState: "rising",
  validTime: "2026-08-24T02:00:00.000Z",
  provider: "test",
  model: null,
  modelRunTime: null,
  retrievedAt: "2026-08-24T00:00:00.000Z",
  schemaVersion: 1,
};

function conditionsWithOnly(
  fields: Array<keyof typeof MATCH_WEIGHTS>,
): MarineConditions {
  const conditions = { ...base };
  for (const key of Object.keys(MATCH_WEIGHTS) as Array<keyof typeof MATCH_WEIGHTS>) {
    if (!fields.includes(key)) conditions[key] = null;
  }
  return conditions;
}

describe("condition matching", () => {
  it("combines required provider scores with equal provider weight", () => {
    expect(combineRequiredSourceScores([
      { sourceKey: "cwa", score: 0.8, availableWeight: 2, matchedWeight: 2, coverage: 1 },
      { sourceKey: "ecmwf", score: 0.4, availableWeight: 8, matchedWeight: 4, coverage: 0.5 },
    ], ["cwa", "ecmwf"])).toMatchObject({
      score: 0.6,
      availableWeight: 10,
      matchedWeight: 6,
      coverage: 0.75,
      sources: [{ sourceKey: "cwa" }, { sourceKey: "ecmwf" }],
    });
  });

  it("requires every provider to meet coverage independently", () => {
    expect(combineRequiredSourceScores([
      { sourceKey: "cwa", score: 1, availableWeight: 2, matchedWeight: 0.8, coverage: 0.4 },
      { sourceKey: "ecmwf", score: 1, availableWeight: 8, matchedWeight: 8, coverage: 1 },
    ], ["cwa", "ecmwf"])).toBeNull();
    expect(combineRequiredSourceScores([
      { sourceKey: "cwa", score: 1, availableWeight: 2, matchedWeight: 2, coverage: 1 },
    ], ["cwa", "ecmwf"])).toBeNull();
  });

  it("uses circular direction distance", () => {
    expect(circularDirectionDistance(359, 1)).toBe(2);
    expect(circularDirectionDistance(0, 180)).toBe(180);
    expect(normalizedCircularDirectionDifference(0, 10)).toBeCloseTo(0.007596, 6);
    expect(normalizedCircularDirectionDifference(0, 90)).toBeCloseTo(0.5, 6);
    expect(normalizedCircularDirectionDifference(0, 180)).toBe(1);
  });

  it("matches primary and secondary swell as an unordered pair", () => {
    const target = {
      ...conditionsWithOnly(["swellHeight", "swellPeriod", "swellDirection"]),
      swellHeight: 1.2,
      swellPeriod: 11,
      swellDirection: 40,
      secondarySwellHeight: 0.8,
      secondarySwellPeriod: 8,
      secondarySwellDirection: 120,
    };
    const swapped = {
      ...target,
      swellHeight: 0.8,
      swellPeriod: 8,
      swellDirection: 120,
      secondarySwellHeight: 1.2,
      secondarySwellPeriod: 11,
      secondarySwellDirection: 40,
    };
    expect(rankSimilarConditions(target, [{ id: "swapped", conditions: swapped }])[0]).toMatchObject({
      score: 1,
      availableWeight: 3.45,
      matchedWeight: 3.45,
      coverage: 1,
    });
  });

  it("weights direction differences by squared swell height without growing the swell budget", () => {
    const target = {
      ...conditionsWithOnly(["swellHeight", "swellPeriod", "swellDirection"]),
      swellHeight: 1.5,
      swellPeriod: 10,
      swellDirection: 0,
      secondarySwellHeight: 0.5,
      secondarySwellPeriod: 10,
      secondarySwellDirection: 90,
    };
    const strongMismatch = { ...target, swellDirection: 90 };
    const weakMismatch = { ...target, secondarySwellDirection: 180 };
    const ranked = rankSimilarConditions(target, [
      { id: "strong", conditions: strongMismatch },
      { id: "weak", conditions: weakMismatch },
    ]);
    expect(ranked.map((match) => match.id)).toEqual(["weak", "strong"]);
    expect(ranked[0]!.availableWeight).toBeCloseTo(3.45, 6);
    expect(ranked[1]!.availableWeight).toBeCloseTo(3.45, 6);
    expect(ranked[0]!.components.find((component) => component.key === "secondarySwellDirection")?.weight)
      .toBeCloseTo(0.12, 6);
    expect(ranked[1]!.components.find((component) => component.key === "swellDirection")?.weight)
      .toBeCloseTo(1.08, 6);
  });

  it("scores identical conditions as one", () => {
    const match = rankSimilarConditions(base, [{ id: "same", conditions: base }])[0];
    expect(match).toMatchObject({
      score: 1,
      availableWeight: 9.2,
      matchedWeight: 9.2,
      coverage: 1,
    });
  });

  it("excludes candidates without numeric overlap", () => {
    const missing = Object.fromEntries(Object.keys(base).map((key) => [key, null])) as unknown as MarineConditions;
    missing.validTime = base.validTime;
    missing.provider = "test";
    missing.retrievedAt = base.retrievedAt;
    missing.schemaVersion = 1;
    expect(rankSimilarConditions(base, [{ id: "missing", conditions: missing }])).toEqual([]);
  });

  it("excludes a coincidental single-field match below 50 percent coverage", () => {
    const sparse = conditionsWithOnly(["swellHeight"]);
    expect(rankSimilarConditions(base, [{ id: "sparse", conditions: sparse }])).toEqual([]);
  });

  it("includes partial data at exactly 50 percent coverage and reports its weights", () => {
    const halfCovered = conditionsWithOnly([
      "swellHeight",
      "swellPeriod",
      "swellDirection",
      "waveHeight",
      "tideSlope",
    ]);
    const match = rankSimilarConditions(base, [{ id: "half", conditions: halfCovered }])[0];
    expect(match).toMatchObject({
      score: 1,
      availableWeight: 9.2,
      matchedWeight: 4.6,
      coverage: 0.5,
    });
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

  it("uses the newest forecast available at capture time before exact lead-time similarity", () => {
    const selected = selectLatestAvailableForecast([
      {
        value: "older-exact-valid-time",
        id: "older",
        issuedAt: "2026-08-24T00:00:00.000Z",
        validAt: "2026-08-25T06:00:00.000Z",
      },
      {
        value: "newer-nearby-valid-time",
        id: "newer",
        issuedAt: "2026-08-25T00:00:00.000Z",
        validAt: "2026-08-25T07:00:00.000Z",
      },
      {
        value: "published-after-capture",
        id: "future",
        issuedAt: "2026-08-25T06:01:00.000Z",
        validAt: "2026-08-25T06:00:00.000Z",
      },
    ], "2026-08-25T06:00:00.000Z", "2026-08-25T06:00:00.000Z");

    expect(selected).toBe("newer-nearby-valid-time");
  });
});
