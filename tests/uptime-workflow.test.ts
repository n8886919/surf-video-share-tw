import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/uptime.yml", import.meta.url), "utf8");

describe("production uptime workflow", () => {
  it("keeps an empty GitHub history parseable instead of appending a stray brace", () => {
    expect(workflow).toContain('<<<"${runs_json:-}" 2>/dev/null || true');
    expect(workflow).toContain('<<<"${jobs_json:-}" 2>/dev/null || true');
    expect(workflow).not.toContain('${runs_json:-{}}');
    expect(workflow).not.toContain('${jobs_json:-{}}');
  });
});
