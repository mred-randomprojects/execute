import type { ProjectId, Task, TaskId } from "../types";
import { findById, mapById } from "../store/tasks";
import type { TaskPatch } from "./TaskSheet";

// ─── The phone's edits, as idempotent intents ────────────────────────
//
// Each takes the current view's tasks and returns them with the intent applied
// (or the same array if it's already true), stamping every changed task past
// its previous version. Idempotent so that a retry after a write conflict —
// re-applied on a fresher view — can never change anything twice.

/**
 * Set one task's completion (an idempotent intent — a retry after a conflict
 * can't flip it twice). Stamped past the version being edited, so the merge
 * treats this edit as the newest for that task even across skewed clocks.
 */
export function setCompleted(tasks: Task[], id: TaskId, completed: boolean): Task[] {
  return mapById(tasks, id, (t) => {
    if (t.completed === completed) return t;
    const now = Date.now();
    return {
      ...t,
      completed,
      completedAt: completed ? now : null,
      wontDo: completed ? null : t.wontDo,
      updatedAt: Math.max(now, t.updatedAt + 1),
    };
  });
}

/** Stamp a whole subtree onto a project: every task in it changes, so every one is stamped. */
function assignProjectStamped(t: Task, projectId: ProjectId, now: number): Task {
  return {
    ...t,
    projectId,
    updatedAt: t.projectId === projectId ? t.updatedAt : Math.max(now, t.updatedAt + 1),
    children: t.children.map((c) => assignProjectStamped(c, projectId, now)),
  };
}

/**
 * Set some of a task's fields (an idempotent intent: re-applying it after a
 * conflict changes nothing twice). A concrete day clears a fuzzy horizon —
 * the two never coexist.
 */
export function updateTask(tasks: Task[], id: TaskId, patch: TaskPatch): Task[] {
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
    let next: Task = { ...cur, updatedAt: Math.max(now, cur.updatedAt + 1) };
    if (patch.text !== undefined) next.text = patch.text;
    if (patch.notes !== undefined) next.notes = patch.notes;
    if (patch.plannedFor !== undefined) {
      next.plannedFor = patch.plannedFor;
      if (patch.plannedFor != null) next.horizon = null;
    }
    if (patch.projectId !== undefined && patch.projectId !== cur.projectId) {
      const projectId = patch.projectId;
      next = {
        ...next,
        projectId,
        children: next.children.map((c) => assignProjectStamped(c, projectId, now)),
      };
    }
    return next;
  });
}
