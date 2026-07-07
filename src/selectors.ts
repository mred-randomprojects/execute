import type {
  ISODate,
  OutlineId,
  Project,
  ProjectId,
  Recurrence,
  RecurrenceId,
  Task,
  TaskId,
} from "./types";
import { DEFAULT_PROJECT_ID, projectRowId } from "./types";
import { ruleFiresOn, ruleLabel, ruleSortKey } from "./store/recurrence";
import {
  findById,
  findParentId,
  getAncestorPath,
  isLeaf,
  isOpen,
  leavesWhere,
  walk,
} from "./store/tasks";
import {
  addDays,
  monthElapsed,
  monthEnd,
  monthKey,
  monthKeyOffset,
  monthLabel,
  monthStart,
  weekElapsed,
  weekKey,
  weekKeyOffset,
  weekLabel,
  weekStart,
} from "./store/dates";

export type ViewKind = "today" | "backlog" | "all" | "projects" | "recurring" | "trash";

export const VIEW_TITLES: Record<ViewKind, string> = {
  today: "Today",
  backlog: "Backlog",
  all: "All tasks",
  projects: "Projects",
  recurring: "Recurring",
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
      return (t) => t.plannedFor == null && isOpen(t);
    case "all":
    case "projects":
      return () => true;
    case "recurring":
    case "trash":
      return () => false; // Rendered from a dedicated array, not the task tree.
  }
}

/** A subtree still holds live today-work: an *open* leaf planned for today. */
export function hasOpenTodayLeaf(t: Task, today: ISODate): boolean {
  if (t.children.length === 0) return t.plannedFor === today && isOpen(t);
  return t.children.some((c) => hasOpenTodayLeaf(c, today));
}

/**
 * The Today outline. A subtree shows only while it still holds an *open* task
 * planned for today; inside such a live subtree, already-resolved today-leaves
 * ride along (so "what you did today" sits beside the open work) and non-today
 * ancestors appear as context. A subtree with no open today-work is dropped
 * whole — so a container that was never a today commitment doesn't linger just
 * because one scheduled subtask is already done.
 *
 * Tasks *themselves* planned for today always show (done or open) — they're
 * direct commitments; `parentLive` carries that permission down through a live
 * subtree so their finished siblings show too.
 */
export function todayTasks(tasks: Task[], today: ISODate, parentLive = true): Task[] {
  const out: Task[] = [];
  for (const t of tasks) {
    const shown = hasOpenTodayLeaf(t, today) || (t.plannedFor === today && parentLive);
    if (shown) out.push({ ...t, children: todayTasks(t.children, today, true) });
  }
  return out;
}

