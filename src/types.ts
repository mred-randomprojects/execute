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

/**
 * Blocked on someone else. NOT a resolution — the task is still open and still
 * yours eventually; it just isn't yours *today*.
 *
 * Before this existed, a task waiting on a reply had nowhere honest to go. It
 * couldn't be finished, so it failed the day; it couldn't be declined, because
 * you still want it; so it got postponed, again and again, until it was a zombie
 * in the backlog with a postpone count that blamed you for someone else's
 * silence. A blocked task now steps out of the Reckoning and out of the day's
 * tally without being resolved, because holding you to a deadline you don't
 * control teaches you to ignore deadlines.
 *
 * The obvious failure mode is a task that sits here forever, which is exactly
 * the zombie this replaces — so `since` is shown, and the weekly review lists
 * what you're waiting on, oldest first.
 */
export interface WaitingOn {
  /** Who or what it's blocked on. Optional: sometimes you only know it isn't you. */
  who: string | null;
  since: number;
}

/** Past this many days, a "waiting" badge stops being neutral and starts nagging. */
export const WAITING_STALE_DAYS = 14;

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
  /**
   * Blocked on someone else — see {@link WaitingOn}. Cleared by completing or
   * declining the task, since both settle it.
   */
  waitingOn: WaitingOn | null;
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
   * How many times this task has been deliberately *pushed to another day* — the
   * Reckoning's postpone, and the board's "push to later".
   *
   * The counterpart to {@link carriedCount}, and the more important of the two:
   * keeping a task for today at least keeps the commitment, while postponing is
   * the cheap exit — one keystroke, and until this existed, invisible. A task
   * could go to the backlog fifteen times over four months and the app would
   * never once mention it. Postponing stays allowed (a mindful "not today" beats
   * a silent overrun) but it is now *counted*, so chronic deferral has to answer
   * for itself. Monotonic, never reset.
   */
  postponedCount: number;
  /**
   * If this task was materialized from a recurrence, the source recurrence id
   * (set on the instance root only) — used to suppress re-suggesting while the
   * instance is still open. `null` for ordinary tasks.
   */
  recurrenceId: RecurrenceId | null;
  /** Which occurrence (its firing day) this instance represents. `null` otherwise. */
  occurrenceDate: ISODate | null;
  /**
   * Wall-clock ms of the calendar event this task was most recently sent to (via
   * "Add to calendar"). Deliberately *decoupled* from any real event: we keep no
   * event id and never read the calendar back, so one task can spawn many events
   * and this is only a lightweight "when did I last block time for this" stamp —
   * it drives the row's calendar badge and the "scheduled today" cue. `null` =
   * never calendared. See src/store/calendar.ts.
   */
  scheduledAt: number | null;
}

export type ThemeName = "slate" | "ivory" | "carbon" | "bordeaux";

/**
 * Per-command usage stats behind the command palette's frecency ranking
 * (Raycast-style: frequently *and* recently used commands float to the top).
 * Keyed by {@link import("./components/CommandPalette").Command}'s `id`.
 * `count` is how many times the command was run from the palette; `lastUsedAt`
 * is the wall-clock ms of the most recent run. A per-device preference —
 * writer wins on cloud merge, like {@link AppState.theme}.
 */
export interface CommandUsage {
  count: number;
  lastUsedAt: number;
}

/**
 * The atom of the effort estimate: a task's `estimatedMinutes` is presented and
 * edited in whole "blocks" of this many minutes (one block ≈ a short focused
 * sitting). 1 block = 20m, 3 blocks = 1h — a deliberately shallow scale.
 */
export const BLOCK_MINUTES = 20;

/** Default daily capacity, in blocks (~4h of estimated task-work). Editable. */
export const DEFAULT_CAPACITY_BLOCKS = 12;

/**
 * What one day amounted to. Sealed as the day is lived (upserted while the app is
 * open on that date), because it can't be reconstructed later: once a leftover is
 * postponed to next Tuesday, nothing in the task tree remembers it was ever
 * promised to a Thursday in March.
 *
 * `closedAt` is the whole point. A day is **closed** when every commitment it
 * carried has an outcome — finished, consciously declined, or faced in the
 * Reckoning and moved on purpose. Not "you did everything": that is unreachable
 * on a bad day, and a target you can miss by having a bad day is a target that
 * teaches you to stop looking. Closing is achievable every single day, and it
 * rewards exactly what the app is for — a mindful postpone over a silent overrun.
 */
