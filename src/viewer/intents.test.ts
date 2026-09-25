import { describe, expect, it } from "vitest";
import { setCompleted, updateTask } from "./intents";
import { makeTask } from "../store/tasks";
import type { ProjectId, Task } from "../types";

const task = (over: Partial<Task> = {}): Task => ({ ...makeTask("t"), updatedAt: 100, ...over });

describe("phone edit intents", () => {
  it("are idempotent: applying one that's already true changes nothing", () => {
    const tasks = [task({ plannedFor: "2026-09-25" })];
    expect(updateTask(tasks, tasks[0].id, { plannedFor: "2026-09-25" })).toBe(tasks);
    const done = [task({ completed: true })];
    expect(setCompleted(done, done[0].id, true)).toEqual(done);
  });

  it("stamp past the version they edit, even one from a clock that runs ahead", () => {
    const future = Date.now() + 3_600_000;
    const tasks = [task({ updatedAt: future })];
    const [edited] = updateTask(tasks, tasks[0].id, { text: "renamed" });
    expect(edited.text).toBe("renamed");
    expect(edited.updatedAt).toBeGreaterThan(future);
  });

  it("a concrete day clears a fuzzy horizon", () => {
    const tasks = [task({ horizon: { unit: "someday", anchor: null } })];
    const [edited] = updateTask(tasks, tasks[0].id, { plannedFor: "2026-10-01" });
    expect(edited.plannedFor).toBe("2026-10-01");
    expect(edited.horizon).toBeNull();
  });

  it("moving a task to a project moves — and stamps — its whole subtree", () => {
    const child = task({ id: "c" as Task["id"], updatedAt: 50 });
    const tasks = [task({ children: [child] })];
    const [edited] = updateTask(tasks, tasks[0].id, { projectId: "life" as ProjectId });
    expect(edited.projectId).toBe("life");
    expect(edited.children[0].projectId).toBe("life");
    expect(edited.children[0].updatedAt).toBeGreaterThan(50);
  });
});
