import { nanoid } from "nanoid";
import type {
  AppState,
  Horizon,
  HorizonUnit,
  LogAction,
  LogEntry,
  Project,
  ProjectId,
  Task,
  TaskId,
  TaskPriority,
  ThemeName,
  TrashedTask,
} from "../types";
import {
  DEFAULT_PROJECT_ID,
  PROJECT_COLORS,
  SCHEMA_VERSION,
  defaultProject,
  emptyState,
} from "../types";
import { normalizeChildProjects } from "./tasks";

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

function coerceProject(raw: unknown, index: number): Project {
  const o = isObject(raw) ? raw : {};
  const fallbackColor = PROJECT_COLORS[index % PROJECT_COLORS.length];
  return {
    id: (str(o.id) || nanoid()) as ProjectId,
    name: str(o.name, `Project ${index + 1}`).trim() || `Project ${index + 1}`,
    color: str(o.color, fallbackColor).trim() || fallbackColor,
    createdAt: num(o.createdAt, Date.now()),
  };
}

function coerceProjects(raw: unknown): Project[] {
  const seen = new Set<ProjectId>();
  const projects = [defaultProject()];
  seen.add(DEFAULT_PROJECT_ID);

  const raws = Array.isArray(raw) ? raw : [];
  for (let i = 0; i < raws.length; i++) {
    const project = coerceProject(raws[i], i);
    if (seen.has(project.id)) {
      if (project.id === DEFAULT_PROJECT_ID) projects[0] = { ...projects[0], ...project };
      continue;
    }
    seen.add(project.id);
    projects.push(project);
  }

  return projects;
}

const HORIZON_UNITS: ReadonlySet<string> = new Set(["week", "month", "someday"]);

function coerceHorizon(raw: unknown): Horizon | null {
  if (!isObject(raw)) return null;
  if (typeof raw.unit !== "string" || !HORIZON_UNITS.has(raw.unit)) return null;
  const unit = raw.unit as HorizonUnit;
  // "someday" has no anchor; week/month carry a period key.
  return { unit, anchor: unit === "someday" ? null : strOrNull(raw.anchor) };
}

function coerceTask(raw: unknown): Task {
  const o = isObject(raw) ? raw : {};
  const children = Array.isArray(o.children) ? o.children.map(coerceTask) : [];
  const labels = Array.isArray(o.labels)
    ? o.labels.filter((l): l is string => typeof l === "string")
    : [];
  const plannedFor = strOrNull(o.plannedFor);
  // Invariant: a concrete date and a fuzzy horizon are mutually exclusive; a
  // date always wins. (Legacy v2 data has no horizon → null, a clean migration.)
  const horizon = plannedFor != null ? null : coerceHorizon(o.horizon);
  return {
    id: (str(o.id) || nanoid()) as TaskId,
    projectId: (str(o.projectId) || DEFAULT_PROJECT_ID) as ProjectId,
    text: str(o.text),
    notes: str(o.notes),
    completed: bool(o.completed),
    completedAt: numOrNull(o.completedAt),
    children,
    createdAt: num(o.createdAt, Date.now()),
    priority: coercePriority(o.priority),
    plannedFor,
    horizon,
    labels,
    estimatedMinutes: numOrNull(o.estimatedMinutes),
  };
}

function coerceTrashed(raw: unknown): TrashedTask {
  const o = isObject(raw) ? raw : {};
  return { task: coerceTask(o.task), deletedAt: num(o.deletedAt, Date.now()) };
}

const LOG_ACTIONS: ReadonlySet<string> = new Set([
  "completed",
  "uncompleted",
  "postponed",
  "dropped",
  "brokeDown",
]);

function coerceLogAction(x: unknown): LogAction {
  return typeof x === "string" && LOG_ACTIONS.has(x)
    ? (x as LogAction)
    : "completed";
}

function coerceLogEntry(raw: unknown): LogEntry {
  const o = isObject(raw) ? raw : {};
  return {
    id: str(o.id) || nanoid(),
    taskId: str(o.taskId) as TaskId,
    taskText: str(o.taskText),
    action: coerceLogAction(o.action),
    reason: strOrNull(o.reason),
    at: num(o.at, Date.now()),
    date: str(o.date),
  };
}

export function coerceState(raw: unknown): AppState {
  if (!isObject(raw)) return emptyState();
  const projects = coerceProjects(raw.projects);
  const projectIds = new Set(projects.map((project) => project.id));
  const tasks = Array.isArray(raw.tasks) ? raw.tasks.map(coerceTask) : [];
  const trash = Array.isArray(raw.trash) ? raw.trash.map(coerceTrashed) : [];

  const normalizeProject = (task: Task): Task => ({
    ...task,
    projectId: projectIds.has(task.projectId) ? task.projectId : DEFAULT_PROJECT_ID,
    children: task.children.map(normalizeProject),
  });

  return {
    schemaVersion: num(raw.schemaVersion, SCHEMA_VERSION),
    projects,
    tasks: normalizeChildProjects(tasks.map(normalizeProject)),
    trash: trash.map((entry) => ({
      ...entry,
      task: normalizeChildProjects([normalizeProject(entry.task)])[0],
    })),
    log: Array.isArray(raw.log) ? raw.log.map(coerceLogEntry) : [],
    theme: coerceTheme(raw.theme),
    lastOpenedDate: strOrNull(raw.lastOpenedDate),
    devDateOverride: strOrNull(raw.devDateOverride),
  };
}
