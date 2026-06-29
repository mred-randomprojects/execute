import { describe, it, expect } from "vitest";
import type { TaskId } from "../types";
import {
  emptySelection,
  moveSelection,
  nearestSurvivor,
  selectAfterRemoving,
  selectOne,
} from "./selection";

const ids = (...xs: string[]) => xs as TaskId[];
const id = (x: string) => x as TaskId;

const visible = ids("a", "b", "c", "d");

describe("nearestSurvivor", () => {
  it("lands on the row above the one that left the view", () => {
    // c was focused and got planned away → cursor should sit on b, so ↓ goes to d.
    expect(nearestSurvivor(visible, ids("a", "b", "d"), id("c"))).toBe("b");
  });

  it("falls to the row below when the first row leaves", () => {
    expect(nearestSurvivor(visible, ids("b", "c", "d"), id("a"))).toBe("b");
  });

  it("skips outward to the row above when the immediate neighbor also left", () => {
    // from d, the row above (c) is also gone → skip out to b.
    expect(nearestSurvivor(visible, ids("a", "b"), id("d"))).toBe("b");
  });

  it("prefers the row above on a tie, else the nearer survivor", () => {
    // from c, b (above) and d (below) are equidistant → above wins…
    expect(nearestSurvivor(visible, ids("a", "b", "d"), id("c"))).toBe("b");
    // …but a nearer survivor below beats a farther one above.
    expect(nearestSurvivor(visible, ids("a", "d"), id("c"))).toBe("d");
  });

  it("returns the top for an unrelated new list (e.g. a view switch)", () => {
    expect(nearestSurvivor(visible, ids("x", "y"), id("c"))).toBe("x");
  });

  it("returns null when nothing is left", () => {
    expect(nearestSurvivor(visible, ids(), id("c"))).toBeNull();
  });
});

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
