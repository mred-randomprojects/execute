import type { AppState, Habit, ISODate, Task, TaskId, Tombstone, TrashedTask } from "../types";
import { pruneTombstones } from "../types";
import { placeTasks } from "../store/placement";
import { widenStaleParents } from "../store/bounds";
import { jsonEqual } from "../sync/json";
import { stampTask } from "../store/clocks";
import { settleWork } from "../store/work";
import { habitLastTouched, stampHabit } from "../store/habits";
import { toISO } from "../store/dates";

// ─── The choke point ────────────────────────────────────────────────
//
// Every change to the state — from the desktop's keyboard, the phone, or any
// other client of the core — passes through `commit`: what a command produced,
// made consistent and stamped for the merge. Pure: the caller supplies `now`,
// and no clock, id generator or platform is read in here.
//
// Doing this once, here, rather than at each of the dozens of mutation sites
// is the point: a rule applied at one choke point can't be forgotten by the
// next mutation someone writes.

/** The day `now` falls on for this state (the dev-date override wins). */
export function todayFor(s: AppState, now: number): ISODate {
  const override = s.devDateOverride;
  return override != null && override !== "" ? override : toISO(new Date(now));
}

// ─── Per-task stamping ──────────────────────────────────────────────
//
// Cloud sync merges each task field group by field group, every group by its
// own clock (see store/clocks, src/sync/merge). We diff the whole tree once:
// every group of a task's *own* fields that changed gets its clock moved to
// `now`, and so does `updatedAt`. Structural sharing is preserved, so
// untouched subtrees keep their identity (and don't re-render).

function indexById(tasks: Task[], into: Map<TaskId, Task>): void {
  for (const t of tasks) {
    into.set(t.id, t);
    indexById(t.children, into);
  }
}

function stampNode(node: Task, prevById: Map<TaskId, Task>, now: number): Task {
  let children = node.children;
  if (children.length > 0) {
    const mapped = children.map((c) => stampNode(c, prevById, now));
    if (mapped.some((c, i) => c !== children[i])) children = mapped;
  }
  // Each changed field group gets its clock, and updatedAt moves — never
  // behind the version being edited: that version may carry another device's
  // clock, and if it runs ahead, `now` would lose the merge to it.
  return stampTask(prevById.get(node.id), children === node.children ? node : { ...node, children }, now);
}

/**
 * Every task whose own fields differ from `prev`, stamped (store/clocks): the
 * clocks of the field groups that changed, and `updatedAt` — each past the
 * version it replaces, which may carry another device's clock that runs ahead.
 */
function stampTasks(prev: AppState, next: AppState, now: number): AppState {
  if (next.tasks === prev.tasks) return next;
  const prevById = new Map<TaskId, Task>();
  indexById(prev.tasks, prevById);
  const tasks = next.tasks.map((t) => stampNode(t, prevById, now));
  return { ...next, tasks };
}

// ─── Tombstones ─────────────────────────────────────────────────────
//
// Cloud sync cannot tell "the cloud has X and I've never seen it" (the other
// device added it → graft it back) from "the cloud has X and I deleted it"
// (→ drop it) unless something says X was deleted. That record is a Tombstone,
// and — exactly like the stamping above — it is written once here rather than
// at each delete site, because the deletes that were getting lost were the
// ones nobody thought of as deletes: undoing a *create*, and emptying the
// Trash (which threw away the only record there was).

/** Every id that currently exists: task nodes at any depth, plus recurrence and habit ids. */
function liveIds(s: AppState): Set<string> {
  const ids = new Set<string>();
  const walk = (list: Task[]) => {
    for (const t of list) {
      ids.add(t.id);
      walk(t.children);
    }
  };
  walk(s.tasks);
  // Template *nodes* are deliberately not counted: they can't be deleted on
  // their own, only edited, and the recurrence is what the merge unions by id.
  for (const r of s.recurrences) ids.add(r.id);
  for (const h of s.habits) ids.add(h.id);
  return ids;
}

/**
 * Record what just disappeared, and un-record what just came back.
 *
 * Both sets are carried forward — the current one *and* whatever `next`
 * brings. The current one, because undo restores a whole snapshot: a deletion
 * recorded *after* the step being undone must not be forgotten just because
 * that step predates it. (Same reasoning as the action log, which undo also
 * carries forward rather than rewinding.) And `next`'s, because a command
 * may record deletions of its own — emptying the Trash marks its entries
 * purged, and dropping that would let the other device's copy refill it.
 *
 * An id that reappears — a restore from the Trash, an undone delete — drops
 * its tombstone, since it plainly isn't deleted any more. An id back *in the
 * Trash* (an undone "Empty the trash") keeps its deletion but loses `purged`
 * locally, so this device doesn't show a Trash its own merge would then empty.
 */
