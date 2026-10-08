import { describe, it, expect, beforeEach } from "vitest";
import {
  canUndo,
  createHabit,
  deleteHabit,
  getState,
  initStore,
  markHabit,
  renameHabit,
  setHabitMeasure,
  moveHabit,
  setHabitPerWeek,
  setKpiValue,
  toggleHabitDone,
  toggleHabitSkip,
  undo,
} from "./store";
import { mergeStates } from "../sync/merge";
import { asRaw, fromDocs, toDocs } from "../sync/docs";
import { jsonEqual } from "../sync/merge";
import type { AppState, Habit, HabitId } from "../types";
import { DEFAULT_MEASURE, markStamped, moveHabitRank, valueStamped } from "./habits";

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
    // The cleared day is stamped past the check-in, or the cloud's copy of it
    // would win the merge and put the check-in straight back.
    expect(undone?.checkedAt["2026-10-01"] ?? 0).toBeGreaterThan(marked?.checkedAt["2026-10-01"] ?? 0);
    // A check-in isn't an edit of the habit itself.
    expect(marked?.updatedAt).toBe(before?.updatedAt);
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

describe("per-day check-in merge (v20)", () => {
  const base = (over: Partial<Habit> = {}): Habit => ({
    id: "hx" as HabitId,
    name: "Run",
    cue: "",
    perWeek: 7,
    checks: {},
    checkedAt: {},
    measure: null,
    values: {},
    archivedAt: null,
    rank: 0,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  });
  const withHabit = (h: Habit): AppState => ({ ...getState(), habits: [h] });
  const both = (a: Habit, b: Habit) => {
    const ab = mergeStates(withHabit(a), withHabit(b)).habits[0];
    const ba = mergeStates(withHabit(b), withHabit(a)).habits[0];
    expect(ab).toEqual(ba); // symmetric, or two devices ping-pong
    return ab;
  };

  it("two devices marking different days keep both", () => {
    const phone = markStamped(base(), "2026-10-01", "done", 100);
    const desk = markStamped(base(), "2026-10-02", "skip", 90);
    expect(both(phone, desk).checks).toEqual({ "2026-10-01": "done", "2026-10-02": "skip" });
  });

  it("the same day: the newer answer wins, a clear included", () => {
    const checked = markStamped(base(), "2026-10-01", "done", 100);
    const cleared = markStamped(checked, "2026-10-01", null, 200);
    expect(both(checked, cleared).checks).toEqual({});
    const later = markStamped(base(), "2026-10-01", "missed", 300);
    expect(both(cleared, later).checks).toEqual({ "2026-10-01": "missed" });
  });

  it("ties resolve by value, the same on both sides", () => {
    const a = markStamped(base(), "2026-10-01", "done", 100);
    const b = markStamped(base(), "2026-10-01", "skip", 100);
    expect(both(a, b).checks["2026-10-01"]).toBe("skip");
  });

  it("a rename on one device and a check-in on the other both survive", () => {
    const desk = { ...base({ name: "Run 5k" }), updatedAt: 50 };
    const phone = markStamped(base(), "2026-10-01", "done", 100);
    const merged = both(desk, phone);
    expect(merged.name).toBe("Run 5k");
    expect(merged.checks).toEqual({ "2026-10-01": "done" });
  });

  it("is a fixed point, v19 marks without stamps included", () => {
    const legacy = base({ checks: { "2026-09-30": "done" } });
    const stamped = markStamped(legacy, "2026-10-01", "done", 100);
    expect(both(stamped, stamped)).toEqual(stamped);
    expect(both(legacy, legacy)).toEqual(legacy);
    // A stamped answer outvotes an unstamped v19 one.
    const changed = markStamped(legacy, "2026-09-30", "missed", 5);
    expect(both(legacy, changed).checks["2026-09-30"]).toBe("missed");
  });

  it("a check-in after a delete brings the habit back; a delete after it doesn't", () => {
    const h = base({ updatedAt: 10 });
    const s = (habit: Habit | null, tomb: number | null): AppState => ({
      ...getState(),
      habits: habit == null ? [] : [habit],
      tombstones: tomb == null ? [] : [{ id: h.id, deletedAt: tomb, purged: false }],
    });
    const t = Date.now(); // tombstones expire, so stamps must be recent
    const checkedLate = markStamped(h, "2026-10-01", "done", t + 300);
    expect(mergeStates(s(null, t + 200), s(checkedLate, null)).habits).toHaveLength(1);
    const checkedEarly = markStamped(h, "2026-10-01", "done", t + 100);
    expect(mergeStates(s(null, t + 200), s(checkedEarly, null)).habits).toHaveLength(0);
  });
});

