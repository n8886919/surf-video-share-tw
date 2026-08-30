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

  it("puts the Actions run URL on a real new line in the LINE message", () => {
    expect(workflow).toContain('--arg text "${message}" --arg run_url "${run_url}"');
    expect(workflow).toContain('text: ($text + "\\n" + $run_url)');
    expect(workflow).not.toContain('${message}\\n${run_url}');
  });
});
