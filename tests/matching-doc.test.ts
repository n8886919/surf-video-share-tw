import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { FORECAST_SOURCES } from "../packages/domain/src/forecast-sources";
import { MATCH_WEIGHTS, MIN_MATCH_COVERAGE } from "../packages/domain/src/matching";

async function readProjectFile(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function normalizedSourceFingerprint(source: string): string {
  const normalized = `${source.replace(/\r\n?/g, "\n").trimEnd()}\n`;
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

function documentedWeightsTable(): string {
  return [
    "| Field key | Weight | Scale | Distance |",
    "|---|---:|---:|---|",
    ...Object.entries(MATCH_WEIGHTS).map(([key, config]) => {
      const distance = "circular" in config && config.circular
        ? "cosine circular"
        : "linear capped";
      return `| \`${key}\` | ${config.weight} | ${config.scale} | ${distance} |`;
    }),
  ].join("\n");
}

function documentedForecastSourceTable(): string {
  return [
    "| Provider / model | Display name | Role | Swell semantics |",
    "|---|---|---|---|",
    ...FORECAST_SOURCES.map((source) =>
      `| \`${source.provider} / ${source.model}\` | ${source.displayName} | ${source.matchingRole} | ${source.swellSemantics} |`
    ),
  ].join("\n");
}

describe("matching documentation", () => {
  it("pins every matching source change to a reviewed documentation update", async () => {
    const [source, documentation] = await Promise.all([
      readProjectFile("packages/domain/src/matching.ts"),
      readProjectFile("docs/MATCHING.md"),
    ]);
    const expected = normalizedSourceFingerprint(source);
    const documented = documentation.match(/matching-source-sha256: ([a-f0-9]{64})/)?.[1];

    expect(documented, `Review docs/MATCHING.md, then set matching-source-sha256 to ${expected}`)
      .toBe(expected);
  });

  it("keeps exported weights, coverage, and required explanations synchronized", async () => {
    const documentation = await readProjectFile("docs/MATCHING.md");
    expect(documentation).toContain(documentedWeightsTable());
    expect(documentation).toContain(documentedForecastSourceTable());
    expect(documentation).toContain(`Minimum source coverage: \`${MIN_MATCH_COVERAGE}\``);
    for (const heading of [
      "## Forecast snapshot selection",
      "## Normalized feature difference",
      "## Unordered swell-system matching",
      "## Availability, matched weight, and coverage",
      "## Source score",
      "## Provider composition",
      "## Deterministic ordering and response",
      "## Explicit non-inputs and limitations",
      "## Synchronization contract",
    ]) expect(documentation).toContain(heading);
  });

  it("is directly referenced by every matching-facing authority", async () => {
    const references = [
      ["AGENTS.md", "docs/MATCHING.md"],
      ["README.md", "docs/MATCHING.md"],
      ["docs/PROJECT_PRINCIPLES.md", "MATCHING.md"],
      ["docs/PRODUCT.md", "MATCHING.md"],
      ["docs/ARCHITECTURE.md", "MATCHING.md"],
      ["docs/API.md", "MATCHING.md"],
      ["packages/domain/src/matching.ts", "docs/MATCHING.md"],
    ] as const;

    await Promise.all(references.map(async ([path, reference]) => {
      expect(await readProjectFile(path), `${path} should reference docs/MATCHING.md`)
        .toContain(reference);
    }));
  });
});