describe("KPIs (v21)", () => {
  const kpi = (over: Partial<Habit> = {}): Habit => ({
    id: "kx" as HabitId,
    name: "Dizzy spells",
    cue: "",
    perWeek: 7,
    checks: {},
    checkedAt: {},
    measure: { min: 0, max: 3, openTop: true, every: "day" },
    values: {},
    archivedAt: null,
    rank: 0,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  });
  const withHabit = (h: Habit): AppState => ({ ...getState(), habits: [h] });
  const both = (a: Habit, b: Habit) => {
    const ab = mergeStates(withHabit(a), withHabit(b)).habits[0];
    const ba = mergeStates(withHabit(b), withHabit(a)).habits[0];
    expect(ab).toEqual(ba);
    return ab;
  };

  it("logs, changes and clears a value — undoable, and stamped per day", async () => {
    const id = createHabit("Dizzy spells", 7, DEFAULT_MEASURE);
    await tick();
    setKpiValue(id, "2026-10-01", 2);
    const first = habitOf(getState(), id);
    expect(first?.values).toEqual({ "2026-10-01": 2 });
    expect(first?.checkedAt["2026-10-01"]).toBeGreaterThan(0);
    await tick();
    setKpiValue(id, "2026-10-01", null);
    expect(habitOf(getState(), id)?.values).toEqual({});
    undo();
    expect(habitOf(getState(), id)?.values).toEqual({ "2026-10-01": 2 });
    expect(getState().tasks).toEqual([]);
  });

  it("refuses a value on a yes/no habit, and a measure on one", () => {
    const id = createHabit("Run");
    setKpiValue(id, "2026-10-01", 3);
    setHabitMeasure(id, DEFAULT_MEASURE);
    expect(habitOf(getState(), id)?.values).toEqual({});
    expect(habitOf(getState(), id)?.measure).toBeNull();
  });

  it("changing the range stamps the habit's own fields", async () => {
    const id = createHabit("DHI", 7, DEFAULT_MEASURE);
    const before = habitOf(getState(), id)?.updatedAt ?? 0;
    await tick();
    setHabitMeasure(id, { min: 0, max: 100, openTop: false, every: "month" });
    const h = habitOf(getState(), id);
    expect(h?.measure).toEqual({ min: 0, max: 100, openTop: false, every: "month" });
    expect(h?.updatedAt).toBeGreaterThan(before);
  });

  it("merge: values on different days both survive; the same day goes to the newer", () => {
    const phone = valueStamped(kpi(), "2026-10-01", 1, 100);
    const desk = valueStamped(kpi(), "2026-10-02", 3, 90);
    expect(both(phone, desk).values).toEqual({ "2026-10-01": 1, "2026-10-02": 3 });
    const newer = valueStamped(kpi(), "2026-10-01", 0, 200);
    expect(both(phone, newer).values).toEqual({ "2026-10-01": 0 });
    const cleared = valueStamped(newer, "2026-10-01", null, 300);
    expect(both(newer, cleared).values).toEqual({});
  });

  it("merge: a range change on one device and a value on the other both survive", () => {
    const desk = { ...kpi({ measure: { min: 0, max: 10, openTop: false, every: "day" } }), updatedAt: 50 };
    const phone = valueStamped(kpi(), "2026-10-01", 2, 100);
    const merged = both(desk, phone);
    expect(merged.measure?.max).toBe(10);
    expect(merged.values).toEqual({ "2026-10-01": 2 });
  });

  it("reads back from cloud documents exactly", async () => {
    const id = createHabit("DHI", 7, { min: 0, max: 100, openTop: false, every: "month" });
    setKpiValue(id, "2026-10-01", 42);
    const s = getState();
    expect(jsonEqual(fromDocs(asRaw(toDocs(s)), s).habits, s.habits)).toBe(true);
    expect(fromDocs(asRaw(toDocs(s)), s).habits[0].values).toEqual({ "2026-10-01": 42 });
  });
});

describe("reordering (v22)", () => {

  it("moves within its own list — habits, KPIs, archive — undoably, and reads back from the cloud", async () => {
    const a = createHabit("A");
    await tick();
    createHabit("B");
    await tick();
    const k1 = createHabit("K1", 7, DEFAULT_MEASURE);
    await tick();
    createHabit("K2", 7, DEFAULT_MEASURE);
    await tick();
    const c = createHabit("C");

    moveHabit(c, -1); // past B, and past nothing in the KPIs
    const habitsOnly = () => getState().habits.filter((h) => h.measure == null).map((h) => h.name);
    const kpisOnly = () => getState().habits.filter((h) => h.measure != null).map((h) => h.name);
    expect(habitsOnly()).toEqual(["A", "C", "B"]);
    moveHabit(c, -1);
    expect(habitsOnly()).toEqual(["C", "A", "B"]);
    moveHabit(c, -1); // already first: nothing
    expect(habitsOnly()).toEqual(["C", "A", "B"]);
    moveHabit(k1, 1);
    expect(kpisOnly()).toEqual(["K2", "K1"]);
    moveHabit(a, 1);
    expect(habitsOnly()).toEqual(["C", "B", "A"]);

    undo();
    expect(habitsOnly()).toEqual(["C", "A", "B"]);
    const s = getState();
    expect(jsonEqual(fromDocs(asRaw(toDocs(s)), s).habits, s.habits)).toBe(true);
  });

  it("spreads equal ranks apart instead of getting stuck", () => {
    const a = createHabit("A");
    const b = createHabit("B");
    // Same rank (same millisecond, or an old copy): the move still lands.
    const s = getState();
    const same = s.habits.map((h) => ({ ...h, rank: 5 }));
    const order = (hs: Habit[]) => [...hs].sort((x, y) => x.rank - y.rank || x.createdAt - y.createdAt || (x.id < y.id ? -1 : 1));
    const before = order(same).map((h) => h.id);
    const moved = moveHabitRank(same, before[1], -1);
    expect(order(moved).map((h) => h.id)).toEqual([before[1], before[0]]);
    expect([a, b].sort()).toEqual([...before].sort());
  });
});
