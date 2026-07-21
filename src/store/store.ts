import { useSyncExternalStore } from "react";
import { nanoid } from "nanoid";
import type {
  AppState,
  Horizon,
  ISODate,
  LogAction,
  LogEntry,
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
import { DEFAULT_PROJECT_ID, PROJECT_COLORS, emptyState } from "../types";
import {
  cloneWithNewIds,
  findById,
  findParentId,
  getAncestorPath,
  indentTask,
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
let undoStack: AppState[] = [];

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

/**
 * Apply a transform. `track` (default true) pushes an undo snapshot first;
 * pass false for incidental changes (theme, dev date, rollover bookkeeping).
 */
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
    a.recurrenceId === b.recurrenceId &&
    a.occurrenceDate === b.occurrenceDate &&
    a.scheduledAt === b.scheduledAt &&
    horizonEq(a.horizon, b.horizon) &&
    wontDoEq(a.wontDo, b.wontDo) &&
    labelsEq(a.labels, b.labels)
  );
}
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
  const before = prevById.get(node.id);
  const ownChanged = before == null || !sameOwnFields(before, node);
  const updatedAt = ownChanged ? now : node.updatedAt;
  if (children === node.children && updatedAt === node.updatedAt) return node;
  return { ...node, children, updatedAt };
}
function stampTasks(prev: AppState, next: AppState): AppState {
  if (next.tasks === prev.tasks) return next; // no structural task change
  const prevById = new Map<TaskId, Task>();
  indexById(prev.tasks, prevById);
  const now = Date.now();
  return { ...next, tasks: next.tasks.map((t) => stampNode(t, prevById, now)) };
}

function update(fn: (s: AppState) => AppState, track = true): void {
  if (track) undoStack = [state, ...undoStack].slice(0, MAX_UNDO);
  const prev = state;
  state = stampTasks(prev, fn(prev));
  notify();
  scheduleSave();
}

function updateTasks(fn: (tasks: Task[]) => Task[], track = true): void {
  update((s) => ({ ...s, tasks: fn(s.tasks) }), track);
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
  update((s) => ({ ...s, theme }), false);
}

export function setDevDateOverride(date: ISODate | null): void {
  update((s) => ({ ...s, devDateOverride: date }), false);
}

export function markOpened(date: ISODate): void {
  update((s) => ({ ...s, lastOpenedDate: date }), false);
}

/** Set the daily capacity budget, in blocks (clamped to ≥ 1). Not undoable. */
export function setDailyCapacityBlocks(blocks: number): void {
  const clamped = Math.max(1, Math.round(blocks));
  update((s) => ({ ...s, dailyCapacityBlocks: clamped }), false);
}

/** Choose how the reckoning renders (board vs. card review). Not undoable. */
export function setBoardPreferred(preferred: boolean): void {
  update((s) => ({ ...s, boardPreferred: preferred }), false);
}

/** Set (or clear, with null) the "right now" task. A focus pointer, not undoable. */
export function setCurrentTask(id: TaskId | null): void {
  update((s) => ({ ...s, currentTaskId: id }), false);
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
  }, false);
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
  }, false);
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
  updateTasks((tasks) => insertAfterSibling(tasks, afterId, t));
  return t.id;
}

export function addTaskAtProjectStart(
  projectId: ProjectId,
  text: string,
  plannedFor: ISODate | null = null
): TaskId {
  const t = { ...makeTask(text, projectId), plannedFor };
  update((s) => ({
    ...s,
    tasks: insertAtProjectStart(s.tasks, s.projects, projectId, t),
  }));
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
  updateTasks((tasks) =>
    mapById(tasks, parentId, (p) => ({ ...p, children: [...p.children, child] }))
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
  }));
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
  }));
}

export function cycleProjectColor(id: ProjectId): void {
  update((s) => ({
    ...s,
    projects: s.projects.map((project) => {
      if (project.id !== id) return project;
      const i = PROJECT_COLORS.indexOf(project.color as (typeof PROJECT_COLORS)[number]);
      return { ...project, color: PROJECT_COLORS[(i + 1) % PROJECT_COLORS.length] };
    }),
  }));
}

// ─── Mutate ─────────────────────────────────────────────────────────

export function setText(id: TaskId, text: string): void {
  updateTasks((tasks) => mapById(tasks, id, (t) => ({ ...t, text })));
}

export function setNotes(id: TaskId, notes: string): void {
  updateTasks((tasks) => mapById(tasks, id, (t) => ({ ...t, notes })));
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
        // Completing resolves the task positively — clear any "won't do".
        wontDo: completed ? null : x.wontDo,
      })),
      log: [makeLog(s, t, completed ? "completed" : "uncompleted", null), ...s.log],
    };
  });
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
      })),
      log: completed ? [makeLog(s, t, "completed", reason), ...s.log] : s.log,
    };
  });
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
  return { ...task, completed: false, completedAt: null, wontDo };
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
  });
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
  });
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
  });
}

