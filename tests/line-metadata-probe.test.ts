import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("runs the local comparison without emitting file names or mistaking missing metadata for preserved metadata", () => {
  const directory = mkdtempSync(join(tmpdir(), "surf-line-probe-"));
  try {
    const original = join(directory, "private-source.mp4");
    const received = join(directory, "private-received.mp4");
    const bytes = Buffer.alloc(16);
    bytes.writeUInt32BE(16, 0);
    bytes.write("ftyp", 4);
    writeFileSync(original, bytes);
    writeFileSync(received, bytes);
    const result = spawnSync(process.execPath, ["ops/compare-line-video-metadata.mjs", original, received], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("private-");
    const report = JSON.parse(result.stdout);
    expect(report.original.recordingTimePresent).toBe(false);
    expect(report.received.gpsPresent).toBe(false);
    expect(report.recordingTimePreserved).toBeNull();
    expect(report.coordinatesPreserved).toBeNull();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
