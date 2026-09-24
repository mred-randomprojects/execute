import type { Task, TaskId } from "../types";
import { rankList } from "./rank";

// ─── Placement: where a task sits, kept as data ──────────────────────
//
// The in-memory tree says where every task is by array position. Sync can't
// merge array positions, so each task also carries its placement as fields:
// `rank` (order among siblings, see ./rank) and `movedAt` (when its parent or
// order last changed — the placement's own clock, separate from `updatedAt`, so
// a move on one device and an edit on another both survive the merge).
//
// Like `updatedAt`, these are written in ONE place — the store's update() choke
// point, via `placeTasks` — never at the dozens of mutation sites that insert,
// indent, drag or reorder.

interface Where {
  parent: TaskId | null;
  rank: string;
}

function indexPlacement(tasks: Task[], parent: TaskId | null, out: Map<TaskId, Where>): void {
  for (const t of tasks) {
    out.set(t.id, { parent, rank: t.rank });
    indexPlacement(t.children, t.id, out);
  }
}

/**
 * Bring `next`'s ranks and `movedAt` stamps in line with its array order,
 * relative to `prev` (the state before the change).
 *
 * - A sibling list gets strictly increasing ranks, keeping as many existing
 *   ranks as possible: after a drag only the dragged task is re-ranked.
 * - Only tasks that were already under the same parent may keep their rank —
 *   a new, pasted, duplicated or re-parented task always gets a fresh one (a
 *   duplicate starts with its original's rank, which must not win).
 * - `movedAt = now` for every task whose parent or rank ends up different from
 *   `prev`, including new ones. That covers undo: restoring an old order brings
 *   back old ranks, and stamping them `now` is what stops the cloud's copy of
 *   the move being undone from winning the next merge.
 *
 * Untouched subtrees keep their identity.
 */
export function placeTasks(prev: Task[], next: Task[], now: number): Task[] {
  if (prev === next) return next;
  const before = new Map<TaskId, Where>();
  indexPlacement(prev, null, before);

  const placeList = (list: Task[], parent: TaskId | null): Task[] => {
    const ranks = rankList(
      list.map((t) => t.rank),
      (i) => before.get(list[i].id)?.parent === parent,
    );
    let changed = false;
    const out = list.map((t, i) => {
      const children = t.children.length > 0 ? placeList(t.children, t.id) : t.children;
      const rank = ranks[i];
      const was = before.get(t.id);
      const moved = was == null || was.parent !== parent || was.rank !== rank;
      const movedAt = moved ? now : t.movedAt;
      if (children === t.children && rank === t.rank && movedAt === t.movedAt) return t;
      changed = true;
      return { ...t, children, rank, movedAt };
    });
    return changed ? out : list;
  };
  return placeList(next, null);
}

/**
 * Give every sibling list valid, strictly increasing ranks without touching
 * `movedAt` — for data read from disk or the cloud, where a list may predate
 * ranks (v17 and older), hold a tie two devices produced independently, or
 * simply be malformed. Deterministic, so two devices repairing the same list
 * agree. Returns the input itself when it is already consistent.
 */
export function repairRanks(tasks: Task[]): Task[] {
  const ranks = rankList(tasks.map((t) => t.rank));
  let changed = false;
  const out = tasks.map((t, i) => {
    const children = t.children.length > 0 ? repairRanks(t.children) : t.children;
    if (children === t.children && ranks[i] === t.rank) return t;
    changed = true;
    return { ...t, children, rank: ranks[i] };
  });
  return changed ? out : tasks;
}
