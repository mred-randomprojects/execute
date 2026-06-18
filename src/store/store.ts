import { useSyncExternalStore } from "react";
import type {
  AppState,
  ISODate,
  Task,
  TaskId,
  TaskPriority,
  ThemeName,
} from "../types";
import { emptyState } from "../types";
import {
  findParentId,
  indentTask,
  makeTask,
  mapById,
  moveSibling,
  outdentTask,
  relocateAsChild,
  relocateTask,
  removeById,
} from "./tasks";
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

/** Create a sibling after `afterId` (or append to root when null). */
export function addTaskAfter(
  afterId: TaskId | null,
  text: string,
  plannedFor: ISODate | null = null
): TaskId {
  const t = { ...makeTask(text), plannedFor };
  updateTasks((tasks) => insertAfterSibling(tasks, afterId, t));
  return t.id;
}

/** Append a child to `parentId`. Used by the breakdown flow. */
export function addChild(
  parentId: TaskId,
  text: string,
  plannedFor: ISODate | null = null
): TaskId {
  const child = { ...makeTask(text), plannedFor };
  updateTasks((tasks) =>
    mapById(tasks, parentId, (p) => ({ ...p, children: [...p.children, child] }))
  );
  return child.id;
}

// ─── Mutate ─────────────────────────────────────────────────────────

export function setText(id: TaskId, text: string): void {
  updateTasks((tasks) => mapById(tasks, id, (t) => ({ ...t, text })));
}

export function setNotes(id: TaskId, notes: string): void {
  updateTasks((tasks) => mapById(tasks, id, (t) => ({ ...t, notes })));
}

export function toggleComplete(id: TaskId): void {
  updateTasks((tasks) =>
    mapById(tasks, id, (t) => ({
      ...t,
      completed: !t.completed,
      completedAt: !t.completed ? Date.now() : null,
    }))
  );
}

export function setCompleted(id: TaskId, completed: boolean): void {
  updateTasks((tasks) =>
    mapById(tasks, id, (t) => ({
      ...t,
      completed,
      completedAt: completed ? Date.now() : null,
    }))
  );
}

export function deleteTask(id: TaskId): void {
  updateTasks((tasks) => removeById(tasks, id));
}

export function setPriority(id: TaskId, priority: TaskPriority): void {
  updateTasks((tasks) => mapById(tasks, id, (t) => ({ ...t, priority })));
}

export function setPlannedFor(id: TaskId, plannedFor: ISODate | null): void {
  updateTasks((tasks) => mapById(tasks, id, (t) => ({ ...t, plannedFor })));
}

// ─── Outline structure ──────────────────────────────────────────────

export function indent(id: TaskId): void {
  updateTasks((tasks) => indentTask(tasks, id));
}

export function outdent(id: TaskId): void {
  updateTasks((tasks) => outdentTask(tasks, id));
}

export function reorderSibling(activeId: TaskId, overId: TaskId): void {
  updateTasks((tasks) => moveSibling(tasks, activeId, overId));
}

export function moveBefore(taskId: TaskId, beforeId: TaskId): void {
  updateTasks((tasks) => relocateTask(tasks, taskId, beforeId));
}

export function moveAsChild(taskId: TaskId, newParentId: TaskId): void {
  updateTasks((tasks) => relocateAsChild(tasks, taskId, newParentId));
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