function withTombstones(prev: AppState, next: AppState, now: number): AppState {
  const carried =
    next.tombstones === prev.tombstones
      ? prev.tombstones
      : pruneTombstones([...next.tombstones, ...prev.tombstones], now);
  const inTrash = new Set<string>(next.trash.map((e) => e.task.id));
  const treeMoved =
    next.tasks !== prev.tasks || next.recurrences !== prev.recurrences || next.habits !== prev.habits;
  const after = treeMoved ? liveIds(next) : null;
  const gone: Tombstone[] = [];
  if (after != null) {
    // Leaving the tree is a deletion, not a purge — a trashed task keeps its
    // restorable copy, and an undone create never had one to keep.
    for (const id of liveIds(prev)) if (!after.has(id)) gone.push({ id, deletedAt: now, purged: false });
  }
  let changed = gone.length > 0 || carried !== next.tombstones;
  const kept: Tombstone[] = [];
  for (const t of carried) {
    if (after?.has(t.id) === true) {
      changed = true;
      continue;
    }
    if (t.purged && inTrash.has(t.id)) {
      changed = true;
      kept.push({ ...t, purged: false });
      continue;
    }
    kept.push(t);
  }
  if (!changed) return next;
  return { ...next, tombstones: gone.length > 0 ? pruneTombstones([...gone, ...kept], now) : kept };
}

/**
 * Keep the deletion on record when the restorable copy is thrown away, so
 * "Delete for good" and "Empty the trash" actually stick. Without this the
 * merge read the other device's Trash back and refilled it.
 *
 * Stamped `now` rather than with the original deletion time: the record's job is
 * to out-vote a stale copy elsewhere, and a Trash entry old enough to have aged
 * out of {@link pruneTombstones} would otherwise be buried with no record at all.
 * The cost is that emptying the Trash also beats an edit another device made to
 * that task in the meantime — which is the right way round for a deliberate
 * "delete this for good".
 */
export function buryTrashed(s: AppState, entries: readonly TrashedTask[], now: number): Tombstone[] {
  return pruneTombstones(
    [...entries.map((e) => ({ id: e.task.id as string, deletedAt: now, purged: true })), ...s.tombstones],
    now,
  );
}

// ─── Placement + project/recurrence/habit clocks ────────────────────
//
// The rest of what the merge needs: every task's rank/movedAt
// (store/placement), and `updatedAt` on any project or recurrence whose
// content changed. Deliberately generic — compare, don't enumerate — so a new
// project or recurrence field can't be forgotten.

function stampChanged<T extends { id: string; updatedAt: number }>(prev: readonly T[], next: T[], now: number): T[] {
  if (next === prev) return next;
  const before = new Map(prev.map((x) => [x.id, x]));
  let changed = false;
  const out = next.map((x) => {
    const was = before.get(x.id);
    if (was === x) return x;
    if (was != null && jsonEqual({ ...was, updatedAt: 0 }, { ...x, updatedAt: 0 })) return x;
    // Never behind the version being replaced (see stampNode).
    const stamp = Math.max(now, (was?.updatedAt ?? -Infinity) + 1);
    if (x.updatedAt >= stamp) return x;
    changed = true;
    return { ...x, updatedAt: stamp };
  });
  return changed ? out : next;
}

/** Habits carry two clocks — own fields and per-day check-ins (store/habits). */
function stampHabits(prev: readonly Habit[], next: Habit[], now: number): Habit[] {
  if (next === prev) return next;
  const before = new Map(prev.map((h) => [h.id, h]));
  let changed = false;
  const out = next.map((h) => {
    const stamped = stampHabit(before.get(h.id), h, now);
    if (stamped !== h) changed = true;
    return stamped;
  });
  return changed ? out : next;
}

function withSyncStamps(prev: AppState, next: AppState, now: number): AppState {
  const tasks = placeTasks(prev.tasks, next.tasks, now);
  const projects = stampChanged(prev.projects, next.projects, now);
  const recurrences = stampChanged(prev.recurrences, next.recurrences, now);
  const habits = stampHabits(prev.habits, next.habits, now);
  if (tasks === next.tasks && projects === next.projects && recurrences === next.recurrences && habits === next.habits) {
    return next;
  }
  return { ...next, tasks, projects, recurrences, habits };
}

