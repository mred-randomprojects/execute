import { describe, it, expect } from "vitest";
import type { AppState, Task, TaskId } from "../types";
import { DEFAULT_PROJECT_ID } from "../types";
import { jsonEqual, mergeStates } from "./merge";

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id: id as TaskId,
    projectId: DEFAULT_PROJECT_ID,
    text: id,
    notes: "",
    completed: false,
    completedAt: null,
    wontDo: null,
    children: [],
    createdAt: 0,
    updatedAt: 1,
    priority: 4,
    plannedFor: null,
    horizon: null,
    labels: [],
    estimatedMinutes: null,
    carriedCount: 0,
    recurrenceId: null,
    occurrenceDate: null,
    scheduledAt: null,
    ...over,
  };
}

function state(over: Partial<AppState> = {}): AppState {
  return {
    schemaVersion: 7,
    projects: [],
    tasks: [],
    recurrences: [],
    trash: [],
    log: [],
    theme: "slate",
    currentTaskId: null,
    lastOpenedDate: null,
    devDateOverride: null,
    dailyCapacityBlocks: 12,
    boardPreferred: false,
    commandUsage: {},
    ...over,
  };
}

const byId = (s: AppState, id: string) => s.tasks.find((t) => t.id === id);

describe("mergeStates", () => {
  it("keeps concurrent edits to DIFFERENT tasks from both sides", () => {
    const local = state({ tasks: [task("a", { text: "oat milk", updatedAt: 10 }), task("b", { updatedAt: 1 })] });
    const remote = state({ tasks: [task("a", { text: "milk", updatedAt: 1 }), task("b", { completed: true, updatedAt: 12 })] });
    const m = mergeStates(local, remote);
    expect(byId(m, "a")?.text).toBe("oat milk"); // local edit newer
    expect(byId(m, "b")?.completed).toBe(true); // remote edit newer
  });

  it("same task, same field: newest updatedAt wins (either direction)", () => {
    const local = state({ tasks: [task("a", { text: "L", updatedAt: 5 })] });
    expect(mergeStates(local, state({ tasks: [task("a", { text: "R", updatedAt: 9 })] })).tasks[0].text).toBe("R");
    expect(mergeStates(local, state({ tasks: [task("a", { text: "R", updatedAt: 2 })] })).tasks[0].text).toBe("L");
  });

  it("unions labels and takes the max carriedCount", () => {
    const local = state({ tasks: [task("a", { labels: ["x"], carriedCount: 2, updatedAt: 1 })] });
    const remote = state({ tasks: [task("a", { labels: ["y"], carriedCount: 5, updatedAt: 9 })] });
    const t = mergeStates(local, remote).tasks[0];
    expect([...t.labels].sort()).toEqual(["x", "y"]);
    expect(t.carriedCount).toBe(5);
  });

  it("remote delete newer than local edit removes the task (no zombie)", () => {
    const local = state({ tasks: [task("a", { updatedAt: 5 })] });
    const remote = state({ trash: [{ task: task("a", { updatedAt: 5 }), deletedAt: 9 }] });
    const m = mergeStates(local, remote);
    expect(byId(m, "a")).toBeUndefined();
    expect(m.trash.some((e) => e.task.id === "a")).toBe(true);
  });

  it("local edit newer than remote delete keeps the task alive (resurrect)", () => {
    const local = state({ tasks: [task("a", { updatedAt: 20 })] });
    const remote = state({ trash: [{ task: task("a"), deletedAt: 10 }] });
    const m = mergeStates(local, remote);
    expect(byId(m, "a")).toBeDefined();
    expect(m.trash.some((e) => e.task.id === "a")).toBe(false);
  });

  it("carries over remote-only top-level tasks (adds aren't lost)", () => {
    const local = state({ tasks: [task("a")] });
    const remote = state({ tasks: [task("a"), task("z", { text: "new" })] });
    const m = mergeStates(local, remote);
    expect(m.tasks.map((t) => t.id).sort()).toEqual(["a", "z"]);
  });

  it("keeps LOCAL structure and merges child content by id", () => {
    const local = state({ tasks: [task("p", { updatedAt: 1, children: [task("c", { text: "child", updatedAt: 1 })] })] });
    const remote = state({ tasks: [task("p", { updatedAt: 1, children: [task("c", { text: "CHILD", updatedAt: 9 })] })] });
    const m = mergeStates(local, remote);
    expect(m.tasks[0].children[0].text).toBe("CHILD"); // remote child edit newer
  });

  it("grafts a remote-only NESTED add under its existing parent (no loss)", () => {
    // The website adds a child under a task the desktop already has.
    const local = state({ tasks: [task("p")] });
    const remote = state({ tasks: [task("p", { children: [task("c", { text: "new child" })] })] });
    const m = mergeStates(local, remote);
    expect(m.tasks.map((t) => t.id)).toEqual(["p"]);
    expect(m.tasks[0].children.map((t) => t.id)).toEqual(["c"]);
  });

  it("grafts a deep remote-only subtree (grandchild) under its surviving parent", () => {
    const local = state({ tasks: [task("p")] });
    const remote = state({
      tasks: [task("p", { children: [task("c", { children: [task("g", { text: "deep" })] })] })],
    });
    const m = mergeStates(local, remote);
    expect(m.tasks[0].children[0].id).toBe("c");
    expect(m.tasks[0].children[0].children[0].id).toBe("g");
  });

  it("keeps a remote-only add whose local parent gained a separate local child", () => {
    // Both sides added a different child under the same parent → keep both.
    const local = state({ tasks: [task("p", { children: [task("cl", { text: "local child" })] })] });
    const remote = state({ tasks: [task("p", { children: [task("cr", { text: "remote child" })] })] });
    const m = mergeStates(local, remote);
    expect(m.tasks[0].children.map((t) => t.id).sort()).toEqual(["cl", "cr"]);
  });

  it("does NOT resurrect a remote-only child of a task deleted locally (delete wins)", () => {
    const local = state({ trash: [{ task: task("p", { updatedAt: 1 }), deletedAt: 9 }] });
    const remote = state({ tasks: [task("p", { updatedAt: 1, children: [task("c")] })] });
    const m = mergeStates(local, remote);
    expect(m.tasks).toEqual([]);
  });

  it("converges: re-merging the result against the same remote is a no-op (no push↔pull loop)", () => {
    const local = state({
      tasks: [task("p", { text: "L", updatedAt: 10, children: [task("cl")] }), task("only-local")],
      log: [
        { id: "l1", taskId: "p" as TaskId, taskText: "p", action: "completed", reason: null, at: 5, date: "2026-07-13" },
        { id: "l2", taskId: "p" as TaskId, taskText: "p", action: "kept", reason: null, at: 9, date: "2026-07-13" },
      ],
    });
    const remote = state({
      tasks: [task("p", { text: "R", updatedAt: 2, children: [task("cr", { text: "remote nested" })] }), task("only-remote")],
    });
    const merged = mergeStates(local, remote);
    // A second pass with the already-merged state as the writer must not change
    // anything — otherwise every remote snapshot would keep re-adopting/pushing.
    expect(jsonEqual(mergeStates(merged, remote), merged)).toBe(true);
  });
});

describe("jsonEqual", () => {
  it("compares nested structures deeply and order-sensitively for arrays", () => {
    expect(jsonEqual({ a: [1, { b: 2 }], c: null }, { a: [1, { b: 2 }], c: null })).toBe(true);
    expect(jsonEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(jsonEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(jsonEqual(null, {})).toBe(false);
    expect(jsonEqual({ a: undefined }, {})).toBe(false); // key present vs absent
  });
});