export interface DayRecord {
  date: ISODate;
  /** Commitments the day carried — today-leaves, including won't-do ones. */
  committed: number;
  done: number;
  /**
   * Estimated minutes on the work actually finished that day. The empirical
   * answer to "how much fits in a day" — the number `dailyCapacityBlocks` is
   * supposed to be, but which has only ever been *declared*.
   */
  doneMinutes: number;
  /** Consciously declined ("won't do") — a resolution, not a failure. */
  skipped: number;
  /**
   * When the day FIRST reached "nothing open, nothing overdue". Stamped once and
   * never cleared: committing to something new at 6pm is new work, and it doesn't
   * un-earn the moment you got to zero.
   */
  closedAt: number | null;
}

/** Roughly thirteen months of day records — enough for a year-long heatmap. */
export const MAX_DAY_RECORDS = 400;

/**
 * How present the app is while its window isn't.
 *
 * The Reckoning, the capacity meter and the deferral ledger all assume the app
 * gets opened. Nothing in the product made that happen: closed, Execute had no
 * menu-bar item, no badge, no way to be reached — the entire ritual was
 * conditional on remembering a thing whose job is to be remembered *for* you.
 *
 * Desktop-only and per-device (writer wins on cloud merge): a menu bar and a
 * login item belong to a machine, not to an account.
 */
export interface Presence {
  /** Menu-bar item showing what's left today (`✓` at zero). Passive — pull, not push. */
  tray: boolean;
  /** Launch Execute at login. Off by default: it adds a system-level login item. */
  openAtLogin: boolean;
  /**
   * The two daily nudges — and only two. A notification you didn't need costs
   * more than one you missed, because the third one gets the whole app muted.
   */
  nudges: boolean;
  /** Local hour (0–23) for the morning "here's your day" nudge. */
  morningHour: number;
  /** Local hour (0–23) for the evening "close the day" nudge. */
  eveningHour: number;
}

export function defaultPresence(): Presence {
  return {
    tray: true,
    // Off by default. Everything else here lives inside the app and is undone by
    // flipping it back; a login item shows up in the OS's own settings, and
    // adding one uninvited is the kind of thing that gets an app deleted.
    openAtLogin: false,
    nudges: true,
    morningHour: 9,
    eveningHour: 18,
  };
}

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

/**
 * What a line of the action history records: the action itself, or a later move
 * back and forth over it. Undo and redo are events in their own right — the log
 * is append-only, so it tells you what actually happened, not what survived.
 */
export type ActionLogKind = "do" | "undo" | "redo";

/**
 * One line of the append-only action history (the `⌘ y` panel). Deliberately
 * light — a sentence and a timestamp, never a state snapshot — so the whole log
 * can be persisted and synced without weighing the document down. The undoable
 * *snapshots* live in memory only (see the undo stack in src/store/store); `id`
 * is the join between the two, so the panel can tell which lines are still
 * reachable by undo in this session.
 */
export interface ActionLogEntry {
  id: string;
  /** Human sentence, written at the mutation site, e.g. `Complete “Buy milk”`. */
  label: string;
  kind: ActionLogKind;
  at: number;
}

/** How many action-history lines to keep. Trimmed oldest-first. */
export const ACTION_LOG_LIMIT = 200;

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
  /**
   * How many 20-minute {@link BLOCK_MINUTES} blocks the user reckons they can
   * take on in a day. Drives the soft capacity meter on the planning board — a
   * gauge, never a hard cap. A per-user setting (writer-wins on cloud merge).
   */
  dailyCapacityBlocks: number;
  /**
   * Whether the reckoning renders as the two-panel planning board (true) or the
   * classic card review (false). A per-user preference, toggled with `v`;
   * persisted so a multi-day experiment sticks. Writer-wins on cloud merge.
   */
  boardPreferred: boolean;
  /**
   * Command-palette usage stats keyed by command id — the memory behind its
   * frecency ranking (see {@link CommandUsage}). Empty until the first palette
   * run. A per-device preference; writer wins on cloud merge.
   */
  commandUsage: Record<string, CommandUsage>;
  /**
   * Append-only history of everything you did, newest first, capped at
   * {@link ACTION_LOG_LIMIT}. Written at the store's single mutation choke
   * point, so nothing can change without leaving a line. Never rolled back —
   * undoing an action *adds* a line rather than erasing one. Merged as a union
   * across devices, so the log reads as one trail.
   */
  actionLog: ActionLogEntry[];
  /** Menu bar / login item / daily nudges — see {@link Presence}. Per-device. */
  presence: Presence;
  /**
   * One record per day the app has seen, oldest first, capped at
   * {@link MAX_DAY_RECORDS}. The spine of the closing streak and the heatmap —
   * see {@link DayRecord} for why this is stored rather than derived.
   */
  days: DayRecord[];
}

export const SCHEMA_VERSION = 16;
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
    dailyCapacityBlocks: DEFAULT_CAPACITY_BLOCKS,
    boardPreferred: false,
    commandUsage: {},
    actionLog: [],
    presence: defaultPresence(),
    days: [],
  };
}
