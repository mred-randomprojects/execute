import type { ISODate, OutlineId, Project, ProjectId, Task, TaskId } from "./types";
import { DEFAULT_PROJECT_ID, projectRowId } from "./types";
import {
  findById,
  findParentId,
  getAncestorPath,
  isLeaf,
  leavesWhere,
  walk,
} from "./store/tasks";
import {
  monthElapsed,
  monthKey,
  monthKeyOffset,
  monthLabel,
  weekElapsed,
  weekKey,
  weekKeyOffset,
  weekLabel,
} from "./store/dates";

export type ViewKind = "today" | "backlog" | "all" | "projects" | "trash";

export const VIEW_TITLES: Record<ViewKind, string> = {
  today: "Today",
  backlog: "Backlog",
  all: "All tasks",
  projects: "Projects",
  trash: "Trash",
};

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
    case "projects":
      return () => true;
    case "trash":
      return () => false; // Trash is rendered from state.trash, not the tree.
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

export interface ProjectTaskGroup {
  project: Project;
  tasks: Task[];
}

/**
 * Bucket tasks under their project, in project order.
 *
 * `showEmpty` toggles the two intents projects serve:
 * - Task-focused views (Today/Backlog/All) pass `false`, so a project only
 *   appears when it actually has matching tasks — no empty-header clutter.
 * - The Projects view passes `true`, so every project is always present (even
 *   empty ones, including the Inbox). That view is the stable home for projects,
 *   which is why emptying a project never makes it vanish.
 */
