import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addChild,
  addTaskAfter,
  adoptRemote,
  canUndo,
  createHabit,
  createProject,
  createRecurrence,
  deleteHabit,
  deleteRecurrence,
  getState,
  getUndoSteps,
  initStore,
  markHabit,
  moveAsChild,
  purgeFromTrash,
  renameProject,
  restoreBackup,
  restoreFromTrash,
  setHabitNote,
  setNotes,
  setText,
  toggleComplete,
  trashTask,
  undo,
  emptyTrash,
} from "./store";
import { restoreOnto } from "./restore";
import { defaultRule } from "./recurrence";
import { mergeStates } from "../sync/merge";
import { findById } from "./tasks";
import { coerceState } from "./persistence";
import { emptyState, type AppState, type TaskId } from "../types";

// Restoring a daily backup: everything the backup holds goes back to how it was
// then, anything newer stays, and the result is stamped so the merge (and so
// the cloud) takes it as the newest change instead of deleting it again.

let clock = Date.UTC(2026, 9, 18, 9, 0, 0);
function tick(ms = 1000): void {
  clock += ms;
  vi.setSystemTime(clock);
}
/** A backup as it comes off the disk: JSON, read back through the loader. */
const snapshot = (): AppState => coerceState(JSON.parse(JSON.stringify(getState())));
const task = (id: TaskId) => findById(getState().tasks, id);
const inTrash = (id: TaskId) => getState().trash.some((e) => e.task.id === id);
const tombstoned = (id: string) => getState().tombstones.some((t) => t.id === id);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
  delete window.execute;
  localStorage.clear();
  await initStore();
  while (canUndo()) undo();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("restoring a backup", () => {
  it("brings back a task deleted since, where it was, under its parent", () => {
    const parent = addTaskAfter(null, "move flat");
    const child = addChild(parent, "pack the kitchen");
    tick();
    const backup = snapshot();
    tick();
    trashTask(child);
    tick();
    purgeFromTrash(child); // gone for good: only a tombstone left
    expect(task(child)).toBeUndefined();
    expect(tombstoned(child)).toBe(true);

    tick();
    expect(restoreBackup(backup, "Restore the backup of Oct 18")).toBe(true);
    expect(task(child)?.text).toBe("pack the kitchen");
    expect(task(parent)?.children.map((t) => t.id)).toEqual([child]);
    expect(tombstoned(child)).toBe(false);
  });

  it("puts the backup's fields back on a task edited since, and keeps what was added since", () => {
    const a = addTaskAfter(null, "pay rent");
    tick();
    const backup = snapshot();
    tick();
    setText(a, "pay rent (overwritten)");
    setNotes(a, "junk");
    toggleComplete(a);
    const added = addTaskAfter(a, "captured after the backup");
    tick();
    restoreBackup(backup, "Restore");
    expect(task(a)).toMatchObject({ text: "pay rent", notes: "", completed: false });
    expect(task(added)?.text).toBe("captured after the backup");
  });

  it("stamps what it puts back past the cloud's copy, so the next merge keeps it", () => {
    const a = addTaskAfter(null, "pay rent");
    const gone = addTaskAfter(a, "call the bank");
    tick();
    const backup = snapshot();
    tick();
    setText(a, "overwritten");
    trashTask(gone);
    tick();
    purgeFromTrash(gone);
    const cloud = JSON.parse(JSON.stringify(getState())) as AppState; // what the cloud has now
    tick();
    restoreBackup(backup, "Restore");
    const merged = mergeStates(getState(), cloud);
    expect(findById(merged.tasks, a)?.text).toBe("pay rent");
    expect(findById(merged.tasks, gone)?.text).toBe("call the bank");
    expect(merged.tombstones.some((t) => t.id === gone)).toBe(false);
  });

  it("outlives a deletion record dated in the future", () => {
    const a = addTaskAfter(null, "pay rent");
    tick();
    const backup = snapshot();
    const cloud: AppState = {
      ...JSON.parse(JSON.stringify(getState())),
      tasks: [],
      tombstones: [{ id: a, deletedAt: clock + 365 * 86_400_000, purged: false }],
    };
    adoptRemote(mergeStates(getState(), cloud)); // the planted record arrives, and wins
    expect(task(a)).toBeUndefined();
    tick();
    restoreBackup(backup, "Restore");
    expect(task(a)?.text).toBe("pay rent");
    expect(findById(mergeStates(getState(), cloud).tasks, a)?.text).toBe("pay rent");
  });

  it("the Trash: what was in it goes back, what was live comes out, what was deleted forever stays deleted", () => {
    const wasTrashed = addTaskAfter(null, "old idea");
    const wasLive = addTaskAfter(wasTrashed, "file taxes");
    const purgedLater = addTaskAfter(wasLive, "spam");
    trashTask(wasTrashed);
    trashTask(purgedLater);
    tick();
    const backup = snapshot();
    tick();
    restoreFromTrash(wasTrashed); // back in the tree since
    trashTask(wasLive); // in the Trash since
    tick();
    emptyTrash(); // deletes purgedLater (and wasLive) for good
    tick();
    restoreBackup(backup, "Restore");
    expect(inTrash(wasTrashed)).toBe(true);
    expect(task(wasTrashed)).toBeUndefined();
    expect(task(wasLive)?.text).toBe("file taxes");
    expect(inTrash(purgedLater)).toBe(false);
    expect(task(purgedLater)).toBeUndefined();
  });

  it("never leaves a task both live and inside a Trash entry", () => {
    const c = addTaskAfter(null, "pack the kitchen");
    tick();
    const backup = snapshot();
    tick();
    const p = addTaskAfter(c, "move flat"); // created after the backup…
    moveAsChild(c, p); // …with the backup's task moved under it…
    tick();
    trashTask(p); // …and trashed with it
    expect(task(c)).toBeUndefined();
    tick();
    restoreBackup(backup, "Restore");
    expect(task(c)?.text).toBe("pack the kitchen");
    const entry = getState().trash.find((e) => e.task.id === p);
    expect(entry?.task.children.map((t) => t.id) ?? []).not.toContain(c);
    const ids: string[] = [];
    const walk = (list: AppState["tasks"]) => list.forEach((t) => (ids.push(t.id), walk(t.children)));
    walk(getState().tasks);
    getState().trash.forEach((e) => walk([e.task]));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("habits: the backup's days come back, days logged since stay, a deleted habit returns", () => {
    const run = createHabit("Run", 3);
    const read = createHabit("Read", 7);
    markHabit(run, "2026-10-16", "done");
    setHabitNote(run, "2026-10-16", "5k");
    markHabit(read, "2026-10-16", "done");
    tick();
    const backup = snapshot();
    tick();
    markHabit(run, "2026-10-16", null); // undone by mistake
    markHabit(run, "2026-10-19", "done"); // logged since
    deleteHabit(read);
    tick();
    restoreBackup(backup, "Restore");
    const runNow = getState().habits.find((h) => h.id === run);
    expect(runNow?.checks).toEqual({ "2026-10-16": "done", "2026-10-19": "done" });
    expect(runNow?.notes).toEqual({ "2026-10-16": "5k" });
    expect(getState().habits.find((h) => h.id === read)?.checks).toEqual({ "2026-10-16": "done" });
    expect(tombstoned(read)).toBe(false);
  });

  it("projects and recurrences: renamed back, deleted ones return, new ones stay", () => {
    const p = createProject("Home");
    const r = createRecurrence("water plants", defaultRule("2026-10-01")).id;
    tick();
    const backup = snapshot();
    tick();
    renameProject(p, "Hoem");
    const newer = createProject("Work");
    deleteRecurrence(r);
    expect(getState().recurrences.some((x) => x.id === r)).toBe(false);
    tick();
    restoreBackup(backup, "Restore");
    expect(getState().projects.find((x) => x.id === p)?.name).toBe("Home");
    expect(getState().projects.some((x) => x.id === newer)).toBe(true);
    expect(getState().recurrences.some((x) => x.id === r)).toBe(true);
  });

  it("is one step: ⌘z takes it all back", () => {
    const a = addTaskAfter(null, "pay rent");
    tick();
    const backup = snapshot();
    tick();
    setText(a, "overwritten");
    trashTask(a);
    tick();
    restoreBackup(backup, "Restore the backup of Oct 18");
    expect(getUndoSteps()[0].label).toBe("Restore the backup of Oct 18");
    expect(task(a)?.text).toBe("pay rent");
    tick();
    undo();
    expect(task(a)).toBeUndefined();
    expect(inTrash(a)).toBe(true); // back in the Trash, as it was before the restore
  });

  it("changes nothing, and says so, when the backup matches", () => {
    addTaskAfter(null, "pay rent");
    tick();
    const backup = snapshot();
    const before = getState();
    expect(restoreBackup(backup, "Restore")).toBe(false);
    expect(getState()).toBe(before);
  });

  it("a backup that isn't a store, or is empty, takes nothing away", () => {
    const a = addTaskAfter(null, "pay rent");
    createHabit("Run", 3);
    tick();
    const before = getState();
    expect(restoreBackup(coerceState({ hello: "world" }), "Restore")).toBe(false);
    expect(restoreBackup(emptyState(), "Restore")).toBe(false);
    expect(getState()).toBe(before);
    expect(task(a)?.text).toBe("pay rent");
  });

  it("keeps the log and the day records written since, and gets back lines only the backup has", () => {
    const a = addTaskAfter(null, "pay rent");
    toggleComplete(a);
    tick();
    const backup = snapshot();
    const current = { ...getState(), log: [] }; // as if the log had been lost
    const restored = restoreOnto(current, backup);
    expect(restored.log.map((e) => e.id)).toEqual(backup.log.map((e) => e.id));
  });
});