/** Toggle the won't-do state (detail-panel / mouse affordance). */
export function toggleWontDo(id: TaskId, reason: string | null = null): void {
  const t = findById(state.tasks, id);
  if (t == null) return;
  if (t.wontDo != null) clearWontDo(id);
  else markWontDo(id, reason);
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
  });
}

/** Unplan a task (back to the Inbox) and log it as a postponement. */
export function postponeToBacklog(id: TaskId, reason: string | null = null): void {
  update((s) => {
    const t = findById(s.tasks, id);
    if (t == null) return s;
    return {
      ...s,
      tasks: mapById(s.tasks, id, (x) => ({ ...x, plannedFor: null, horizon: null })),
      log: [makeLog(s, t, "postponed", reason), ...s.log],
    };
  });
}

/**
 * Re-commit a leftover to today, unchanged — the Reckoning's "Keep for today".
 * Bumps `carriedCount` (the deliberate-dodge counter behind the "carried N×"
 * badge) and logs it. Setting `plannedFor = today` lifts it out of the gate.
 */
export function keepForToday(id: TaskId, reason: string | null = null): void {
  update((s) => {
    const t = findById(s.tasks, id);
    if (t == null) return s;
    return {
      ...s,
      tasks: mapById(s.tasks, id, (x) => ({
        ...x,
        plannedFor: todayISO(s.devDateOverride),
        horizon: null,
        carriedCount: x.carriedCount + 1,
      })),
      log: [makeLog(s, t, "kept", reason), ...s.log],
    };
  });
}

export function logBreakdown(id: TaskId): void {
  update((s) => {
    const t = findById(s.tasks, id);
    if (t == null) return s;
    return { ...s, log: [makeLog(s, t, "brokeDown", null), ...s.log] };
  });
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
  });
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
  });
}

export function purgeFromTrash(taskId: TaskId): void {
  update((s) => ({ ...s, trash: s.trash.filter((e) => e.task.id !== taskId) }));
}

export function emptyTrash(): void {
  update((s) => ({ ...s, trash: [] }));
}

export function reorder(selectedIds: TaskId[], dir: "up" | "down"): void {
  updateTasks((tasks) => reorderSelected(tasks, new Set(selectedIds), dir));
}

// `visible` is the set of task ids the current view actually shows, so a reorder
// hops over filtered-out siblings instead of silently swapping past them.
export function reorderAcrossProjects(
  selectedIds: TaskId[],
  dir: "up" | "down",
  visible?: Set<TaskId>
): void {
  update((s) => ({
    ...s,
    tasks: reorderSelectedAcrossProjects(s.tasks, new Set(selectedIds), dir, s.projects, visible),
  }));
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
  });
}

/** Reckoning "Backlog all": unplan a batch of leftovers, each logged as postponed. */
export function postponeManyToBacklog(ids: TaskId[], reason: string | null = null): void {
  update((s) => {
    let tasks = s.tasks;
    const logs: LogEntry[] = [];
    for (const id of ids) {
      const t = findById(tasks, id);
      if (t == null) continue;
      tasks = mapById(tasks, id, (x) => ({ ...x, plannedFor: null, horizon: null }));
      logs.push(makeLog(s, t, "postponed", reason));
    }
    return { ...s, tasks, log: [...logs, ...s.log] };
  });
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
  });
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
      }));
      if (completed) logs.push(makeLog(s, t, "completed", null));
    }
    return { ...s, tasks, log: [...logs, ...s.log] };
  });
}

export function setPlannedForMany(ids: TaskId[], date: ISODate | null): void {
  update((s) => {
    let tasks = s.tasks;
    // A concrete date and a fuzzy horizon are mutually exclusive.
    for (const id of ids) tasks = mapById(tasks, id, (x) => ({ ...x, plannedFor: date, horizon: null }));
    return { ...s, tasks };
  });
}

/** Set a fuzzy horizon (this/next week·month, someday) — clears any concrete date. */
export function setHorizonMany(ids: TaskId[], horizon: Horizon | null): void {
  update((s) => {
    let tasks = s.tasks;
    for (const id of ids) tasks = mapById(tasks, id, (x) => ({ ...x, plannedFor: null, horizon }));
    return { ...s, tasks };
  });
}

export function setPriority(id: TaskId, priority: TaskPriority): void {
  updateTasks((tasks) => mapById(tasks, id, (t) => ({ ...t, priority })));
}

/** Set (or clear, with null) the effort estimate on a batch — one undo step. */
export function setEstimatedMinutesMany(ids: TaskId[], minutes: number | null): void {
  const value = minutes == null || minutes <= 0 ? null : Math.round(minutes);
  updateTasks((tasks) => {
    let next = tasks;
    for (const id of ids) next = mapById(next, id, (t) => ({ ...t, estimatedMinutes: value }));
    return next;
  });
}

