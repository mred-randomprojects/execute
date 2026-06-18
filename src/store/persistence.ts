import { nanoid } from "nanoid";
import type { AppState, Task, TaskId, TaskPriority, ThemeName } from "../types";
import { SCHEMA_VERSION, emptyState } from "../types";

// Bridge exposed by electron/preload.cjs. In the browser (pnpm dev) it's absent
// and we fall back to localStorage, so the renderer runs either way.
interface ExecuteBridge {
  isElectron: boolean;
  loadStore: () => Promise<unknown>;
  saveStore: (data: AppState) => Promise<boolean>;
}

declare global {
  interface Window {
    execute?: ExecuteBridge;
  }
}

const LS_KEY = "execute-store";

export async function loadRaw(): Promise<unknown> {
  if (window.execute?.isElectron) return window.execute.loadStore();
  const raw = localStorage.getItem(LS_KEY);
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveRaw(state: AppState): Promise<void> {
  if (window.execute?.isElectron) {
    await window.execute.saveStore(state);
    return;
  }
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

// ─── Defensive coercion (we own the format, but never trust on read) ────

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}
function str(x: unknown, fallback = ""): string {
  return typeof x === "string" ? x : fallback;
}
function num(x: unknown, fallback: number): number {
  return typeof x === "number" && Number.isFinite(x) ? x : fallback;
}
function bool(x: unknown, fallback = false): boolean {
  return typeof x === "boolean" ? x : fallback;
}
function strOrNull(x: unknown): string | null {
  return typeof x === "string" ? x : null;
}
function numOrNull(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

function coercePriority(x: unknown): TaskPriority {
  const n = num(x, 4);
  return n === 1 || n === 2 || n === 3 ? n : 4;
}

function coerceTheme(x: unknown): ThemeName {
  return x === "ivory" || x === "carbon" || x === "bordeaux" ? x : "slate";
}

function coerceTask(raw: unknown): Task {
  const o = isObject(raw) ? raw : {};
  const children = Array.isArray(o.children) ? o.children.map(coerceTask) : [];
  const labels = Array.isArray(o.labels)
    ? o.labels.filter((l): l is string => typeof l === "string")
    : [];
  return {
    id: (str(o.id) || nanoid()) as TaskId,
    text: str(o.text),
    notes: str(o.notes),
    completed: bool(o.completed),
    completedAt: numOrNull(o.completedAt),
    children,
    createdAt: num(o.createdAt, Date.now()),
    priority: coercePriority(o.priority),
    plannedFor: strOrNull(o.plannedFor),
    labels,
    estimatedMinutes: numOrNull(o.estimatedMinutes),
  };
}

export function coerceState(raw: unknown): AppState {
  if (!isObject(raw)) return emptyState();
  return {
    schemaVersion: num(raw.schemaVersion, SCHEMA_VERSION),
    tasks: Array.isArray(raw.tasks) ? raw.tasks.map(coerceTask) : [],
    theme: coerceTheme(raw.theme),
    lastOpenedDate: strOrNull(raw.lastOpenedDate),
    devDateOverride: strOrNull(raw.devDateOverride),
  };
}
