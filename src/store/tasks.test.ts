import { describe, it, expect } from "vitest";
import {
  findById,
  findParentId,
  mapById,
  removeById,
  arrayMove,
  moveSibling,
  getAncestorPath,
  countAll,
  flattenVisible,
  relocateTask,
  relocateAsChild,
  indentTask,
  indentUnder,
  outdentTask,
  leavesWhere,
  countPending,
  reorderSelected,
  reorderSelectedAcrossProjects,
} from "./tasks";
import type { Project, ProjectId, Task, TaskId } from "../types";
import { DEFAULT_PROJECT_ID } from "../types";

function task(id: string, children: Task[] = [], overrides: Partial<Task> = {}): Task {
  return {
    id: id as TaskId,
    projectId: DEFAULT_PROJECT_ID,
    text: id,
    notes: "",
    completed: false,
    completedAt: null,
    children,
    createdAt: 0,
    priority: 4,
    plannedFor: null,
    horizon: null,
    labels: [],
    estimatedMinutes: null,
    ...overrides,
  };
}

const id = (s: string) => s as TaskId;
const projectId = (s: string) => s as ProjectId;
const projects: Project[] = [
  { id: projectId("work"), name: "Work", color: "#2f4b8f", createdAt: 0 },
  { id: projectId("home"), name: "Home", color: "#8c4b2f", createdAt: 0 },
];

/** Render a tree as nested ids, e.g. "a[b,c[d]]" — handy for asserting shape. */
function shape(tasks: Task[]): string {
  return tasks
    .map((t) => (t.children.length ? `${t.id}[${shape(t.children)}]` : t.id))
    .join(",");
}

describe("findById / findParentId", () => {
  const tree = [task("a", [task("b"), task("c", [task("d")])])];
  it("finds nested", () => {
    expect(findById(tree, id("d"))?.id).toBe("d");
    expect(findById(tree, id("x"))).toBeUndefined();
  });
  it("finds the parent id", () => {
    expect(findParentId(tree, id("d"))).toBe("c");
    expect(findParentId(tree, id("a"))).toBeNull();
  });
});

describe("mapById / removeById", () => {
  it("updates only the matching node immutably", () => {
    const tree = [task("a", [task("b")])];
    const next = mapById(tree, id("b"), (t) => ({ ...t, text: "changed" }));
    expect(findById(next, id("b"))?.text).toBe("changed");
    expect(tree[0].children[0].text).toBe("b"); // original untouched
  });
  it("removes a node and its descendants", () => {
    const tree = [task("a", [task("b", [task("c")])])];
    expect(shape(removeById(tree, id("b")))).toBe("a");
  });
});

