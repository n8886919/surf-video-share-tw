import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../.github/workflows/forecast-heartbeat.yml", import.meta.url),
  "utf8",
);

describe("production forecast heartbeat workflow", () => {
  it("runs after each six-hour forecast Cron and verifies the latest due MFWAM ingestion slot", () => {
    expect(workflow).toContain('cron: "35 */6 * * *"');
    expect(workflow).toContain("/api/v1/matches?spotId=${spot_id}&targetTime=${encoded_target}");
    expect(workflow).toContain('.model == "meteofrance_wave"');
    expect(workflow).toContain("six_hours_seconds=21600");
    expect(workflow).toContain("ingestion_minute_offset_seconds=1200");
    expect(workflow).toContain("ingestion_grace_seconds=900");
    expect(workflow).toContain("issued_epoch < expected_slot_epoch - 300");
    expect(workflow).not.toContain("age_seconds > 14400");
    expect(workflow).toContain("✅MFWAM 最新批次：%s");
    expect(workflow).not.toContain("✅ 彼日浪影氣象資料已更新");
  });

  it("uses the independently configured LINE path for both success and failure", () => {
    expect(workflow).toContain("LINE_MESSAGING_CHANNEL_ACCESS_TOKEN");
    expect(workflow).toContain("OPS_LINE_USER_ID");
    expect(workflow).toContain("✅MFWAM 最新批次：%s");
    expect(workflow).toContain("🚨MFWAM 最新批次未確認");
    expect(workflow).not.toContain("run_url");
    expect(workflow).not.toContain("github.run_id");
    expect(workflow).toContain("https://api.line.me/v2/bot/message/push");
    expect(workflow).not.toContain("actions/checkout");
  });
});
