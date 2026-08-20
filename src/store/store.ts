import { useSyncExternalStore } from "react";
import { nanoid } from "nanoid";
import type {
  ActionLogEntry,
  AppState,
  DayRecord,
  Horizon,
  ISODate,
  LogAction,
  LogEntry,
  Presence,
  ProjectId,
  Recurrence,
  RecurrenceId,
  RecurrenceRule,
  Task,
  TaskId,
  TaskPriority,
  ThemeName,
  WontDo,
} from "../types";
import {
  ACTION_LOG_LIMIT,
  DEFAULT_PROJECT_ID,
  MAX_DAY_RECORDS,
  PROJECT_COLORS,
  emptyState,
} from "../types";
import {
  assignProjectDeep,
  cloneWithNewIds,
  findById,
  findParentId,
  getAncestorPath,
  indentTask,
  isOpen,
  indentUnder,
  makeTask,
  mapById,
  moveSibling,
  normalizeChildProjects,
  outdentTask,
  relocateAfter,
  relocateAsChild,
  relocateTask,
  removeById,
  reorderSelected,
  reorderSelectedAcrossProjects,
  setProjectForIds,
} from "./tasks";
import { normalizeRule } from "./recurrence";
import { horizonWords } from "../selectors";
import { todayISO } from "./dates";
import { coerceState, loadRaw, saveRaw } from "./persistence";

// ─── Singleton store ────────────────────────────────────────────────

let state: AppState = emptyState();
let ready = false;
// Set when the initial load ultimately fails, so the UI can show a retry prompt
// instead of hanging on the blank loading screen forever.
let loadError: string | null = null;
const listeners = new Set<() => void>();

const MAX_UNDO = 100;

/**
 * One reversible step. The snapshot is the state as it was *before* the action;
 * `touched` is the set of task ids the action added, removed, or edited — its
 * footprint, which {@link restamp} needs to make the reversal stick across the
 * cloud. `id` is shared with the matching {@link ActionLogEntry}, so the history
 * panel can tell which of its (persisted) lines are still reachable in memory.
 */
interface HistoryStep {
  id: string;
  label: string;
  at: number;
  state: AppState;
  touched: Set<TaskId>;
}

/** A history step as the UI sees it — no snapshot, just the line. */
export interface HistoryStepView {
  id: string;
  label: string;
  at: number;
}

let undoStack: HistoryStep[] = [];
let redoStack: HistoryStep[] = [];

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function notify() {
  for (const l of listeners) l();
}

// Optional hook fired right after each local persist. Cloud sync registers here
// (see src/sync/desktopSync) so it mirrors EVERY change without any per-mutation
// wiring — because it rides the single save choke point that update()/undo() all
// funnel through, no mutation can silently skip a sync.
let onPersist: (() => void) | null = null;
export function setCloudSync(fn: (() => void) | null): void {
  onPersist = fn;
}

// Fired once the local store has finished loading. Cloud PULL gates on this so
// it never merges remote data into — or races ahead of — the empty pre-load
// state (which initStore would then clobber on disk read).
const readyListeners = new Set<() => void>();
export function subscribeReady(cb: () => void): () => void {
  readyListeners.add(cb);
  if (ready) cb();
  return () => {
    readyListeners.delete(cb);
  };
}

/**
 * Adopt whole state pulled from the cloud (the PULL half of two-way sync).
 * Deliberately does NOT go through update()/scheduleSave's `onPersist` hook, so
 * adopting a remote snapshot never schedules a push back — that would echo
 * forever. We still persist to local disk (durability) and notify subscribers.
 * Undo history is left intact: it holds the user's own edit steps, which a
 * remote change from another device doesn't invalidate. Callers must only pass
 * a state that already reflects local edits (i.e. a merge, not a raw remote),
 * so this can't drop unsynced local work.
 */
export function adoptRemote(next: AppState): void {
  state = next;
  notify();
  void saveRaw(state);
}

function scheduleSave() {
  if (saveTimer != null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void saveRaw(state);
    onPersist?.();
  }, 200);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): AppState {
  return state;
}

// ─── Automatic per-task updatedAt stamping ──────────────────────────
//
// Cloud sync merges per task by updatedAt (see src/sync/merge). Rather than
// bump the stamp at each of the dozens of mutation sites (easy to forget), we
// diff the whole tree once at the single update() choke point: any task whose
// *own* fields changed gets stamped `now`. Structural sharing is preserved, so
// untouched subtrees keep their identity (and don't re-render).

