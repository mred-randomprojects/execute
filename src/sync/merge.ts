import type { AppState, LogEntry, Project, Recurrence, Task, TaskId, TrashedTask } from "../types";

// ─── Two-way merge (per-task last-write-wins) ────────────────────────
//
// Merges the local (writer) state with the remote (cloud) state so concurrent
// edits from two devices don't clobber each other. The rules, and why:
//
//   • Content: resolved PER TASK by `updatedAt` — newest wins. Because tasks are
//     keyed by stable id, edits to *different* tasks never conflict. Only the
//     same task edited on both sides within one sync window loses the older edit
//     (rare, and real-time onSnapshot makes it rarer still).
//   • labels: UNION (a set — adding a tag on each device keeps both).
//   • carriedCount: MAX (a monotonic counter — never goes backwards).
//   • Deletes: `trash` entries are tombstones. A delete wins iff its deletedAt is
//     ≥ the newest live copy's updatedAt (edit-after-delete resurrects; ties →
//     deleted, which keeps the merge idempotent). No zombie resurrection.
//   • Structure (tree shape / sibling order): taken from LOCAL (the writer) for
//     tasks both sides know about. Remote-only tasks (adds from the other device)
//     are grafted back in at ANY depth — under their remote parent when it
//     survived locally, else at top level — so no add is ever dropped, whether it
//     was made at the root or nested under an existing task.

function flatten(tasks: Task[]): Map<TaskId, Task> {
  const m = new Map<TaskId, Task>();
  const go = (list: Task[]) => {
    for (const t of list) {
      m.set(t.id, t);
      go(t.children);
    }
  };
  go(tasks);
  return m;
}

function newestTombstones(...lists: TrashedTask[][]): Map<TaskId, TrashedTask> {
  const m = new Map<TaskId, TrashedTask>();
  for (const list of lists) {
    for (const e of list) {
      const prev = m.get(e.task.id);
      if (prev == null || e.deletedAt > prev.deletedAt) m.set(e.task.id, e);
    }
  }
  return m;
}

function labelsUnion(a: string[], b: string[]): string[] {
  const out = [...a];
  for (const x of b) if (!out.includes(x)) out.push(x);
  return out;
}

/** Merge one task's OWN fields (keeps `base`'s children + tree position). */
function mergeOwnFields(base: Task, other: Task | undefined): Task {
  if (other == null) return base;
  const newer = other.updatedAt > base.updatedAt ? other : base;
  return {
    ...base,
    text: newer.text,
    notes: newer.notes,
    completed: newer.completed,
    completedAt: newer.completedAt,
    wontDo: newer.wontDo,
    priority: newer.priority,
    plannedFor: newer.plannedFor,
    horizon: newer.horizon,
    projectId: newer.projectId,
    estimatedMinutes: newer.estimatedMinutes,
    recurrenceId: newer.recurrenceId,
    occurrenceDate: newer.occurrenceDate,
    scheduledAt: newer.scheduledAt,
    carriedCount: Math.max(base.carriedCount, other.carriedCount),
    labels: labelsUnion(base.labels, other.labels),
    updatedAt: Math.max(base.updatedAt, other.updatedAt),
  };
}

function unionById<T>(a: T[], b: T[], id: (x: T) => string): T[] {
  const out = [...a];
  const seen = new Set(a.map(id));
  for (const x of b) if (!seen.has(id(x))) out.push(x);
  return out;
}

function mergeLog(a: LogEntry[], b: LogEntry[]): LogEntry[] {
  const byId = new Map<string, LogEntry>();
  for (const e of [...a, ...b]) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()].sort((x, y) => y.at - x.at);
}

function maxDate(a: string | null, b: string | null): string | null {
  if (a == null) return b;
  if (b == null) return a;
  return a >= b ? a : b; // ISO dates sort lexically
}