export function viewTasks(
  tasks: Task[],
  view: ViewKind,
  today: ISODate
): Task[] {
  // Today needs subtree-level reasoning (drop done-only branches), which a flat
  // per-node predicate can't express; the other views are simple predicates.
  if (view === "today") return todayTasks(tasks, today);
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

type PrevSibling = { found: true; prevId: TaskId | null } | { found: false };

function locatePrevSibling(forest: Task[], id: TaskId): PrevSibling {
  const idx = forest.findIndex((t) => t.id === id);
  if (idx >= 0) return { found: true, prevId: idx > 0 ? forest[idx - 1].id : null };
  for (const t of forest) {
    const res = locatePrevSibling(t.children, id);
    if (res.found) return res;
  }
  return { found: false };
}

/**
 * The task immediately before `id` among its siblings in an *already-filtered*
 * forest (one project group's tasks, a zoom subtree, etc.), or null if `id` is
 * first among its visible siblings or absent. Indent uses this so Tab nests
 * under the row visually above — never under a sibling the view is hiding.
 */
export function prevVisibleSiblingId(forest: Task[], id: TaskId): TaskId | null {
  const res = locatePrevSibling(forest, id);
  return res.found ? res.prevId : null;
}

// ─── Counts for the sidebar / progress ──────────────────────────────

/**
 * Today-planned *leaves* the Today view actually shows (open + resolved), for
 * counting. Walks the real tree so "leaf" reflects the true structure, but
 * follows the same subtree visibility as {@link todayTasks} — a done leaf in a
 * branch that's no longer a today commitment is hidden, so it isn't counted.
 */
export function todayLeaves(tasks: Task[], today: ISODate): Task[] {
  const out: Task[] = [];
  const walk = (list: Task[], parentLive: boolean) => {
    for (const t of list) {
      if (!(hasOpenTodayLeaf(t, today) || (t.plannedFor === today && parentLive))) continue;
      if (t.children.length === 0) {
        if (t.plannedFor === today) out.push(t);
      } else {
        walk(t.children, true);
      }
    }
  };
  walk(tasks, true);
  return out;
}

export interface TodayProgress {
  done: number;
  total: number;
  remaining: number;
}

export function todayProgress(tasks: Task[], today: ISODate): TodayProgress {
  // Count only what Today shows: a done sub-step of a branch that's no longer a
  // today commitment (and thus hidden) shouldn't inflate the tally. Skipped
  // ("won't do") leaves also drop out — set aside, neither done nor remaining.
  const leaves = todayLeaves(tasks, today).filter((t) => t.wontDo == null);
  const done = leaves.filter((t) => t.completed).length;
  return { done, total: leaves.length, remaining: leaves.length - done };
}

export function backlogCount(tasks: Task[]): number {
  return leavesWhere(tasks, (t) => t.plannedFor == null && isOpen(t)).length;
}

/** Open leaves planned strictly before today — the Reckoning's input. */
export function leftoverLeaves(tasks: Task[], today: ISODate): Task[] {
  return leavesWhere(
    tasks,
    (t) => isOpen(t) && t.plannedFor != null && t.plannedFor < today
  );
}

/** A leftover leaf together with the ancestor chain that gives it context. */
export interface ReckoningLeaf {
  task: Task;
  /** Tasks between the card root and this leaf, exclusive of both (nearest-last). */
  parents: Task[];
}

/**
 * One Reckoning "card": a top-level ancestor and the unfinished leftover leaves
 * beneath it. Restores the hierarchy the flat list threw away — you review a
 * whole top-level commitment and its stranded subtasks together.
 *
 * `root` is the top-level ancestor; for a leftover that is itself top-level,
 * `root` is that task and its single leaf has no `parents`. Cards (and the
 * leaves within them) preserve tree order.
 */
export interface ReckoningCard {
  root: Task;
  leaves: ReckoningLeaf[];
}

export function reckoningCards(tasks: Task[], today: ISODate): ReckoningCard[] {
  const cards: ReckoningCard[] = [];
  const indexByRoot = new Map<TaskId, number>();
  for (const leaf of leftoverLeaves(tasks, today)) {
    const path = getAncestorPath(tasks, leaf.id);
    const root = path[0] ?? leaf;
    let idx = indexByRoot.get(root.id);
    if (idx == null) {
      idx = cards.length;
      indexByRoot.set(root.id, idx);
      cards.push({ root, leaves: [] });
    }
    cards[idx].leaves.push({ task: leaf, parents: path.slice(1, -1) });
  }
  return cards;
}

export function isActionableLeaf(t: Task): boolean {
  return isLeaf(t) && isOpen(t);
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

// ─── The schedule ladder (t / ⇧t step through it) ───────────────────
// The s-picker's options in display order. Stepping wraps at the ends, so
// `t` on an inbox task plans it for today and `⇧t` on a today task unplans it.

export const SCHEDULE_LADDER = [
  "today",
  "tomorrow",
  "thisWeek",
  "nextWeek",
  "thisMonth",
  "nextMonth",
  "someday",
  "inbox",
] as const;
export type ScheduleStep = (typeof SCHEDULE_LADDER)[number];

/**
 * Where a task currently sits on the ladder. Concrete dates map into their
 * containing rung (tomorrow / this week / …, far future → someday) and an
 * overdue date counts as today, so stepping is meaningful from any schedule.
 */
export function scheduleStep(task: Task, today: ISODate): ScheduleStep {
  const p = task.plannedFor;
  if (p != null) {
    if (p <= today) return "today";
    if (p === addDays(today, 1)) return "tomorrow";
    if (weekKey(p) === weekKey(today)) return "thisWeek";
    if (weekKey(p) === weekKeyOffset(today, 1)) return "nextWeek";
    if (monthKey(p) === monthKey(today)) return "thisMonth";
    if (monthKey(p) === monthKeyOffset(today, 1)) return "nextMonth";
    return "someday";
  }
  return taskBucket(task, today);
}

/** One rung right (dir 1, later) or left (dir -1, sooner), wrapping around. */
export function stepSchedule(step: ScheduleStep, dir: 1 | -1): ScheduleStep {
  const n = SCHEDULE_LADDER.length;
  return SCHEDULE_LADDER[(SCHEDULE_LADDER.indexOf(step) + dir + n) % n];
}

// ─── Soft horizons → a suggested concrete day (the AI-swappable heuristic) ──
//
// Horizons stay the source of truth and never reckon. This only *projects* a
// concrete day so a fuzzy task can surface in Today as a suggestion the user can
// accept (→ a real dated commitment) or dismiss. A later, smarter pass (load
// balancing, then an AI) can replace `pickSuggested` without touching callers.

/** All days from `start` to `end`, inclusive. */
function daysInclusive(start: ISODate, end: ISODate): ISODate[] {
  const days: ISODate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

/**
 * Pick a day within a horizon's window: aim for the middle (Wed of a week,
 * mid-month), but once that's past, aim for the middle of what's left; if the
 * whole window is behind us, surface today so the stale horizon gets re-triaged.
 */
function pickSuggested(window: ISODate[], today: ISODate): ISODate {
  const remaining = window.filter((d) => d >= today);
  if (remaining.length === 0) return today;
  const natural = window[Math.floor(window.length / 2)];
  if (natural >= today) return natural;
  return remaining[Math.floor(remaining.length / 2)];
}

/**
 * The concrete day a soft-horizon task is *suggested* for, or null when there's
 * nothing to suggest: completed, already dated (`plannedFor`), Inbox (`horizon`
 * null), or Someday (no clock). Never mutates — purely derived from the horizon.
 */
export function suggestedDayFor(task: Task, today: ISODate): ISODate | null {
  if (!isOpen(task) || task.plannedFor != null) return null;
  const h = task.horizon;
  if (h == null || h.unit === "someday" || h.anchor == null) return null;
  const anchor = h.anchor; // narrowed to string by the guard above

  const window =
    h.unit === "week"
      ? [0, 1, 2, 3, 4].map((i) => addDays(weekStart(anchor), i)) // Mon–Fri
      : daysInclusive(monthStart(anchor), monthEnd(anchor));
  return pickSuggested(window, today);
}

/** Incomplete horizon tasks whose suggested day is today — the "Suggested for today" surface. */
export function suggestedForToday(tasks: Task[], today: ISODate): Task[] {
  const out: Task[] = [];
  walk(tasks, (t) => {
    if (suggestedDayFor(t, today) === today) out.push(t);
  });
  return out;
}

// ─── Recurrences → the "Recurring" section + today's suggestions ────

/** One "Every day" / "Every Mon" pattern header and the recurrences under it. */
export interface RecurrenceGroup {
  label: string;
  sortKey: number;
  recurrences: Recurrence[];
}

/** Group recurrences by their rule's pattern label (day → week → month → year). */
export function groupRecurrencesByRule(recurrences: Recurrence[]): RecurrenceGroup[] {
  const byLabel = new Map<string, RecurrenceGroup>();
  for (const rec of recurrences) {
    const label = ruleLabel(rec.rule);
    const existing = byLabel.get(label);
    if (existing != null) existing.recurrences.push(rec);
    else byLabel.set(label, { label, sortKey: ruleSortKey(rec.rule), recurrences: [rec] });
  }
  return [...byLabel.values()].sort(
    (a, b) => a.sortKey - b.sortKey || a.label.localeCompare(b.label)
  );
}

/**
 * Recurrence ids that must NOT re-suggest today (the on-completion suppression):
 * an accepted instance is still open, or one was already accepted for today (so
 * completing it doesn't immediately re-offer the same task).
 */
export function suppressedRecurrenceIds(tasks: Task[], today: ISODate): Set<RecurrenceId> {
  const out = new Set<RecurrenceId>();
  walk(tasks, (t) => {
    if (t.recurrenceId == null) return;
    if (!t.completed || t.occurrenceDate === today) out.add(t.recurrenceId);
  });
  return out;
}

/** Recurrences firing today that aren't suppressed — Today's "Recurring" suggestions. */
export function recurringForToday(
  recurrences: Recurrence[],
  tasks: Task[],
  today: ISODate
): Recurrence[] {
  const suppressed = suppressedRecurrenceIds(tasks, today);
  return recurrences.filter((r) => !suppressed.has(r.id) && ruleFiresOn(r.rule, today));
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
    if (t.wontDo != null) continue; // skipped tasks drop out of the tally
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
    if (t.wontDo != null) return; // skipped — neither open nor done; set aside
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
