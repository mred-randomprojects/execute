import { beforeEach, describe, expect, it } from "vitest";
import {
  addChild,
  addTaskAfter,
  createProject,
  getState,
  indent,
  initStore,
  moveBefore,
  renameProject,
  setText,
  undo,
} from "./store";
import type { Task, TaskId } from "../types";

// Placement (rank + movedAt) is written at the store's one choke point. These
// check it from the outside: through the same mutations the app calls.

const tick = () => new Promise((r) => setTimeout(r, 3));

function find(id: TaskId, tasks: Task[] = getState().tasks): Task {
  for (const t of tasks) {
    if (t.id === id) return t;
    const hit = t.children.length > 0 ? tryFind(id, t.children) : null;
    if (hit != null) return hit;
  }
  throw new Error(`no task ${id}`);
}
function tryFind(id: TaskId, tasks: Task[]): Task | null {
  try {
    return find(id, tasks);
  } catch {
    return null;
  }
}
const ranksOf = (tasks: Task[]) => tasks.map((t) => t.rank);
const increasing = (xs: string[]) => xs.every((x, i) => x !== "" && (i === 0 || xs[i - 1] < x));

beforeEach(async () => {
  localStorage.clear();
  await initStore();
});

describe("placement at the choke point", () => {
  it("ranks every new task in order", () => {
    const a = addTaskAfter(null, "a");
    const b = addTaskAfter(a, "b");
    addTaskAfter(b, "c");
    expect(increasing(ranksOf(getState().tasks))).toBe(true);
  });

  it("a move re-ranks and stamps only the task that moved", async () => {
    const a = addTaskAfter(null, "a");
    const b = addTaskAfter(a, "b");
    const c = addTaskAfter(b, "c");
    const before = { a: find(a), b: find(b) };
    await tick();
    moveBefore(c, a);

    expect(getState().tasks.map((t) => t.text)).toEqual(["c", "a", "b"]);
    expect(increasing(ranksOf(getState().tasks))).toBe(true);
    expect(find(a).rank).toBe(before.a.rank);
    expect(find(b).rank).toBe(before.b.rank);
    expect(find(a).movedAt).toBe(before.a.movedAt);
    expect(find(c).movedAt).toBeGreaterThan(before.a.movedAt);
  });

  it("a move is not a content edit", async () => {
    const a = addTaskAfter(null, "a");
    const b = addTaskAfter(a, "b");
    const updatedAt = find(b).updatedAt;
    await tick();
    moveBefore(b, a);
    expect(find(b).updatedAt).toBe(updatedAt);
  });

  it("re-parenting stamps the move", async () => {
    const a = addTaskAfter(null, "a");
    const b = addTaskAfter(a, "b");
    const was = find(b).movedAt;
    await tick();
    indent(b);
    expect(find(a).children.map((t) => t.id)).toEqual([b]);
    expect(find(b).movedAt).toBeGreaterThan(was);
  });

  it("an edit leaves placement alone", async () => {
    const a = addTaskAfter(null, "a");
    const { rank, movedAt } = find(a);
    await tick();
    setText(a, "renamed");
    expect(find(a).rank).toBe(rank);
    expect(find(a).movedAt).toBe(movedAt);
  });

  it("undoing a move restores the old order, stamped as a new move", async () => {
    const a = addTaskAfter(null, "a");
    const b = addTaskAfter(a, "b");
    const original = find(b).rank;
    await tick();
    moveBefore(b, a);
    const movedAt = find(b).movedAt;
    await tick();
    undo();

    expect(getState().tasks.map((t) => t.text)).toEqual(["a", "b"]);
    expect(find(b).rank).toBe(original);
    // Newer than the move being undone — or the cloud's copy of that move wins.
    expect(find(b).movedAt).toBeGreaterThan(movedAt);
  });

  it("children get ranks of their own", () => {
    const p = addTaskAfter(null, "p");
    addChild(p, "x");
    addChild(p, "y");
    expect(increasing(ranksOf(find(p).children))).toBe(true);
  });
});

describe("project clocks", () => {
  it("a rename stamps updatedAt; undo stamps it again", async () => {
    const id = createProject("Work");
    const created = getState().projects.find((p) => p.id === id)?.updatedAt ?? 0;
    await tick();
    renameProject(id, "Job");
    const renamed = getState().projects.find((p) => p.id === id)?.updatedAt ?? 0;
    expect(renamed).toBeGreaterThan(created);
    await tick();
    undo();
    const project = getState().projects.find((p) => p.id === id);
    expect(project?.name).toBe("Work");
    expect(project?.updatedAt ?? 0).toBeGreaterThan(renamed);
  });
});
