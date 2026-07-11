// ─── Core domain types ──────────────────────────────────────────────

/** Branded id so a TaskId can never be confused with a plain string. */
export type TaskId = string & { readonly __brand: "TaskId" };
export type ProjectId = string & { readonly __brand: "ProjectId" };
export type ProjectRowId = string & { readonly __brand: "ProjectRowId" };
export type RecurrenceId = string & { readonly __brand: "RecurrenceId" };
export type OutlineId = TaskId | ProjectRowId;

/** Local-calendar date, "YYYY-MM-DD". The unit the whole app reasons in. */
export type ISODate = string;

export type TaskPriority = 1 | 2 | 3 | 4;

/**
 * A soft, fuzzy sense of "when" — distinct from a concrete `plannedFor` date.
 * Week/month horizons are anchored to a real period (`anchor` is a week key
 * "YYYY-Www" or month key "YYYY-MM"); "someday" has no anchor. Horizons never
 * feed the Reckoning — only concrete dates do.
 */
export type HorizonUnit = "week" | "month" | "someday";

export interface Horizon {
  unit: HorizonUnit;
  anchor: string | null;
}

/**
 * A deliberate "won't do" / intentionally-skipped resolution. Distinct from
 * `completed`: the task is *resolved* (out of the Reckoning, off the counts) but
 * consciously declined rather than accomplished. Mutually exclusive with
 * `completed` — setters clear one when setting the other. `reason` is optional
 * (captured inline, like the Reckoning's reasons); `at` is when it was skipped.
 */
export interface WontDo {
  reason: string | null;
  at: number;
}

// ─── Recurrence (repeating tasks) ───────────────────────────────────
//
// A recurrence is a *definition*, not a spawned task: a task template plus a
// rule. On days the rule fires, the template surfaces in Today as a suggestion
// the user can accept (which materializes a real, dated commitment). Templates
// live in their own array, never in `tasks`, so they can never reckon or be
// counted — only accepted instances do.

export type RecurrenceFreq = "day" | "week" | "month" | "year";

/** When a recurrence stops offering itself. */
export type RecurrenceEnds =
  | { kind: "never" }
  | { kind: "on"; date: ISODate }
  | { kind: "after"; count: number };

/**
 * An RRULE-ish spec matching the familiar calendar "Repeat" UI. `anchor` is the
 * reference day the cadence is measured from (also the day-of-month for monthly
 * and the month/day for yearly). `weekdays` (ISO 1=Mon…7=Sun) only applies to
 * the weekly frequency.
 */
export interface RecurrenceRule {
  freq: RecurrenceFreq;
  interval: number; // "every N" — always >= 1
  weekdays: number[]; // ISO weekdays; meaningful only when freq === "week"
  anchor: ISODate;
  ends: RecurrenceEnds;
}

export interface Recurrence {
  id: RecurrenceId;
  /** The task subtree spawned on acceptance (children preserved verbatim). */
  template: Task;
  rule: RecurrenceRule;
  createdAt: number;
}

export interface Project {
  id: ProjectId;
  name: string;
  color: string;
  createdAt: number;
}

