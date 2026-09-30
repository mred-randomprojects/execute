import { describe, it, expect } from "vitest";
import type { OutlineId, TaskId } from "../types";
import type { Selection } from "./selection";
import {
  emptySelection,
  moveSelection,
  nearestSurvivor,
  rangeTo,
  selectAfterRemoving,
  selectAll,
  selectOne,
  toggleSelected,
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

describe("toggleSelected (⌘-click)", () => {
  it("adds a non-adjacent row for a discontiguous selection", () => {
    const s = toggleSelected(selectOne(id("a"), visible), id("c"), visible);
    expect(s.selectedIds).toEqual(ids("a", "c"));
    expect(s.focusedId).toBe("c");
  });
  it("removes a row that is already selected", () => {
    const start = toggleSelected(selectOne(id("a"), visible), id("c"), visible); // [a, c]
    const s = toggleSelected(start, id("a"), visible);
    expect(s.selectedIds).toEqual(ids("c"));
  });
  it("empties when the last selected row is toggled off", () => {
    expect(toggleSelected(selectOne(id("b"), visible), id("b"), visible)).toEqual(emptySelection);
  });
  it("keeps the selection in visible order regardless of click order", () => {
    const s = toggleSelected(selectOne(id("d"), visible), id("b"), visible);
    expect(s.selectedIds).toEqual(ids("b", "d"));
  });
});

describe("rangeTo (⇧-click)", () => {
  it("selects the contiguous range from the anchor forward", () => {
    const s = rangeTo(selectOne(id("b"), visible), id("d"), visible);
    expect(s.selectedIds).toEqual(ids("b", "c", "d"));
    expect(s.focusedId).toBe("d");
  });
  it("selects backwards too", () => {
    const s = rangeTo(selectOne(id("c"), visible), id("a"), visible);
    expect(s.selectedIds).toEqual(ids("a", "b", "c"));
  });
});

describe("selectAll (⌘a)", () => {
  // A view holding two projects: a/b under one header, c/d under the next.
  const rows = ids("pA", "a", "b", "pB", "c", "d");
  const one = ids("a", "b");
  const every = ids("a", "b", "c", "d");

  /** The App's ⌘a: repeated presses, carrying the ring the way App.tsx does. */
  function presses(
    start: Selection,
    times: number,
    visibleRows = rows,
    scoped = one,
    all = every
  ): Selection {
    let sel = start;
    let ring: readonly OutlineId[] | null = null;
    for (let i = 0; i < times; i++) {
      sel = selectAll(sel, visibleRows, scoped, all, ring);
      ring = sel.selectedIds;
    }
    return sel;
  }

  it("takes the focused row's project first, leaving the headers out", () => {
    const s = presses(selectOne(id("a"), rows), 1);
    expect(s.selectedIds).toEqual(one);
    expect(s.focusedId).toBe("a");
  });

  it("widens to every project on the second press", () => {
    const s = presses(selectOne(id("a"), rows), 2);
    expect(s.selectedIds).toEqual(every);
    // Focus stays put, so a third press can scope back to the same project.
    expect(s.focusedId).toBe("a");
  });

  it("cycles back to the project, so over-shooting costs one keystroke", () => {
    expect(presses(selectOne(id("a"), rows), 3).selectedIds).toEqual(one);
  });

  it("gives a one-task project its own ring before widening", () => {
    // The whole project is already selected the moment the cursor lands on it;
    // the ring must still take two presses to reach the other projects.
    const solo = ids("a");
    expect(presses(selectOne(id("a"), rows), 1, rows, solo).selectedIds).toEqual(solo);
    expect(presses(selectOne(id("a"), rows), 2, rows, solo).selectedIds).toEqual(every);
  });

  it("does not widen when something else moved the selection in between", () => {
    const first = selectAll(selectOne(id("a"), rows), rows, one, every, null);
    const moved = moveSelection(first, rows, "down", false); // an ↑/↓ in between
    const again = selectAll(moved, rows, one, every, first.selectedIds);
    expect(again.selectedIds).toEqual(one);
  });

  it("goes straight to everything when the cursor has no project", () => {
    expect(presses(selectOne(id("a"), rows), 1, rows, []).selectedIds).toEqual(every);
  });

  it("is a no-op in a view with no task rows at all", () => {
    const projectsOnly = ids("pA", "pB");
    const start = selectOne(id("pA"), projectsOnly);
    expect(selectAll(start, projectsOnly, [], [], null)).toBe(start);
  });

  it("ignores rows that are no longer visible", () => {
    // `b` was filtered out between renders; it must not come back in the set.
    const shrunk = ids("pA", "a", "pB", "c", "d");
    expect(presses(selectOne(id("a"), shrunk), 1, shrunk).selectedIds).toEqual(ids("a"));
  });
});
