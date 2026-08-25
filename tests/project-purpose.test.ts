import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PROJECT_PURPOSE } from "../packages/domain/src/project-purpose";

async function readProjectFile(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("project purpose", () => {
  it("keeps the five-second purpose synchronized in handoff documents", async () => {
    const [readme, principles] = await Promise.all([
      readProjectFile("README.md"),
      readProjectFile("docs/PROJECT_PRINCIPLES.md"),
    ]);

    expect(readme).toContain(PROJECT_PURPOSE);
    expect(principles).toContain(PROJECT_PURPOSE);
  });
});
