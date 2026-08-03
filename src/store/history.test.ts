import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  addTaskAfter,
  canRedo,
  canUndo,
  getRedoSteps,
  getState,
  getUndoSteps,
  initStore,
  markWontDo,
  redo,
  setCurrentTask,
  setDailyCapacityBlocks,
  setText,
  setTheme,
  toggleComplete,
  trashTask,
  undo,
  undoThrough,
} from "./store";
import { mergeStates } from "../sync/merge";
import { findById } from "./tasks";
import type { AppState, TaskId } from "../types";

// Undo, redo, and the action log. The sync assertions are the important ones:
// undo used to restore a snapshot verbatim, stale `updatedAt` and all, so the
// next cloud merge saw the undone edit as *older* than the edit it reversed and
// put it straight back. Undo has to win last-write-wins to stick.

async function freshStore(): Promise<void> {
  localStorage.clear();
  window.execute = {
    isElectron: true,
    loadStore: () => Promise.resolve({}),
    saveStore: () => Promise.resolve(true),
  };
  await initStore();
  // Drain whatever the load itself pushed, so each test starts with clean stacks.
  while (canUndo()) undo();
}

// A controlled clock, and it matters: every assertion here is about which side
// of a last-write-wins merge is *newer*. On a real machine a create and the edit
// that follows it can land in the same millisecond, which would make these tests
// pass whether or not undo re-stamps anything. `tick()` between steps is what
// makes them able to fail.
let clock = Date.UTC(2026, 7, 3, 9, 0, 0);
function tick(ms = 1000): void {
  clock += ms;
  vi.setSystemTime(clock);
}

/** What the cloud would hold after the given local state was pushed. */
const asRemote = (s: AppState): AppState => JSON.parse(JSON.stringify(s)) as AppState;

const task = (id: TaskId) => findById(getState().tasks, id);

beforeEach(async () => {
  await freshStore(); // real timers: initStore awaits real promises
  clock = Date.UTC(2026, 7, 3, 9, 0, 0);
  vi.useFakeTimers();
  vi.setSystemTime(clock);
});
afterEach(() => {
  vi.useRealTimers();
  delete window.execute;
  localStorage.clear();
});

describe("undo survives the cloud merge", () => {
  it("re-stamps an undone edit so last-write-wins keeps it undone", () => {
    const id = addTaskAfter(null, "oat milk");
    const beforeEdit = task(id)?.updatedAt ?? 0;

    tick();
    setText(id, "almond milk");
    // The edit is pushed: this is what the cloud now holds.
    const remote = asRemote(getState());
    expect(findById(remote.tasks, id)?.text).toBe("almond milk");
    expect(findById(remote.tasks, id)?.updatedAt).toBeGreaterThan(beforeEdit);

    tick();
    undo();
    expect(task(id)?.text).toBe("oat milk");
    // The restored task must be *newer* than the edit it reverses — a verbatim
    // snapshot would carry the pre-edit stamp and lose the merge.
    expect(task(id)?.updatedAt).toBeGreaterThan(
      findById(remote.tasks, id)?.updatedAt ?? 0,
    );

    const merged = mergeStates(getState(), remote);
    expect(findById(merged.tasks, id)?.text).toBe("oat milk"); // undo stuck
  });

  it("resurrects an undone trash against its own tombstone", () => {
    const id = addTaskAfter(null, "cancel the gym");
    tick();
    trashTask(id);
    const remote = asRemote(getState()); // the cloud has the tombstone
    expect(remote.trash.some((e) => e.task.id === id)).toBe(true);

    tick();
    undo();
    expect(task(id)?.text).toBe("cancel the gym");

    // A tombstone wins while `deletedAt >= updatedAt`, so the restored task has
    // to out-stamp its own deletion or the merge quietly re-deletes it.
    const merged = mergeStates(getState(), remote);
    expect(findById(merged.tasks, id)?.text).toBe("cancel the gym");
    expect(merged.trash.some((e) => e.task.id === id)).toBe(false);
  });

  it("does not clobber a task the action never touched", () => {
    const mine = addTaskAfter(null, "mine");
    const theirs = addTaskAfter(null, "theirs");
    tick();
    setText(mine, "mine, edited");

    // Another device edits the *other* task while ours sits unsynced.
    const remote = asRemote(getState());
    const remoteTheirs = findById(remote.tasks, theirs);
    if (remoteTheirs == null) throw new Error("fixture");
    remoteTheirs.text = "theirs, from the laptop";
    remoteTheirs.updatedAt = Date.now() + 1000;

    tick();
    undo(); // undoes *my* edit only

    const merged = mergeStates(getState(), remote);
    expect(findById(merged.tasks, mine)?.text).toBe("mine"); // my undo stuck
    expect(findById(merged.tasks, theirs)?.text).toBe("theirs, from the laptop");
  });
});