export interface Task {
  id: TaskId;
  projectId: ProjectId;
  text: string;
  notes: string;
  completed: boolean;
  completedAt: number | null;
  /**
   * When set, the task is "won't do" — intentionally skipped (see {@link WontDo}).
   * Mutually exclusive with `completed`; both false/null = an open task. Skipped
   * leaves never reckon and are dropped from the done/total counts.
   */
  wontDo: WontDo | null;
  children: Task[];
  createdAt: number;
  /**
   * Wall-clock ms of the last change to this task's *own* fields (not its
   * children). Stamped automatically at the store's mutation choke point and
   * used by cloud sync for per-task last-write-wins merging. See src/sync/merge.
   */
  updatedAt: number;
  priority: TaskPriority;
  /**
   * The day this task is committed to. `null` = no concrete date.
   * "Today" = an incomplete *leaf* whose plannedFor === today's date.
   * A task with incomplete children is a container, never itself "today".
   * A concrete date is what the Reckoning gates on.
   */
  plannedFor: ISODate | null;
  /**
   * Fuzzy "when" bucket (this/next week, this/next month, someday). Mutually
   * exclusive with `plannedFor` — at most one is set; both null = Inbox.
   */
  horizon: Horizon | null;
  labels: string[];
  estimatedMinutes: number | null;
  /**
   * How many times this task has been deliberately *kept for today* out of the
   * Reckoning (re-committed unchanged rather than finished, deferred, or dropped).
   * Drives the "carried N×" badge so chronic dodging stays visible. Never reset.
   */
  carriedCount: number;
  /**
   * If this task was materialized from a recurrence, the source recurrence id
   * (set on the instance root only) — used to suppress re-suggesting while the
   * instance is still open. `null` for ordinary tasks.
   */
  recurrenceId: RecurrenceId | null;
  /** Which occurrence (its firing day) this instance represents. `null` otherwise. */
  occurrenceDate: ISODate | null;
}

export type ThemeName = "slate" | "ivory" | "carbon" | "bordeaux";

/** A task removed from the tree, retained in the Trash so deletes are reversible. */
export interface TrashedTask {
  task: Task;
  deletedAt: number;
}

/** Accountability events. Optional reasons can later be fed to an AI for analysis. */
export type LogAction =
  | "completed"
  | "uncompleted"
  | "postponed"
  | "dropped"
  | "brokeDown"
  | "kept"
  | "skipped";

export interface LogEntry {
  id: string;
  taskId: TaskId;
  taskText: string;
  action: LogAction;
  reason: string | null;
  at: number;
  date: ISODate;
}

/** The single persisted document. */
export interface AppState {
  schemaVersion: number;
  projects: Project[];
  tasks: Task[];
  /** Recurrence definitions (templates + rules). Never counted or reckoned. */
  recurrences: Recurrence[];
  trash: TrashedTask[];
  log: LogEntry[];
  theme: ThemeName;
  /** The one task the user is focusing on "right now" — surfaced in a banner. */
  currentTaskId: TaskId | null;
  /** Last calendar date the app was opened — drives rollover detection. */
  lastOpenedDate: ISODate | null;
  /** Dev-only: pretend "today" is this date, to exercise the rollover ritual. */
  devDateOverride: ISODate | null;
}

export const SCHEMA_VERSION = 7;
export const DEFAULT_PROJECT_ID = "project-inbox" as ProjectId;
export const PROJECT_ROW_PREFIX = "project:";

export function projectRowId(projectId: ProjectId): ProjectRowId {
  return `${PROJECT_ROW_PREFIX}${projectId}` as ProjectRowId;
}

export function isProjectRowId(id: OutlineId | string | null): id is ProjectRowId {
  return typeof id === "string" && id.startsWith(PROJECT_ROW_PREFIX);
}

export function projectIdFromRowId(id: ProjectRowId): ProjectId {
  return id.slice(PROJECT_ROW_PREFIX.length) as ProjectId;
}

export const PROJECT_COLORS = [
  "#2f4b8f",
  "#8c4b2f",
  "#2f735f",
  "#7c3f64",
  "#7a651f",
  "#4f5f9f",
  "#6d5f86",
  "#4e7135",
] as const;

export function defaultProject(): Project {
  return {
    id: DEFAULT_PROJECT_ID,
    name: "Inbox",
    color: PROJECT_COLORS[0],
    createdAt: 0,
  };
}

export function emptyState(): AppState {
  return {
    schemaVersion: SCHEMA_VERSION,
    projects: [defaultProject()],
    tasks: [],
    recurrences: [],
    trash: [],
    log: [],
    theme: "slate",
    currentTaskId: null,
    lastOpenedDate: null,
    devDateOverride: null,
  };
}
