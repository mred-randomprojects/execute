import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  addChild,
  addTaskAfter,
  adoptRemote,
  canUndo,
  createHabit,
  createRecurrence,
  deleteHabit,
  deleteRecurrence,
  emptyTrash,
  getState,
  indent,
  initStore,
  markHabit,
  redo,
  restoreFromTrash,
  setText,
  toggleComplete,
  trashTask,
  undo,
} from "./store";
import { rebaseStep } from "./rebase";
import { defaultRule } from "./recurrence";
import { mergeStates } from "../sync/merge";
import { findById, makeTask } from "./tasks";
import { setHabitMark, updateTask } from "../viewer/intents";
import type { AppState, Task, TaskId } from "../types";

// The footprint rebase behind undo and redo (store/rebase), case by case.
// history.test.ts holds the end-user scenarios; these pin the edges.

let clock = Date.UTC(2026, 9, 16, 9, 0, 0);
function tick(ms = 1000): void {
  clock += ms;
  vi.setSystemTime(clock);
}
const asRemote = (s: AppState): AppState => JSON.parse(JSON.stringify(s)) as AppState;
const task = (id: TaskId) => findById(getState().tasks, id);
const inTrash = (id: TaskId) => getState().trash.some((e) => e.task.id === id);

function fromAnotherDevice(change: (s: AppState) => AppState): AppState {
  const cloud = asRemote(change(asRemote(getState())));
  adoptRemote(mergeStates(getState(), cloud));
  return cloud;
}

beforeEach(async () => {
  localStorage.clear();
  window.execute = { isElectron: true, loadStore: () => Promise.resolve({}), saveStore: () => Promise.resolve(true) };
  await initStore();
  while (canUndo()) undo();
  clock = Date.UTC(2026, 9, 16, 9, 0, 0);
  vi.useFakeTimers();
  vi.setSystemTime(clock);
});
afterEach(() => {
  vi.useRealTimers();
  delete window.execute;
  localStorage.clear();
});

describe("rebaseStep", () => {
  it("is the identity when the step changed nothing, or when it's already in place", () => {
    const s = getState();
    expect(rebaseStep(s, s, s)).toBe(s);
    const a = addTaskAfter(null, "a");
    const after = getState();
    // Applying "create a" forwards to a state that already has it changes nothing.
    expect(rebaseStep(s, after, after)).toBe(after);
    expect(task(a)).toBeDefined();
  });
});

