import { describe, expect, it, vi } from "vitest";
import {
  deploymentCliEnvironment,
  enforceProductionRedaction,
  parseWranglerAuthToken,
  REQUIRED_OBSERVABILITY,
  resolveDeployToken,
} from "../ops/deploy-production.mjs";

function cloudflareResponse(result: unknown, status = 200): Response {
  return Response.json(
    { success: status >= 200 && status < 300, result },
    { status },
  );
}

describe("production deployment safeguard", () => {
  it("lets Wrangler use its stored OAuth session for CLI subprocesses", () => {
    expect(deploymentCliEnvironment({ CLOUDFLARE_API_TOKEN: "stale" }, null))
      .not.toHaveProperty("CLOUDFLARE_API_TOKEN");
    expect(deploymentCliEnvironment({}, "explicit-token"))
      .toMatchObject({ CLOUDFLARE_API_TOKEN: "explicit-token" });
  });

  it("uses only an explicit deploy credential locally", () => {
    expect(resolveDeployToken({
      workersCi: undefined,
      ciToken: "inherited-readonly-token",
      explicitDeployToken: "deploy-token",
      envFileContents: null,
    })).toBe("deploy-token");
    expect(resolveDeployToken({
      workersCi: undefined,
      ciToken: "inherited-readonly-token",
      explicitDeployToken: "",
      envFileContents: "CLOUDFLARE_DEPLOY_API_TOKEN=file-deploy-token\n",
    })).toBe("file-deploy-token");
    expect(resolveDeployToken({
      workersCi: undefined,
      ciToken: "inherited-readonly-token",
      explicitDeployToken: "",
      envFileContents: null,
    })).toBeNull();
  });

  it("accepts the Workers Builds deployment credential only inside Workers CI", () => {
    expect(resolveDeployToken({
      workersCi: "1",
      ciToken: "workers-build-token",
      explicitDeployToken: "",
      envFileContents: null,
    })).toBe("workers-build-token");
  });

  it("parses Wrangler's machine-readable OAuth credential without logging it", () => {
    expect(parseWranglerAuthToken(JSON.stringify({ type: "oauth", token: "oauth-token" })))
      .toBe("oauth-token");
    expect(() => parseWranglerAuthToken(JSON.stringify({ type: "oauth" })))
      .toThrow("Wrangler OAuth credential is unavailable");
    expect(() => parseWranglerAuthToken("not-json"))
      .toThrow("Wrangler OAuth credential returned invalid JSON");
  });

  it("PATCHes the complete observability payload and verifies it with a GET", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(cloudflareResponse({ observability: REQUIRED_OBSERVABILITY }))
      .mockResolvedValueOnce(cloudflareResponse({ observability: REQUIRED_OBSERVABILITY }));

    await expect(enforceProductionRedaction({
      fetchImpl: fetchMock,
      accountId: "account-id",
      workerName: "worker-name",
      token: "write-token",
    })).resolves.toEqual(REQUIRED_OBSERVABILITY);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account-id/workers/scripts/worker-name/script-settings",
    );
    expect(init).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ observability: REQUIRED_OBSERVABILITY }),
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "GET", cache: "no-store" });
  });

  it("fails closed when the PATCH is rejected without exposing the credential", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(cloudflareResponse(null, 403));

    const error = await enforceProductionRedaction({
      fetchImpl: fetchMock,
      accountId: "account-id",
      workerName: "worker-name",
      token: "must-not-appear",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("Cloudflare script-settings PATCH failed (403)");
    expect(String(error)).not.toContain("must-not-appear");
  });

  it.each([
    { enabled: true, head_sampling_rate: 1, redact_query_string: false },
    { enabled: true, head_sampling_rate: 1 },
  ])("fails closed when read-back is not the required setting", async (observability) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(cloudflareResponse({ observability: REQUIRED_OBSERVABILITY }))
      .mockResolvedValueOnce(cloudflareResponse({ observability }));

    await expect(enforceProductionRedaction({
      fetchImpl: fetchMock,
      accountId: "account-id",
      workerName: "worker-name",
      token: "write-token",
    })).rejects.toThrow("did not match the required observability settings");
  });

  it("fails before any request when the write credential is missing", async () => {
    const fetchMock = vi.fn();
    await expect(enforceProductionRedaction({
      fetchImpl: fetchMock,
      accountId: "account-id",
      workerName: "worker-name",
      token: "",
    })).rejects.toThrow("Production deploy credential is missing");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