function horizonEq(a: Task["horizon"], b: Task["horizon"]): boolean {
  if (a == null || b == null) return a === b;
  return a.unit === b.unit && a.anchor === b.anchor;
}
function wontDoEq(a: Task["wontDo"], b: Task["wontDo"]): boolean {
  if (a == null || b == null) return a === b;
  return a.reason === b.reason && a.at === b.at;
}
function waitingEq(a: Task["waitingOn"], b: Task["waitingOn"]): boolean {
  if (a == null || b == null) return a === b;
  return a.who === b.who && a.since === b.since;
}
function labelsEq(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
function sameOwnFields(a: Task, b: Task): boolean {
  return (
    a.text === b.text &&
    a.notes === b.notes &&
    a.completed === b.completed &&
    a.completedAt === b.completedAt &&
    a.projectId === b.projectId &&
    a.priority === b.priority &&
    a.plannedFor === b.plannedFor &&
    a.estimatedMinutes === b.estimatedMinutes &&
    a.carriedCount === b.carriedCount &&
    a.postponedCount === b.postponedCount &&
    a.recurrenceId === b.recurrenceId &&
    a.occurrenceDate === b.occurrenceDate &&
    a.scheduledAt === b.scheduledAt &&
    horizonEq(a.horizon, b.horizon) &&
    wontDoEq(a.wontDo, b.wontDo) &&
    waitingEq(a.waitingOn, b.waitingOn) &&
    labelsEq(a.labels, b.labels)
  );
}
function indexById(tasks: Task[], into: Map<TaskId, Task>): void {
  for (const t of tasks) {
    into.set(t.id, t);
    indexById(t.children, into);
  }
}
function stampNode(
  node: Task,
  prevById: Map<TaskId, Task>,
  now: number,
  touched: Set<TaskId>,
): Task {
  let children = node.children;
  if (children.length > 0) {
    const mapped = children.map((c) => stampNode(c, prevById, now, touched));
    if (mapped.some((c, i) => c !== children[i])) children = mapped;
  }
  const before = prevById.get(node.id);
  const ownChanged = before == null || !sameOwnFields(before, node);
  if (ownChanged) touched.add(node.id);
  const updatedAt = ownChanged ? now : node.updatedAt;
  if (children === node.children && updatedAt === node.updatedAt) return node;
  return { ...node, children, updatedAt };
}

/** The stamped state plus the ids the transform actually touched. */
interface Stamped {
  state: AppState;
  touched: Set<TaskId>;
}

function stampTasks(prev: AppState, next: AppState): Stamped {
  if (next.tasks === prev.tasks) return { state: next, touched: new Set() };
  const prevById = new Map<TaskId, Task>();
  indexById(prev.tasks, prevById);
  const nextById = new Map<TaskId, Task>();
  indexById(next.tasks, nextById);
  const now = Date.now();
  const touched = new Set<TaskId>();
  // Deletions have to be collected separately: `stampNode` only ever walks the
  // *next* tree, so a task that was trashed leaves no node behind to mark — and
  // it's exactly the one undo has to resurrect against its own tombstone.
  for (const id of prevById.keys()) if (!nextById.has(id)) touched.add(id);
  const tasks = next.tasks.map((t) => stampNode(t, prevById, now, touched));
  return { state: { ...next, tasks }, touched };
}

/**
 * Re-stamp `updatedAt = now` on exactly the tasks an undone (or redone) action
 * touched. This is what makes undo *stick* once you're signed in: cloud sync
 * resolves every task by last-write-wins on `updatedAt` (see src/sync/merge), so
 * a snapshot restored with its original — older — stamps loses to the very edit
 * it was meant to reverse, and the next pull puts that edit straight back.
 * Restoring a trashed task is the same story against its tombstone, which wins
 * while `deletedAt >= updatedAt`.
 *
 * Scoped to the footprint on purpose. Tasks *outside* it keep the snapshot's
 * stamps, so undoing your own edit can't also clobber an unrelated task another
 * device changed in the meantime — that one stays older, loses LWW, and heals on
 * the next pull.
 */
function restamp(target: AppState, touched: Set<TaskId>): AppState {
  if (touched.size === 0) return target;
  const now = Date.now();
  const walk = (nodes: Task[]): Task[] =>
    nodes.map((t) => {
      const children = t.children.length > 0 ? walk(t.children) : t.children;
      if (!touched.has(t.id)) return children === t.children ? t : { ...t, children };
      return { ...t, children, updatedAt: now };
    });
  return { ...target, tasks: walk(target.tasks) };
}

/** Prepend one line to the action history, capped. `log` is the trail to extend
 *  — passed explicitly because undo restores an old snapshot but must carry the
 *  *current* log forward: the history records what happened, and an undo did. */
function withHistory(
  s: AppState,
  log: ActionLogEntry[],
  entry: ActionLogEntry,
): AppState {
  return { ...s, actionLog: [entry, ...log].slice(0, ACTION_LOG_LIMIT) };
}

/**
 * Apply a transform. `label` is the sentence this change goes down as in the
 * history (`Complete “Buy milk”`) — and passing it is what makes the change
 * undoable. `null` means an incidental change that is neither undoable nor
 * worth a history line: preferences, dev-date, rollover bookkeeping.
 *
 * The label is required rather than defaulted so that every new mutation has to
 * answer "what do I call this, and should undo reach it?" at the call site.
 */
function update(fn: (s: AppState) => AppState, label: string | null): void {
  const prev = state;
  const produced = fn(prev);
  // A guard that bailed (`markWontDo` on an already-skipped task, and friends)
  // returns `s` untouched. Stop here: an undo step that does nothing, and a
  // history line for a change that never happened, are both worse than silence.
  if (produced === prev) return;

  const { state: next, touched } = stampTasks(prev, produced);
  if (label == null) {
    state = next;
  } else {
    const id = nanoid();
    const at = Date.now();
    undoStack = [{ id, label, at, state: prev, touched }, ...undoStack].slice(0, MAX_UNDO);
    redoStack = []; // a new action forks the timeline — nothing left to redo
    state = withHistory(next, next.actionLog, { id, label, kind: "do", at });
  }
  notify();
  scheduleSave();
}

function updateTasks(fn: (tasks: Task[]) => Task[], label: string | null): void {
  update((s) => ({ ...s, tasks: fn(s.tasks) }), label);
}

// ─── History labels ─────────────────────────────────────────────────
//
// Every undoable mutation names itself. Kept here (at the effect, not at the
// keybinding) so a change made with the mouse, the palette, or a keystroke all
// land the same line — there is no path into the store that skips this.

const LABEL_TITLE_MAX = 40;

/** A task title, trimmed and quoted for a history line. */
function quoteText(text: string): string {
  const clean = text.trim();
  if (clean === "") return "an untitled task";
  const short =
    clean.length > LABEL_TITLE_MAX ? `${clean.slice(0, LABEL_TITLE_MAX - 1)}…` : clean;
  return `“${short}”`;
}

function quote(task: Task | null | undefined): string {
  return quoteText(task?.text ?? "");
}

/** `New task “Buy milk”` — or just `New task`, for something not yet named. */
function titled(prefix: string, text: string): string {
  return text.trim() === "" ? prefix : `${prefix} ${quoteText(text)}`;
}

/** `“Buy milk”` for a single id, `3 tasks` for several — a line's subject. */
function subject(ids: TaskId[], tasks: Task[] = state.tasks): string {
  if (ids.length === 1) return quote(findById(tasks, ids[0]));
  return `${ids.length} tasks`;
}

function topLevelIdFor(tasks: Task[], id: TaskId): TaskId {
  return getAncestorPath(tasks, id)[0]?.id ?? id;
}

// ─── Lifecycle ──────────────────────────────────────────────────────

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Reject if `p` hasn't settled within `ms`. A cold-start load that never comes
 * back (e.g. an IPC reply that never arrives) would otherwise hang `initStore`
 * forever — and with it the whole app on the loading screen. With a timeout it
 * fails instead, so the retry/error path can take over. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Loading your tasks timed out.")),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export async function initStore(loadTimeoutMs = 4000): Promise<void> {
  // Load the local store, retrying a couple of times so a transient read/IPC
  // hiccup on a cold start recovers on its own, and bounding each attempt so a
  // stuck load can't hang. CRITICAL: this must ALWAYS reach `ready = true`.
  // Previously any rejection (or a load that never resolved) left the app stuck
  // forever on the blank loading screen (`ready` never flipped); this makes that
  // impossible — a real failure now surfaces a retry prompt instead of hanging.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      state = coerceState(await withTimeout(loadRaw(), loadTimeoutMs));
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await delay(150);
    }
  }
  loadError =
    lastErr == null
      ? null
      : lastErr instanceof Error
        ? lastErr.message
        : "Failed to load your saved tasks.";
  if (lastErr != null) {
    // eslint-disable-next-line no-console
    console.error("initStore: could not load the local store", lastErr);
  }
  ready = true;
  notify();
  for (const l of readyListeners) l();
}

