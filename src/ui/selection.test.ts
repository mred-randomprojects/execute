import { describe, it, expect } from "vitest";
import type { TaskId } from "../types";
import {
  emptySelection,
  moveSelection,
  selectAfterRemoving,
  selectOne,
} from "./selection";

const ids = (...xs: string[]) => xs as TaskId[];
const id = (x: string) => x as TaskId;

const visible = ids("a", "b", "c", "d");

describe("selectOne", () => {
  it("selects a single visible id", () => {
    expect(selectOne(id("b"), visible)).toEqual({
      focusedId: "b",
      anchorId: "b",
      selectedIds: ["b"],
    });
  });
  it("falls back to first when id missing", () => {
    expect(selectOne(id("z"), visible).focusedId).toBe("a");
  });
});

describe("moveSelection", () => {
  it("moves focus without extending", () => {
    const s = moveSelection(selectOne(id("a"), visible), visible, "down", false);
    expect(s).toEqual({ focusedId: "b", anchorId: "b", selectedIds: ["b"] });
  });
  it("extends a range from the anchor", () => {
    let s = selectOne(id("b"), visible);
    s = moveSelection(s, visible, "down", true); // b..c
    expect(s.selectedIds).toEqual(["b", "c"]);
    s = moveSelection(s, visible, "down", true); // b..d
    expect(s.selectedIds).toEqual(["b", "c", "d"]);
    s = moveSelection(s, visible, "up", true); // back to b..c
    expect(s.selectedIds).toEqual(["b", "c"]);
  });
  it("clamps at the bottom", () => {
    const s = moveSelection(selectOne(id("d"), visible), visible, "down", false);
    expect(s.focusedId).toBe("d");
  });
});

describe("selectAfterRemoving", () => {
  it("picks a sensible neighbor after deletion", () => {
    const sel = selectOne(id("b"), visible);
    const next = selectAfterRemoving(sel, visible, new Set([id("b")]));
    expect(next.focusedId).toBe("c");
  });
  it("empties when everything is gone", () => {
    expect(selectAfterRemoving(selectOne(id("a"), visible), visible, new Set(visible))).toEqual(
      emptySelection
    );
  });
});
