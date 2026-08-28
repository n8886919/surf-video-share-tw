import { describe, expect, it } from "vitest";
import {
  desiredBindingNames,
  extractJson,
  pendingMigrationNames,
  resolveCloudflareToken,
  summarizeVersion,
} from "../ops/preflight-production.mjs";

describe("production preflight output", () => {
  it("parses JSON after Wrangler status lines", () => {
    expect(extractJson("status line\n[{\"name\":\"SESSION_SECRET\"}]"))
      .toEqual([{ name: "SESSION_SECRET" }]);
  });

  it("reports only local migration filenames present in the remote list", () => {
    expect(pendingMigrationNames(
      "Pending: 0003_forecast_runs.sql\n0004_video_moderation.sql",
      ["0002_existing.sql", "0003_forecast_runs.sql", "0004_video_moderation.sql"],
    )).toEqual(["0003_forecast_runs.sql", "0004_video_moderation.sql"]);
  });

  it("summarizes binding names and types without values or secret contents", () => {
    const summary = summarizeVersion({
      id: "version-id",
      metadata: { created_on: "2026-08-28T00:00:00.000Z" },
      resources: {
        script_runtime: { compatibility_date: "2026-08-24" },
        bindings: [
          { name: "APP_ENV", type: "plain_text", text: "production" },
          { name: "SESSION_SECRET", type: "secret_text", text: "must-not-appear" },
        ],
      },
    }, 100);

    expect(summary.bindings).toEqual([
      { name: "APP_ENV", type: "plain_text" },
      { name: "SESSION_SECRET", type: "secret_text" },
    ]);
    expect(JSON.stringify(summary)).not.toContain("must-not-appear");
    expect(JSON.stringify(summary)).not.toContain("production");
  });

  it("loads the ignored token file when the parent process value is blank", () => {
    expect(resolveCloudflareToken("", "CLOUDFLARE_API_TOKEN=file-token\n"))
      .toBe("file-token");
    expect(resolveCloudflareToken("process-token", "CLOUDFLARE_API_TOKEN=file-token\n"))
      .toBe("process-token");
  });

  it("derives desired binding names without reading their configured values", () => {
    expect(desiredBindingNames({
      vars: { APP_ENV: "production" },
      d1_databases: [{ binding: "DB", database_id: "private-id" }],
      ratelimits: [{ name: "UPLOAD_RATE_LIMITER", namespace_id: "private-namespace" }],
    })).toEqual(["APP_ENV", "DB", "UPLOAD_RATE_LIMITER"]);
  });
});
