import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PROJECT_POSITION, PROJECT_PURPOSE, PROJECT_VERSION } from "../packages/domain/src/project-purpose";

async function readProjectFile(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("project purpose", () => {
  it("renders the current visible product version in help", async () => {
    expect(PROJECT_VERSION).toBe("0.8");

    const [app, packageMetadata] = await Promise.all([
      readProjectFile("app/surf-app.tsx"),
      readProjectFile("package.json"),
    ]);
    expect(app).toContain("版本 {PROJECT_VERSION}");
    expect(JSON.parse(packageMetadata)).toMatchObject({ version: `${PROJECT_VERSION}.0` });
  });

  it("keeps the five-second purpose synchronized in handoff documents", async () => {
    const [readme, principles] = await Promise.all([
      readProjectFile("README.md"),
      readProjectFile("docs/PROJECT_PRINCIPLES.md"),
    ]);

    expect(readme).toContain(PROJECT_PURPOSE);
    expect(principles).toContain(PROJECT_PURPOSE);
  });

  it("keeps the help modal's Purpose and position copy synchronized with the principles", async () => {
    const principles = await readProjectFile("docs/PROJECT_PRINCIPLES.md");
    for (const item of PROJECT_POSITION) expect(principles).toContain(item);
  });
});
