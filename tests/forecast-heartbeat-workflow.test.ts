import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../.github/workflows/forecast-heartbeat.yml", import.meta.url),
  "utf8",
);

describe("production forecast heartbeat workflow", () => {
  it("runs after each six-hour forecast Cron and verifies fresh production MFWAM data", () => {
    expect(workflow).toContain('cron: "35 */6 * * *"');
    expect(workflow).toContain("/api/v1/matches?spotId=${spot_id}&targetTime=${encoded_target}");
    expect(workflow).toContain('.model == "meteofrance_wave"');
    expect(workflow).toContain("age_seconds > 14400");
    expect(workflow).toContain("Production API 驗證成功");
  });

  it("uses the independently configured LINE path for both success and failure", () => {
    expect(workflow).toContain("LINE_MESSAGING_CHANNEL_ACCESS_TOKEN");
    expect(workflow).toContain("OPS_LINE_USER_ID");
    expect(workflow).toContain("✅ 彼日浪影氣象資料已更新");
    expect(workflow).toContain("🚨 彼日浪影氣象更新未確認");
    expect(workflow).toContain("https://api.line.me/v2/bot/message/push");
    expect(workflow).not.toContain("actions/checkout");
  });
});
