import type { MarineConditions } from "./conditions";

export interface HistoricalCondition {
  id: string;
  conditions: MarineConditions;
}

export interface MatchComponent {
  key: string;
  normalizedDifference: number;
  weight: number;
}

export interface RankedMatch extends HistoricalCondition {
  score: number;
  availableWeight: number;
  matchedWeight: number;
  coverage: number;
  components: MatchComponent[];
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

export const MIN_MATCH_COVERAGE = 0.5;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function circularDirectionDistance(a: number, b: number): number {
  const raw = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(raw, 360 - raw);
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
  const availableWeight = Object.entries(MATCH_WEIGHTS).reduce((sum, [key, config]) => {
    const field = key as keyof typeof MATCH_WEIGHTS;
    return isFiniteNumber(target[field]) ? sum + config.weight : sum;
  }, 0);

  return candidates
    .map((candidate) => {
      const components: MatchComponent[] = [];
      for (const [key, config] of Object.entries(MATCH_WEIGHTS)) {
        const field = key as keyof typeof MATCH_WEIGHTS;
        const targetValue = target[field];
        const candidateValue = candidate.conditions[field];
        if (!isFiniteNumber(targetValue) || !isFiniteNumber(candidateValue)) continue;
        const difference = "circular" in config
          ? circularDirectionDistance(targetValue, candidateValue)
          : Math.abs(targetValue - candidateValue);
        components.push({
          key,
          normalizedDifference: Math.min(difference / config.scale, 1),
          weight: config.weight,
        });
      }
      const matchedWeight = components.reduce((sum, item) => sum + item.weight, 0);
      const coverage = availableWeight === 0 ? 0 : matchedWeight / availableWeight;
      const distance = matchedWeight === 0
        ? 1
        : components.reduce(
            (sum, item) => sum + item.normalizedDifference * item.weight,
            0,
          ) / matchedWeight;
      return {
        ...candidate,
        score: Number((1 - distance).toFixed(6)),
        availableWeight,
        matchedWeight,
        coverage,
        components,
      };
    })
    .filter((match) => match.coverage >= MIN_MATCH_COVERAGE)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
