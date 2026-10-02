import { describe, it, expect, beforeEach } from "vitest";
import {
  canUndo,
  createHabit,
  deleteHabit,
  getState,
  initStore,
  markHabit,
  renameHabit,
  setHabitPerWeek,
  toggleHabitDone,
  toggleHabitSkip,
  undo,
} from "./store";
import { mergeStates } from "../sync/merge";
import { asRaw, fromDocs, toDocs } from "../sync/docs";
import { jsonEqual } from "../sync/merge";
import type { AppState, HabitId } from "../types";

// Habits through the store and the merge: undoable, tombstoned on delete, and
// never anywhere near the task tree the Reckoning reads.

const tick = () => new Promise((r) => setTimeout(r, 3));

async function freshStore(): Promise<void> {
  localStorage.clear();
  window.execute = {
    isElectron: true,
    loadStore: () => Promise.resolve({}),
    saveStore: () => Promise.resolve(true),
  };
  await initStore();
  while (canUndo()) undo();
}

const habitOf = (s: AppState, id: HabitId) => s.habits.find((h) => h.id === id);

beforeEach(freshStore);

describe("habits in the store", () => {
  it("creates, renames, retargets and marks — none of it touching tasks", () => {
    const id = createHabit("Meditate");
    renameHabit(id, "  Meditate 10 min ");
    setHabitPerWeek(id, 12);
    toggleHabitDone(id, "2026-10-01");
    toggleHabitSkip(id, "2026-10-02");
    const h = habitOf(getState(), id);
    expect(h?.name).toBe("Meditate 10 min");
    expect(h?.perWeek).toBe(7);
    expect(h?.checks).toEqual({ "2026-10-01": "done", "2026-10-02": "skip" });
    expect(getState().tasks).toEqual([]);
    toggleHabitDone(id, "2026-10-01");
    expect(habitOf(getState(), id)?.checks).toEqual({ "2026-10-02": "skip" });
  });

  it("names each change in the history, and undo reverses it with a newer stamp", async () => {
    const id = createHabit("Run");
    await tick();
    const before = habitOf(getState(), id);
    markHabit(id, "2026-10-01", "done");
    expect(getState().actionLog[0].label).toBe("Check in “Run” · 2026-10-01");
    await tick();
    const marked = habitOf(getState(), id);
    undo();
    const undone = habitOf(getState(), id);
    expect(undone?.checks).toEqual({});
    // Past the marked version, or the cloud's copy of the check-in would win.
    expect(undone?.updatedAt ?? 0).toBeGreaterThan(marked?.updatedAt ?? 0);
    expect(before?.checks).toEqual({});
  });

  it("a no-op mark leaves no history line", () => {
    const id = createHabit("Run");
    const lines = getState().actionLog.length;
    markHabit(id, "2026-10-01", null);
    expect(getState().actionLog.length).toBe(lines);
  });

  it("deleting tombstones the habit, so another device's copy doesn't graft it back", async () => {
    const id = createHabit("Stretch");
    markHabit(id, "2026-10-01", "done");
    const elsewhere = getState(); // the other device still has it
    await tick();
    deleteHabit(id);
    const here = getState();
    expect(here.tombstones.some((t) => t.id === id)).toBe(true);
    expect(mergeStates(here, elsewhere).habits).toEqual([]);
    expect(mergeStates(elsewhere, here).habits).toEqual([]);
  });

  it("merge: the newer copy of a habit wins, either way round", async () => {
    const id = createHabit("Read");
    const older = getState();
    await tick();
    markHabit(id, "2026-10-01", "done");
    const newer = getState();
    expect(habitOf(mergeStates(older, newer), id)?.checks).toEqual({ "2026-10-01": "done" });
    expect(habitOf(mergeStates(newer, older), id)?.checks).toEqual({ "2026-10-01": "done" });
  });

  it("merge: habits only one side has are kept, in one canonical order", async () => {
    createHabit("A");
    const onlyA = getState();
    await tick();
    await freshStore();
    createHabit("B");
    const onlyB = getState();
    const ab = mergeStates(onlyA, onlyB).habits.map((h) => h.name);
    const ba = mergeStates(onlyB, onlyA).habits.map((h) => h.name);
    expect(ab).toEqual(["A", "B"]);
    expect(ba).toEqual(ab);
  });

  it("reads back from cloud documents exactly", () => {
    const id = createHabit("Journal", 5);
    markHabit(id, "2026-10-01", "done");
    const s = getState();
    expect(jsonEqual(fromDocs(asRaw(toDocs(s)), s).habits, s.habits)).toBe(true);
  });
});
