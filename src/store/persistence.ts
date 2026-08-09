import { nanoid } from "nanoid";
import type {
  ActionLogEntry,
  ActionLogKind,
  AppState,
  CommandUsage,
  DayRecord,
  Horizon,
  HorizonUnit,
  LogAction,
  LogEntry,
  Presence,
  Project,
  ProjectId,
  Recurrence,
  RecurrenceEnds,
  RecurrenceFreq,
  RecurrenceId,
  RecurrenceRule,
  Task,
  TaskId,
  TaskPriority,
  ThemeName,
  TrashedTask,
  WontDo,
} from "../types";
import { normalizeRule } from "./recurrence";
import {
  ACTION_LOG_LIMIT,
  DEFAULT_CAPACITY_BLOCKS,
  DEFAULT_PROJECT_ID,
  MAX_DAY_RECORDS,
  PROJECT_COLORS,
  SCHEMA_VERSION,
  defaultPresence,
  defaultProject,
  emptyState,
} from "../types";
import { normalizeChildProjects } from "./tasks";
import type { CalendarEventInput } from "./calendar";
import type { PresenceSnapshot } from "./presence";

// Bridge exposed by electron/preload.cjs. In the browser (pnpm dev) it's absent
// and we fall back to localStorage, so the renderer runs either way.
interface ExecuteBridge {
  isElectron: boolean;
  loadStore: () => Promise<unknown>;
  saveStore: (data: AppState) => Promise<boolean>;
  // Present only in builds with cloud sync wired: loopback Google OAuth run in
  // the Electron main process, resolving with a Google id_token.
  signInWithGoogle?: (
    clientId: string,
    clientSecret: string,
  ) => Promise<{ idToken: string }>;
  // Calendar integration (desktop only): whether a service-account key is
  // present, and a silent event-create that writes to the configured calendar.
  // Absent in the browser / builds without it → the picker falls back to opening
  // a prefilled Google Calendar link.
  calendarStatus?: () => Promise<{ connected: boolean; clientEmail: string | null }>;
  createCalendarEvent?: (
    input: CalendarEventInput,
  ) => Promise<{ ok: boolean; htmlLink: string | null }>;
  // Presence (desktop only): push what's left today + the settings, so the shell
  // can keep the menu bar, dock badge, login item and daily nudges honest.
  updatePresence?: (snapshot: PresenceSnapshot) => Promise<boolean>;
  /** Subscribe to the global capture shortcut. Returns an unsubscribe. */
  onFocusCapture?: (fn: () => void) => () => void;
  /** Subscribe to "open the shutdown ritual" (the evening nudge was clicked). */
  onOpenShutdown?: (fn: () => void) => () => void;
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

function coerceWontDo(raw: unknown): WontDo | null {
  if (!isObject(raw)) return null;
  return { reason: strOrNull(raw.reason), at: num(raw.at, Date.now()) };
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
  const completed = bool(o.completed);
  // v7: "won't do" resolution. Mutually exclusive with `completed` — completion
  // wins. Pre-v7 tasks have no field → null (open), a clean migration.
  const wontDo = completed ? null : coerceWontDo(o.wontDo);
  return {
    id: (str(o.id) || nanoid()) as TaskId,
    projectId: (str(o.projectId) || DEFAULT_PROJECT_ID) as ProjectId,
    text: str(o.text),
    notes: str(o.notes),
    completed,
    completedAt: numOrNull(o.completedAt),
    wontDo,
    children,
    createdAt: num(o.createdAt, Date.now()),
    // Pre-sync data has no updatedAt → baseline from createdAt so LWW has a sane
    // starting point (a task never edited since creation "changed" at creation).
    updatedAt: num(o.updatedAt, num(o.createdAt, Date.now())),
    priority: coercePriority(o.priority),
    plannedFor,
    horizon,
    labels,
    estimatedMinutes: numOrNull(o.estimatedMinutes),
    // v4: pre-v4 tasks have no carry history → 0. Clamp to a non-negative int.
    carriedCount: Math.max(0, Math.trunc(num(o.carriedCount, 0))),
    // v12: pre-v12 tasks were postponed without anyone counting → 0. The history
    // is genuinely lost (the old `s` wrote no counter), so a long-deferred task
    // starts its tally today rather than pretending to know.
    postponedCount: Math.max(0, Math.trunc(num(o.postponedCount, 0))),
    // v5: recurrence instance link. Legacy tasks aren't from recurrences → null.
    recurrenceId: strOrNull(o.recurrenceId) as RecurrenceId | null,
    occurrenceDate: strOrNull(o.occurrenceDate),
    // v10: last "added to calendar" time. Pre-v10 tasks were never calendared → null.
    scheduledAt: numOrNull(o.scheduledAt),
  };
}

const RECURRENCE_FREQS: ReadonlySet<string> = new Set(["day", "week", "month", "year"]);
const ANCHOR_FALLBACK: string = "2020-01-01";

function coerceFreq(x: unknown): RecurrenceFreq {
  return typeof x === "string" && RECURRENCE_FREQS.has(x) ? (x as RecurrenceFreq) : "day";
}

function coerceEnds(raw: unknown): RecurrenceEnds {
  if (!isObject(raw)) return { kind: "never" };
  if (raw.kind === "on" && typeof raw.date === "string") return { kind: "on", date: raw.date };
  if (raw.kind === "after") return { kind: "after", count: Math.max(1, Math.trunc(num(raw.count, 1))) };
  return { kind: "never" };
}

function coerceWeekdays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((n): n is number => typeof n === "number" && n >= 1 && n <= 7);
}

