import type {
  ActionLogEntry,
  AppState,
  DayRecord,
  ISODate,
  LogEntry,
  Project,
  Recurrence,
  Task,
  TaskId,
  Tombstone,
  TrashedTask,
} from "../types";
import { ACTION_LOG_LIMIT, MAX_DAY_RECORDS, pruneTombstones } from "../types";
import { repairRanks } from "../store/placement";

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
//   • carriedCount / postponedCount: MAX (monotonic counters — never go
//     backwards, so deferring on one device can't be erased by the other).
//   • Deletes: recorded as `tombstones` (see the type — the Trash is the undo
//     affordance, this is the merge record), and read from `trash` too so a
//     document written before v17 keeps its deletions. A delete wins iff its
//     deletedAt is ≥ the newest live copy's updatedAt (edit-after-delete
//     resurrects; ties → deleted, which keeps the merge idempotent). Without a
//     record, a delete cannot be told apart from an add the other device made,
//     and comes straight back — which is what used to happen to an undone
//     create, an emptied Trash, and every deleted recurrence.
//   • Structure (v18): resolved PER TASK too. Each task's placement — its parent
//     and its sibling `rank` — comes from whichever side moved it last
//     (`movedAt`), and the tree is rebuilt from those, siblings sorted by rank.
//     So moves on either device survive, and an add from the other device lands
//     wherever it was made, at any depth. (Before v18 the writer's tree shape
//     won wholesale and the other side's moves were lost.) See mergeTrees.
//   • Projects and recurrences: newest `updatedAt` wins per id (v18).
//   • actionLog: UNION by id (append-only on both sides — nobody rewrites it),
//     newest first and capped, so the history reads as one trail per account.

/** The newest Trash entry per id — the restorable payload behind a deletion. */
function newestTrashed(...lists: TrashedTask[][]): Map<TaskId, TrashedTask> {
  const m = new Map<TaskId, TrashedTask>();
  for (const list of lists) {
    for (const e of list) {
      const prev = m.get(e.task.id);
      if (prev == null || e.deletedAt > prev.deletedAt) m.set(e.task.id, e);
    }
  }
  return m;
}

/**
 * When each id was deleted, newest across every record either side holds:
 * bare {@link Tombstone}s *and* Trash entries, which carry a deletion of their
 * own. Reading both is what lets a document deleted before v17 — when the Trash
 * was the only record — keep staying deleted.
 */
function deletionRecords(
  trashed: Map<TaskId, TrashedTask>,
  ...lists: Tombstone[][]
): Map<string, Tombstone> {
  // Bare records get the same reduction the store and the read path use:
  // newest per id, `purged` latched on, expired entries dropped.
  const records = new Map<string, Tombstone>(
    pruneTombstones(lists.flat()).map((t) => [t.id, t]),
  );
  // A Trash entry is a deletion in its own right — reading it is what keeps a
  // document written before v17 (when the Trash was the only record) deleted.
  // It is deliberately NOT run through the TTL: the TTL exists to bound bare
  // records, and a Trash entry is bounded by the Trash itself. Expiring it here
  // would make everything trashed more than TOMBSTONE_TTL_DAYS ago silently fall
  // out of the Trash on the next sync.
  for (const [id, e] of trashed) {
    const bare = records.get(id);
    records.set(id, {
      id,
      deletedAt: Math.max(bare?.deletedAt ?? -Infinity, e.deletedAt),
      purged: bare?.purged === true,
    });
  }
  return records;
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
    waitingOn: newer.waitingOn,
    priority: newer.priority,
    plannedFor: newer.plannedFor,
    horizon: newer.horizon,
    projectId: newer.projectId,
    estimatedMinutes: newer.estimatedMinutes,
    recurrenceId: newer.recurrenceId,
    occurrenceDate: newer.occurrenceDate,
    scheduledAt: newer.scheduledAt,
    carriedCount: Math.max(base.carriedCount, other.carriedCount),
    postponedCount: Math.max(base.postponedCount, other.postponedCount),
    labels: labelsUnion(base.labels, other.labels),
    updatedAt: Math.max(base.updatedAt, other.updatedAt),
  };
}

/**
 * Union by id; where both sides have an item, the newer `updatedAt` wins (a tie
 * keeps local). Local order first, then remote-only items in remote order.
 */
function newestById<T extends { id: string; updatedAt: number }>(a: T[], b: T[]): T[] {
  const theirs = new Map(b.map((x) => [x.id, x]));
  const out = a.map((x) => {
    const other = theirs.get(x.id);
    return other != null && other.updatedAt > x.updatedAt ? other : x;
  });
  const seen = new Set(a.map((x) => x.id));
  for (const x of b) if (!seen.has(x.id)) out.push(x);
  return out;
}

// ─── Tree merge: content and placement resolved per task ────────────

/** A task's own fields (children ignored) and where it sits. */
interface Slot {
  node: Task;
  parent: TaskId | null;
}

