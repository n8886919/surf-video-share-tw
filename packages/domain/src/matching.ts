import type { MarineConditions } from "./conditions";

// Scoring authority: every change to this file must update docs/MATCHING.md.
// tests/matching-doc.test.ts enforces the source fingerprint and documented constants.

export interface HistoricalCondition {
  id: string;
  conditions: MarineConditions;
}

export interface MatchComponent {
  key: string;
  normalizedDifference: number;
  weight: number;
}

export type SwellLabel = "primary" | "secondary";

export interface SwellPairing {
  target: SwellLabel;
  candidate: SwellLabel | null;
}

export interface RankedMatch extends HistoricalCondition {
  score: number;
  availableWeight: number;
  matchedWeight: number;
  coverage: number;
  components: MatchComponent[];
  swellPairing: SwellPairing[];
}

export interface SourceMatchScore {
  sourceKey: string;
  score: number;
  availableWeight: number;
  matchedWeight: number;
  coverage: number;
}

export interface CombinedMatchScore {
  score: number;
  availableWeight: number;
  matchedWeight: number;
  coverage: number;
  sources: SourceMatchScore[];
}

export interface AvailableForecastCandidate<T> {
  value: T;
  id: string;
  issuedAt: string;
  validAt: string;
}

export const MATCH_WEIGHTS = {
  swellHeight: { weight: 1.25, scale: 2 },
  swellPeriod: { weight: 1, scale: 12 },
  swellDirection: { weight: 1.2, scale: 180, circular: true },
  windSpeed: { weight: 0.65, scale: 20 },
  windDirection: { weight: 0.55, scale: 180, circular: true },
  tideHeight: { weight: 0.6, scale: 3 },
  waveHeight: { weight: 0.8, scale: 3 },
  wavePeriod: { weight: 0.55, scale: 15 },
  waveDirection: { weight: 0.65, scale: 180, circular: true },
  windWaveHeight: { weight: 0.55, scale: 2 },
  windWavePeriod: { weight: 0.35, scale: 10 },
  windWaveDirection: { weight: 0.45, scale: 180, circular: true },
  windGust: { weight: 0.25, scale: 25 },
  tideSlope: { weight: 0.35, scale: 1 },
} as const;

const SWELL_COMPONENT_KEYS = ["swellHeight", "swellPeriod", "swellDirection"] as const;
type SwellComponentKey = typeof SWELL_COMPONENT_KEYS[number];
interface WeightedSwellComponent {
  label: SwellLabel;
  share: number;
  values: Record<SwellComponentKey, number | null>;
}

export const MIN_MATCH_COVERAGE = 0.5;

