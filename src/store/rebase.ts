import type {
  AppState,
  DayRecord,
  Habit,
  LogEntry,
  Project,
  Recurrence,
  Task,
  TaskId,
  Tombstone,
  TrashedTask,
} from "../types";
import { TASK_FIELD_MERGE, pruneTombstones } from "../types";
import { jsonEqual, treeFromSlots, type PlacedSlot } from "../sync/merge";
import { sortHabits } from "./habits";

// ─── Undo and redo as a change, not a snapshot ───────────────────────
//
// A history step is the pair of states around one action, `before` and
// `after`. Undo used to put `before` back whole, which also took back
// everything that had arrived from other devices since: a task captured on the
// phone was deleted (it wasn't in `before`, so it read as removed, and the next
// sync deleted it everywhere), a phone check-in was stamped back to unmarked, a
// project renamed on another device was renamed back.
//
// Now a step is applied as its FOOTPRINT — what differs between `before` and
// `after` — on top of the state as it is now. Undo moves the footprint from
// `after` back to `before`; redo moves it from `before` to `after`. Anything
// the step didn't change stays exactly as it is now, whoever changed it.
//
// The grain is the field: a task the step completed and the phone annotated
// afterwards comes back open with the phone's notes. A task's placement
// (parent and rank) moves as one; a habit's check-ins go by the day.
//
// Something the step changed that was deleted since (on another device) stays
// deleted: undo reverses this step, it doesn't revive someone else's delete.
//
// Pure, and no clocks: the store stamps the result against the current state
// at its choke point, exactly like any other change.

type HabitOwnKey = Exclude<keyof Habit, "id" | "checks" | "values" | "notes" | "checkedAt" | "createdAt" | "updatedAt">;
const HABIT_OWN: Record<HabitOwnKey, true> = {
  name: true,
  cue: true,
  perWeek: true,
  measure: true,
  archivedAt: true,
  rank: true,
};

type ProjectOwnKey = Exclude<keyof Project, "id" | "createdAt" | "updatedAt">;
const PROJECT_OWN: Record<ProjectOwnKey, true> = { name: true, color: true };

type RecurrenceOwnKey = Exclude<keyof Recurrence, "id" | "createdAt" | "updatedAt">;
const RECURRENCE_OWN: Record<RecurrenceOwnKey, true> = { template: true, rule: true };

/** The top-level fields that aren't collections: preferences, dates, the version. */
type ScalarKey = Exclude<
  keyof AppState,
  "tasks" | "trash" | "projects" | "recurrences" | "habits" | "log" | "days" | "tombstones" | "actionLog"
>;
const SCALARS: Record<ScalarKey, true> = {
  schemaVersion: true,
  theme: true,
  lastOpenedDate: true,
  devDateOverride: true,
  dailyCapacityBlocks: true,
  wrapAll: true,
  hideCompleted: true,
  commandUsage: true,
  presence: true,
};

function keysOf<K extends string>(fields: Record<K, unknown>): K[] {
  const out: K[] = [];
  for (const k in fields) out.push(k);
  return out;
}

/** A task's content fields (TASK_FIELD_MERGE lists every one of them). */
const TASK_CONTENT_KEYS = keysOf(TASK_FIELD_MERGE);
const HABIT_OWN_KEYS = keysOf(HABIT_OWN);
const PROJECT_OWN_KEYS = keysOf(PROJECT_OWN);
const RECURRENCE_OWN_KEYS = keysOf(RECURRENCE_OWN);
const SCALAR_KEYS = keysOf(SCALARS);

/**
 * `current` with every field in `keys` that differs between `from` and `to`
 * set to `to`'s value. The same object when nothing needed to change.
 */
function fieldwise<T extends object, K extends keyof T>(from: T, to: T, current: T, keys: readonly K[]): T {
  let out = current;
  for (const k of keys) {
    if (jsonEqual(from[k], to[k]) || jsonEqual(current[k], to[k])) continue;
    if (out === current) out = { ...current };
    out[k] = to[k];
  }
  return out;
}

/**
 * Apply the footprint of `from → to` to a keyed list, on top of `current`:
 * an item the step removed is removed, one it added comes back if it's gone,
 * one it changed is changed again (`change` decides how, given all three
 * versions). Everything else keeps its current version and place. An item
 * that comes back goes after its nearest earlier neighbour in `to` still
 * present, so a restored list reads in the order it had.
 */