function slotsOf(tasks: Task[]): Map<TaskId, Slot> {
  const m = new Map<TaskId, Slot>();
  const go = (list: Task[], parent: TaskId | null) => {
    for (const t of list) {
      m.set(t.id, { node: t, parent });
      go(t.children, t.id);
    }
  };
  go(tasks, null);
  return m;
}

const byRank = (a: Task, b: Task): number =>
  a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Merge two task trees id by id, then rebuild the tree from the result.
 *
 * - Content: `mergeOwnFields` (newest `updatedAt`, labels unioned, counters maxed).
 * - Placement (parent + rank): the side with the newer `movedAt`; a tie keeps
 *   local. So a move made on either device survives, independently of content
 *   edits made on the other.
 * - A task whose parent was deleted goes with it (a Trash entry recorded only
 *   its root). One whose parent is simply unknown is kept at the top level.
 * - Opposite concurrent moves can form a loop (X under Y here, Y under X there).
 *   The loop's oldest move loses: that task goes to the top level.
 * - Siblings sort by (rank, id), so both devices build the same order, and a
 *   rank tie is broken in the output.
 */
function mergeTrees(
  slotsL: Map<TaskId, Slot>,
  slotsR: Map<TaskId, Slot>,
  deleted: ReadonlySet<string>,
): Task[] {
  const merged = new Map<TaskId, Slot & { dead: boolean }>();
  for (const id of new Set([...slotsL.keys(), ...slotsR.keys()])) {
    if (deleted.has(id)) continue;
    const l = slotsL.get(id);
    const r = slotsR.get(id);
    const content = l != null ? mergeOwnFields(l.node, r?.node) : r != null ? r.node : null;
    if (content == null) continue;
    const place = l == null ? r : r == null ? l : r.node.movedAt > l.node.movedAt ? r : l;
    if (place == null) continue;
    merged.set(id, {
      node: { ...content, rank: place.node.rank, movedAt: place.node.movedAt, children: [] },
      parent: place.parent,
      dead: false,
    });
  }

  for (const slot of merged.values()) {
    if (slot.parent == null || merged.has(slot.parent)) continue;
    if (deleted.has(slot.parent)) slot.dead = true;
    else slot.parent = null;
  }

  // Break loops: walk up from every task; a revisit on the current path is a loop.
  const settled = new Set<TaskId>();
  for (const start of merged.keys()) {
    const path: TaskId[] = [];
    const onPath = new Set<TaskId>();
    let cur: TaskId | null = start;
    while (cur != null && !settled.has(cur)) {
      if (onPath.has(cur)) {
        const loop = path.slice(path.indexOf(cur));
        let loser = loop[0];
        for (const id of loop) {
          const a = merged.get(id)?.node;
          const b = merged.get(loser)?.node;
          if (a != null && b != null && (a.movedAt < b.movedAt || (a.movedAt === b.movedAt && a.id < b.id))) {
            loser = id;
          }
        }
        const slot = merged.get(loser);
        if (slot != null) slot.parent = null;
        break;
      }
      onPath.add(cur);
      path.push(cur);
      cur = merged.get(cur)?.parent ?? null;
    }
    for (const id of path) settled.add(id);
  }

  const alive = new Map<TaskId, boolean>();
  const isAlive = (id: TaskId): boolean => {
    const known = alive.get(id);
    if (known != null) return known;
    const slot = merged.get(id);
    const ok = slot != null && !slot.dead && (slot.parent == null || isAlive(slot.parent));
    alive.set(id, ok);
    return ok;
  };

  const kids = new Map<TaskId | null, Task[]>();
  for (const [id, slot] of merged) {
    if (!isAlive(id)) continue;
    const list = kids.get(slot.parent) ?? [];
    list.push(slot.node);
    kids.set(slot.parent, list);
  }
  const build = (parent: TaskId | null): Task[] =>
    (kids.get(parent) ?? []).sort(byRank).map((t) => ({ ...t, children: build(t.id) }));
  // Two devices can hand out the same rank independently (both appended to the
  // same list offline). Sorting by id already ordered them identically on both;
  // re-ranking the tie here makes the output a fixed point, so merging it again
  // changes nothing (no push↔pull loop). Deterministic, so both devices agree.
  return repairRanks(build(null));
}

function mergeLog(a: LogEntry[], b: LogEntry[]): LogEntry[] {
  const byId = new Map<string, LogEntry>();
  for (const e of [...a, ...b]) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()].sort((x, y) => y.at - x.at);
}

/**
 * The action history is append-only on both sides, so a union by id is the whole
 * merge — no side ever rewrites a line. Newest first, then trimmed, so two busy
 * devices converge on one capped trail instead of growing without bound.
 */
function mergeActionLog(a: ActionLogEntry[], b: ActionLogEntry[]): ActionLogEntry[] {
  const byId = new Map<string, ActionLogEntry>();
  for (const e of [...a, ...b]) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()].sort((x, y) => y.at - x.at).slice(0, ACTION_LOG_LIMIT);
}

