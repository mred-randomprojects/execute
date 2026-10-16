import { describe, expect, it } from "vitest";
import type { Task, TaskId } from "../types";
import { TASK_FIELD_MERGE } from "../types";
import { CLOCK_GROUPS, stampTask } from "./clocks";
import { makeTask } from "./tasks";

const t = (over: Partial<Task> = {}): Task => ({
  ...makeTask("x"),
  id: "a" as TaskId,
  updatedAt: 100,
  clocks: {},
  ...over,
});

describe("field-group clocks", () => {
  it("every clocked field belongs to exactly one group", () => {
    const grouped = CLOCK_GROUPS.flatMap(([, fields]) => fields);
    const clocked = Object.entries(TASK_FIELD_MERGE)
      .filter(([, how]) => how !== "union" && how !== "max")
      .map(([f]) => f);
    expect([...grouped].sort()).toEqual(clocked.sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("stamps only the groups that changed, and updatedAt", () => {
    const before = t({ clocks: { notes: 50 } });
    const after = stampTask(before, { ...before, text: "new", completed: true, completedAt: 1 }, 500);
    expect(after.clocks).toEqual({ notes: 50, text: 500, status: 500 });
    expect(after.updatedAt).toBe(500);
  });

  it("never stamps behind the clock it replaces (another device's may run ahead)", () => {
    const before = t({ updatedAt: 900, clocks: { text: 900 } });
    const after = stampTask(before, { ...before, text: "new" }, 500);
    expect(after.clocks.text).toBe(901);
    expect(after.updatedAt).toBe(901);
  });

  it("an unchanged task comes back as itself", () => {
    const before = t();
    expect(stampTask(before, { ...before }, 500)).toEqual(before);
    expect(stampTask(before, before, 500)).toBe(before);
  });

  it("labels and counters move updatedAt but no group clock", () => {
    const before = t();
    const after = stampTask(before, { ...before, labels: ["x"] }, 500);
    expect(after.clocks).toEqual({});
    expect(after.updatedAt).toBe(500);
  });

  it("a new task gets updatedAt and no clocks", () => {
    const fresh = t({ updatedAt: 1 });
    const stamped = stampTask(undefined, fresh, 500);
    expect(stamped.updatedAt).toBe(500);
    expect(stamped.clocks).toEqual({});
  });
});