/**
 * What undo or redo brings back (a task out of the Trash, a deleted habit or
 * recurrence) has to out-stamp its own deletion record, or the merge reads the
 * record as the newer word and deletes it again. Stamping `now` does that
 * unless the record landed in the same millisecond, or came from a clock that
 * runs ahead — so the stamp goes past the record, whatever it says.
 */
function pastDeletions(next: AppState, current: AppState): AppState {
  const deletedAt = new Map<string, number>();
  const note = (id: string, at: number) => deletedAt.set(id, Math.max(deletedAt.get(id) ?? -Infinity, at));
  for (const t of current.tombstones) note(t.id, t.deletedAt);
  for (const e of current.trash) note(e.task.id, e.deletedAt);
  if (deletedAt.size === 0) return next;
  const wasLive = liveIds(current);
  const floor = (id: string): number | null => (wasLive.has(id) ? null : (deletedAt.get(id) ?? null));
  const walk = (nodes: Task[]): Task[] => {
    let any = false;
    const out = nodes.map((t) => {
      const children = t.children.length > 0 ? walk(t.children) : t.children;
      const d = floor(t.id);
      const updatedAt = d != null && d >= Math.max(t.updatedAt, t.movedAt) ? d + 1 : t.updatedAt;
      if (children === t.children && updatedAt === t.updatedAt) return t;
      any = true;
      return { ...t, children, updatedAt };
    });
    return any ? out : nodes;
  };
  const tasks = walk(next.tasks);
  const habits = next.habits.map((h) => {
    const d = floor(h.id);
    if (d == null || d < habitLastTouched(h)) return h;
    return { ...h, updatedAt: d + 1 };
  });
  const recurrences = next.recurrences.map((r) => {
    const d = floor(r.id);
    if (d == null || d < r.updatedAt) return r;
    return { ...r, updatedAt: d + 1 };
  });
  const changed =
    tasks !== next.tasks ||
    habits.some((h, i) => h !== next.habits[i]) ||
    recurrences.some((r, i) => r !== next.recurrences[i]);
  return changed ? { ...next, tasks, habits, recurrences } : next;
}

/** No settled task left in progress, and only one in progress (see store/work). */
function withSettledWork(prev: AppState, s: AppState, now: number): AppState {
  if (s.tasks === prev.tasks) return s;
  const tasks = settleWork(s.tasks, now);
  return tasks === s.tasks ? s : { ...s, tasks };
}

/** The state with no parent left stranded behind its open children (see store/bounds). */
function withBoundedParents(s: AppState, now: number): AppState {
  const tasks = widenStaleParents(s.tasks, todayFor(s, now));
  return tasks === s.tasks ? s : { ...s, tasks };
}

/**
 * Commit what a change produced from `prev`: the state made consistent and
 * stamped for the merge. Returns `prev` itself when nothing changed — a guard
 * that bailed (`markWontDo` on an already-skipped task, and friends) — so the
 * caller can skip the save, the sync and the history line for a change that
 * never happened.
 */
export function commit(prev: AppState, produced: AppState, now: number): AppState {
  if (produced === prev) return prev;
  // Every write passes through the parent-date bound (see store/bounds): each
  // scheduling surface writes dates onto leaves, so without this a
  // carried-forward subtask strands its parent on a day that has gone, with
  // nothing left in the app able to move it. Idempotent and structure-sharing,
  // so a write that doesn't break the bound pays nothing. (The day's own
  // rollover bookkeeping is a write too, which is what repairs a parent that
  // went stale overnight without the user touching anything.)
  //
  // Work settles here for the same reason: completing, declining or blocking a
  // task has a dozen doors (the outline, the Reckoning, Shutdown, the board,
  // the palette, the phone), and every one of them has to stop its timer.
  const settled = withSettledWork(prev, withBoundedParents(produced, now), now);
  if (settled === prev) return prev;
  return withTombstones(prev, withSyncStamps(prev, stampTasks(prev, settled, now), now), now);
}

/**
 * Commit an undo or redo: `rebased` is `current` with a step's footprint
 * applied (store/rebase). Stamped against `current` like any change — what
 * comes back is stamped `now`, past its own deletion record too, or the
 * cloud's newer copy of what the step did would win the next merge and hand
 * it straight back; and tombstones are diffed against `current` as well, so
 * undoing a *create* leaves a record behind. Unlike {@link commit} it neither
 * bounds parents nor settles work: an undo that "helpfully" kept part of the
 * change isn't one.
 */
export function commitRebased(current: AppState, rebased: AppState, now: number): AppState {
  const stamped = withSyncStamps(current, stampTasks(current, rebased, now), now);
  return withTombstones(current, pastDeletions(stamped, current), now);
}
