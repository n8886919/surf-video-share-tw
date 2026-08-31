import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { scripts: Record<string, string> };

describe("CI quality gates", () => {
  it("runs every repository gate in dependency order", () => {
    const commands = [
      "pnpm lint",
      "pnpm typecheck",
      "pnpm test",
      "pnpm db:check",
      "pnpm build",
      "pnpm test:site:built",
      "pnpm test:browser:built",
    ];
    const positions = commands.map((command) => workflow.indexOf(`- run: ${command}`));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("installs Chromium and preserves browser diagnostics on failure", () => {
    expect(workflow).toContain("pnpm exec playwright install --with-deps chromium");
    expect(workflow).toContain("if: failure()");
    expect(workflow).toContain("outputs/playwright-report");
    expect(workflow).toContain("outputs/playwright-results");
  });

  it("keeps local verify aligned with CI", () => {
    expect(packageJson.scripts["db:check"]).toBe("node ops/check-migration-drift.mjs");
    expect(packageJson.scripts["test:site:built"]).toBe("node --test tests/rendered-html.test.mjs");
    expect(packageJson.scripts["test:browser:built"]).toBe("playwright test");
    for (const command of [
      "pnpm lint",
      "pnpm typecheck",
      "pnpm test",
      "pnpm db:check",
      "pnpm build",
      "pnpm test:site:built",
      "pnpm test:browser:built",
    ]) {
      expect(packageJson.scripts.verify).toContain(command);
    }
  });
});
