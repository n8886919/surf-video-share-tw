import { createHash } from "node:crypto";
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const migrationSource = path.join(repositoryRoot, "drizzle");
const temporaryPrefix = path.join(repositoryRoot, ".tmp-migration-verify-");
const temporaryRoot = await mkdtemp(temporaryPrefix);
const temporaryMigrationDirectory = path.join(temporaryRoot, "drizzle");
const relativeMigrationDirectory = path
  .relative(repositoryRoot, temporaryMigrationDirectory)
  .replaceAll(path.sep, "/");

function runDrizzleKit(arguments_) {
  const pnpmEntrypoint = process.env.npm_execpath;
  const command = pnpmEntrypoint
    ? process.execPath
    : process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const argumentsWithRunner = pnpmEntrypoint
    ? [pnpmEntrypoint, "exec", "drizzle-kit", ...arguments_]
    : ["exec", "drizzle-kit", ...arguments_];
  const result = spawnSync(command, argumentsWithRunner, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  return result.status === 0;
}

async function directoryFingerprint(directory, relativeDirectory = "") {
  const entries = await readdir(path.join(directory, relativeDirectory), { withFileTypes: true });
  const fingerprint = new Map();
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      const nested = await directoryFingerprint(directory, relativePath);
      for (const [name, hash] of nested) fingerprint.set(name, hash);
      continue;
    }
    const contents = await readFile(path.join(directory, relativePath));
    fingerprint.set(relativePath.replaceAll(path.sep, "/"), createHash("sha256").update(contents).digest("hex"));
  }
  return fingerprint;
}

function changedPaths(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((file) => before.get(file) !== after.get(file))
    .sort();
}

try {
  await cp(migrationSource, temporaryMigrationDirectory, { recursive: true });
  const before = await directoryFingerprint(temporaryMigrationDirectory);

  if (!runDrizzleKit([
    "check",
    "--dialect=sqlite",
    `--out=${relativeMigrationDirectory}`,
  ])) {
    throw new Error("Drizzle migration history consistency check failed.");
  }

  if (!runDrizzleKit([
    "generate",
    "--dialect=sqlite",
    "--schema=./db/schema.ts",
    `--out=${relativeMigrationDirectory}`,
    "--name=ci_schema_drift",
  ])) {
    throw new Error("Drizzle schema generation check failed.");
  }

  const after = await directoryFingerprint(temporaryMigrationDirectory);
  const drift = changedPaths(before, after);
  if (drift.length > 0) {
    throw new Error([
      "db/schema.ts and the committed Drizzle migrations have drifted.",
      "Run `pnpm db:generate`, review the migration, and commit it.",
      `Changed paths in the isolated check: ${drift.join(", ")}`,
    ].join("\n"));
  }

  console.log("Migration history is consistent and db/schema.ts has no uncommitted migration drift.");
} finally {
  const resolvedTemporaryRoot = path.resolve(temporaryRoot);
  if (!resolvedTemporaryRoot.startsWith(path.resolve(temporaryPrefix))) {
    throw new Error(`Refusing to remove unexpected temporary path: ${resolvedTemporaryRoot}`);
  }
  await rm(resolvedTemporaryRoot, { recursive: true, force: true });
}