export function combineRequiredSourceScores(
  sourceScores: SourceMatchScore[],
  requiredSourceKeys: readonly string[],
): CombinedMatchScore | null {
  if (requiredSourceKeys.length === 0 || new Set(requiredSourceKeys).size !== requiredSourceKeys.length) {
    return null;
  }
  const bySource = new Map(sourceScores.map((source) => [source.sourceKey, source]));
  const sources = requiredSourceKeys.map((key) => bySource.get(key));
  if (sources.some((source) => !source
    || !Number.isFinite(source.score)
    || !Number.isFinite(source.coverage)
    || source.coverage < MIN_MATCH_COVERAGE)) {
    return null;
  }
  const completeSources = sources as SourceMatchScore[];
  const count = completeSources.length;
  return {
    score: Number((completeSources.reduce((sum, source) => sum + source.score, 0) / count).toFixed(6)),
    availableWeight: completeSources.reduce((sum, source) => sum + source.availableWeight, 0),
    matchedWeight: completeSources.reduce((sum, source) => sum + source.matchedWeight, 0),
    coverage: completeSources.reduce((sum, source) => sum + source.coverage, 0) / count,
    sources: completeSources,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function circularDirectionDistance(a: number, b: number): number {
  const raw = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(raw, 360 - raw);
}

export function normalizedCircularDirectionDifference(a: number, b: number): number {
  return (1 - Math.cos(circularDirectionDistance(a, b) * Math.PI / 180)) / 2;
}

function normalizedFeatureDifference(
  a: number,
  b: number,
  config: { scale: number; circular?: true },
): number {
  return config.circular
    ? normalizedCircularDirectionDifference(a, b)
    : Math.min(Math.abs(a - b) / config.scale, 1);
}

function swellComponents(conditions: MarineConditions): WeightedSwellComponent[] {
  const components = [
    {
      label: "primary" as const,
      values: {
        swellHeight: conditions.swellHeight,
        swellPeriod: conditions.swellPeriod,
        swellDirection: conditions.swellDirection,
      },
    },
    {
      label: "secondary" as const,
      values: {
        swellHeight: conditions.secondarySwellHeight,
        swellPeriod: conditions.secondarySwellPeriod,
        swellDirection: conditions.secondarySwellDirection,
      },
    },
  ].filter((component) => Object.values(component.values).some(isFiniteNumber));
  const strengths = components.map((component) => {
    const height = component.values.swellHeight;
    return isFiniteNumber(height) && height > 0 ? height ** 2 : 0;
  });
  const totalStrength = strengths.reduce((sum, strength) => sum + strength, 0);
  return components.map((component, index) => ({
    ...component,
    share: totalStrength > 0 ? (strengths[index] ?? 0) / totalStrength : 1 / components.length,
  }));
}

interface SwellComparison {
  availableWeight: number;
  matchedWeight: number;
  distanceWeight: number;
  components: MatchComponent[];
  pairing: SwellPairing[];
}

function bestSwellComparison(
  target: MarineConditions,
  candidate: MarineConditions,
): SwellComparison {
  const targets = swellComponents(target);
  const candidates = swellComponents(candidate);
  const availableWeight = targets.reduce((sum, component) => sum + component.share
    * SWELL_COMPONENT_KEYS.reduce((fieldSum, key) => fieldSum
      + (isFiniteNumber(component.values[key]) ? MATCH_WEIGHTS[key].weight : 0), 0), 0);
  if (!targets.length || !candidates.length) {
    return {
      availableWeight,
      matchedWeight: 0,
      distanceWeight: 0,
      components: [],
      pairing: targets.map((target) => ({ target: target.label, candidate: null })),
    };
  }

  const evaluations: Array<SwellComparison & { assignmentPenalty: number; assignmentKey: string }> = [];
  const evaluate = (assignment: Array<number | null>) => {
    const components: MatchComponent[] = [];
    let assignmentPenalty = 0;
    for (let index = 0; index < targets.length; index += 1) {
      const targetComponent = targets[index]!;
      const candidateIndex = assignment[index];
      const candidateComponent = candidateIndex === null || candidateIndex === undefined
        ? null
        : candidates[candidateIndex]!;
      for (const key of SWELL_COMPONENT_KEYS) {
        const targetValue = targetComponent.values[key];
        if (!isFiniteNumber(targetValue)) continue;
        const weight = MATCH_WEIGHTS[key].weight * targetComponent.share;
        const candidateValue = candidateComponent?.values[key];
        if (!isFiniteNumber(candidateValue)) {
          assignmentPenalty += weight;
          continue;
        }
        const difference = normalizedFeatureDifference(targetValue, candidateValue, MATCH_WEIGHTS[key]);
        assignmentPenalty += difference * weight;
        components.push({
          key: targetComponent.label === "primary"
            ? key
            : `secondarySwell${key.slice("swell".length)}`,
          normalizedDifference: difference,
          weight,
        });
      }
    }
    evaluations.push({
      availableWeight,
      matchedWeight: components.reduce((sum, item) => sum + item.weight, 0),
      distanceWeight: components.reduce(
        (sum, item) => sum + item.normalizedDifference * item.weight,
        0,
      ),
      components,
      pairing: targets.map((target, index) => {
        const candidateIndex = assignment[index];
        return {
          target: target.label,
          candidate: candidateIndex === null || candidateIndex === undefined
            ? null
            : candidates[candidateIndex]!.label,
        };
      }),
      assignmentPenalty,
      assignmentKey: assignment.map((candidateIndex) => candidateIndex === null
        || candidateIndex === undefined
        ? "~"
        : candidates[candidateIndex]!.label).join(":"),
    });
  };
  const visit = (targetIndex: number, used: Set<number>, assignment: Array<number | null>) => {
    if (targetIndex === targets.length) {
      evaluate(assignment);
      return;
    }
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      if (used.has(candidateIndex)) continue;
      used.add(candidateIndex);
      assignment.push(candidateIndex);
      visit(targetIndex + 1, used, assignment);
      assignment.pop();
      used.delete(candidateIndex);
    }
    assignment.push(null);
    visit(targetIndex + 1, used, assignment);
    assignment.pop();
  };
  visit(0, new Set(), []);
  const best = evaluations.sort((a, b) => a.assignmentPenalty - b.assignmentPenalty
    || b.matchedWeight - a.matchedWeight
    || (a.assignmentKey < b.assignmentKey ? -1 : a.assignmentKey > b.assignmentKey ? 1 : 0))[0];
  return best ?? {
    availableWeight,
    matchedWeight: 0,
    distanceWeight: 0,
    components: [],
    pairing: targets.map((target) => ({ target: target.label, candidate: null })),
  };
}

export function selectLatestAvailableForecast<T>(
  candidates: AvailableForecastCandidate<T>[],
  targetTime: string | Date,
  availableAt: string | Date,
  maxValidDifferenceMs = 4 * 60 * 60_000,
): T | null {
  const targetMs = new Date(targetTime).getTime();
  const availableMs = new Date(availableAt).getTime();
  if (!Number.isFinite(targetMs) || !Number.isFinite(availableMs) || maxValidDifferenceMs < 0) {
    return null;
  }
  return candidates
    .map((candidate) => ({
      ...candidate,
      issuedMs: new Date(candidate.issuedAt).getTime(),
      validDifferenceMs: Math.abs(new Date(candidate.validAt).getTime() - targetMs),
    }))
    .filter((candidate) => Number.isFinite(candidate.issuedMs)
      && Number.isFinite(candidate.validDifferenceMs)
      && candidate.issuedMs <= availableMs
      && candidate.validDifferenceMs <= maxValidDifferenceMs)
    .sort((a, b) => b.issuedMs - a.issuedMs
      || a.validDifferenceMs - b.validDifferenceMs
      || a.id.localeCompare(b.id))[0]?.value ?? null;
}

export function rankSimilarConditions(
  target: MarineConditions,
  candidates: HistoricalCondition[],
): RankedMatch[] {
  const staticAvailableWeight = Object.entries(MATCH_WEIGHTS).reduce((sum, [key, config]) => {
    if ((SWELL_COMPONENT_KEYS as readonly string[]).includes(key)) return sum;
    const field = key as keyof typeof MATCH_WEIGHTS;
    return isFiniteNumber(target[field]) ? sum + config.weight : sum;
  }, 0);
  const targetSwell = bestSwellComparison(target, target);
  const availableWeight = staticAvailableWeight + targetSwell.availableWeight;

  return candidates
    .map((candidate) => {
      const components: MatchComponent[] = [];
      let staticMatchedWeight = 0;
      let staticDistanceWeight = 0;
      for (const [key, config] of Object.entries(MATCH_WEIGHTS)) {
        if ((SWELL_COMPONENT_KEYS as readonly string[]).includes(key)) continue;
        const field = key as keyof typeof MATCH_WEIGHTS;
        const targetValue = target[field];
        const candidateValue = candidate.conditions[field];
        if (!isFiniteNumber(targetValue) || !isFiniteNumber(candidateValue)) continue;
        const difference = normalizedFeatureDifference(targetValue, candidateValue, config);
        components.push({
          key,
          normalizedDifference: difference,
          weight: config.weight,
        });
        staticMatchedWeight += config.weight;
        staticDistanceWeight += difference * config.weight;
      }
      const swell = bestSwellComparison(target, candidate.conditions);
      components.push(...swell.components);
      const matchedWeight = staticMatchedWeight + swell.matchedWeight;
      const coverage = availableWeight === 0 ? 0 : matchedWeight / availableWeight;
      const distance = matchedWeight === 0
        ? 1
        : (staticDistanceWeight + swell.distanceWeight) / matchedWeight;
      return {
        ...candidate,
        score: Number((1 - distance).toFixed(6)),
        availableWeight,
        matchedWeight,
        coverage,
        components,
        swellPairing: swell.pairing,
      };
    })
    .filter((match) => match.coverage >= MIN_MATCH_COVERAGE)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
