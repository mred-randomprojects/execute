// ─── Core domain types ──────────────────────────────────────────────

/** Branded id so a TaskId can never be confused with a plain string. */
export type TaskId = string & { readonly __brand: "TaskId" };

/** Local-calendar date, "YYYY-MM-DD". The unit the whole app reasons in. */
export type ISODate = string;

export type TaskPriority = 1 | 2 | 3 | 4;

export interface Task {
  id: TaskId;
  text: string;
  notes: string;
  completed: boolean;
  completedAt: number | null;
  children: Task[];
  createdAt: number;
  priority: TaskPriority;
  /**
   * The day this task is committed to. `null` = unplanned (lives in the backlog).
   * "Today" = an incomplete *leaf* whose plannedFor === today's date.
   * A task with incomplete children is a container, never itself "today".
   */
  plannedFor: ISODate | null;
  labels: string[];
  estimatedMinutes: number | null;
}

export type ThemeName = "slate" | "ivory" | "carbon" | "bordeaux";

/** The single persisted document. */
export interface AppState {
  schemaVersion: number;
  tasks: Task[];
  theme: ThemeName;
  /** Last calendar date the app was opened — drives rollover detection. */
  lastOpenedDate: ISODate | null;
  /** Dev-only: pretend "today" is this date, to exercise the rollover ritual. */
  devDateOverride: ISODate | null;
}

export const SCHEMA_VERSION = 1;

export function emptyState(): AppState {
  return {
    schemaVersion: SCHEMA_VERSION,
    tasks: [],
    theme: "slate",
    lastOpenedDate: null,
    devDateOverride: null,
  };
}
