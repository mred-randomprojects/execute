import type {
  AppState,
  DayRecord,
  ISODate,
  LogEntry,
  Project,
  Recurrence,
  Task,
  TaskId,
} from "../types";
import { DEFAULT_PROJECT_ID, SCHEMA_VERSION } from "../types";
import { coerceState, coerceTask } from "../store/persistence";
import { jsonEqual, treeFromSlots, type PlacedSlot } from "./merge";

// ─── Sync v2: the state as one small document per item ───────────────
//
// Phase 1 of the per-task-documents plan (docs/architecture.md, "Sync"). The
// cloud stops being one ~600 KB document and becomes collections under
// users/{uid}/, one document per task, project, recurrence, tombstone, log line
// and day, plus one `meta/state` document.
//
// This module is only the FORMAT — pure, no Firebase:
//
//   toDocs(state)          → the documents that represent a state
//   fromDocs(docs, base)   → back to a state (per-device fields from `base`)
//   diffDocs(prev, next)   → the writes that turn one set into the other
//
// The merge stays where it is and stays the only merge: a device reads the
// documents, turns them into a state with `fromDocs`, merges that with its own
// through `mergeStates`, and writes back only what `diffDocs` says changed. So
// every rule already proven there (per-task content and placement, tombstones,
// Trash, loops) carries over unchanged, and this layer only has to be lossless.

/** A task as stored: its own fields, where it sits, and whether it's in the Trash. */
export type TaskDoc = Omit<Task, "children"> & {
  parentId: TaskId | null;
  /**
   * Set on the top task of a Trash entry (its `deletedAt`); the entry's other
   * tasks hang under it by `parentId` as usual. Null for live tasks.
   */
  trashedAt: number | null;
};

export interface TombstoneDoc {
  deletedAt: number;
  purged: boolean;
}

/** The few synced fields that aren't a collection of their own. */
export interface MetaDoc {
  schemaVersion: number;
  lastOpenedDate: ISODate | null;
}

export const META_DOC_ID = "state";

export interface CloudDocs {
  tasks: Map<string, TaskDoc>;
  projects: Map<string, Project>;
  recurrences: Map<string, Recurrence>;
  tombstones: Map<string, TombstoneDoc>;
  log: Map<string, LogEntry>;
  days: Map<string, DayRecord>;
  meta: MetaDoc;
}

export type Collection = Exclude<keyof CloudDocs, "meta">;

export const COLLECTIONS: readonly Collection[] = [
  "tasks",
  "projects",
  "recurrences",
  "tombstones",
  "log",
  "days",
];

/** Documents as read from the cloud: untrusted until coerced. */
export type RawDocs = Record<Collection, ReadonlyMap<string, unknown>> & { meta: unknown };

/**
 * Fields that are per device and never leave it. Everything else in AppState
 * is synced. (Decided 2026-09-24: undo history, palette ranking, theme and the
 * tray/login settings stay local; so do the focus task, the dev date override,
 * the capacity setting and the board preference, which the merge already kept
 * writer-local.)
 */
type DeviceField =
  | "theme"
  | "currentTaskId"
  | "devDateOverride"
  | "dailyCapacityBlocks"
  | "boardPreferred"
  | "commandUsage"
  | "actionLog"
  | "presence";

function ownFields(t: Task): Omit<Task, "children"> {
  const { children: _children, ...own } = t;
  return own;
}

function addTree(
  out: Map<string, TaskDoc>,
  tasks: Task[],
  parentId: TaskId | null,
  trashedAt: number | null,
): void {
  for (const t of tasks) {
    if (out.has(t.id)) continue; // a live copy outranks a stale Trash payload
    out.set(t.id, { ...ownFields(t), parentId, trashedAt });
    addTree(out, t.children, t.id, null);
  }
}