export function getState(): AppState {
  return state;
}

/** True once the local store has finished loading — cloud sync gates on this so
 * it can never push the empty pre-load state over good cloud data. */
export function getReady(): boolean {
  return ready;
}

/** Non-null when the initial load failed (after retries) — the UI shows a retry
 * prompt rather than leaving the user on a blank/hung loading screen. */
export function getLoadError(): string | null {
  return loadError;
}

export function useStore(): { state: AppState; ready: boolean; loadError: string | null } {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  return { state: s, ready, loadError };
}

// ─── App-level settings ─────────────────────────────────────────────

export function setTheme(theme: ThemeName): void {
  update((s) => ({ ...s, theme }), null);
}

export function setDevDateOverride(date: ISODate | null): void {
  update((s) => ({ ...s, devDateOverride: date }), null);
}

export function markOpened(date: ISODate): void {
  update((s) => ({ ...s, lastOpenedDate: date }), null);
}

/**
 * Upsert today's {@link DayRecord} — the streak's raw material. Called from a
 * render effect on every change, so it MUST return the state untouched when
 * nothing actually moved: `update()` bails on an identical object, and that bail
 * is the only thing standing between this and an infinite render loop.
 *
 * Every field is a HIGH-WATER MARK, which is the whole reason this is stored
 * rather than counted from the tree on demand. The live tally shrinks as tasks
 * leave the day: carry your last task to tomorrow and today suddenly looks like
 * a day that asked nothing of you — so the record would forget the commitment
 * existed, and the day would read as empty instead of closed. Monotonic counts
 * remember what the day was actually asked to carry.
 *
 * `closedAt` is write-once for the same reason: the day was closed at the moment
 * it first reached zero, and taking on something new at 6pm is new work rather
 * than a retraction.
 */
export function recordDay(
  date: ISODate,
  tally: { committed: number; done: number; doneMinutes: number; skipped: number },
  closed: boolean
): void {
  update((s) => {
    const prev = s.days.find((d) => d.date === date);
    const next: DayRecord = {
      date,
      committed: Math.max(prev?.committed ?? 0, tally.committed),
      done: Math.max(prev?.done ?? 0, tally.done),
      doneMinutes: Math.max(prev?.doneMinutes ?? 0, tally.doneMinutes),
      skipped: Math.max(prev?.skipped ?? 0, tally.skipped),
      closedAt: prev?.closedAt ?? (closed ? Date.now() : null),
    };
    if (
      prev != null &&
      prev.committed === next.committed &&
      prev.done === next.done &&
      prev.doneMinutes === next.doneMinutes &&
      prev.skipped === next.skipped &&
      prev.closedAt === next.closedAt
    ) {
      return s;
    }
    const others = s.days.filter((d) => d.date !== date);
    const days = [...others, next]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-MAX_DAY_RECORDS);
    return { ...s, days };
  }, null);
}

/** Set the daily capacity budget, in blocks (clamped to ≥ 1). Not undoable. */
export function setDailyCapacityBlocks(blocks: number): void {
  const clamped = Math.max(1, Math.round(blocks));
  update((s) => ({ ...s, dailyCapacityBlocks: clamped }), null);
}

/** Choose how the reckoning renders (board vs. card review). Not undoable. */
export function setBoardPreferred(preferred: boolean): void {
  update((s) => ({ ...s, boardPreferred: preferred }), null);
}

/**
 * Change how present the app is when its window isn't (menu bar, login item,
 * nudges). A per-device preference like the theme — not undoable, and writer-wins
 * on cloud merge.
 */
export function setPresence(patch: Partial<Presence>): void {
  update((s) => ({ ...s, presence: { ...s.presence, ...patch } }), null);
}

/** Set (or clear, with null) the "right now" task. A focus pointer, not undoable. */
export function setCurrentTask(id: TaskId | null): void {
  update((s) => ({ ...s, currentTaskId: id }), null);
}

/**
 * Record one run of a palette command, feeding its frecency ranking (bumps the
 * count and stamps "now"). A usage stat, like theme — not undoable.
 */
export function recordCommandUse(id: string): void {
  update((s) => {
    const prev = s.commandUsage[id];
    return {
      ...s,
      commandUsage: {
        ...s.commandUsage,
        [id]: { count: (prev?.count ?? 0) + 1, lastUsedAt: Date.now() },
      },
    };
  }, null);
}

/**
 * Forget a command's ranking (Raycast's "Reset Ranking"): drop its usage entry
 * so it falls back to its default position in the palette. No-op if unused.
 */
export function resetCommandRanking(id: string): void {
  update((s) => {
    if (s.commandUsage[id] == null) return s;
    const next = { ...s.commandUsage };
    delete next[id];
    return { ...s, commandUsage: next };
  }, null);
}

// ─── Insert ─────────────────────────────────────────────────────────

function insertAfterSibling(tasks: Task[], afterId: TaskId | null, newTask: Task): Task[] {
  if (afterId == null) return [...tasks, newTask];
  const parentId = findParentId(tasks, afterId);
  if (parentId == null) {
    const idx = tasks.findIndex((t) => t.id === afterId);
    const r = [...tasks];
    r.splice(idx + 1, 0, newTask);
    return r;
  }
  return mapById(tasks, parentId, (p) => {
    const idx = p.children.findIndex((c) => c.id === afterId);
    const ch = [...p.children];
    ch.splice(idx + 1, 0, newTask);
    return { ...p, children: ch };
  });
}

function insertAtProjectStart(
  tasks: Task[],
  projects: AppState["projects"],
  projectId: ProjectId,
  newTask: Task
): Task[] {
  const existingProjectTaskIndex = tasks.findIndex((task) => task.projectId === projectId);
  if (existingProjectTaskIndex !== -1) {
    const next = [...tasks];
    next.splice(existingProjectTaskIndex, 0, newTask);
    return next;
  }

  const order = new Map(projects.map((project, index) => [project.id, index]));
  const targetIndex = order.get(projectId) ?? 0;
  const laterProjectTaskIndex = tasks.findIndex(
    (task) => (order.get(task.projectId) ?? Number.MAX_SAFE_INTEGER) > targetIndex
  );
  if (laterProjectTaskIndex === -1) return [...tasks, newTask];

  const next = [...tasks];
  next.splice(laterProjectTaskIndex, 0, newTask);
  return next;
}