/**
 * Day records merge per date, generously: the larger count on each side (a device
 * that saw more of the day saw more of the truth) and the *earliest* non-null
 * `closedAt` (you closed the day at the first moment you reached zero, whichever
 * machine was watching). Commutative and idempotent, so repeated syncs converge.
 */
function mergeDays(a: DayRecord[], b: DayRecord[]): DayRecord[] {
  const byDate = new Map<ISODate, DayRecord>();
  for (const d of [...a, ...b]) {
    const prev = byDate.get(d.date);
    byDate.set(
      d.date,
      prev == null
        ? d
        : {
            date: d.date,
            committed: Math.max(prev.committed, d.committed),
            done: Math.max(prev.done, d.done),
            doneMinutes: Math.max(prev.doneMinutes, d.doneMinutes),
            skipped: Math.max(prev.skipped, d.skipped),
            closedAt:
              prev.closedAt == null
                ? d.closedAt
                : d.closedAt == null
                  ? prev.closedAt
                  : Math.min(prev.closedAt, d.closedAt),
          }
    );
  }
  return [...byDate.values()].sort((x, y) => x.date.localeCompare(y.date)).slice(-MAX_DAY_RECORDS);
}

function maxDate(a: string | null, b: string | null): string | null {
  if (a == null) return b;
  if (b == null) return a;
  return a >= b ? a : b; // ISO dates sort lexically
}

export function mergeStates(local: AppState, remote: AppState): AppState {
  // Rank-less or tied sibling lists (pre-v18 data, a hand-built state) get
  // deterministic ranks from their position first; a no-op on consistent data.
  const slotsL = slotsOf(repairRanks(local.tasks));
  const slotsR = slotsOf(repairRanks(remote.tasks));
  const trashed = newestTrashed(local.trash, remote.trash);
  const records = deletionRecords(trashed, local.tombstones, remote.tombstones);

  // Which ids end up deleted (tombstone at least as new as the newest live copy).
  //
  // "Live" time is the newest of a copy's content edit and its move: moving a
  // task on one device after it was deleted on the other brings it back, just as
  // editing it does. A RECURRENCE id is judged by the same rule on its own
  // `updatedAt` (v18; older recurrences carry their createdAt).
  const recUpdatedAt = new Map<string, number>();
  for (const r of [...local.recurrences, ...remote.recurrences]) {
    recUpdatedAt.set(r.id, Math.max(recUpdatedAt.get(r.id) ?? -Infinity, r.updatedAt));
  }
  const lastTouched = (slot: Slot | undefined): number =>
    slot == null ? -Infinity : Math.max(slot.node.updatedAt, slot.node.movedAt);
  const deleted = new Set<string>();
  for (const [id, record] of records) {
    const liveUpdatedAt = Math.max(
      lastTouched(slotsL.get(id as TaskId)),
      lastTouched(slotsR.get(id as TaskId)),
      recUpdatedAt.get(id) ?? -Infinity,
    );
    if (record.deletedAt >= liveUpdatedAt) deleted.add(id);
  }

  const tasks = mergeTrees(slotsL, slotsR, deleted);

  // The restorable copy survives while the id is deleted but not *purged*. Once
  // it is purged the payload goes, even though the other device still lists it —
  // otherwise emptying the Trash just waits for the next pull to refill it.
  const trash: TrashedTask[] = [];
  for (const [id, entry] of trashed) {
    if (deleted.has(id) && records.get(id)?.purged !== true) trash.push(entry);
  }

  // Every surviving deletion, as a bare record. Deliberately kept for ids that
  // are in the Trash too: emptying the Trash throws the payload away, and this
  // is what then goes on holding the deletion down. An id that lost the rule
  // above (edited on the other device after it was deleted here) drops out —
  // it is alive again, and a tombstone left behind would re-fight every sync.
  const tombstones = pruneTombstones(
    [...records.values()].filter((t) => deleted.has(t.id)),
  );

  return {
    schemaVersion: Math.max(local.schemaVersion, remote.schemaVersion),
    projects: newestById<Project>(local.projects, remote.projects),
    tasks,
    recurrences: newestById<Recurrence>(local.recurrences, remote.recurrences).filter(
      (r) => !deleted.has(r.id),
    ),
    trash,
    tombstones,
    log: mergeLog(local.log, remote.log),
    theme: local.theme, // writer wins (a per-device preference, effectively)
    currentTaskId: local.currentTaskId, // writer's "right now"
    lastOpenedDate: maxDate(local.lastOpenedDate, remote.lastOpenedDate),
    devDateOverride: local.devDateOverride,
    dailyCapacityBlocks: local.dailyCapacityBlocks, // writer wins (a per-device setting)
    boardPreferred: local.boardPreferred, // writer wins (a per-device preference)
    commandUsage: local.commandUsage, // writer wins (per-device palette rankings)
    actionLog: mergeActionLog(local.actionLog, remote.actionLog),
    presence: local.presence, // writer wins (a menu bar / login item is per-machine)
    days: mergeDays(local.days, remote.days),
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
