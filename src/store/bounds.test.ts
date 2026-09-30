import { beforeEach, describe, expect, it } from "vitest";
import type { ISODate, Task } from "../types";
import { makeTask } from "./tasks";
import { widenStaleParents } from "./bounds";
import { leftoverLeaves } from "../selectors";
import {
  addChild,
  addTaskAfter,
  getState,
  initStore,
  keepManyForToday,
  setDevDateOverride,
  setPlannedForMany,
  setText,
  undo,
} from "./store";

const MON = "2026-09-28" as ISODate;
const TUE = "2026-09-29" as ISODate;
const WED = "2026-09-30" as ISODate;

function task(
  text: string,
  plannedFor: ISODate | null,
  children: Task[] = [],
  extra: Partial<Task> = {}
): Task {
  return { ...makeTask(text), plannedFor, children, ...extra };
}

const dateOf = (tasks: Task[], text: string): ISODate | null | undefined => {
  for (const t of tasks) {
    if (t.text === text) return t.plannedFor;
    const hit = dateOf(t.children, text);
    if (hit !== undefined) return hit;
  }
  return undefined;
};

describe("widenStaleParents", () => {
  // "Today" is Wednesday throughout: MON/TUE are days that have gone.
  const repair = (tasks: Task[]) => widenStaleParents(tasks, WED);

  it("moves a parent stranded behind its open child out to the child's day", () => {
    // The shape the Reckoning leaves behind: the subtask got carried to today,
    // the parent stayed on the day that's gone (it isn't a leaf, so it never
    // reckons — and nothing else in the app would ever move it again).
    const out = repair([task("Ship it", MON, [task("Write it", WED)])]);
    expect(dateOf(out, "Ship it")).toBe(WED);
    expect(dateOf(out, "Write it")).toBe(WED);
  });

  it("leaves a parent that already covers its children alone, object identity and all", () => {
    const tasks = [task("Ship it", MON, [task("Write it", MON)])];
    expect(repair(tasks)).toBe(tasks);
  });

  it("is idempotent", () => {
    const once = repair([task("Ship it", MON, [task("Write it", WED)])]);
    expect(repair(once)).toBe(once);
  });

  it("never touches a parent still in the future — an explicit choice stays made", () => {
    // "Just this task" on a parent, moved earlier than a subtask you meant to
    // leave where it is. Enforcing the bound here would silently undo it.
    const tasks = [task("Ship it", WED, [task("Write it", "2026-10-09" as ISODate)])];
    expect(repair(tasks)).toBe(tasks);
  });

  it("ignores a completed or won't-do child — finished business can't drag a parent", () => {
    const out = repair([
      task("Ship it", MON, [
        task("Done late", WED, [], { completed: true, completedAt: Date.now() }),
        task("Skipped late", WED, [], { wontDo: { reason: "", at: Date.now() } }),
      ]),
    ]);
    expect(dateOf(out, "Ship it")).toBe(MON);
  });

  it("still covers a blocked child — waiting isn't finished", () => {
    const out = repair([
      task("Ship it", MON, [
        task("Their review", WED, [], { waitingOn: { who: "Ana", since: Date.now() } }),
      ]),
    ]);
    expect(dateOf(out, "Ship it")).toBe(WED);
  });

  it("leaves an undated container undated — it never invents a commitment", () => {
    const out = repair([task("Ship it", null, [task("Write it", WED)])]);
    expect(dateOf(out, "Ship it")).toBeNull();
  });

  it("ignores a fuzzy horizon: there is no date to compare, and none to invent", () => {
    const out = repair([
      task("Ship it", MON, [
        task("Someday bit", null, [], { horizon: { unit: "someday", anchor: null } }),
      ]),
    ]);
    expect(dateOf(out, "Ship it")).toBe(MON);
  });

  it("carries a deep child's date all the way up, one level at a time", () => {
    const out = repair([task("Epic", MON, [task("Story", TUE, [task("Step", WED)])])]);
    expect(dateOf(out, "Epic")).toBe(WED);
    expect(dateOf(out, "Story")).toBe(WED);
  });

  it("takes the latest open child, not the first", () => {
    const out = repair([
      task("Ship it", MON, [task("A", TUE), task("B", WED), task("C", MON)]),
    ]);
    expect(dateOf(out, "Ship it")).toBe(WED);
  });

  it("keeps siblings it didn't have to touch identical", () => {
    const untouched = task("Fine", MON, [task("kid", MON)]);
    const out = repair([untouched, task("Stranded", MON, [task("late", WED)])]);
    expect(out[0]).toBe(untouched);
  });
});

// ─── Through the store, on the path that actually created the bug ────

describe("the Reckoning can no longer strand a parent in the past", () => {
  beforeEach(async () => {
    localStorage.clear();
    await initStore();
  });

  it("carries the parent along when its only subtask is kept for today", () => {
    setDevDateOverride(TUE);
    const parent = addTaskAfter(null, "Ship it", TUE);
    const child = addChild(parent, "Write it", TUE);
    setPlannedForMany([parent, child], TUE); // the "Subtasks too" cascade

    // Next morning. The gate offers leaves only — the parent isn't one, so
    // before the bound it simply stayed on Tuesday for good.
    setDevDateOverride(WED);
    const leftovers = leftoverLeaves(getState().tasks, WED);
    expect(leftovers.map((t) => t.id)).toEqual([child]);
    keepManyForToday(leftovers.map((t) => t.id));

    expect(dateOf(getState().tasks, "Write it")).toBe(WED);
    expect(dateOf(getState().tasks, "Ship it")).toBe(WED);
  });

  it("repairs a parent that went stale overnight, on the next write of any kind", () => {
    // The shutdown's shape: the subtask was carried to tomorrow, the parent
    // stayed on today. Nothing is wrong yet — and then the day turns over.
    setDevDateOverride(TUE);
    const parent = addTaskAfter(null, "Ship it", TUE);
    const child = addChild(parent, "Write it", TUE);
    setPlannedForMany([parent, child], TUE);
    setPlannedForMany([child], WED);
    expect(dateOf(getState().tasks, "Ship it")).toBe(TUE); // still the future

    setDevDateOverride(WED);
    setText(child, "Write it up"); // any write at all, incl. the day's own bookkeeping
    expect(dateOf(getState().tasks, "Ship it")).toBe(WED);
  });

  it("undo still restores the parent exactly as it was", () => {
    setDevDateOverride(TUE);
    const parent = addTaskAfter(null, "Ship it", TUE);
    const child = addChild(parent, "Write it", TUE);
    setPlannedForMany([parent, child], TUE);

    setDevDateOverride(WED);
    keepManyForToday([child]);
    expect(dateOf(getState().tasks, "Ship it")).toBe(WED);

    undo();
    expect(dateOf(getState().tasks, "Write it")).toBe(TUE);
    expect(dateOf(getState().tasks, "Ship it")).toBe(TUE);
  });
});