/** Create a sibling after `afterId` (or append to root when null). */
export function addTaskAfter(
  afterId: TaskId | null,
  text: string,
  plannedFor: ISODate | null = null,
  projectId?: ProjectId
): TaskId {
  const after = afterId == null ? null : findById(state.tasks, afterId);
  const t = {
    ...makeTask(text, projectId ?? after?.projectId ?? DEFAULT_PROJECT_ID),
    plannedFor,
  };
  updateTasks((tasks) => insertAfterSibling(tasks, afterId, t), titled("New task", text));
  return t.id;
}

export function addTaskAtProjectStart(
  projectId: ProjectId,
  text: string,
  plannedFor: ISODate | null = null
): TaskId {
  const t = { ...makeTask(text, projectId), plannedFor };
  update(
    (s) => ({ ...s, tasks: insertAtProjectStart(s.tasks, s.projects, projectId, t) }),
    titled("New task", text),
  );
  return t.id;
}

/** Append a child to `parentId`. Used by the breakdown flow. */
export function addChild(
  parentId: TaskId,
  text: string,
  plannedFor: ISODate | null = null
): TaskId {
  const parent = findById(state.tasks, parentId);
  const child = {
    ...makeTask(text, parent?.projectId ?? DEFAULT_PROJECT_ID),
    plannedFor,
  };
  updateTasks(
    (tasks) => mapById(tasks, parentId, (p) => ({ ...p, children: [...p.children, child] })),
    `New subtask of ${quote(parent)}`,
  );
  return child.id;
}

// ─── Projects ───────────────────────────────────────────────────────

function nextProjectColor(projectCount: number): string {
  return PROJECT_COLORS[projectCount % PROJECT_COLORS.length];
}

export function createProject(name: string): ProjectId {
  const id = nanoid() as ProjectId;
  const cleanName = name.trim() || "New project";
  update((s) => ({
    ...s,
    projects: [
      ...s.projects,
      {
        id,
        name: cleanName,
        color: nextProjectColor(s.projects.length),
        createdAt: Date.now(),
      },
    ],
  }), titled("New project", cleanName));
  return id;
}

export function renameProject(id: ProjectId, name: string): void {
  const cleanName = name.trim();
  if (cleanName === "") return;
  update((s) => ({
    ...s,
    projects: s.projects.map((project) =>
      project.id === id ? { ...project, name: cleanName } : project
    ),
  }), titled("Rename project to", cleanName));
}

export function cycleProjectColor(id: ProjectId): void {
  update((s) => ({
    ...s,
    projects: s.projects.map((project) => {
      if (project.id !== id) return project;
      const i = PROJECT_COLORS.indexOf(project.color as (typeof PROJECT_COLORS)[number]);
      return { ...project, color: PROJECT_COLORS[(i + 1) % PROJECT_COLORS.length] };
    }),
  }), "Change a project’s colour");
}

// ─── Mutate ─────────────────────────────────────────────────────────

export function setText(id: TaskId, text: string): void {
  const before = findById(state.tasks, id);
  // A brand-new row starts empty, so its first commit is a naming, not a rename.
  const named = (before?.text ?? "").trim() !== "";
  const label =
    text.trim() === ""
      ? `Clear the title of ${quote(before)}`
      : `${named ? "Rename" : "Name"} ${quoteText(text)}`;
  updateTasks((tasks) => mapById(tasks, id, (t) => ({ ...t, text })), label);
}

export function setNotes(id: TaskId, notes: string): void {
  updateTasks(
    (tasks) => mapById(tasks, id, (t) => ({ ...t, notes })),
    `Edit the notes on ${quote(findById(state.tasks, id))}`,
  );
}

function makeLog(
  s: AppState,
  task: Task,
  action: LogAction,
  reason: string | null
): LogEntry {
  return {
    id: nanoid(),
    taskId: task.id,
    taskText: task.text,
    action,
    reason,
    at: Date.now(),
    date: todayISO(s.devDateOverride),
  };
}

export function toggleComplete(id: TaskId): void {
  const before = findById(state.tasks, id);
  const willComplete = before != null && !before.completed;
  update((s) => {
    const t = findById(s.tasks, id);
    if (t == null) return s;
    const completed = !t.completed;
    return {
      ...s,
      tasks: mapById(s.tasks, id, (x) => ({
        ...x,
        completed,
        completedAt: completed ? Date.now() : null,
        // Completing resolves the task positively — clear any "won't do", and
        // any wait: a finished task isn't blocked on anyone.
        wontDo: completed ? null : x.wontDo,
        waitingOn: completed ? null : x.waitingOn,
      })),
      log: [makeLog(s, t, completed ? "completed" : "uncompleted", null), ...s.log],
    };
  }, `${willComplete ? "Complete" : "Uncomplete"} ${quote(before)}`);
}

export function setCompleted(
  id: TaskId,
  completed: boolean,
  reason: string | null = null
): void {
  update((s) => {
    const t = findById(s.tasks, id);
    if (t == null) return s;
    return {
      ...s,
      tasks: mapById(s.tasks, id, (x) => ({
        ...x,
        completed,
        completedAt: completed ? Date.now() : null,
        wontDo: completed ? null : x.wontDo,
        waitingOn: completed ? null : x.waitingOn,
      })),
      log: completed ? [makeLog(s, t, "completed", reason), ...s.log] : s.log,
    };
  }, `${completed ? "Complete" : "Uncomplete"} ${quote(findById(state.tasks, id))}`);
}

// ─── Won't do (intentionally skipped) ───────────────────────────────
//
// A parallel terminal state to `completed`, mutually exclusive with it. Marking
// won't-do clears completion; the reason is optional and captured after the fact
// (inline or in the detail panel), so `markWontDo` records the "skipped" log with
// a null reason and `setWontDoReason` back-fills both the task and that log entry.

/** The newest "skipped" log entry for `taskId`, patched with a reason. */
function patchLatestSkip(log: LogEntry[], taskId: TaskId, reason: string | null): LogEntry[] {
  const idx = log.findIndex((e) => e.taskId === taskId && e.action === "skipped");
  if (idx === -1) return log;
  const next = [...log];
  next[idx] = { ...next[idx], reason };
  return next;
}

function applyWontDo(task: Task, reason: string | null): Task {
  const wontDo: WontDo = { reason, at: Date.now() };
  // Declining settles it too, so the wait ends here.
  return { ...task, completed: false, completedAt: null, wontDo, waitingOn: null };
}

/** Mark one task "won't do" (clears completion). No-op if already skipped. */
export function markWontDo(id: TaskId, reason: string | null = null): void {
  update((s) => {
    const t = findById(s.tasks, id);
    if (t == null || t.wontDo != null) return s;
    return {
      ...s,
      tasks: mapById(s.tasks, id, (x) => applyWontDo(x, reason)),
      log: [makeLog(s, t, "skipped", reason), ...s.log],
    };
  }, `Won’t do ${quote(findById(state.tasks, id))}`);
}

