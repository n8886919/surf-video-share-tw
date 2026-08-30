import { describe, expect, it } from "vitest";
import { mergeSpotOrder, moveSpotId, spotReorderTarget } from "../app/spot-order";

describe("find-view spot order", () => {
  it("keeps only known unique saved IDs and appends new choices", () => {
    expect(mergeSpotOrder(
      ["wushi", "double-lions", "test-1"],
      ["test-1", "removed", "wushi", "test-1"],
    )).toEqual(["test-1", "wushi", "double-lions"]);
  });

  it("moves a long-pressed choice without losing any choice", () => {
    expect(moveSpotId(
      ["wushi", "double-lions", "test-1", "test-2"],
      "test-2",
      "double-lions",
    )).toEqual(["wushi", "test-2", "double-lions", "test-1"]);
  });

  it("waits until the pointer crosses the adjacent midpoint plus hysteresis", () => {
    const order = ["wushi", "double-lions", "test-1"];
    const positions = [
      { id: "wushi", centerX: 50 },
      { id: "double-lions", centerX: 120 },
      { id: "test-1", centerX: 190 },
    ];
    expect(spotReorderTarget(order, "wushi", 127, 1, positions)).toBeNull();
    expect(spotReorderTarget(order, "wushi", 128, 1, positions)).toBe("double-lions");
  });

  it("moves only toward the pointer direction and only one neighbor at a time", () => {
    const order = ["wushi", "double-lions", "test-1", "test-2"];
    const positions = order.map((id, index) => ({ id, centerX: 50 + index * 70 }));
    expect(spotReorderTarget(order, "double-lions", 300, 1, positions)).toBe("test-1");
    expect(spotReorderTarget(order, "double-lions", 300, -1, positions)).toBeNull();
    expect(spotReorderTarget(order, "double-lions", 0, -1, positions)).toBe("wushi");
  });

  it("does not oscillate at the old boundary after one rightward swap", () => {
    const afterSwap = ["double-lions", "wushi", "test-1"];
    const positions = [
      { id: "double-lions", centerX: 50 },
      { id: "wushi", centerX: 120 },
      { id: "test-1", centerX: 190 },
    ];
    expect(spotReorderTarget(afterSwap, "wushi", 132, 1, positions)).toBeNull();
    expect(spotReorderTarget(afterSwap, "wushi", 132, -1, positions)).toBeNull();
  });
});
