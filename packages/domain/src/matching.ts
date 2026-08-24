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
  components: MatchComponent[];
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
} as const;

export function circularDirectionDistance(a: number, b: number): number {
  const raw = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(raw, 360 - raw);
}

export function rankSimilarConditions(
  target: MarineConditions,
  candidates: HistoricalCondition[],
): RankedMatch[] {
  return candidates
    .map((candidate) => {
      const components: MatchComponent[] = [];
      for (const [key, config] of Object.entries(MATCH_WEIGHTS)) {
        const field = key as keyof typeof MATCH_WEIGHTS;
        const targetValue = target[field];
        const candidateValue = candidate.conditions[field];
        if (typeof targetValue !== "number" || typeof candidateValue !== "number") continue;
        const difference = "circular" in config
          ? circularDirectionDistance(targetValue, candidateValue)
          : Math.abs(targetValue - candidateValue);
        components.push({
          key,
          normalizedDifference: Math.min(difference / config.scale, 1),
          weight: config.weight,
        });
      }
      const weightTotal = components.reduce((sum, item) => sum + item.weight, 0);
      const distance = weightTotal === 0
        ? 1
        : components.reduce(
            (sum, item) => sum + item.normalizedDifference * item.weight,
            0,
          ) / weightTotal;
      return { ...candidate, score: Number((1 - distance).toFixed(6)), components };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