/** Mark a batch "won't do" — each a "skipped" log entry, one undo step. */
export function markWontDoMany(ids: TaskId[], reason: string | null = null): void {
  update((s) => {
    let tasks = s.tasks;
    const logs: LogEntry[] = [];
    for (const id of ids) {
      const t = findById(tasks, id);
      if (t == null || t.wontDo != null) continue;
      tasks = mapById(tasks, id, (x) => applyWontDo(x, reason));
      logs.push(makeLog(s, t, "skipped", reason));
    }
    return { ...s, tasks, log: [...logs, ...s.log] };
  }, `Won’t do ${subject(ids)}`);
}

/** Reopen a skipped task (or clear a skip). Logs a reopen for the record. */
export function clearWontDo(id: TaskId): void {
  update((s) => {
    const t = findById(s.tasks, id);
    if (t == null || t.wontDo == null) return s;
    return {
      ...s,
      tasks: mapById(s.tasks, id, (x) => ({ ...x, wontDo: null })),
      log: [makeLog(s, t, "uncompleted", null), ...s.log],
    };
  }, `Reopen ${quote(findById(state.tasks, id))}`);
}

/** Toggle the won't-do state (detail-panel / mouse affordance). */
export function toggleWontDo(id: TaskId, reason: string | null = null): void {
  const t = findById(state.tasks, id);
  if (t == null) return;
  if (t.wontDo != null) clearWontDo(id);
  else markWontDo(id, reason);
}

// ─── Waiting on someone else ────────────────────────────────────────
//
// Not a resolution: the task stays open and stays yours eventually. It just
// steps out of the Reckoning and out of the day's tally while the ball is in
// someone else's court. Completing or declining clears it, because both settle
// the task — see {@link WaitingOn} for why this exists at all.

/** Mark a task blocked (optionally on whom). No-op on a resolved task. */
export function markWaiting(id: TaskId, who: string | null = null): void {
  update((s) => {
    const t = findById(s.tasks, id);
    if (t == null || !isOpen(t)) return s;
    return {
      ...s,
      tasks: mapById(s.tasks, id, (x) => ({
        ...x,
        // Re-marking keeps the original `since`: the wait started when it
        // started, and naming who you're waiting on shouldn't reset the clock.
        waitingOn: { who, since: x.waitingOn?.since ?? Date.now() },
      })),
    };
  }, `Waiting on ${who == null || who.trim() === "" ? "someone" : quoteText(who)} for ${quote(findById(state.tasks, id))}`);
}

/** Unblock a task — the ball is back in your court. */
export function clearWaiting(id: TaskId): void {
  update((s) => {
    const t = findById(s.tasks, id);
    if (t == null || t.waitingOn == null) return s;
    return { ...s, tasks: mapById(s.tasks, id, (x) => ({ ...x, waitingOn: null })) };
  }, `No longer waiting on ${quote(findById(state.tasks, id))}`);
}

/** Set the reason on an already-skipped task, back-filling its log entry. */
export function setWontDoReason(id: TaskId, reason: string): void {
  const clean = reason.trim();
  const value = clean === "" ? null : clean;
  update((s) => {
    const t = findById(s.tasks, id);
    if (t == null || t.wontDo == null) return s;
    return {
      ...s,
      tasks: mapById(s.tasks, id, (x) =>
        x.wontDo == null ? x : { ...x, wontDo: { ...x.wontDo, reason: value } }
      ),
      log: patchLatestSkip(s.log, id, value),
    };
  }, `Give a reason for not doing ${quote(findById(state.tasks, id))}`);
}

/**
 * Where a postponement sends a task. Exactly one of the two is meaningful at a
 * time (a concrete date and a fuzzy horizon are mutually exclusive); both null
 * is the undated backlog.
 */
export interface PostponeTarget {
  plannedFor: ISODate | null;
  horizon: Horizon | null;
}

/** "to tomorrow" / "to next week" / "to the backlog" — for the history line. */
function postponeWords(target: PostponeTarget, today: ISODate): string {
  if (target.plannedFor != null) return `to ${target.plannedFor}`;
  if (target.horizon != null) return `to ${horizonWords(target.horizon, today)}`;
  return "to the backlog";
}

/**
 * Push tasks to another day (or into the undated backlog) as a *deliberate
 * postponement*: bumps {@link Task.postponedCount}, logs each one, and lands the
 * whole batch in a single undo step.
 *
 * The counter is the point. Plain rescheduling (`s` in the outline, the panel's
 * chips) stays uncounted — moving a plan around before its day arrives is just
 * planning. This is the path taken when a task *already came due and didn't get
 * done*, which is the only postponement worth holding someone to.
 */
export function postponeManyTo(
  ids: TaskId[],
  target: PostponeTarget,
  reason: string | null = null
): void {
  update((s) => {
    let tasks = s.tasks;
    const logs: LogEntry[] = [];
    for (const id of ids) {
      const t = findById(tasks, id);
      if (t == null) continue;
      tasks = mapById(tasks, id, (x) => ({
        ...x,
        plannedFor: target.plannedFor,
        horizon: target.plannedFor != null ? null : target.horizon,
        postponedCount: x.postponedCount + 1,
      }));
      logs.push(makeLog(s, t, "postponed", reason));
    }
    if (logs.length === 0) return s;
    return { ...s, tasks, log: [...logs, ...s.log] };
  }, `Postpone ${subject(ids)} ${postponeWords(target, todayISO(state.devDateOverride))}`);
}


/**
 * Re-commit unfinished tasks to a day, unchanged — the Reckoning's "Keep for
 * today" and the evening shutdown's "→ Tomorrow". Bumps `carriedCount` (the
 * counter behind the "carried N×" badge) and logs each one. One update, so a
 * batch is a single undo step.
 *
 * Both callers bump the same counter on purpose. Facing a task at 6pm rather
 * than 9am the next morning is better *behaviour*, and it's rewarded where
 * rewards belong — the day closes, the streak grows, the morning gate never
 * fires. The counter isn't measuring virtue, it's measuring the task: this
 * really is the third day running that you've promised to do it.
 */
export function carryManyTo(
  ids: TaskId[],
  date: ISODate,
  reason: string | null = null
): void {
  update((s) => {
    let tasks = s.tasks;
    const logs: LogEntry[] = [];
    for (const id of ids) {
      const t = findById(tasks, id);
      if (t == null) continue;
      tasks = mapById(tasks, id, (x) => ({
        ...x,
        plannedFor: date,
        horizon: null,
        carriedCount: x.carriedCount + 1,
      }));
      logs.push(makeLog(s, t, "kept", reason));
    }
    if (logs.length === 0) return s;
    return { ...s, tasks, log: [...logs, ...s.log] };
  }, `Carry ${subject(ids)} to ${date}`);
}

