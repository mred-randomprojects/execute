import type { Habit, HabitId, HabitMark, ISODate, ProjectId, Task, TaskId } from "../types";
import { markStamped } from "../store/habits";
import { deferralOf } from "../core/commands";
import { stampTask } from "../store/clocks";
import { todayISO } from "../store/dates";
import { findById, mapById } from "../store/tasks";
import type { TaskPatch } from "./TaskSheet";

// ─── The phone's edits, as idempotent intents ────────────────────────
//
// Each takes the current view's tasks and returns them with the intent applied
// (or the same array if it's already true), stamping every changed task past
// its previous version — the clock of each field group it changed, and
// `updatedAt` (store/clocks), exactly as the desktop's choke point does.
// Idempotent so that a retry after a write conflict — re-applied on a fresher
// view — can never change anything twice.

/**
 * Set one task's completion (an idempotent intent — a retry after a conflict
 * can't flip it twice). Stamped past the version being edited, so the merge
 * treats this edit as the newest for that task even across skewed clocks.
 */
export function setCompleted(tasks: Task[], id: TaskId, completed: boolean): Task[] {
  return mapById(tasks, id, (t) => {
    if (t.completed === completed) return t;
    const now = Date.now();
    return stampTask(
      t,
      { ...t, completed, completedAt: completed ? now : null, wontDo: completed ? null : t.wontDo },
      now,
    );
  });
}

/** Stamp a whole subtree onto a project: every task in it changes, so every one is stamped. */
function assignProjectStamped(t: Task, projectId: ProjectId, now: number): Task {
  const children = t.children.map((c) => assignProjectStamped(c, projectId, now));
  return stampTask(t, { ...t, projectId, children }, now);
}

/**
 * Set some of a task's fields (an idempotent intent: re-applying it after a
 * conflict changes nothing twice). A concrete day clears a fuzzy horizon —
 * the two never coexist.
 *
 * Moving a task that came due is a deferral here too, counted the way the
 * desktop counts it (core/commands' deferralOf): back to today bumps
 * carriedCount, anywhere else postponedCount. Counted, not logged — the phone
 * writes only task and habit documents — and the counters merge by max, so a
 * retry can't count twice.
 */
export function updateTask(
  tasks: Task[],
  id: TaskId,
  patch: TaskPatch,
  today: ISODate = todayISO(null),
): Task[] {
  const t = findById(tasks, id);
  if (t == null) return tasks;
  const same =
    (patch.text === undefined || patch.text === t.text) &&
    (patch.notes === undefined || patch.notes === t.notes) &&
    (patch.plannedFor === undefined || patch.plannedFor === t.plannedFor) &&
    (patch.projectId === undefined || patch.projectId === t.projectId);
  if (same) return tasks;
  const now = Date.now();
  return mapById(tasks, id, (cur) => {
    let next: Task = { ...cur };
    if (patch.text !== undefined) next.text = patch.text;
    if (patch.notes !== undefined) next.notes = patch.notes;
    if (patch.plannedFor !== undefined && patch.plannedFor !== cur.plannedFor) {
      const deferral = deferralOf(cur, patch.plannedFor, today);
      next.plannedFor = patch.plannedFor;
      if (patch.plannedFor != null) next.horizon = null;
      if (deferral === "kept") next.carriedCount = cur.carriedCount + 1;
      if (deferral === "postponed") next.postponedCount = cur.postponedCount + 1;
    }
    if (patch.projectId !== undefined && patch.projectId !== cur.projectId) {
      const projectId = patch.projectId;
      next = {
        ...next,
        projectId,
        children: next.children.map((c) => assignProjectStamped(c, projectId, now)),
      };
    }
    return stampTask(cur, next, now);
  });
}

/**
 * Set one habit's mark for one day (or clear it, with null) — idempotent, and
 * stamped on that day alone, so the merge keeps both this and whatever the
 * desktop marked on other days (or later on this one).
 */
export function setHabitMark(
  habits: Habit[],
  id: HabitId,
  date: ISODate,
  mark: HabitMark | null,
  now: number = Date.now(),
): Habit[] {
  let changed = false;
  const next = habits.map((h) => {
    if (h.id !== id) return h;
    const marked = markStamped(h, date, mark, now);
    if (marked !== h) changed = true;
    return marked;
  });
  return changed ? next : habits;
}

