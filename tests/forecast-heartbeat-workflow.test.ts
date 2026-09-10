import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../.github/workflows/forecast-heartbeat.yml", import.meta.url),
  "utf8",
);

describe("production forecast heartbeat workflow", () => {
  it("runs after each six-hour forecast Cron and verifies the latest due MFWAM ingestion slot", () => {
    expect(workflow).toContain('cron: "35 */6 * * *"');
    expect(workflow).toContain("${BASE_URL}/api/v1/forecast-collection-status");
    expect(workflow).toContain("curl --fail --silent --show-error --max-time 20");
    expect(workflow).toContain("jq -e 'select([.checkedAt, .near.slotAt, .near.completedAt, .far.slotAt, .far.completedAt]");
    expect(workflow).toContain('all(type == "string" and length > 0)');
    expect(workflow).not.toContain("/api/v1/matches");
    expect(workflow).not.toContain("issued_epoch");
    expect(workflow).not.toContain("age_seconds > 14400");
    expect(workflow).not.toContain("✅MFWAM 最新批次：%s");
    expect(workflow).not.toContain("✅ 彼日浪影氣象資料已更新");
  });

  it("keeps independent failure alerts while daily reports own success notifications", () => {
    expect(workflow).toContain("LINE_MESSAGING_CHANNEL_ACCESS_TOKEN");
    expect(workflow).toContain("OPS_LINE_USER_ID");
    expect(workflow).not.toContain("✅MFWAM 最新批次：%s");
    expect(workflow).toContain("🚨MFWAM 最新批次未確認");
    expect(workflow).toContain("if: ${{ always() && needs.check.result == 'failure' }}");
    expect(workflow).not.toContain("run_url");
    expect(workflow).not.toContain("github.run_id");
    expect(workflow).toContain("https://api.line.me/v2/bot/message/push");
    expect(workflow).not.toContain("actions/checkout");
  });
});