/** {@link carryManyTo}, aimed at today — the Reckoning's "Keep for today". */
export function keepManyForToday(ids: TaskId[], reason: string | null = null): void {
  carryManyTo(ids, todayISO(state.devDateOverride), reason);
}


export function logBreakdown(id: TaskId): void {
  update((s) => {
    const t = findById(s.tasks, id);
    if (t == null) return s;
    return { ...s, log: [makeLog(s, t, "brokeDown", null), ...s.log] };
  }, `Break down ${quote(findById(state.tasks, id))}`);
}

/** Soft delete: move the subtree to the Trash. Optionally log it as a drop. */
export function trashTask(
  id: TaskId,
  opts?: { reason?: string | null; log?: boolean }
): void {
  update((s) => {
    const t = findById(s.tasks, id);
    if (t == null) return s;
    return {
      ...s,
      tasks: removeById(s.tasks, id),
      trash: [{ task: t, deletedAt: Date.now() }, ...s.trash],
      log: opts?.log
        ? [makeLog(s, t, "dropped", opts.reason ?? null), ...s.log]
        : s.log,
    };
  }, `Trash ${quote(findById(state.tasks, id))}`);
}

export function restoreFromTrash(taskId: TaskId): void {
  update((s) => {
    const entry = s.trash.find((e) => e.task.id === taskId);
    if (entry == null) return s;
    return {
      ...s,
      tasks: [...s.tasks, entry.task],
      trash: s.trash.filter((e) => e.task.id !== taskId),
    };
  }, `Restore ${quote(state.trash.find((e) => e.task.id === taskId)?.task)} from the trash`);
}

export function purgeFromTrash(taskId: TaskId): void {
  const gone = quote(state.trash.find((e) => e.task.id === taskId)?.task);
  update(
    (s) => ({ ...s, trash: s.trash.filter((e) => e.task.id !== taskId) }),
    `Delete ${gone} for good`,
  );
}

export function emptyTrash(): void {
  update((s) => ({ ...s, trash: [] }), `Empty the trash (${state.trash.length})`);
}

// Both reorders take `visible`: the task ids rendered in the *same section* as
// the cursor, so a move hops over filtered-out siblings (and over anything the
// view re-listed elsewhere) instead of silently swapping past them. This one
// stays inside the tree — it never moves a task between projects — which is what
// the views that re-sort their groups (Later's buckets, the multi-day day
// headings) want: their sections stop short of the project divider.
export function reorder(
  selectedIds: TaskId[],
  dir: "up" | "down",
  visible?: Set<TaskId>
): void {
  updateTasks(
    (tasks) => reorderSelected(tasks, new Set(selectedIds), dir, visible),
    `Move ${subject(selectedIds)} ${dir}`,
  );
}

// …and this one lets a root task at a group's edge cross the divider into the
// neighbouring project, which is only meaningful in the plain outline.
export function reorderAcrossProjects(
  selectedIds: TaskId[],
  dir: "up" | "down",
  visible?: Set<TaskId>
): void {
  update((s) => ({
    ...s,
    tasks: reorderSelectedAcrossProjects(s.tasks, new Set(selectedIds), dir, s.projects, visible),
  }), `Move ${subject(selectedIds)} ${dir}`);
}

// ─── Bulk operations (multi-select) — each a single undo step ────────

export function trashMany(ids: TaskId[]): void {
  update((s) => {
    let tasks = s.tasks;
    const trashed: AppState["trash"] = [];
    for (const id of ids) {
      const t = findById(tasks, id);
      if (t == null) continue; // already removed via a selected ancestor
      tasks = removeById(tasks, id);
      trashed.push({ task: t, deletedAt: Date.now() });
    }
    return { ...s, tasks, trash: [...trashed, ...s.trash] };
  }, `Trash ${subject(ids)}`);
}

/** Reckoning "Drop all": trash a batch of leftovers, each logged as dropped. */
export function dropManyWithLog(ids: TaskId[], reason: string | null = null): void {
  update((s) => {
    let tasks = s.tasks;
    const trashed: AppState["trash"] = [];
    const logs: LogEntry[] = [];
    for (const id of ids) {
      const t = findById(tasks, id);
      if (t == null) continue;
      tasks = removeById(tasks, id);
      trashed.push({ task: t, deletedAt: Date.now() });
      logs.push(makeLog(s, t, "dropped", reason));
    }
    return { ...s, tasks, trash: [...trashed, ...s.trash], log: [...logs, ...s.log] };
  }, `Drop ${subject(ids)}`);
}

export function setCompletedMany(ids: TaskId[], completed: boolean): void {
  update((s) => {
    let tasks = s.tasks;
    const logs: LogEntry[] = [];
    for (const id of ids) {
      const t = findById(tasks, id);
      if (t == null) continue;
      tasks = mapById(tasks, id, (x) => ({
        ...x,
        completed,
        completedAt: completed ? Date.now() : null,
        wontDo: completed ? null : x.wontDo,
        waitingOn: completed ? null : x.waitingOn,
      }));
      if (completed) logs.push(makeLog(s, t, "completed", null));
    }
    return { ...s, tasks, log: [...logs, ...s.log] };
  }, `${completed ? "Complete" : "Uncomplete"} ${subject(ids)}`);
}

export function setPlannedForMany(ids: TaskId[], date: ISODate | null): void {
  update((s) => {
    let tasks = s.tasks;
    // A concrete date and a fuzzy horizon are mutually exclusive.
    for (const id of ids) tasks = mapById(tasks, id, (x) => ({ ...x, plannedFor: date, horizon: null }));
    return { ...s, tasks };
  }, date == null ? `Unschedule ${subject(ids)}` : `Schedule ${subject(ids)} for ${date}`);
}

/** Set a fuzzy horizon (this/next week·month, someday) — clears any concrete date. */
export function setHorizonMany(ids: TaskId[], horizon: Horizon | null): void {
  update((s) => {
    let tasks = s.tasks;
    for (const id of ids) tasks = mapById(tasks, id, (x) => ({ ...x, plannedFor: null, horizon }));
    return { ...s, tasks };
  }, horizon == null ? `Unschedule ${subject(ids)}` : `Schedule ${subject(ids)} for ${horizonWords(horizon, todayISO(state.devDateOverride))}`);
}