export function toDocs(state: AppState): CloudDocs {
  const tasks = new Map<string, TaskDoc>();
  addTree(tasks, state.tasks, null, null);
  for (const entry of state.trash) addTree(tasks, [entry.task], null, entry.deletedAt);
  return {
    tasks,
    projects: new Map(state.projects.map((p) => [p.id, p])),
    recurrences: new Map(state.recurrences.map((r) => [r.id, r])),
    tombstones: new Map(state.tombstones.map((t) => [t.id, { deletedAt: t.deletedAt, purged: t.purged }])),
    log: new Map(state.log.map((e) => [e.id, e])),
    days: new Map(state.days.map((d) => [d.date, d])),
    meta: { schemaVersion: state.schemaVersion, lastOpenedDate: state.lastOpenedDate },
  };
}

// ─── Reading ─────────────────────────────────────────────────────────

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
const strOrNull = (x: unknown): string | null => (typeof x === "string" && x !== "" ? x : null);
const numOrNull = (x: unknown): number | null =>
  typeof x === "number" && Number.isFinite(x) ? x : null;
const numOr = (x: unknown, fallback: number): number => numOrNull(x) ?? fallback;
const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Each value with its document id written in as `key`, dropping non-objects. */
function withIds(docs: ReadonlyMap<string, unknown>, key: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const [id, v] of docs) if (isObject(v)) out.push({ ...v, [key]: id });
  return out;
}

/** Live tasks and Trash entries, rebuilt from task documents. */
function readTasks(docs: ReadonlyMap<string, unknown>): {
  tasks: Task[];
  trash: { task: Task; deletedAt: number }[];
} {
  const slots = new Map<TaskId, PlacedSlot>();
  const trashedAt = new Map<TaskId, number>();
  for (const [id, raw] of docs) {
    if (!isObject(raw)) continue;
    const node = coerceTask({ ...raw, id, children: [] });
    const trashed = numOrNull(raw.trashedAt);
    if (trashed != null) trashedAt.set(node.id, trashed);
    slots.set(node.id, {
      node,
      parent: trashed != null ? null : (strOrNull(raw.parentId) as TaskId | null),
      dead: false,
    });
  }

  // Which Trash entry (if any) each task belongs to: walk up to a trashed top.
  const entryOf = (id: TaskId): TaskId | null => {
    const seen = new Set<TaskId>();
    let cur: TaskId | null = id;
    while (cur != null && !seen.has(cur)) {
      if (trashedAt.has(cur)) return cur;
      seen.add(cur);
      cur = slots.get(cur)?.parent ?? null;
    }
    return null;
  };
  const live = new Map<TaskId, PlacedSlot>();
  const entries = new Map<TaskId, Map<TaskId, PlacedSlot>>();
  for (const [id, slot] of slots) {
    const entry = entryOf(id);
    if (entry == null) {
      live.set(id, slot);
      continue;
    }
    const group = entries.get(entry) ?? new Map<TaskId, PlacedSlot>();
    group.set(id, slot);
    entries.set(entry, group);
  }

  const trash: { task: Task; deletedAt: number }[] = [];
  for (const [root, group] of entries) {
    const built = treeFromSlots(group).find((t) => t.id === root);
    if (built != null) trash.push({ task: built, deletedAt: trashedAt.get(root) ?? 0 });
  }
  trash.sort((a, b) => b.deletedAt - a.deletedAt || byId(a.task.id, b.task.id));
  return { tasks: treeFromSlots(live), trash };
}

/**
 * The state these documents describe. Every document goes through the same
 * defensive coercion as the local file (`coerceState`), so nothing read from
 * the cloud is trusted as-is. Per-device fields come from `base` — the device's
 * own state, or `emptyState()` on a device that has none.
 *
 * Tolerates a subset (the phone loads only open and recent tasks): a task
 * whose parent isn't loaded lands at the top level. That detachment exists only
 * in this device's view; `diffDocs` patches only fields that changed, so it
 * never reaches the cloud.
 */
