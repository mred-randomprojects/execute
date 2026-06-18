import type { ISODate, Task, TaskId } from "./types";
import { isLeaf, leavesWhere } from "./store/tasks";

export type ViewKind = "today" | "backlog" | "all";

export type TaskPredicate = (t: Task) => boolean;

/** Keep a node if it matches, or has a kept descendant. Prunes other branches. */
export function filterTree(tasks: Task[], pred: TaskPredicate): Task[] {
  const out: Task[] = [];
  for (const t of tasks) {
    const kids = filterTree(t.children, pred);
    if (pred(t) || kids.length > 0) out.push({ ...t, children: kids });
  }
  return out;
}

export function viewPredicate(view: ViewKind, today: ISODate): TaskPredicate {
  switch (view) {
    case "today":
      return (t) => t.plannedFor === today;
    case "backlog":
      return (t) => t.plannedFor == null && !t.completed;
    case "all":
      return () => true;
  }
}

export function viewTasks(
  tasks: Task[],
  view: ViewKind,
  today: ISODate
): Task[] {
  return filterTree(tasks, viewPredicate(view, today));
}

export interface Row {
  task: Task;
  depth: number;
}

/** Flatten a (already filtered) tree into ordered rows, respecting collapse. */
export function flattenRows(
  tasks: Task[],
  collapsed: Set<TaskId>,
  depth = 0
): Row[] {
  const rows: Row[] = [];
  for (const t of tasks) {
    rows.push({ task: t, depth });
    if (t.children.length > 0 && !collapsed.has(t.id)) {
      rows.push(...flattenRows(t.children, collapsed, depth + 1));
    }
  }
  return rows;
}

// ─── Counts for the sidebar / progress ──────────────────────────────

export function todayLeaves(tasks: Task[], today: ISODate): Task[] {
  return leavesWhere(tasks, (t) => t.plannedFor === today);
}

export interface TodayProgress {
  done: number;
  total: number;
  remaining: number;
}

export function todayProgress(tasks: Task[], today: ISODate): TodayProgress {
  const leaves = todayLeaves(tasks, today);
  const done = leaves.filter((t) => t.completed).length;
  return { done, total: leaves.length, remaining: leaves.length - done };
}

export function backlogCount(tasks: Task[]): number {
  return leavesWhere(tasks, (t) => t.plannedFor == null && !t.completed).length;
}

/** Incomplete leaves planned strictly before today — the Reckoning's input. */
export function leftoverLeaves(tasks: Task[], today: ISODate): Task[] {
  return leavesWhere(
    tasks,
    (t) => !t.completed && t.plannedFor != null && t.plannedFor < today
  );
}

export function isActionableLeaf(t: Task): boolean {
  return isLeaf(t) && !t.completed;
}
