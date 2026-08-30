import { describe, expect, it } from "vitest";
import { mergeSpotOrder, moveSpotId } from "../app/spot-order";

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
});