describe("arrayMove", () => {
  it("moves items", () => {
    expect(arrayMove([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
  });
});

describe("moveSibling", () => {
  it("reorders within the same parent only", () => {
    const tree = [task("a"), task("b"), task("c")];
    expect(shape(moveSibling(tree, id("c"), id("a")))).toBe("c,a,b");
  });
  it("refuses to move across parents", () => {
    const tree = [task("a", [task("b")]), task("c")];
    expect(shape(moveSibling(tree, id("b"), id("c")))).toBe("a[b],c");
  });
});

describe("getAncestorPath", () => {
  it("returns the path from root to target", () => {
    const tree = [task("a", [task("b", [task("c")])])];
    expect(getAncestorPath(tree, id("c")).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
});

describe("countAll / countPending", () => {
  it("counts descendants and completion", () => {
    const tree = task("root", [
      task("a", [task("b", [], { completed: true })]),
      task("c", [], { completed: true }),
    ]);
    expect(countAll(tree)).toEqual({ done: 2, total: 3 });
  });
  it("countPending counts incomplete across the forest", () => {
    const forest = [task("a", [task("b", [], { completed: true })]), task("c")];
    expect(countPending(forest)).toBe(2); // a, c
  });
});

describe("flattenVisible", () => {
  it("respects collapsed nodes", () => {
    const tree = [task("a", [task("b")]), task("c")];
    expect(flattenVisible(tree, new Set())).toEqual(["a", "b", "c"]);
    expect(flattenVisible(tree, new Set([id("a")]))).toEqual(["a", "c"]);
  });
});

describe("relocateTask / relocateAsChild", () => {
  it("moves a task before another across parents", () => {
    const tree = [task("a", [task("b")]), task("c")];
    expect(shape(relocateTask(tree, id("b"), id("c")))).toBe("a,b,c");
  });
  it("refuses to move a task into its own subtree", () => {
    const tree = [task("a", [task("b")])];
    expect(shape(relocateAsChild(tree, id("a"), id("b")))).toBe("a[b]");
  });
  it("nests a task as first child", () => {
    const tree = [task("a"), task("b")];
    expect(shape(relocateAsChild(tree, id("b"), id("a")))).toBe("a[b]");
  });
});

describe("indentTask", () => {
  it("nests under previous sibling", () => {
    const tree = [task("a"), task("b")];
    expect(shape(indentTask(tree, id("b")))).toBe("a[b]");
  });
  it("no-op without a previous sibling", () => {
    const tree = [task("a"), task("b")];
    expect(shape(indentTask(tree, id("a")))).toBe("a,b");
  });
  it("indents nested items and keeps their children", () => {
    const tree = [task("p", [task("a"), task("b", [task("c")])])];
    expect(shape(indentTask(tree, id("b")))).toBe("p[a[b[c]]]");
  });
});

describe("indentUnder", () => {
  it("nests under a chosen earlier sibling, skipping the one in between", () => {
    // The middle sibling is what the view is hiding; indent must reach past it.
    const tree = [task("a"), task("hidden"), task("c")];
    expect(shape(indentUnder(tree, id("c"), id("a")))).toBe("a[c],hidden");
  });
  it("appends as the last child, preserving the parent's children", () => {
    const tree = [task("a", [task("x")]), task("b")];
    expect(shape(indentUnder(tree, id("b"), id("a")))).toBe("a[x,b]");
  });
  it("no-op when the target isn't an earlier sibling", () => {
    const tree = [task("a"), task("b")];
    expect(shape(indentUnder(tree, id("a"), id("b")))).toBe("a,b"); // b is after a
    expect(shape(indentUnder(tree, id("b"), id("missing")))).toBe("a,b");
  });
  it("works on nested siblings", () => {
    const tree = [task("p", [task("a"), task("mid"), task("c")])];
    expect(shape(indentUnder(tree, id("c"), id("a")))).toBe("p[a[c],mid]");
  });
});

describe("outdentTask", () => {
  it("lifts a child to be the parent's next sibling", () => {
    const tree = [task("a", [task("b")]), task("c")];
    expect(shape(outdentTask(tree, id("b")))).toBe("a,b,c");
  });
  it("no-op for a top-level task", () => {
    const tree = [task("a"), task("b")];
    expect(shape(outdentTask(tree, id("a")))).toBe("a,b");
  });
  it("indent then outdent is identity for shape", () => {
    const tree = [task("a"), task("b")];
    const indented = indentTask(tree, id("b"));
    expect(shape(outdentTask(indented, id("b")))).toBe("a,b");
  });
});

describe("reorderSelected", () => {
  const sel = (...ids: string[]) => new Set(ids.map(id));
  it("moves a single task up among siblings", () => {
    const tree = [task("a"), task("b"), task("c")];
    expect(shape(reorderSelected(tree, sel("c"), "up"))).toBe("a,c,b");
  });
  it("moves a contiguous block down together", () => {
    const tree = [task("a"), task("b"), task("c"), task("d")];
    expect(shape(reorderSelected(tree, sel("a", "b"), "down"))).toBe("c,a,b,d");
  });
  it("reorders within the correct parent only", () => {
    const tree = [task("p", [task("x"), task("y")]), task("q")];
    expect(shape(reorderSelected(tree, sel("y"), "up"))).toBe("p[y,x],q");
  });
  it("is a no-op at the boundary", () => {
    const tree = [task("a"), task("b")];
    expect(shape(reorderSelected(tree, sel("a"), "up"))).toBe("a,b");
  });
});

describe("reorderSelectedAcrossProjects", () => {
  const sel = (...ids: string[]) => new Set(ids.map(id));

  it("reorders root tasks inside one project", () => {
    const tree = [
      task("a", [], { projectId: projectId("work") }),
      task("b", [], { projectId: projectId("work") }),
      task("c", [], { projectId: projectId("home") }),
    ];
    const next = reorderSelectedAcrossProjects(tree, sel("b"), "up", projects);
    expect(next.map((t) => t.id)).toEqual(["b", "a", "c"]);
    expect(next[0].projectId).toBe(projectId("work"));
  });

  it("moves a root task into the previous project at the divider boundary", () => {
    const tree = [
      task("a", [], { projectId: projectId("work") }),
      task("b", [], { projectId: projectId("home") }),
      task("c", [], { projectId: projectId("home") }),
    ];
    const next = reorderSelectedAcrossProjects(tree, sel("b"), "up", projects);
    expect(next.map((t) => `${t.id}:${t.projectId}`)).toEqual([
      "a:work",
      "b:work",
      "c:home",
    ]);
  });

  it("moves a root task into the next project at the divider boundary", () => {
    const tree = [
      task("a", [], { projectId: projectId("work") }),
      task("b", [], { projectId: projectId("home") }),
    ];
    const next = reorderSelectedAcrossProjects(tree, sel("a"), "down", projects);
    expect(next.map((t) => `${t.id}:${t.projectId}`)).toEqual([
      "a:home",
      "b:home",
    ]);
  });
});

describe("leavesWhere", () => {
  it("returns only matching leaves in order", () => {
    const tree = [
      task("a", [task("a1", [], { plannedFor: "2026-06-17" })]),
      task("b", [], { plannedFor: "2026-06-17" }),
      task("c", [], { plannedFor: "2026-06-18" }),
    ];
    const today = leavesWhere(tree, (t) => t.plannedFor === "2026-06-17");
    expect(today.map((t) => t.id)).toEqual(["a1", "b"]);
  });
});
