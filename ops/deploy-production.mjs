import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const wranglerConfigPath = resolve(projectRoot, "wrangler.jsonc");
const deployTokenPath = resolve(projectRoot, ".env.cloudflare-deploy");
const wranglerEntryPath = resolve(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const vinextCloudflareEntryPath = resolve(
  projectRoot,
  "node_modules",
  "@vinext",
  "cloudflare",
  "dist",
  "cli.js",
);

export const REQUIRED_OBSERVABILITY = Object.freeze({
  enabled: true,
  head_sampling_rate: 1,
  redact_query_string: true,
});

export function resolveDeployToken({
  workersCi,
  ciToken,
  explicitDeployToken,
  envFileContents,
}) {
  if (typeof explicitDeployToken === "string" && explicitDeployToken.trim()) {
    return explicitDeployToken.trim();
  }
  if (typeof envFileContents === "string") {
    const fileToken = parseEnv(envFileContents).CLOUDFLARE_DEPLOY_API_TOKEN;
    if (typeof fileToken === "string" && fileToken.trim()) return fileToken.trim();
  }
  if (workersCi === "1" && typeof ciToken === "string" && ciToken.trim()) {
    return ciToken.trim();
  }
  return null;
}

export function parseWranglerAuthToken(output) {
  let payload;
  try {
    payload = JSON.parse(output);
  } catch {
    throw new Error("Wrangler OAuth credential returned invalid JSON");
  }
  if (typeof payload?.token !== "string" || !payload.token.trim()) {
    throw new Error("Wrangler OAuth credential is unavailable");
  }
  return payload.token.trim();
}

function readWranglerOAuthToken() {
  let output;
  try {
    output = execFileSync(
      process.execPath,
      [wranglerEntryPath, "auth", "token", "--json"],
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
  } catch {
    throw new Error("Wrangler OAuth credential could not be retrieved");
  }
  return parseWranglerAuthToken(output);
}

function scriptSettingsUrl(accountId, workerName) {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}/script-settings`;
}

async function requireSuccessfulCloudflareResponse(response, operation) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${operation} returned a non-JSON response (${response.status})`);
  }
  if (!response.ok || payload?.success !== true) {
    throw new Error(`${operation} failed (${response.status})`);
  }
  return payload.result;
}

export async function enforceProductionRedaction({ fetchImpl, accountId, workerName, token }) {
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("Production deploy credential is missing");
  }
  const url = scriptSettingsUrl(accountId, workerName);
  const patchBody = { observability: { ...REQUIRED_OBSERVABILITY } };
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };

  const patchResponse = await fetchImpl(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify(patchBody),
  });
  await requireSuccessfulCloudflareResponse(patchResponse, "Cloudflare script-settings PATCH");

  const readResponse = await fetchImpl(url, {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const settings = await requireSuccessfulCloudflareResponse(
    readResponse,
    "Cloudflare script-settings read-back",
  );
  const observability = settings?.observability;
  if (
    observability?.enabled !== REQUIRED_OBSERVABILITY.enabled
    || observability?.head_sampling_rate !== REQUIRED_OBSERVABILITY.head_sampling_rate
    || observability?.redact_query_string !== REQUIRED_OBSERVABILITY.redact_query_string
  ) {
    throw new Error("Cloudflare script-settings read-back did not match the required observability settings");
  }
  return observability;
}

function runNodeCli(entryPath, args, token) {
  execFileSync(process.execPath, [entryPath, ...args], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CLOUDFLARE_API_TOKEN: token,
      NO_COLOR: "1",
      WRANGLER_SEND_METRICS: "false",
    },
    stdio: "inherit",
  });
}

export async function main() {
  const envFileContents = existsSync(deployTokenPath)
    ? readFileSync(deployTokenPath, "utf8")
    : null;
  const useWranglerOAuth = process.argv.includes("--wrangler-oauth");
  const explicitDeployToken = process.env.CLOUDFLARE_DEPLOY_API_TOKEN
    || (useWranglerOAuth ? readWranglerOAuthToken() : null);
  const token = resolveDeployToken({
    workersCi: process.env.WORKERS_CI,
    ciToken: process.env.CLOUDFLARE_API_TOKEN,
    explicitDeployToken,
    envFileContents,
  });
  if (!token) {
    throw new Error(
      "Production deploy credential is absent. Use CLOUDFLARE_DEPLOY_API_TOKEN locally or the Workers Builds deployment token in CI.",
    );
  }

  const config = JSON.parse(readFileSync(wranglerConfigPath, "utf8"));
  const accountId = config.account_id;
  const workerName = config.name;
  if (typeof accountId !== "string" || typeof workerName !== "string") {
    throw new Error("wrangler.jsonc must contain account_id and name");
  }

  const redactionOnly = process.argv.includes("--redaction-only");
  if (!redactionOnly) {
    process.stdout.write("Applying reviewed production D1 migrations...\n");
    runNodeCli(
      wranglerEntryPath,
      ["d1", "migrations", "apply", "DB", "--remote", "--config", wranglerConfigPath],
      token,
    );
    process.stdout.write("Publishing the reviewed Worker build...\n");
    runNodeCli(vinextCloudflareEntryPath, ["deploy"], token);
  }
  process.stdout.write("Restoring and verifying query-string redaction...\n");
  await enforceProductionRedaction({
    fetchImpl: fetch,
    accountId,
    workerName,
    token,
  });
  process.stdout.write(
    redactionOnly
      ? "Query-string redaction restored and verified.\n"
      : "Production deployment completed with query-string redaction verified.\n",
  );
}

const invokedAsScript = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedAsScript) {
  main().catch((error) => {
    process.stderr.write(`Production deployment failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
