import { describe, expect, it } from "vitest";
import { setCompleted, setHabitNote, updateTask } from "./intents";
import { makeTask } from "../store/tasks";
import type { Habit, HabitId, ProjectId, Task } from "../types";

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

  it("moving a task that came due counts it, like the desktop: today is a keep, elsewhere a postponement", () => {
    const today = "2026-10-23";
    const late = [task({ plannedFor: "2026-10-21" })];
    const [kept] = updateTask(late, late[0].id, { plannedFor: today }, today);
    expect(kept).toMatchObject({ plannedFor: today, carriedCount: 1, postponedCount: 0 });
    const [later] = updateTask(late, late[0].id, { plannedFor: "2026-10-30" }, today);
    expect(later).toMatchObject({ carriedCount: 0, postponedCount: 1 });
    const [undated] = updateTask(late, late[0].id, { plannedFor: null }, today);
    expect(undated.postponedCount).toBe(1);

    // Never came due, already done, or a rename: nothing counted.
    const fresh = [task({ plannedFor: "2026-10-25" })];
    expect(updateTask(fresh, fresh[0].id, { plannedFor: "2026-10-28" }, today)[0].postponedCount).toBe(0);
    const done = [task({ plannedFor: "2026-10-21", completed: true })];
    expect(updateTask(done, done[0].id, { plannedFor: "2026-10-28" }, today)[0].postponedCount).toBe(0);
    expect(updateTask(late, late[0].id, { text: "renamed" }, today)[0].postponedCount).toBe(0);
    // A retry on the already-moved task is a no-op, so it can't count twice.
    const moved = updateTask(late, late[0].id, { plannedFor: "2026-10-30" }, today);
    expect(updateTask(moved, moved[0].id, { plannedFor: "2026-10-30" }, today)).toBe(moved);
  });

  it("a habit note is stamped on its day alone, and re-applying it changes nothing", () => {
    const h: Habit = {
      id: "h" as HabitId, name: "Veggies", cue: "", perWeek: 7, checks: {}, checkedAt: {}, measure: null,
      values: {}, notes: {}, archivedAt: null, rank: 0, createdAt: 1, updatedAt: 1,
    };
    const noted = setHabitNote([h], h.id, "2026-10-23", "  Steamed broccoli! ", 500);
    expect(noted[0].notes).toEqual({ "2026-10-23": "Steamed broccoli!" });
    expect(noted[0].checkedAt["2026-10-23"]).toBe(500);
    expect(noted[0].updatedAt).toBe(1);
    expect(setHabitNote(noted, h.id, "2026-10-23", "Steamed broccoli!", 600)).toBe(noted);
  });
});