export function setPlannedFor(id: TaskId, plannedFor: ISODate | null): void {
  updateTasks((tasks) => mapById(tasks, id, (t) => ({ ...t, plannedFor, horizon: null })));
}

/**
 * Stamp when this task was last blocked out on the calendar (from "Add to
 * calendar"). Decoupled from the real event — just a display cue. `null` clears
 * it. Kept out of the undo stack: the event itself already lives in the user's
 * calendar, so undo here would only desync the badge from reality.
 */
export function setScheduledAt(id: TaskId, at: number | null): void {
  updateTasks((tasks) => mapById(tasks, id, (t) => ({ ...t, scheduledAt: at })), false);
}

export function setProjectForMany(ids: TaskId[], projectId: ProjectId): void {
  updateTasks((tasks) => {
    const topLevelIds = new Set(ids.map((id) => topLevelIdFor(tasks, id)));
    return normalizeChildProjects(setProjectForIds(tasks, topLevelIds, projectId));
  });
}

// ─── Outline structure ──────────────────────────────────────────────

// `underId` is the previous *visible* sibling chosen by the view (so Tab nests
// under the row above, not under a filtered-out sibling). When omitted, falls
// back to the raw previous sibling.
export function indent(id: TaskId, underId?: TaskId | null): void {
  updateTasks((tasks) =>
    normalizeChildProjects(
      underId == null ? indentTask(tasks, id) : indentUnder(tasks, id, underId)
    )
  );
}

export function outdent(id: TaskId): void {
  updateTasks((tasks) => normalizeChildProjects(outdentTask(tasks, id)));
}

export function reorderSibling(activeId: TaskId, overId: TaskId): void {
  updateTasks((tasks) => moveSibling(tasks, activeId, overId));
}

export function moveBefore(taskId: TaskId, beforeId: TaskId): void {
  const targetProjectId = findById(state.tasks, beforeId)?.projectId ?? DEFAULT_PROJECT_ID;
  updateTasks((tasks) =>
    normalizeChildProjects(
      setProjectForIds(relocateTask(tasks, taskId, beforeId), new Set([taskId]), targetProjectId)
    )
  );
}

export function moveAfter(taskId: TaskId, afterId: TaskId): void {
  const targetProjectId = findById(state.tasks, afterId)?.projectId ?? DEFAULT_PROJECT_ID;
  updateTasks((tasks) =>
    normalizeChildProjects(
      setProjectForIds(relocateAfter(tasks, taskId, afterId), new Set([taskId]), targetProjectId)
    )
  );
}

export function moveAsChild(taskId: TaskId, newParentId: TaskId): void {
  const targetProjectId = findById(state.tasks, newParentId)?.projectId ?? DEFAULT_PROJECT_ID;
  updateTasks((tasks) =>
    normalizeChildProjects(
      setProjectForIds(
        relocateAsChild(tasks, taskId, newParentId),
        new Set([taskId]),
        targetProjectId
      )
    )
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
  rule: RecurrenceRule
): { id: RecurrenceId; taskId: TaskId } {
  const id = nanoid() as RecurrenceId;
  const template = makeTask(text, DEFAULT_PROJECT_ID);
  update((s) => ({
    ...s,
    recurrences: [...s.recurrences, { id, template, rule: normalizeRule(rule), createdAt: Date.now() }],
  }));
  return { id, taskId: template.id };
}

export function setRecurrenceRule(id: RecurrenceId, rule: RecurrenceRule): void {
  update((s) => ({
    ...s,
    recurrences: s.recurrences.map((r) => (r.id === id ? { ...r, rule: normalizeRule(rule) } : r)),
  }));
}

export function deleteRecurrence(id: RecurrenceId): void {
  update((s) => ({ ...s, recurrences: s.recurrences.filter((r) => r.id !== id) }));
}

export function setRecurrenceText(taskId: TaskId, text: string): void {
  update((s) => ({
    ...s,
    recurrences: mapRecurrenceOfNode(s.recurrences, taskId, (tpl) =>
      mapById([tpl], taskId, (t) => ({ ...t, text }))[0]
    ),
  }));
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
  }));
  return step.id;
}

export function indentRecurrenceNode(taskId: TaskId, underId?: TaskId | null): void {
  update((s) => ({
    ...s,
    recurrences: mapRecurrenceOfNode(s.recurrences, taskId, (tpl) => {
      const forest = underId == null ? indentTask([tpl], taskId) : indentUnder([tpl], taskId, underId);
      return forest[0] ?? tpl;
    }),
  }));
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
  }));
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
  });
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
  }));
  return instance.id;
}

// ─── Undo ───────────────────────────────────────────────────────────

export function undo(): void {
  if (undoStack.length === 0) return;
  const [prev, ...rest] = undoStack;
  undoStack = rest;
  state = prev;
  notify();
  scheduleSave();
}

export function canUndo(): boolean {
  return undoStack.length > 0;
}
