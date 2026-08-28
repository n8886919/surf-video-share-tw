import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const wranglerConfigPath = resolve(projectRoot, "wrangler.jsonc");
const readonlyTokenPath = resolve(projectRoot, ".env.cloudflare-readonly");
const wranglerConfig = JSON.parse(readFileSync(wranglerConfigPath, "utf8"));
const wranglerEntryPath = resolve(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");

export function extractJson(output) {
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== "[" && output[index] !== "{") continue;
    try {
      return JSON.parse(output.slice(index));
    } catch {
      // Wrangler may print a non-JSON status line before its JSON result.
    }
  }
  throw new Error("Wrangler did not return JSON output");
}

export function pendingMigrationNames(output, localMigrationNames) {
  return localMigrationNames.filter((name) => output.includes(name));
}

export function summarizeVersion(version, percentage) {
  const bindings = Array.isArray(version.resources?.bindings)
    ? version.resources.bindings
        .map((binding) => ({ name: binding.name, type: binding.type }))
        .filter((binding) => typeof binding.name === "string" && typeof binding.type === "string")
        .sort((left, right) => left.name.localeCompare(right.name))
    : [];
  return {
    id: version.id,
    percentage,
    createdOn: version.metadata?.created_on ?? null,
    compatibilityDate: version.resources?.script_runtime?.compatibility_date ?? null,
    bindings,
  };
}

export function resolveCloudflareToken(processToken, envFileContents) {
  if (typeof processToken === "string" && processToken.trim()) return processToken.trim();
  if (typeof envFileContents !== "string") return null;
  const fileToken = parseEnv(envFileContents).CLOUDFLARE_API_TOKEN;
  return typeof fileToken === "string" && fileToken.trim() ? fileToken.trim() : null;
}

export function desiredBindingNames(config) {
  return [
    ...Object.keys(config.vars ?? {}),
    ...(config.d1_databases ?? []).map((binding) => binding.binding),
    ...(config.ratelimits ?? []).map((binding) => binding.name),
  ].filter((name) => typeof name === "string").sort();
}

function runWrangler(args) {
  return execFileSync(
    process.execPath,
    [wranglerEntryPath, ...args, "--config", wranglerConfigPath],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        NO_COLOR: "1",
        WRANGLER_SEND_METRICS: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

async function getScriptSettings(accountId, workerName, token) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}/script-settings`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const payload = await response.json();
  if (!response.ok || payload.success !== true) {
    const message = payload.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(`Cloudflare script-settings read failed (${response.status}): ${message || "unknown error"}`);
  }
  return payload.result;
}

export async function main() {
  const envFileContents = existsSync(readonlyTokenPath)
    ? readFileSync(readonlyTokenPath, "utf8")
    : null;
  const token = resolveCloudflareToken(process.env.CLOUDFLARE_API_TOKEN, envFileContents);
  if (!token) {
    throw new Error(
      "CLOUDFLARE_API_TOKEN is absent. Put it in the git-ignored .env.cloudflare-readonly file or the parent process environment.",
    );
  }
  process.env.CLOUDFLARE_API_TOKEN = token;

  const accountId = wranglerConfig.account_id;
  const workerName = wranglerConfig.name;
  if (typeof accountId !== "string" || typeof workerName !== "string") {
    throw new Error("wrangler.jsonc must contain account_id and name");
  }

  const secrets = extractJson(runWrangler(["secret", "list", "--format", "json"]));
  const deployments = extractJson(runWrangler(["deployments", "list", "--json"]));
  if (!Array.isArray(secrets) || !Array.isArray(deployments) || deployments.length === 0) {
    throw new Error("Cloudflare returned an unexpected secret or deployment result");
  }

  const latestDeployment = [...deployments]
    .sort((left, right) => String(left.created_on).localeCompare(String(right.created_on)))
    .at(-1);
  const versions = [];
  for (const traffic of latestDeployment.versions ?? []) {
    const version = extractJson(runWrangler(["versions", "view", traffic.version_id, "--json"]));
    versions.push(summarizeVersion(version, traffic.percentage));
  }

  const migrationOutput = runWrangler(["d1", "migrations", "list", "DB", "--remote"]);
  const localMigrationNames = readdirSync(resolve(projectRoot, "drizzle"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const settings = await getScriptSettings(accountId, workerName, token);
  const secretNames = secrets
    .map((secret) => secret.name)
    .filter((name) => typeof name === "string")
    .sort();
  const requiredSecretNames = ["LINE_CHANNEL_SECRET", "SESSION_SECRET", "CLOUDFLARE_STREAM_API_TOKEN"];
  const deployedBindingNames = [...new Set(versions.flatMap((version) =>
    version.bindings.map((binding) => binding.name)
  ))].sort();
  const localBindingsNotYetDeployed = desiredBindingNames(wranglerConfig)
    .filter((name) => !deployedBindingNames.includes(name));

  const result = {
    worker: workerName,
    secretNames,
    requiredSecrets: Object.fromEntries(
      requiredSecretNames.map((name) => [name, secretNames.includes(name) ? "present" : "missing"]),
    ),
    cwaApiKey: secretNames.includes("CWA_API_KEY") ? "present" : "absent_optional",
    latestDeployment: {
      createdOn: latestDeployment.created_on ?? null,
      versions,
    },
    localBindingsNotYetDeployed,
    pendingMigrations: pendingMigrationNames(migrationOutput, localMigrationNames),
    queryStringRedaction: settings.observability?.redact_query_string === true ? "enabled" : "not_enabled",
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const invokedAsScript = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedAsScript) {
  main().catch((error) => {
    process.stderr.write(`Production preflight failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
