import { useSyncExternalStore } from "react";
import { nanoid } from "nanoid";
import type {
  AppState,
  Horizon,
  ISODate,
  LogAction,
  LogEntry,
  ProjectId,
  Task,
  TaskId,
  TaskPriority,
  ThemeName,
} from "../types";
import { DEFAULT_PROJECT_ID, PROJECT_COLORS, emptyState } from "../types";
import {
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
  relocateAsChild,
  relocateTask,
  removeById,
  reorderSelected,
  reorderSelectedAcrossProjects,
  setProjectForIds,
} from "./tasks";
import { todayISO } from "./dates";
import { coerceState, loadRaw, saveRaw } from "./persistence";

// ─── Singleton store ────────────────────────────────────────────────

let state: AppState = emptyState();
let ready = false;
const listeners = new Set<() => void>();

const MAX_UNDO = 100;
let undoStack: AppState[] = [];

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function notify() {
  for (const l of listeners) l();
}

function scheduleSave() {
  if (saveTimer != null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void saveRaw(state);
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
function update(fn: (s: AppState) => AppState, track = true): void {
  if (track) undoStack = [state, ...undoStack].slice(0, MAX_UNDO);
  state = fn(state);
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

export async function initStore(): Promise<void> {
  state = coerceState(await loadRaw());
  ready = true;
  notify();
}

export function getState(): AppState {
  return state;
}

export function useStore(): { state: AppState; ready: boolean } {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  return { state: s, ready };
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
      })),
      log: completed ? [makeLog(s, t, "completed", reason), ...s.log] : s.log,
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

export function reorderAcrossProjects(selectedIds: TaskId[], dir: "up" | "down"): void {
  update((s) => ({
    ...s,
    tasks: reorderSelectedAcrossProjects(s.tasks, new Set(selectedIds), dir, s.projects),
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

export function setPlannedFor(id: TaskId, plannedFor: ISODate | null): void {
  updateTasks((tasks) => mapById(tasks, id, (t) => ({ ...t, plannedFor, horizon: null })));
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