describe("redo", () => {
  it("replays the undone action", () => {
    const id = addTaskAfter(null, "write it down");
    toggleComplete(id);
    expect(task(id)?.completed).toBe(true);

    undo();
    expect(task(id)?.completed).toBe(false);
    expect(canRedo()).toBe(true);

    redo();
    expect(task(id)?.completed).toBe(true);
    expect(canRedo()).toBe(false);
  });

  it("re-stamps on the way forward too, so a redo also sticks", () => {
    const id = addTaskAfter(null, "ship it");
    tick();
    setText(id, "ship it twice");
    tick();
    undo();
    const remote = asRemote(getState()); // the cloud caught the undone state
    tick();
    redo();

    const merged = mergeStates(getState(), remote);
    expect(findById(merged.tasks, id)?.text).toBe("ship it twice");
  });

  it("is discarded once a new action forks the timeline", () => {
    const id = addTaskAfter(null, "a");
    setText(id, "b");
    undo();
    expect(canRedo()).toBe(true);

    setText(id, "c"); // new branch
    expect(canRedo()).toBe(false);
    expect(task(id)?.text).toBe("c");
  });

  it("walks a whole run back and forth", () => {
    const id = addTaskAfter(null, "one");
    setText(id, "two");
    setText(id, "three");

    undo();
    undo();
    expect(task(id)?.text).toBe("one");
    redo();
    redo();
    expect(task(id)?.text).toBe("three");
  });
});

describe("the action log", () => {
  it("names each change and survives being undone", () => {
    const id = addTaskAfter(null, "buy milk");
    toggleComplete(id);

    const labels = getState().actionLog.map((e) => e.label);
    expect(labels[0]).toBe("Complete “buy milk”");
    expect(labels[1]).toBe("New task “buy milk”");

    undo();
    // The log is an account of what happened, not of what survived: undoing adds
    // a line rather than removing the one it reverses.
    const after = getState().actionLog;
    expect(after[0].kind).toBe("undo");
    expect(after[0].label).toBe("Complete “buy milk”");
    expect(after.some((e) => e.kind === "do" && e.label === "Complete “buy milk”")).toBe(true);
  });

  it("gives every undoable step a line the panel can jump to", () => {
    const id = addTaskAfter(null, "a");
    setText(id, "b");

    const steps = getUndoSteps();
    const logIds = new Set(getState().actionLog.map((e) => e.id));
    expect(steps.length).toBe(2);
    for (const s of steps) expect(logIds.has(s.id)).toBe(true);
  });

  it("rewinds through a chosen step, taking everything after it", () => {
    const id = addTaskAfter(null, "one");
    setText(id, "two");
    setText(id, "three");

    // The line for "two" — one step back from the newest.
    const target = getUndoSteps()[1];
    undoThrough(target.id);
    expect(task(id)?.text).toBe("one");
    expect(getRedoSteps().length).toBe(2);
  });

  it("records nothing for a mutation that changed nothing", () => {
    const id = addTaskAfter(null, "skip me");
    markWontDo(id);
    const before = getState().actionLog.length;

    markWontDo(id); // already skipped — the transform bails
    expect(getState().actionLog.length).toBe(before);
    expect(getUndoSteps().length).toBe(2); // the add + the first skip, no phantom
  });

  it("leaves preferences out of the history entirely", () => {
    addTaskAfter(null, "real change");
    const before = getState().actionLog.length;
    const steps = getUndoSteps().length;

    // Per-device preferences are neither undoable nor worth a line, so ⌘z after
    // a theme switch still reaches the last real change.
    setTheme("carbon");
    setDailyCapacityBlocks(9);
    setCurrentTask(null);

    expect(getState().theme).toBe("carbon");
    expect(getState().actionLog.length).toBe(before);
    expect(getUndoSteps().length).toBe(steps);
  });
});