describe("undo and redo, edge by edge", () => {
  it("a trashed subtree comes back whole, under its parent, in its place", () => {
    const first = addTaskAfter(null, "first");
    const parent = addTaskAfter(first, "parent");
    const kid1 = addChild(parent, "kid 1");
    const kid2 = addChild(parent, "kid 2");
    addTaskAfter(parent, "last");
    tick();
    trashTask(parent);
    tick();
    fromAnotherDevice((s) => ({ ...s, tasks: [...s.tasks, { ...makeTask("phone"), movedAt: Date.now() }] }));
    tick();
    undo();
    expect(getState().tasks.map((t) => t.text)).toEqual(["first", "parent", "last", "phone"]);
    expect(task(parent)?.children.map((c) => c.id)).toEqual([kid1, kid2]);
    expect(inTrash(parent)).toBe(false);
    for (const id of [parent, kid1, kid2]) expect(getState().tombstones.some((t) => t.id === id)).toBe(false);
  });

  it("an undone indent goes back to its old parent and place, beside another device's add", () => {
    const a = addTaskAfter(null, "a");
    const b = addTaskAfter(a, "b");
    tick();
    indent(b); // b under a
    expect(task(a)?.children.map((c) => c.id)).toEqual([b]);
    tick();
    const x = { ...makeTask("phone"), movedAt: Date.now() };
    const cloud = fromAnotherDevice((s) => ({ ...s, tasks: [...s.tasks, x] }));
    tick();
    undo();
    // b is back at the top, after a. (The phone appended its task after a too,
    // and can have handed out b's old rank: such a tie sorts by id, the same
    // way on every device.)
    const top = getState().tasks.map((t) => t.text);
    expect([...top].sort()).toEqual(["a", "b", "phone"]);
    expect(top[0]).toBe("a");
    expect(task(a)?.children).toEqual([]);
    const merged = mergeStates(getState(), cloud);
    expect(merged.tasks.map((t) => t.text)).toEqual(top); // the undone move sticks
    expect(findById(merged.tasks, a)?.children).toEqual([]);
  });

  it("an undone and redone 'Empty the trash' keeps its purge", () => {
    const a = addTaskAfter(null, "gone for good");
    tick();
    trashTask(a);
    tick();
    emptyTrash();
    expect(getState().tombstones.find((t) => t.id === a)?.purged).toBe(true);
    tick();
    undo();
    expect(inTrash(a)).toBe(true);
    expect(getState().tombstones.find((t) => t.id === a)?.purged).toBe(false);
    tick();
    redo();
    expect(inTrash(a)).toBe(false);
    expect(getState().tombstones.find((t) => t.id === a)?.purged).toBe(true);
  });

  it("undoing a restore after the phone edited the task keeps the edit, in the Trash", () => {
    const a = addTaskAfter(null, "back and forth");
    tick();
    trashTask(a);
    tick();
    restoreFromTrash(a); // the step
    tick();
    fromAnotherDevice((s) => ({ ...s, tasks: updateTask(s.tasks, a, { notes: "from the phone" }) }));
    tick();
    undo();
    expect(task(a)).toBeUndefined();
    const entry = getState().trash.find((e) => e.task.id === a);
    expect(entry?.task.notes).toBe("from the phone");
  });

  it("a task the step edited and another device deleted since stays deleted", () => {
    const a = addTaskAfter(null, "a");
    tick();
    setText(a, "a, renamed"); // the step
    tick();
    fromAnotherDevice((s) => ({
      ...s,
      tasks: s.tasks.filter((t) => t.id !== a),
      tombstones: [{ id: a, deletedAt: Date.now(), purged: false }, ...s.tombstones],
    }));
    expect(task(a)).toBeUndefined();
    tick();
    undo();
    expect(task(a)).toBeUndefined();
  });

  it("someone else's subtask under a task whose create is undone is kept, at the top", () => {
    tick();
    const p = addTaskAfter(null, "created, then undone");
    tick();
    const child: Task = { ...makeTask("added elsewhere"), movedAt: Date.now() };
    fromAnotherDevice((s) => ({
      ...s,
      tasks: s.tasks.map((t) => (t.id === p ? { ...t, children: [child] } : t)),
    }));
    expect(task(p)?.children.map((c) => c.id)).toEqual([child.id]);
    tick();
    undo();
    expect(task(p)).toBeUndefined();
    expect(getState().tasks.map((t) => t.id)).toContain(child.id);
  });

  it("a deleted habit comes back with its check-ins, and redo deletes it again", () => {
    const h = createHabit("read");
    markHabit(h, "2026-10-15", "done");
    tick();
    deleteHabit(h);
    tick();
    undo();
    const back = getState().habits.find((x) => x.id === h);
    expect(back?.checks["2026-10-15"]).toBe("done");
    expect(getState().tombstones.some((t) => t.id === h)).toBe(false);
    tick();
    redo();
    expect(getState().habits.some((x) => x.id === h)).toBe(false);
    expect(getState().tombstones.some((t) => t.id === h)).toBe(true);
  });

  it("a habit's own fields and other days survive an undone check-in", () => {
    const h = createHabit("stretch");
    tick();
    markHabit(h, "2026-10-14", "done"); // the step
    tick();
    const cloud = fromAnotherDevice((s) => ({
      ...s,
      habits: setHabitMark(
        s.habits.map((x) => (x.id === h ? { ...x, name: "stretch well", updatedAt: Date.now() } : x)),
        h,
        "2026-10-15",
        "skip",
        Date.now(),
      ),
    }));
    tick();
    undo();
    const merged = mergeStates(getState(), cloud).habits.find((x) => x.id === h);
    expect(merged?.name).toBe("stretch well");
    expect(merged?.checks["2026-10-14"]).toBeUndefined();
    expect(merged?.checks["2026-10-15"]).toBe("skip");
  });

  it("a deleted recurrence comes back and outlives its tombstone", () => {
    const { id } = createRecurrence("water plants", defaultRule("2026-10-01"));
    tick();
    deleteRecurrence(id);
    const cloud = asRemote(getState());
    tick();
    undo();
    expect(getState().recurrences.some((r) => r.id === id)).toBe(true);
    expect(mergeStates(getState(), cloud).recurrences.some((r) => r.id === id)).toBe(true);
  });

  it("the event log loses an undone step's line and gets it back in order on redo", () => {
    const a = addTaskAfter(null, "a");
    const b = addTaskAfter(a, "b");
    tick();
    toggleComplete(a);
    tick();
    toggleComplete(b);
    const lines = () => getState().log.map((e) => `${e.action} ${e.taskText}`);
    expect(lines()).toEqual(["completed b", "completed a"]);
    undo();
    undo();
    expect(lines()).toEqual([]);
    redo();
    expect(lines()).toEqual(["completed a"]);
    redo();
    expect(lines()).toEqual(["completed b", "completed a"]);
  });

  it("what comes back outlives its deletion even in the same millisecond", () => {
    const a = addTaskAfter(null, "quick");
    trashTask(a); // no tick: deleted at the very same ms the undo will run
    const cloud = asRemote(getState());
    undo();
    expect(task(a)).toBeDefined();
    const merged = mergeStates(getState(), cloud);
    expect(findById(merged.tasks, a)?.text).toBe("quick");
    expect(merged.trash.some((e) => e.task.id === a)).toBe(false);
  });
});