export function setPriority(id: TaskId, priority: TaskPriority): void {
  updateTasks(
    (tasks) => mapById(tasks, id, (t) => ({ ...t, priority })),
    `Set ${quote(findById(state.tasks, id))} to priority ${priority}`,
  );
}

/** Set (or clear, with null) the effort estimate on a batch — one undo step. */
export function setEstimatedMinutesMany(ids: TaskId[], minutes: number | null): void {
  const value = minutes == null || minutes <= 0 ? null : Math.round(minutes);
  updateTasks(
    (tasks) => {
      let next = tasks;
      for (const id of ids) next = mapById(next, id, (t) => ({ ...t, estimatedMinutes: value }));
      return next;
    },
    value == null
      ? `Clear the estimate on ${subject(ids)}`
      : `Estimate ${subject(ids)} at ${value} min`,
  );
}

export function setPlannedFor(id: TaskId, plannedFor: ISODate | null): void {
  const what = quote(findById(state.tasks, id));
  updateTasks(
    (tasks) => mapById(tasks, id, (t) => ({ ...t, plannedFor, horizon: null })),
    plannedFor == null ? `Unschedule ${what}` : `Schedule ${what} for ${plannedFor}`,
  );
}

/**
 * Stamp when this task was last blocked out on the calendar (from "Add to
 * calendar"). Decoupled from the real event — just a display cue. `null` clears
 * it. Kept out of the undo stack: the event itself already lives in the user's
 * calendar, so undo here would only desync the badge from reality.
 */
export function setScheduledAt(id: TaskId, at: number | null): void {
  updateTasks((tasks) => mapById(tasks, id, (t) => ({ ...t, scheduledAt: at })), null);
}

export function setProjectForMany(ids: TaskId[], projectId: ProjectId): void {
  const project = state.projects.find((p) => p.id === projectId);
  updateTasks(
    (tasks) => {
      const topLevelIds = new Set(ids.map((id) => topLevelIdFor(tasks, id)));
      return normalizeChildProjects(setProjectForIds(tasks, topLevelIds, projectId));
    },
    `Move ${subject(ids)} to ${quoteText(project?.name ?? "another project")}`,
  );
}

// ─── Outline structure ──────────────────────────────────────────────

// `underId` is the previous *visible* sibling chosen by the view (so Tab nests
// under the row above, not under a filtered-out sibling). When omitted, falls
// back to the raw previous sibling.
export function indent(id: TaskId, underId?: TaskId | null): void {
  updateTasks(
    (tasks) =>
      normalizeChildProjects(
        underId == null ? indentTask(tasks, id) : indentUnder(tasks, id, underId)
      ),
    `Indent ${quote(findById(state.tasks, id))}`,
  );
}

export function outdent(id: TaskId): void {
  updateTasks(
    (tasks) => normalizeChildProjects(outdentTask(tasks, id)),
    `Outdent ${quote(findById(state.tasks, id))}`,
  );
}

export function reorderSibling(activeId: TaskId, overId: TaskId): void {
  updateTasks(
    (tasks) => moveSibling(tasks, activeId, overId),
    `Move ${quote(findById(state.tasks, activeId))}`,
  );
}

export function moveBefore(taskId: TaskId, beforeId: TaskId): void {
  const targetProjectId = findById(state.tasks, beforeId)?.projectId ?? DEFAULT_PROJECT_ID;
  updateTasks(
    (tasks) =>
      normalizeChildProjects(
        setProjectForIds(relocateTask(tasks, taskId, beforeId), new Set([taskId]), targetProjectId)
      ),
    `Move ${quote(findById(state.tasks, taskId))}`,
  );
}

export function moveAfter(taskId: TaskId, afterId: TaskId): void {
  const targetProjectId = findById(state.tasks, afterId)?.projectId ?? DEFAULT_PROJECT_ID;
  updateTasks(
    (tasks) =>
      normalizeChildProjects(
        setProjectForIds(relocateAfter(tasks, taskId, afterId), new Set([taskId]), targetProjectId)
      ),
    `Move ${quote(findById(state.tasks, taskId))}`,
  );
}

export function moveAsChild(taskId: TaskId, newParentId: TaskId): void {
  const targetProjectId = findById(state.tasks, newParentId)?.projectId ?? DEFAULT_PROJECT_ID;
  updateTasks(
    (tasks) =>
      normalizeChildProjects(
        setProjectForIds(
          relocateAsChild(tasks, taskId, newParentId),
          new Set([taskId]),
          targetProjectId
        )
      ),
    `Move ${quote(findById(state.tasks, taskId))} under ${quote(findById(state.tasks, newParentId))}`,
  );
}

// ─── Recurrences (repeating-task definitions) ───────────────────────
//
// Templates live only here, never in `tasks`, so they can't reckon or be
// counted. Node-level edits address a template by any of its task ids and find
// the owning recurrence; whole-recurrence edits take the recurrence id.

/** Update whichever recurrence's template contains `taskId`. */
function mapRecurrenceOfNode(
  recurrences: Recurrence[],
  taskId: TaskId,
  fn: (template: Task) => Task
): Recurrence[] {
  return recurrences.map((r) =>
    findById([r.template], taskId) != null ? { ...r, template: fn(r.template) } : r
  );
}

/** Create a recurrence with a one-line template. Returns both ids for focus/edit. */
export function createRecurrence(
  text: string,
  rule: RecurrenceRule,
  projectId: ProjectId = DEFAULT_PROJECT_ID
): { id: RecurrenceId; taskId: TaskId } {
  const id = nanoid() as RecurrenceId;
  const template = makeTask(text, projectId);
  update((s) => ({
    ...s,
    recurrences: [...s.recurrences, { id, template, rule: normalizeRule(rule), createdAt: Date.now() }],
  }), titled("New recurring task", text));
  return { id, taskId: template.id };
}

export function setRecurrenceRule(id: RecurrenceId, rule: RecurrenceRule): void {
  update((s) => ({
    ...s,
    recurrences: s.recurrences.map((r) => (r.id === id ? { ...r, rule: normalizeRule(rule) } : r)),
  }), "Change a repeat schedule");
}

/**
 * File a recurrence under a project. The whole template moves together (root and
 * steps), because that's what {@link materialize} clones into a real task — an
 * accepted occurrence lands in this project, at the top of it.
 */
export function setRecurrenceProject(id: RecurrenceId, projectId: ProjectId): void {
  const rec = state.recurrences.find((r) => r.id === id);
  const project = state.projects.find((p) => p.id === projectId);
  update(
    (s) => ({
      ...s,
      recurrences: s.recurrences.map((r) =>
        r.id === id ? { ...r, template: assignProjectDeep(r.template, projectId) } : r
      ),
    }),
    `Move the recurring task ${quote(rec?.template)} to ${quoteText(project?.name ?? "another project")}`
  );
}