export function fromDocs(raw: RawDocs, base: AppState): AppState {
  const { tasks, trash } = readTasks(raw.tasks);
  const meta = isObject(raw.meta) ? raw.meta : {};

  const projects = withIds(raw.projects, "id").sort(
    (a, b) =>
      Number(b.id === DEFAULT_PROJECT_ID) - Number(a.id === DEFAULT_PROJECT_ID) ||
      numOr(a.createdAt, 0) - numOr(b.createdAt, 0) ||
      byId(String(a.id), String(b.id)),
  );
  const recurrences = withIds(raw.recurrences, "id").sort(
    (a, b) => numOr(a.createdAt, 0) - numOr(b.createdAt, 0) || byId(String(a.id), String(b.id)),
  );
  const log = withIds(raw.log, "id").sort(
    (a, b) => numOr(b.at, 0) - numOr(a.at, 0) || byId(String(a.id), String(b.id)),
  );
  const days = withIds(raw.days, "date").sort((a, b) => byId(String(a.date), String(b.date)));

  const synced = coerceState({
    schemaVersion: SCHEMA_VERSION,
    projects,
    tasks,
    recurrences,
    trash,
    tombstones: withIds(raw.tombstones, "id"),
    log,
    days,
    lastOpenedDate: meta.lastOpenedDate ?? null,
  });

  const device: Pick<AppState, DeviceField> = {
    theme: base.theme,
    currentTaskId: base.currentTaskId,
    devDateOverride: base.devDateOverride,
    dailyCapacityBlocks: base.dailyCapacityBlocks,
    boardPreferred: base.boardPreferred,
    commandUsage: base.commandUsage,
    actionLog: base.actionLog,
    presence: base.presence,
  };
  return { ...synced, ...device };
}

// ─── Writing ─────────────────────────────────────────────────────────

/**
 * One document write. Changes to an existing document are PATCHES — only the
 * fields that differ — so a device never rewrites a field it didn't change.
 * That matters beyond bandwidth: a device holding a partial view (the phone)
 * sees some tasks detached from parents it never loaded, and a whole-document
 * write would push that detachment back as a real move.
 */
export type DocWrite =
  | { collection: Collection | "meta"; id: string; op: "set"; data: object }
  | { collection: Collection | "meta"; id: string; op: "patch"; fields: Record<string, unknown> }
  | { collection: Collection | "meta"; id: string; op: "delete" };

function writeFor(
  collection: Collection | "meta",
  id: string,
  was: object | undefined,
  data: object,
): DocWrite | null {
  if (was == null) return { collection, id, op: "set", data };
  const before = new Map(Object.entries(was));
  const fields: Record<string, unknown> = {};
  let n = 0;
  for (const [key, value] of Object.entries(data)) {
    if (before.has(key) && jsonEqual(before.get(key), value)) continue;
    fields[key] = value;
    n++;
  }
  // A field that vanished can't be expressed as a patch of values; rewrite the
  // document (never happens with today's fixed-shape documents).
  for (const key of before.keys()) if (!(key in data)) return { collection, id, op: "set", data };
  return n === 0 ? null : { collection, id, op: "patch", fields };
}

/**
 * The writes that turn `prev` into `next`. Unchanged documents produce
 * nothing, so a single edit is a single small patch.
 *
 * `prev` must be the documents of the state the device STARTED from, in its
 * own view (`toDocs(state before the change)`) — not the raw cloud documents,
 * which a partial view doesn't reproduce.
 */
export function diffDocs(prev: CloudDocs | null, next: CloudDocs): DocWrite[] {
  const writes: DocWrite[] = [];
  for (const collection of COLLECTIONS) {
    const before: ReadonlyMap<string, object> = prev?.[collection] ?? new Map<string, object>();
    const after: ReadonlyMap<string, object> = next[collection];
    for (const [id, data] of after) {
      const w = writeFor(collection, id, before.get(id), data);
      if (w != null) writes.push(w);
    }
    for (const id of before.keys()) {
      if (!after.has(id)) writes.push({ collection, id, op: "delete" });
    }
  }
  const meta = writeFor("meta", META_DOC_ID, prev?.meta, next.meta);
  if (meta != null) writes.push(meta);
  return writes;
}

/** Documents as plain values, as a reader would hand them to `fromDocs`. */
export function asRaw(docs: CloudDocs): RawDocs {
  return {
    tasks: docs.tasks,
    projects: docs.projects,
    recurrences: docs.recurrences,
    tombstones: docs.tombstones,
    log: docs.log,
    days: docs.days,
    meta: docs.meta,
  };
}
