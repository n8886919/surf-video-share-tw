import { describe, expect, it } from "vitest";
import {
  PUBLIC_MEDIA_NOTICE,
  PUBLIC_MEDIA_TERMS_VERSION,
  PUBLIC_MEDIA_THIRD_PARTY_RIGHTS_NOTICE,
} from "../packages/domain/src/public-terms";

describe("public media terms", () => {
  it("sets the agreed main-subject and third-party-rights boundaries", () => {
    expect(PUBLIC_MEDIA_TERMS_VERSION).toBe("cc0-1.0-2026-08-30");
    expect(PUBLIC_MEDIA_NOTICE).toContain("若可辨識的人物是主要拍攝對象");
    expect(PUBLIC_MEDIA_NOTICE).toContain("未成年人監護人的同意");
    expect(PUBLIC_MEDIA_THIRD_PARTY_RIGHTS_NOTICE).toContain("不影響畫面中第三人的肖像、隱私及其他權利");
  });
});