export function groupTasksByProject(
  tasks: Task[],
  projects: Project[],
  { showEmpty = false }: { showEmpty?: boolean } = {}
): ProjectTaskGroup[] {
  const byProject = new Map(projects.map((project) => [project.id, project]));
  const buckets = new Map<Project["id"], Task[]>();

  for (const task of tasks) {
    const projectId = byProject.has(task.projectId) ? task.projectId : DEFAULT_PROJECT_ID;
    buckets.set(projectId, [...(buckets.get(projectId) ?? []), task]);
  }

  return projects
    .map((project) => ({ project, tasks: buckets.get(project.id) ?? [] }))
    .filter((group) => showEmpty || group.tasks.length > 0);
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

// ─── Fuzzy horizons → "Later" buckets ───────────────────────────────

export type LaterBucket =
  | "thisWeek"
  | "nextWeek"
  | "thisMonth"
  | "nextMonth"
  | "someday"
  | "inbox";

export const LATER_BUCKET_ORDER: readonly LaterBucket[] = [
  "thisWeek",
  "nextWeek",
  "thisMonth",
  "nextMonth",
  "someday",
  "inbox",
];

/**
 * Which Later bucket a task falls into, from its fuzzy horizon. Tasks in the
 * Later view have no concrete date (those live in Today / on their day), so we
 * only read `horizon`. Anchored week/month horizons that have already arrived
 * carry forward into "this week / this month" (they never reckon, never nag).
 */
export function taskBucket(task: Task, today: ISODate): LaterBucket {
  const h = task.horizon;
  if (h == null) return "inbox";
  if (h.unit === "someday") return "someday";
  if (h.unit === "week") {
    return (h.anchor ?? "") >= weekKeyOffset(today, 1) ? "nextWeek" : "thisWeek";
  }
  return (h.anchor ?? "") >= monthKeyOffset(today, 1) ? "nextMonth" : "thisMonth";
}

/** Short chip label for a task's horizon (for the by-project layout). `null` for Inbox/dated. */
export function horizonLabel(task: Task, today: ISODate): string | null {
  if (task.horizon == null) return null;
  switch (taskBucket(task, today)) {
    case "thisWeek":
      return "this week";
    case "nextWeek":
      return "next week";
    case "thisMonth":
      return "this month";
    case "nextMonth":
      return "next month";
    default:
      return "someday";
  }
}

export interface BucketMeta {
  id: LaterBucket;
  label: string;
  /** Concrete period, e.g. "Week 25" / "June 2026". `null` for Someday / Inbox. */
  sublabel: string | null;
  /** Fraction (0–1) of the period elapsed — drives the donut. `null` = no donut. */
  elapsed: number | null;
}

export function bucketMeta(id: LaterBucket, today: ISODate): BucketMeta {
  switch (id) {
    case "thisWeek":
      return { id, label: "This week", sublabel: weekLabel(weekKey(today)), elapsed: weekElapsed(today) };
    case "nextWeek":
      return { id, label: "Next week", sublabel: weekLabel(weekKeyOffset(today, 1)), elapsed: null };
    case "thisMonth":
      return { id, label: "This month", sublabel: monthLabel(monthKey(today)), elapsed: monthElapsed(today) };
    case "nextMonth":
      return { id, label: "Next month", sublabel: monthLabel(monthKeyOffset(today, 1)), elapsed: null };
    case "someday":
      return { id, label: "Someday", sublabel: null, elapsed: null };
    case "inbox":
      return { id, label: "Inbox", sublabel: null, elapsed: null };
  }
}

export interface LaterGroup {
  meta: BucketMeta;
  tasks: Task[]; // the (incomplete) tasks shown in this bucket
  done: number; // completed undated tasks in this bucket
  total: number; // all undated tasks in this bucket (done + open)
}

/**
 * Group the (already view-filtered) Later tree into time buckets by each root's
 * horizon. Completion counts (`done`/`total`) come from `allTasks` — the full
 * tree — so they include completed items the view itself filters out, instead
 * of always reading 0% done.
 */
export function groupTasksByBucket(
  tasks: Task[],
  allTasks: Task[],
  today: ISODate
): LaterGroup[] {
  const display = new Map<LaterBucket, Task[]>();
  for (const task of tasks) {
    const id = taskBucket(task, today);
    display.set(id, [...(display.get(id) ?? []), task]);
  }

  const done = new Map<LaterBucket, number>();
  const total = new Map<LaterBucket, number>();
  for (const t of allTasks) {
    if (t.plannedFor != null) continue; // dated tasks live in Today / on their day
    const id = taskBucket(t, today);
    total.set(id, (total.get(id) ?? 0) + 1);
    if (t.completed) done.set(id, (done.get(id) ?? 0) + 1);
  }

  return LATER_BUCKET_ORDER.flatMap((id) => {
    const bucketTasks = display.get(id);
    if (bucketTasks == null || bucketTasks.length === 0) return [];
    return [
      {
        meta: bucketMeta(id, today),
        tasks: bucketTasks,
        done: done.get(id) ?? 0,
        total: total.get(id) ?? 0,
      },
    ];
  });
}

// ─── Project index (the Projects tab is a list, not a task outline) ──

export interface ProjectSummary {
  project: Project;
  open: number; // incomplete leaves in the project
  today: number; // incomplete leaves planned for today
  done: number; // completed leaves
}

export function projectSummaries(
  tasks: Task[],
  projects: Project[],
  today: ISODate
): ProjectSummary[] {
  const open = new Map<ProjectId, number>();
  const todayCount = new Map<ProjectId, number>();
  const done = new Map<ProjectId, number>();
  const bump = (m: Map<ProjectId, number>, id: ProjectId) => m.set(id, (m.get(id) ?? 0) + 1);

  walk(tasks, (t) => {
    if (!isLeaf(t)) return;
    if (t.completed) bump(done, t.projectId);
    else {
      bump(open, t.projectId);
      if (t.plannedFor === today) bump(todayCount, t.projectId);
    }
  });

  return projects.map((project) => ({
    project,
    open: open.get(project.id) ?? 0,
    today: todayCount.get(project.id) ?? 0,
    done: done.get(project.id) ?? 0,
  }));
}

// ─── Zoom / focus mode (Workflowy-style hoisting) ───────────────────

/** What the outline is currently hoisted onto. `null` = the normal view. */
export type ZoomTarget =
  | { kind: "task"; id: TaskId }
  | { kind: "project"; id: ProjectId };

/** One breadcrumb above the zoom root. `id == null` is "home" (exit zoom). */
export interface Crumb {
  id: OutlineId | null;
  label: string;
  kind: "home" | "project" | "task";
}

export interface ZoomFocus {
  kind: "task" | "project";
  /** The hoisted node's id, for re-focusing on exit. */
  rootId: OutlineId;
  title: string;
  color: string | null;
  /** Rows rendered beneath the title (children of a task / roots of a project). */
  subtree: Task[];
  /** Ancestors, left→right, NOT including the root itself. */
  crumbs: Crumb[];
}

const titleOf = (text: string): string => (text.trim() === "" ? "Untitled" : text);

/**
 * Resolve a zoom target into everything the focused view needs. Returns `null`
 * when the target no longer exists (deleted), so the caller can drop the zoom.
 */
export function resolveZoom(
  tasks: Task[],
  projects: Project[],
  zoom: ZoomTarget,
  homeLabel: string
): ZoomFocus | null {
  const home: Crumb = { id: null, label: homeLabel, kind: "home" };

  if (zoom.kind === "project") {
    const project = projects.find((p) => p.id === zoom.id);
    if (project == null) return null;
    return {
      kind: "project",
      rootId: projectRowId(project.id),
      title: project.name,
      color: project.color,
      subtree: tasks.filter((t) => t.projectId === project.id),
      crumbs: [home],
    };
  }

  const path = getAncestorPath(tasks, zoom.id); // [root … target], includes target
  if (path.length === 0) return null;
  const target = path[path.length - 1];
  const project = projects.find((p) => p.id === target.projectId) ?? null;
  const ancestorsAbove = path.slice(0, -1);

  const crumbs: Crumb[] = [home];
  if (project != null) {
    crumbs.push({ id: projectRowId(project.id), label: project.name, kind: "project" });
  }
  for (const a of ancestorsAbove) {
    crumbs.push({ id: a.id, label: titleOf(a.text), kind: "task" });
  }

  return {
    kind: "task",
    rootId: target.id,
    title: titleOf(target.text),
    color: project?.color ?? null,
    subtree: target.children,
    crumbs,
  };
}

/** One step "up" for the ESC-climbs-out behaviour. `null` exits zoom entirely. */
export function zoomParent(tasks: Task[], zoom: ZoomTarget): ZoomTarget | null {
  if (zoom.kind === "project") return null;
  const parentId = findParentId(tasks, zoom.id);
  if (parentId != null) return { kind: "task", id: parentId };
  const task = findById(tasks, zoom.id);
  if (task != null) return { kind: "project", id: task.projectId };
  return null;
}
