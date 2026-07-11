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
//   • Structure (tree shape / sibling order): taken from LOCAL (the writer). With
//     real-time sync the writer already holds the other side's latest, so this is
//     rarely lossy; remote-only *top-level* subtrees are still carried over as a
//     safety net. (Nested remote-only adds rely on the pull keeping the writer
//     current — a documented v1 limitation, not silent loss of content fields.)

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
    carriedCount: Math.max(base.carriedCount, other.carriedCount),
    labels: labelsUnion(base.labels, other.labels),
    updatedAt: Math.max(base.updatedAt, other.updatedAt),
  };
}

function stripDeleted(task: Task, deleted: Set<TaskId>): Task {
  return {
    ...task,
    children: task.children
      .filter((c) => !deleted.has(c.id))
      .map((c) => stripDeleted(c, deleted)),
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

  // Safety net: remote-only top-level subtrees (added on the other device).
  for (const rt of remote.tasks) {
    if (!liveL.has(rt.id) && !deleted.has(rt.id)) {
      tasks.push(stripDeleted(rt, deleted));
    }
  }

  const trash: TrashedTask[] = [];
  for (const [id, tomb] of tombs) if (deleted.has(id)) trash.push(tomb);

  return {
    schemaVersion: Math.max(local.schemaVersion, remote.schemaVersion),
    projects: unionById<Project>(local.projects, remote.projects, (p) => p.id),
    tasks,
    recurrences: unionById<Recurrence>(local.recurrences, remote.recurrences, (r) => r.id),
    trash,
    log: mergeLog(local.log, remote.log),
    theme: local.theme, // writer wins (a per-device preference, effectively)
    currentTaskId: local.currentTaskId, // writer's "right now"
    lastOpenedDate: maxDate(local.lastOpenedDate, remote.lastOpenedDate),
    devDateOverride: local.devDateOverride,
  };
}
