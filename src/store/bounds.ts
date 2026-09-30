import type { ISODate, Task } from "../types";
import { isOpen } from "./tasks";

/**
 * A parent's date is a *bound*, not a plan of its own: "everything underneath is
 * needed by then at the latest" (see the schedule-inheritance note at the top of
 * selectors.ts — that is what makes an undated child borrow it). A parent whose
 * date has fallen into the past while its open children moved on isn't a
 * schedule any more; it's a lie about one, and until this it was permanent.
 *
 * Permanent, because every scheduling surface in the app writes dates onto
 * *leaves* and nothing ever touched an ancestor: the Reckoning's input
 * (`leftoverLeaves`) is leaves-only by design, so a task with children can never
 * reckon. Plan a parent and its subtask for Monday, carry the subtask forward on
 * Tuesday morning, and the parent stays pinned to Monday for good — overdue in
 * every view, filed under the wrong day in the week tabs, and with nothing left
 * in the app able to move it again.
 *
 * `widenStaleParents` repairs exactly that: bottom-up, a parent whose own date
 * is *already in the past* and which sits behind an open child is moved out to
 * that child's day. It only moves a parent forward, and only onto a day one of
 * its own children already holds, so it never invents a commitment. Idempotent,
 * so it can run after every write; structure-sharing, so untouched subtrees keep
 * their identity (and so don't re-render, and don't take an `updatedAt` bump the
 * cloud would then sync).
 *
 * Deliberately narrow in four ways:
 * - **Only stale parents.** Enforcing the bound on *future* dates too would read
 *   better on paper and behave worse: "Just this task" on a parent, moved
 *   earlier than a subtask you're deliberately leaving where it is, would be
 *   silently undone — an explicit answer to an explicit prompt, reverted. A date
 *   in the past is different: nobody is holding it on purpose, and no other path
 *   can move it.
 * - **Only concrete dates.** A fuzzy horizon ("this week") is already a loose
 *   bound — there's nothing incoherent to repair, and deriving a day from one
 *   would invent a commitment.
 * - **Only open children.** A completed or won't-do subtask dated next month is
 *   finished business and must not drag its parent out behind it.
 * - **Never backwards.** Completing the late child doesn't undo the widening:
 *   the parent's date is the user's now, and walking it back silently is a
 *   second surprise on top of the first.
 */
export function widenStaleParents(tasks: Task[], today: ISODate): Task[] {
  const mapped = tasks.map((t) => widenOne(t, today));
  return mapped.some((t, i) => t !== tasks[i]) ? mapped : tasks;
}

function widenOne(task: Task, today: ISODate): Task {
  if (task.children.length === 0) return task;
  // Bottom-up: a child that is itself a parent has to settle on its own bound
  // before this level can be asked to cover it.
  const children = widenStaleParents(task.children, today);
  // An undated parent stays undated — it's a container its children inherit
  // nothing from, and stamping it would make it a commitment of its own.
  const plannedFor =
    task.plannedFor != null && task.plannedFor < today
      ? latestDate(children, task.plannedFor)
      : task.plannedFor;
  if (children === task.children && plannedFor === task.plannedFor) return task;
  return { ...task, children, plannedFor };
}

/** The last day any open child is planned for, never earlier than `floor`. */
function latestDate(children: Task[], floor: ISODate): ISODate {
  let latest = floor;
  for (const child of children) {
    if (!isOpen(child) || child.plannedFor == null) continue;
    if (child.plannedFor > latest) latest = child.plannedFor;
  }
  return latest;
}