export function deleteRecurrence(id: RecurrenceId): void {
  const gone = state.recurrences.find((r) => r.id === id);
  update(
    (s) => ({ ...s, recurrences: s.recurrences.filter((r) => r.id !== id) }),
    `Delete the recurring task ${quote(gone?.template)}`,
  );
}

export function setRecurrenceText(taskId: TaskId, text: string): void {
  update((s) => ({
    ...s,
    recurrences: mapRecurrenceOfNode(s.recurrences, taskId, (tpl) =>
      mapById([tpl], taskId, (t) => ({ ...t, text }))[0]
    ),
  }), titled("Rename a recurring step", text));
}

/** Add an empty step: a child of `taskId`, or a sibling after it. Returns its id. */
export function addRecurrenceStep(taskId: TaskId, mode: "child" | "sibling"): TaskId {
  const step = makeTask("");
  update((s) => ({
    ...s,
    recurrences: mapRecurrenceOfNode(s.recurrences, taskId, (tpl) => {
      const child = { ...step, projectId: tpl.projectId };
      if (mode === "child") {
        return mapById([tpl], taskId, (t) => ({ ...t, children: [...t.children, child] }))[0];
      }
      return insertAfterSibling([tpl], taskId, child)[0];
    }),
  }), "New recurring step");
  return step.id;
}

export function indentRecurrenceNode(taskId: TaskId, underId?: TaskId | null): void {
  update((s) => ({
    ...s,
    recurrences: mapRecurrenceOfNode(s.recurrences, taskId, (tpl) => {
      const forest = underId == null ? indentTask([tpl], taskId) : indentUnder([tpl], taskId, underId);
      return forest[0] ?? tpl;
    }),
  }), "Indent a recurring step");
}

export function outdentRecurrenceNode(taskId: TaskId): void {
  update((s) => ({
    ...s,
    recurrences: mapRecurrenceOfNode(s.recurrences, taskId, (tpl) => {
      const parentId = findParentId([tpl], taskId);
      // Never lift a node to become a second root of the template.
      if (parentId == null || parentId === tpl.id) return tpl;
      return outdentTask([tpl], taskId)[0] ?? tpl;
    }),
  }), "Outdent a recurring step");
}

/** Remove a step; removing the template root deletes the whole recurrence. */
export function removeRecurrenceNode(taskId: TaskId): void {
  update((s) => {
    const rec = s.recurrences.find((r) => findById([r.template], taskId) != null);
    if (rec == null) return s;
    if (rec.template.id === taskId) {
      return { ...s, recurrences: s.recurrences.filter((r) => r.id !== rec.id) };
    }
    return {
      ...s,
      recurrences: s.recurrences.map((r) =>
        r.id === rec.id ? { ...r, template: removeById([r.template], taskId)[0] } : r
      ),
    };
  }, "Delete a recurring step");
}

/** Clone a recurrence's template into a concrete, dated-for-today commitment. */
function materialize(rec: Recurrence, today: ISODate): Task {
  const planAll = (t: Task): Task => ({
    ...t,
    plannedFor: today,
    horizon: null,
    completed: false,
    completedAt: null,
    wontDo: null,
    children: t.children.map(planAll),
  });
  const planned = planAll(cloneWithNewIds(rec.template));
  return { ...planned, recurrenceId: rec.id, occurrenceDate: today };
}

/**
 * Accept a recurrence for today: materialize its template as a real task (dated
 * for today, linked back to the recurrence for suppression). Returns the new
 * instance's root id for focusing, or null if the recurrence is gone.
 */
export function acceptRecurrence(recId: RecurrenceId, today: ISODate): TaskId | null {
  const rec = state.recurrences.find((r) => r.id === recId);
  if (rec == null) return null;
  const instance = materialize(rec, today);
  update((s) => ({
    ...s,
    tasks: insertAtProjectStart(s.tasks, s.projects, instance.projectId, instance),
  }), `Take on today’s ${quote(rec.template)}`);
  return instance.id;
}

// ─── Undo / redo / history ──────────────────────────────────────────
//
// Undo is a stack of whole-state snapshots — coarse, but it means every change
// that goes through update() is reversible without any per-mutation inverse to
// write (or forget). Redo is its mirror: undoing moves a step across to the redo
// stack, and any *new* action forks the timeline and clears it.
//
// The action log is the one thing that never rewinds. It is an account of what
// you did, so undoing records a line rather than erasing one.

/** Restore a snapshot and record the move. Shared by undo and redo. */
function applyStep(step: HistoryStep, kind: "undo" | "redo"): void {
  const restored = restamp(step.state, step.touched);
  state = withHistory(restored, state.actionLog, {
    id: nanoid(),
    label: step.label,
    kind,
    at: Date.now(),
  });
  notify();
  scheduleSave();
}

export function undo(): void {
  const step = undoStack[0];
  if (step == null) return;
  undoStack = undoStack.slice(1);
  // What we're leaving behind becomes the redo step — same name, same footprint.
  redoStack = [{ ...step, state }, ...redoStack].slice(0, MAX_UNDO);
  applyStep(step, "undo");
}

export function redo(): void {
  const step = redoStack[0];
  if (step == null) return;
  redoStack = redoStack.slice(1);
  undoStack = [{ ...step, state }, ...undoStack].slice(0, MAX_UNDO);
  applyStep(step, "redo");
}

/** Undo everything back through the step with this history id, inclusive. */
export function undoThrough(historyId: string): void {
  const idx = undoStack.findIndex((e) => e.id === historyId);
  if (idx === -1) return;
  for (let i = 0; i <= idx; i++) undo();
}

/** Redo forward through the step with this history id, inclusive. */
export function redoThrough(historyId: string): void {
  const idx = redoStack.findIndex((e) => e.id === historyId);
  if (idx === -1) return;
  for (let i = 0; i <= idx; i++) redo();
}

export function canUndo(): boolean {
  return undoStack.length > 0;
}

export function canRedo(): boolean {
  return redoStack.length > 0;
}

/** How many steps are still reversible — without materialising the stack. */
export function undoDepth(): number {
  return undoStack.length;
}

const toView = (e: HistoryStep): HistoryStepView => ({ id: e.id, label: e.label, at: e.at });

/** The reversible steps, newest first. Only these history lines can be jumped
 *  to — the log outlives the session, the snapshots don't. */
export function getUndoSteps(): HistoryStepView[] {
  return undoStack.map(toView);
}

/** The steps waiting to be redone, most-recently-undone first. */
export function getRedoSteps(): HistoryStepView[] {
  return redoStack.map(toView);
}
