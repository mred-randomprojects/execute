import type { Task, TaskClockGroup, TaskClocks, TaskOwnField } from "../types";
import { TASK_FIELD_MERGE } from "../types";
import { jsonEqual } from "../sync/json";

// ─── Field-group clocks (v24) ────────────────────────────────────────
//
// A task used to merge as one unit: whichever copy had the newer `updatedAt`
// won every field. So any change on one device — even an automatic one, like
// the timer's pause when the Mac wakes — threw away whatever the other device
// had changed on the same task: a completion made on the phone overnight, a
// note added while the laptop was offline.
//
// Now each group of fields (see TASK_FIELD_MERGE) has its own clock, and the
// merge resolves each group on its own. The clocks are written here, the one
// place both the store's choke point and the phone's intents stamp a change.

/** The fields of each clock group, in TASK_FIELD_MERGE's order. */
export const CLOCK_GROUPS: ReadonlyArray<readonly [TaskClockGroup, readonly TaskOwnField[]]> = (() => {
  const groups = new Map<TaskClockGroup, TaskOwnField[]>();
  for (const field of ownFields()) {
    const how = TASK_FIELD_MERGE[field];
    if (how === "union" || how === "max") continue;
    const list = groups.get(how) ?? [];
    list.push(field);
    groups.set(how, list);
  }
  return [...groups.entries()];
})();

/** Fields merged without a clock (labels: union; the counters: max). */
const UNCLOCKED: readonly TaskOwnField[] = ownFields().filter((f) => {
  const how = TASK_FIELD_MERGE[f];
  return how === "union" || how === "max";
});

function ownFields(): TaskOwnField[] {
  const out: TaskOwnField[] = [];
  for (const field in TASK_FIELD_MERGE) if (isOwnField(field)) out.push(field);
  return out;
}

function isOwnField(key: string): key is TaskOwnField {
  return Object.prototype.hasOwnProperty.call(TASK_FIELD_MERGE, key);
}

const same = (a: unknown, b: unknown): boolean => a === b || jsonEqual(a, b);

/** Whether `a` and `b` agree on every field of the group. */
export function sameGroup(a: Task, b: Task, fields: readonly TaskOwnField[]): boolean {
  return fields.every((f) => same(a[f], b[f]));
}

/**
 * `after` stamped as an edit of `before`: each group whose fields changed gets
 * its clock moved to `now` — or just past the clock it replaces, if that one
 * runs ahead — and `updatedAt` moves the same way if anything changed at all.
 * A task with no `before` (new, or back from the Trash) is stamped `now` and
 * needs no group clocks: nobody else holds a copy to merge it with.
 * Returns `after` itself when there's nothing to stamp.
 */
export function stampTask(before: Task | undefined, after: Task, now: number): Task {
  if (before === after) return after;
  if (before == null) return after.updatedAt === now ? after : { ...after, updatedAt: now };
  let clocks: TaskClocks | null = null;
  for (const [group, fields] of CLOCK_GROUPS) {
    if (sameGroup(before, after, fields)) continue;
    clocks ??= { ...after.clocks };
    clocks[group] = Math.max(now, (before.clocks[group] ?? 0) + 1);
  }
  if (clocks == null && UNCLOCKED.every((f) => same(before[f], after[f]))) return after;
  const updatedAt = Math.max(now, before.updatedAt + 1);
  return { ...after, updatedAt, clocks: clocks ?? after.clocks };
}