function coerceRule(raw: unknown): RecurrenceRule {
  const o = isObject(raw) ? raw : {};
  return normalizeRule({
    freq: coerceFreq(o.freq),
    interval: Math.max(1, Math.trunc(num(o.interval, 1))),
    weekdays: coerceWeekdays(o.weekdays),
    anchor: str(o.anchor) || ANCHOR_FALLBACK,
    ends: coerceEnds(o.ends),
  });
}

function coerceRecurrence(raw: unknown): Recurrence {
  const o = isObject(raw) ? raw : {};
  return {
    id: (str(o.id) || nanoid()) as RecurrenceId,
    template: coerceTask(o.template),
    rule: coerceRule(o.rule),
    createdAt: num(o.createdAt, Date.now()),
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
  "kept",
  "skipped",
]);

function coerceLogAction(x: unknown): LogAction {
  return typeof x === "string" && LOG_ACTIONS.has(x)
    ? (x as LogAction)
    : "completed";
}

// v9: command-palette frecency memory. Best-effort — drop any malformed entry
// rather than let junk poison the ranking (a non-positive count scores 0
// anyway). Pre-v9 data has no field → an empty map (no learned rankings yet).
function coerceCommandUsage(raw: unknown): Record<string, CommandUsage> {
  if (!isObject(raw)) return {};
  const out: Record<string, CommandUsage> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!isObject(value)) continue;
    const count = Math.max(0, Math.trunc(num(value.count, 0)));
    if (count <= 0) continue;
    out[id] = { count, lastUsedAt: num(value.lastUsedAt, 0) };
  }
  return out;
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

// v14: day records (the closing streak + heatmap). Anything without a usable
// date is dropped — a record that can't say which day it is says nothing. Sorted
// and de-duplicated on read so the streak walk can trust the shape.
function coerceDays(raw: unknown): DayRecord[] {
  if (!Array.isArray(raw)) return [];
  const byDate = new Map<string, DayRecord>();
  for (const entry of raw) {
    const o = isObject(entry) ? entry : {};
    const date = str(o.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const count = (x: unknown) => Math.max(0, Math.trunc(num(x, 0)));
    byDate.set(date, {
      date,
      committed: count(o.committed),
      done: count(o.done),
      skipped: count(o.skipped),
      closedAt: numOrNull(o.closedAt),
    });
  }
  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_DAY_RECORDS);
}

/** Clamp an hour-of-day to 0–23, falling back when it's absent or nonsense. */
function coerceHour(x: unknown, fallback: number): number {
  const n = Math.trunc(num(x, fallback));
  return n >= 0 && n <= 23 ? n : fallback;
}

// v13: menu bar / login item / nudges. Pre-v13 data has none → the defaults,
// which deliberately leave `openAtLogin` off (see defaultPresence).
function coercePresence(raw: unknown): Presence {
  const d = defaultPresence();
  if (!isObject(raw)) return d;
  return {
    tray: bool(raw.tray, d.tray),
    openAtLogin: bool(raw.openAtLogin, d.openAtLogin),
    nudges: bool(raw.nudges, d.nudges),
    morningHour: coerceHour(raw.morningHour, d.morningHour),
    eveningHour: coerceHour(raw.eveningHour, d.eveningHour),
  };
}

function coerceActionLogKind(raw: unknown): ActionLogKind {
  return raw === "undo" || raw === "redo" ? raw : "do";
}

function coerceActionLog(raw: unknown): ActionLogEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry): ActionLogEntry => {
      const o = isObject(entry) ? entry : {};
      return {
        id: str(o.id) || nanoid(),
        label: str(o.label),
        kind: coerceActionLogKind(o.kind),
        at: num(o.at, Date.now()),
      };
    })
    .filter((entry) => entry.label !== "")
    .slice(0, ACTION_LOG_LIMIT);
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

  const recurrences = Array.isArray(raw.recurrences)
    ? raw.recurrences.map(coerceRecurrence).map((rec) => ({
        ...rec,
        template: normalizeChildProjects([normalizeProject(rec.template)])[0],
      }))
    : [];

  return {
    schemaVersion: num(raw.schemaVersion, SCHEMA_VERSION),
    projects,
    tasks: normalizeChildProjects(tasks.map(normalizeProject)),
    recurrences,
    trash: trash.map((entry) => ({
      ...entry,
      task: normalizeChildProjects([normalizeProject(entry.task)])[0],
    })),
    log: Array.isArray(raw.log) ? raw.log.map(coerceLogEntry) : [],
    theme: coerceTheme(raw.theme),
    currentTaskId: strOrNull(raw.currentTaskId) as TaskId | null,
    lastOpenedDate: strOrNull(raw.lastOpenedDate),
    devDateOverride: strOrNull(raw.devDateOverride),
    // v8: soft daily-capacity budget. Pre-v8 data has none → the default.
    dailyCapacityBlocks: Math.max(1, Math.trunc(num(raw.dailyCapacityBlocks, DEFAULT_CAPACITY_BLOCKS))),
    // v8: planning-board preference. Pre-v8 → classic card review.
    boardPreferred: bool(raw.boardPreferred, false),
    // v9: command-palette frecency memory. Pre-v9 → no learned rankings.
    commandUsage: coerceCommandUsage(raw.commandUsage),
    // v11: the action history. Pre-v11 data has none → the log starts here.
    actionLog: coerceActionLog(raw.actionLog),
    presence: coercePresence(raw.presence),
    days: coerceDays(raw.days),
  };
}