function rebaseList<T>(
  from: readonly T[],
  to: readonly T[],
  current: T[],
  key: (x: T) => string,
  change: (f: T, t: T, c: T) => T,
  revive: (t: T) => T = (t) => t,
): T[] {
  if (from === to) return current;
  const byFrom = new Map(from.map((x) => [key(x), x]));
  const byTo = new Map(to.map((x) => [key(x), x]));
  const byCurrent = new Map(current.map((x) => [key(x), x]));
  const changes = new Map<string, T | null>();
  const back = new Set<string>();
  for (const id of new Set([...byFrom.keys(), ...byTo.keys()])) {
    const f = byFrom.get(id);
    const t = byTo.get(id);
    if (f === t || (f !== undefined && t !== undefined && jsonEqual(f, t))) continue;
    const c = byCurrent.get(id);
    if (t === undefined) {
      if (c !== undefined) changes.set(id, null);
    } else if (f === undefined) {
      if (c === undefined) back.add(id);
    } else if (c !== undefined) {
      const next = change(f, t, c);
      if (next !== c) changes.set(id, next);
    }
  }
  if (changes.size === 0 && back.size === 0) return current;
  const out: T[] = [];
  for (const x of current) {
    const ch = changes.get(key(x));
    if (ch === undefined) out.push(x);
    else if (ch !== null) out.push(ch);
  }
  if (back.size > 0) {
    const present = new Set(out.map(key));
    const toKeys = to.map(key);
    for (let i = 0; i < to.length; i++) {
      if (!back.has(toKeys[i])) continue;
      let j = i - 1;
      while (j >= 0 && !present.has(toKeys[j])) j--;
      const after = j < 0 ? -1 : out.findIndex((x) => key(x) === toKeys[j]);
      out.splice(after + 1, 0, revive(to[i]));
      present.add(toKeys[i]);
    }
  }
  return out;
}

// ─── The task tree ───────────────────────────────────────────────────

interface Slot {
  node: Task;
  parent: TaskId | null;
}

function slotsOf(tasks: readonly Task[]): Map<TaskId, Slot> {
  const m = new Map<TaskId, Slot>();
  const go = (list: readonly Task[], parent: TaskId | null) => {
    for (const t of list) {
      m.set(t.id, { node: t, parent });
      go(t.children, t.id);
    }
  };
  go(tasks, null);
  return m;
}

const placed = (node: Task, parent: TaskId | null): PlacedSlot => ({
  node: { ...node, children: [] },
  parent,
  dead: false,
});

/**
 * The footprint of `from → to` on the task tree, applied to `current`. Per task:
 * content field by field, placement (parent + rank) as a unit, and presence —
 * a task the step created goes, one it removed comes back where it was. A task
 * someone else put under one that goes is kept, at the top level.
 */
function rebaseTree(from: Task[], to: Task[], current: Task[]): Task[] {
  if (from === to) return current;
  const slotsFrom = slotsOf(from);
  const slotsTo = slotsOf(to);
  const slotsNow = slotsOf(current);
  const edits = new Map<TaskId, PlacedSlot | null>();
  for (const id of new Set([...slotsFrom.keys(), ...slotsTo.keys()])) {
    const f = slotsFrom.get(id);
    const t = slotsTo.get(id);
    if (f != null && t != null && f.node === t.node && f.parent === t.parent) continue;
    const c = slotsNow.get(id);
    if (t == null) {
      if (c != null) edits.set(id, null);
      continue;
    }
    if (f == null) {
      if (c == null) edits.set(id, placed(t.node, t.parent));
      continue;
    }
    if (c == null) continue; // deleted since, elsewhere: it stays deleted
    let node = fieldwise(f.node, t.node, c.node, TASK_CONTENT_KEYS);
    let parent = c.parent;
    const stepMoved = f.parent !== t.parent || f.node.rank !== t.node.rank;
    if (stepMoved && (c.parent !== t.parent || c.node.rank !== t.node.rank)) {
      parent = t.parent;
      node = { ...node, rank: t.node.rank };
    }
    if (node !== c.node || parent !== c.parent) edits.set(id, placed(node, parent));
  }
  if (edits.size === 0) return current;

  const slots = new Map<TaskId, PlacedSlot>();
  for (const [id, c] of slotsNow) {
    const e = edits.get(id);
    if (e === null) continue;
    slots.set(id, e ?? placed(c.node, c.parent));
  }
  for (const [id, e] of edits) if (e != null && !slotsNow.has(id)) slots.set(id, e);
  return treeFromSlots(slots);
}

/**
 * A Trash entry coming back holds what its tasks hold NOW where they're still
 * live (an undone restore, after the phone edited the restored task), so the
 * edit goes into the Trash with it instead of being lost.
 */