export function mergeStates(local: AppState, remote: AppState): AppState {
  const liveL = flatten(local.tasks);
  const liveR = flatten(remote.tasks);
  const tombs = newestTombstones(local.trash, remote.trash);

  // Which ids end up deleted (tombstone at least as new as the newest live copy).
  const deleted = new Set<TaskId>();
  for (const [id, tomb] of tombs) {
    const liveUpdatedAt = Math.max(
      liveL.get(id)?.updatedAt ?? -Infinity,
      liveR.get(id)?.updatedAt ?? -Infinity,
    );
    if (tomb.deletedAt >= liveUpdatedAt) deleted.add(id);
  }

  // Rebuild on LOCAL structure; overlay each node's own fields by LWW; drop
  // deleted subtrees.
  const rebuild = (nodes: Task[]): Task[] => {
    const out: Task[] = [];
    for (const t of nodes) {
      if (deleted.has(t.id)) continue;
      const merged = mergeOwnFields(t, liveR.get(t.id));
      out.push({ ...merged, children: rebuild(t.children) });
    }
    return out;
  };
  const tasks = rebuild(local.tasks);

  // ── Graft remote-only adds back in (at any depth) ──────────────────
  // Every task that exists on the remote but not in the rebuilt local tree (and
  // isn't deleted) is an add from the other device. We re-attach it under its
  // remote parent when that parent survived here, otherwise at top level — so a
  // task created as a *child* of an existing task is never lost.
  const placed = new Set<TaskId>();
  const indexPlaced = (list: Task[]): void => {
    for (const t of list) {
      placed.add(t.id);
      indexPlaced(t.children);
    }
  };
  indexPlaced(tasks);

  const remoteParent = new Map<TaskId, TaskId | null>();
  const indexParents = (list: Task[], parent: TaskId | null): void => {
    for (const t of list) {
      remoteParent.set(t.id, parent);
      indexParents(t.children, t.id);
    }
  };
  indexParents(remote.tasks, null);

  // A remote subtree stripped of deleted nodes and of nodes that already live in
  // the merged tree (local structure wins → never duplicate an id).
  const stripForGraft = (t: Task): Task | null => {
    if (deleted.has(t.id) || placed.has(t.id)) return null;
    const children: Task[] = [];
    for (const c of t.children) {
      const kept = stripForGraft(c);
      if (kept != null) children.push(kept);
    }
    return { ...t, children };
  };

  // Collect graft roots grouped by the surviving parent they hang off (null =
  // top level). We only graft at the boundary between the shared tree and a
  // remote-only region; deeper remote-only nodes ride along inside their root.
  const graftsByParent = new Map<TaskId | null, Task[]>();
  for (const rt of liveR.values()) {
    if (placed.has(rt.id) || deleted.has(rt.id)) continue;
    const parent = remoteParent.get(rt.id) ?? null;
    if (parent !== null && !placed.has(parent)) continue; // rides inside its root
    const sub = stripForGraft(rt);
    if (sub == null) continue;
    const siblings = graftsByParent.get(parent) ?? [];
    siblings.push(sub);
    graftsByParent.set(parent, siblings);
  }

  const hasNested = [...graftsByParent.keys()].some((k) => k !== null);
  const attach = (nodes: Task[]): Task[] =>
    nodes.map((n) => {
      const kids = attach(n.children);
      const extra = graftsByParent.get(n.id);
      return { ...n, children: extra != null ? [...kids, ...extra] : kids };
    });
  const rooted = hasNested ? attach(tasks) : tasks;
  const withGrafts = [...rooted, ...(graftsByParent.get(null) ?? [])];

  const trash: TrashedTask[] = [];
  for (const [id, tomb] of tombs) if (deleted.has(id)) trash.push(tomb);

  return {
    schemaVersion: Math.max(local.schemaVersion, remote.schemaVersion),
    projects: unionById<Project>(local.projects, remote.projects, (p) => p.id),
    tasks: withGrafts,
    recurrences: unionById<Recurrence>(local.recurrences, remote.recurrences, (r) => r.id),
    trash,
    log: mergeLog(local.log, remote.log),
    theme: local.theme, // writer wins (a per-device preference, effectively)
    currentTaskId: local.currentTaskId, // writer's "right now"
    lastOpenedDate: maxDate(local.lastOpenedDate, remote.lastOpenedDate),
    devDateOverride: local.devDateOverride,
    dailyCapacityBlocks: local.dailyCapacityBlocks, // writer wins (a per-device setting)
    boardPreferred: local.boardPreferred, // writer wins (a per-device preference)
    commandUsage: local.commandUsage, // writer wins (per-device palette rankings)
  };
}

/**
 * Deep structural equality for JSON-safe values. AppState is fully JSON
 * (primitives, plain objects, arrays, null — no Dates/functions), so this is a
 * sound equality for it. The pull loop uses it to detect a no-op merge: an
 * unchanged result means "the remote added nothing new" → don't re-render, and
 * a result equal to the remote means "the cloud is already current" → don't echo
 * a pointless push. Both together are what keep pull↔push from looping.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || a === null) return false;
  if (typeof b !== "object" || b === null) return false;
  const aArr = Array.isArray(a);
  if (aArr !== Array.isArray(b)) return false;
  if (aArr) {
    const ar = a as unknown[];
    const br = b as unknown[];
    if (ar.length !== br.length) return false;
    for (let i = 0; i < ar.length; i++) if (!jsonEqual(ar[i], br[i])) return false;
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao);
  if (keys.length !== Object.keys(bo).length) return false;
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!jsonEqual(ao[k], bo[k])) return false;
  }
  return true;
}
