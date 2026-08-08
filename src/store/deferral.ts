import type { Task } from "../types";

// The deferral ledger: what a task's carry/postpone history *means*.
//
// The app's whole bargain is that postponing is allowed but must be mindful. For
// that to be true the two ways of not doing something today have to cost
// something, and until now only one of them did:
//
//   • KEEP (`t` in the Reckoning) re-commits the task to today unchanged. It
//     bumps `carriedCount` and has always shown a "carried N×" badge.
//   • POSTPONE (`s`) pushes it to another day — or, before v12, into an undated
//     void. It was one keystroke, uncounted and unbadged, which made it the
//     cheapest possible exit and therefore the one a tired person reaches for.
//
// Both are now counted, both are badged, and past a threshold both stop being
// free: the Reckoning interrupts with a question whose *default* is the honest
// answer (break it down / decide you won't do it) and whose escape is one extra
// deliberate key. That asymmetry is the entire design — never a block, because a
// gate you can't pass just pushes the dodge somewhere the app can't see.
//
// Pure and dependency-free on purpose: thresholds and wording are product
// judgement, and this is the one file to argue with when they need to change.

/**
 * Keep this many times without finishing and the Reckoning stops taking a bare
 * "keep for today". Three is the point where a task has demonstrated it is not
 * a task: you have now committed to it on three separate days and finished it on
 * none of them, which is what a project looks like from the inside.
 */
export const CARRY_PROMPT_AT = 3;

/**
 * Postpone this many times and the Reckoning asks whether it is ever happening.
 * Set higher than the carry threshold because pushing a date is a legitimate,
 * common act — plans really do change — and the prompt should read as a fair
 * observation rather than nagging. Four separate deferrals is past that line.
 */
export const POSTPONE_PROMPT_AT = 4;

/** Below this a postpone is just life; at or above it, it's a pattern worth showing. */
const POSTPONE_BADGE_AT = 2;

export type DeferralKind = "carried" | "postponed";

/** One "carried 3×" / "postponed 5×" chip: what it says and how loud it is. */
export interface DeferralBadge {
  kind: DeferralKind;
  count: number;
  label: string;
  title: string;
  /** "loud" once the count has crossed its prompt threshold — the tone escalates. */
  tone: "quiet" | "loud";
}

const times = (n: number): string => `${n} time${n === 1 ? "" : "s"}`;

/**
 * The badges a task has earned, worst first. A task the user has both carried
 * and postponed shows both — they are different failures (clung to vs. pushed
 * away) and collapsing them would hide which one is happening.
 *
 * Carried shows from the first time, matching the badge's long-standing
 * behaviour in the Reckoning. Postponed waits for the second: one "not today" is
 * ordinary, and a badge on it would cry wolf.
 */
export function deferralBadges(task: Task): DeferralBadge[] {
  const out: DeferralBadge[] = [];
  if (task.postponedCount >= POSTPONE_BADGE_AT) {
    out.push({
      kind: "postponed",
      count: task.postponedCount,
      label: `postponed ${task.postponedCount}×`,
      title: `Pushed to another day ${times(task.postponedCount)} without being done`,
      tone: task.postponedCount >= POSTPONE_PROMPT_AT ? "loud" : "quiet",
    });
  }
  if (task.carriedCount >= 1) {
    out.push({
      kind: "carried",
      count: task.carriedCount,
      label: `carried ${task.carriedCount}×`,
      title: `Kept for today ${times(task.carriedCount)} without finishing`,
      tone: task.carriedCount >= CARRY_PROMPT_AT ? "loud" : "quiet",
    });
  }
  return out;
}

/**
 * Would keeping this for today make it the {@link CARRY_PROMPT_AT}-th time? Read
 * *before* the keep lands, so the count is the one the user is about to create.
 */
export function willPromptOnKeep(task: Task): boolean {
  return task.carriedCount + 1 >= CARRY_PROMPT_AT;
}

/** The same question for postponing — see {@link POSTPONE_PROMPT_AT}. */
export function willPromptOnPostpone(task: Task): boolean {
  return task.postponedCount + 1 >= POSTPONE_PROMPT_AT;
}