function withLiveContent(entry: TrashedTask, live: ReadonlyMap<TaskId, Slot>): TrashedTask {
  const refresh = (t: Task): Task => {
    const now = live.get(t.id)?.node;
    const children = t.children.map(refresh);
    const own = now == null ? t : { ...now, rank: t.rank, movedAt: t.movedAt };
    return { ...own, children };
  };
  return { ...entry, task: refresh(entry.task) };
}

// ─── The whole state ─────────────────────────────────────────────────

/**
 * `current` with the footprint of `from → to` applied: undo is
 * `rebaseStep(after, before, now)`, redo `rebaseStep(before, after, now)`.
 * Returns `current` itself when the footprint is already in place.
 */
export function rebaseStep(from: AppState, to: AppState, current: AppState): AppState {
  if (from === to) return current;
  const tasks = rebaseTree(from.tasks, to.tasks, current.tasks);
  const live = slotsOf(current.tasks);
  const trash = rebaseList<TrashedTask>(
    from.trash,
    to.trash,
    current.trash,
    (e) => e.task.id,
    (_f, t, c) => (jsonEqual(c, t) ? c : withLiveContent(t, live)),
    (t) => withLiveContent(t, live),
  );
  const projects = rebaseList<Project>(from.projects, to.projects, current.projects, (p) => p.id, (f, t, c) =>
    fieldwise(f, t, c, PROJECT_OWN_KEYS),
  );
  const recurrences = rebaseList<Recurrence>(
    from.recurrences,
    to.recurrences,
    current.recurrences,
    (r) => r.id,
    (f, t, c) => fieldwise(f, t, c, RECURRENCE_OWN_KEYS),
  );
  const habitList = rebaseList<Habit>(from.habits, to.habits, current.habits, (h) => h.id, rebaseHabit);
  const habits = habitList === current.habits ? habitList : sortHabits(habitList);
  const log = rebaseList<LogEntry>(from.log, to.log, current.log, (e) => e.id, (_f, t) => t);
  const days = rebaseList<DayRecord>(from.days, to.days, current.days, (d) => d.date, (_f, t) => t);
  const tombstones = rebaseTombstones(from.tombstones, to.tombstones, current.tombstones);
  const scalars = fieldwise(from, to, current, SCALAR_KEYS);

  if (
    tasks === current.tasks &&
    trash === current.trash &&
    projects === current.projects &&
    recurrences === current.recurrences &&
    habits === current.habits &&
    log === current.log &&
    days === current.days &&
    tombstones === current.tombstones &&
    scalars === current
  ) {
    return current;
  }
  return { ...scalars, tasks, trash, projects, recurrences, habits, log, days, tombstones };
}

/** A habit the step changed: own fields one by one, check-ins and values day by day. */
function rebaseHabit(f: Habit, t: Habit, c: Habit): Habit {
  let out = fieldwise(f, t, c, HABIT_OWN_KEYS);
  const days = new Set([
    ...Object.keys(f.checks),
    ...Object.keys(f.values),
    ...Object.keys(f.notes),
    ...Object.keys(t.checks),
    ...Object.keys(t.values),
    ...Object.keys(t.notes),
  ]);
  for (const d of days) {
    const stepChanged = f.checks[d] !== t.checks[d] || f.values[d] !== t.values[d] || f.notes[d] !== t.notes[d];
    if (
      !stepChanged ||
      (out.checks[d] === t.checks[d] && out.values[d] === t.values[d] && out.notes[d] === t.notes[d])
    ) {
      continue;
    }
    const checks = { ...out.checks };
    const values = { ...out.values };
    const notes = { ...out.notes };
    const mark = t.checks[d];
    const value = t.values[d];
    const note = t.notes[d];
    if (mark === undefined) delete checks[d];
    else checks[d] = mark;
    if (value === undefined) delete values[d];
    else values[d] = value;
    if (note === undefined) delete notes[d];
    else notes[d] = note;
    out = { ...out, checks, values, notes };
  }
  return out;
}

/**
 * Deletion records: whatever the step recorded on the target side comes back
 * (a redone "Empty the trash" keeps its purge), and nothing the step recorded
 * is dropped here — the store drops a record by itself once its id is live
 * again, and a record that isn't is still telling the truth.
 */
function rebaseTombstones(from: Tombstone[], to: Tombstone[], current: Tombstone[]): Tombstone[] {
  if (from === to) return current;
  const before = new Map(from.map((t) => [t.id, t]));
  const restored = to.filter((t) => {
    const f = before.get(t.id);
    return f == null || f.deletedAt !== t.deletedAt || f.purged !== t.purged;
  });
  return restored.length === 0 ? current : pruneTombstones([...restored, ...current]);
}
