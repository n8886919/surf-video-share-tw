import { describe, expect, it } from "vitest";
import {
  reduceFindQuery,
  visibleFindQuery,
  type FindQueryState,
} from "../app/surf-app";

function settledState(queryKey: string, results: string[]): FindQueryState<string[]> {
  return {
    requestId: 1,
    queryKey,
    results,
    loading: false,
    error: null,
  };
}

describe("find query result ownership", () => {
  it("hides old results without claiming a search started when the selection changes", () => {
    const state = settledState("spot-a/time-a", ["old-result"]);

    expect(visibleFindQuery(state, "spot-b/time-b", [])).toEqual({
      results: [],
      loading: false,
      error: null,
    });
  });

  it("clears prior results and errors when the latest request starts", () => {
    const previous = { ...settledState("spot-a/time-a", ["old-result"]), error: "old-error" };

    expect(reduceFindQuery(previous, {
      type: "start",
      requestId: 2,
      queryKey: "spot-b/time-b",
      emptyResults: [],
    })).toEqual({
      requestId: 2,
      queryKey: "spot-b/time-b",
      results: [],
      loading: true,
      error: null,
    });
  });

  it("ignores stale success and failure responses after a rapid query switch", () => {
    const current = reduceFindQuery(settledState("spot-a/time-a", ["old-result"]), {
      type: "start",
      requestId: 2,
      queryKey: "spot-b/time-b",
      emptyResults: [],
    });

    expect(reduceFindQuery(current, {
      type: "success",
      requestId: 1,
      queryKey: "spot-a/time-a",
      results: ["stale-success"],
    })).toBe(current);
    expect(reduceFindQuery(current, {
      type: "failure",
      requestId: 1,
      queryKey: "spot-a/time-a",
      error: "stale-error",
    })).toBe(current);
  });

  it("uses request identity when the user leaves and returns to the same query", () => {
    const revisited = reduceFindQuery(settledState("spot-a/time-a", ["old-result"]), {
      type: "start",
      requestId: 3,
      queryKey: "spot-a/time-a",
      emptyResults: [],
    });

    expect(reduceFindQuery(revisited, {
      type: "success",
      requestId: 1,
      queryKey: "spot-a/time-a",
      results: ["first-request-result"],
    })).toBe(revisited);
    expect(reduceFindQuery(revisited, {
      type: "success",
      requestId: 3,
      queryKey: "spot-a/time-a",
      results: ["latest-result"],
    })).toMatchObject({
      results: ["latest-result"],
      loading: false,
      error: null,
    });
  });

  it("keeps a current failure empty instead of restoring old results", () => {
    const loading = reduceFindQuery(settledState("spot-a/time-a", ["old-result"]), {
      type: "start",
      requestId: 2,
      queryKey: "spot-b/time-b",
      emptyResults: [],
    });

    expect(reduceFindQuery(loading, {
      type: "failure",
      requestId: 2,
      queryKey: "spot-b/time-b",
      error: "比對失敗",
    })).toEqual({
      requestId: 2,
      queryKey: "spot-b/time-b",
      results: [],
      loading: false,
      error: "比對失敗",
    });
  });
});
