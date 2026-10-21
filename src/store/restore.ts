import type { AppState, Habit, Project, Recurrence, Task, TaskId, TaskOwnField, TrashedTask } from "../types";
import { TASK_FIELD_MERGE } from "../types";
import { mergeDays, mergeLog, treeFromSlots, type PlacedSlot } from "../sync/merge";
import { sortHabits } from "./habits";

// ─── Restoring a backup ──────────────────────────────────────────────
//
// The desktop keeps a copy of its store file per day (electron/backups.cjs).
// Copying one back over the store used to undo nothing: the first sync deleted
// again whatever the cloud had a deletion record for, and the cloud's newer
// copy of every edit won the merge. A backup was only useful with the cloud
// disconnected.
//
// So a restore is a change like any other, made now: `restoreOnto` computes
// the state to go to, and the store commits it the way it commits an undo
// (core/commit `commitRebased`): every field it changes is stamped now, and
// everything that comes back is stamped past its own deletion record, so the
// merge reads the restore as the newest word and the cloud follows.
//
// What it does, item by item, for tasks (live or in the Trash), projects,
// recurrences and habits:
//
// - everything the backup holds goes back to how the backup has it: a deleted
//   task comes back where it was, an edited one gets its old fields, a habit's
//   days get the backup's marks, values and notes;
// - anything newer than the backup stays as it is: a task, project or habit
//   created since, a check-in on a day the backup has none for, the log lines
//   and day records written since (both merge as a union).
//
// Nothing is deleted, so a backup that turns out to be the wrong one, or not a
// store at all, can't take anything away. The one thing it can't bring back is
// a Trash entry deleted forever since: that deletion is final everywhere, by
// design (see the `purged` latch in pruneTombstones), so it stays deleted.

function isOwnField(key: string): key is TaskOwnField {
  return Object.prototype.hasOwnProperty.call(TASK_FIELD_MERGE, key);
}

/** Every field of a task's own content (TASK_FIELD_MERGE lists each one). */
const TASK_CONTENT: readonly TaskOwnField[] = (() => {
  const out: TaskOwnField[] = [];
  for (const key in TASK_FIELD_MERGE) if (isOwnField(key)) out.push(key);
  return out;
})();

function take<K extends TaskOwnField>(into: Task, from: Task, field: K): void {
  into[field] = from[field];
}

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

function idsIn(task: Task, into: Set<TaskId>): Set<TaskId> {
  into.add(task.id);
  for (const c of task.children) idsIn(c, into);
  return into;
}

/** `task`'s subtree without the tasks in `placed` (and what's under them); null if `task` itself is. */
function withoutPlaced(task: Task, placed: ReadonlySet<TaskId>): Task | null {
  if (placed.has(task.id)) return null;
  let changed = false;
  const children: Task[] = [];
  for (const c of task.children) {
    const kept = withoutPlaced(c, placed);
    if (kept !== c) changed = true;
    if (kept != null) children.push(kept);
  }
  return changed ? { ...task, children } : task;
}

/** `now`'s node with the backup's content and rank; its own clocks and stamps stay, for the store to move. */
function withBackupContent(now: Task, then: Task): Task {
  const out: Task = { ...now, rank: then.rank, children: [] };
  for (const field of TASK_CONTENT) take(out, then, field);
  return out;
}

/** The current list with the backup's version of every item it holds, and the backup's other items after. */
function overlay<T extends { id: string }>(current: readonly T[], backup: readonly T[], merge: (now: T, then: T) => T): T[] {
  const then = new Map(backup.map((x) => [x.id, x]));
  const out = current.map((x) => {
    const b = then.get(x.id);
    return b == null ? x : merge(x, b);
  });
  const seen = new Set(current.map((x) => x.id));
  for (const b of backup) if (!seen.has(b.id)) out.push(b);
  return out;
}

const ownFieldsFrom = <T extends { updatedAt: number; createdAt: number }>(now: T, then: T): T => ({
  ...then,
  createdAt: now.createdAt,
  updatedAt: now.updatedAt,
});

/** The backup's habit: its own fields, and its marks, values and notes on every day it has an entry for. */
function restoreHabit(now: Habit, then: Habit): Habit {
  const checks = { ...now.checks };
  const values = { ...now.values };
  const notes = { ...now.notes };
  const days = new Set([...Object.keys(then.checks), ...Object.keys(then.values), ...Object.keys(then.notes)]);
  for (const d of days) {
    delete checks[d];
    delete values[d];
    delete notes[d];
    if (then.checks[d] !== undefined) checks[d] = then.checks[d];
    if (then.values[d] !== undefined) values[d] = then.values[d];
    if (then.notes[d] !== undefined) notes[d] = then.notes[d];
  }
  return {
    ...then,
    id: now.id,
    createdAt: now.createdAt,
    updatedAt: now.updatedAt,
    checkedAt: now.checkedAt,
    checks,
    values,
    notes,
  };
}

/**
 * `current` with everything `backup` holds put back as the backup has it, and
 * everything newer kept (see the top of this file). Not stamped: the store
 * commits the result like an undo, which stamps it.
 */
export function restoreOnto(current: AppState, backup: AppState): AppState {
  const purged = new Set(current.tombstones.filter((t) => t.purged).map((t) => t.id));
  const liveThen = slotsOf(backup.tasks);
  const liveNow = slotsOf(current.tasks);

  // The backup's Trash entries come back to the Trash, unless deleted forever since.
  const trashThen = backup.trash.filter((e) => !purged.has(e.task.id));
  const trashedThen = new Set<TaskId>();
  for (const e of trashThen) idsIn(e.task, trashedThen);

  // The tree: the backup's live tasks where it had them, with its content;
  // every other live task as it is now, unless the backup has it in the Trash.
  const slots = new Map<TaskId, PlacedSlot>();
  for (const [id, then] of liveThen) {
    const now = liveNow.get(id);
    const node = now == null ? { ...then.node, children: [] } : withBackupContent(now.node, then.node);
    slots.set(id, { node, parent: then.parent, dead: false });
  }
  for (const [id, now] of liveNow) {
    if (slots.has(id) || trashedThen.has(id)) continue;
    slots.set(id, { node: { ...now.node, children: [] }, parent: now.parent, dead: false });
  }
  const tasks = treeFromSlots(slots);

  // The Trash: the backup's entries, then whatever else is in it now. A task
  // is in one place only — live, or in one entry — since each is one cloud
  // document: what is live again, or already in an earlier entry, is left out.
  const placed = new Set(slotsOf(tasks).keys());
  const trash: TrashedTask[] = [];
  for (const e of [...trashThen, ...current.trash]) {
    const task = withoutPlaced(e.task, placed);
    if (task == null) continue;
    trash.push(task === e.task ? e : { ...e, task });
    idsIn(task, placed);
  }

  return {
    ...current,
    tasks,
    trash,
    projects: overlay<Project>(current.projects, backup.projects, ownFieldsFrom),
    recurrences: overlay<Recurrence>(current.recurrences, backup.recurrences, ownFieldsFrom),
    habits: sortHabits(overlay<Habit>(current.habits, backup.habits, restoreHabit)),
    log: mergeLog(current.log, backup.log),
    days: mergeDays(current.days, backup.days),
  };
}
