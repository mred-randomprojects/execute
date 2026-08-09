import type { AppState, ISODate, LogAction, Task } from "../types";
import { addDays } from "./dates";
import { recentRate, type RecentRate } from "./streak";
import { waitingOnOthers } from "../selectors";
import { walk } from "./tasks";

// The weekly review: everything the app already knew and never told you.
//
// Execute has been recording a reason on every Reckoning choice since long
// before this file existed — and reading them back exactly nowhere except one
// task's own history panel. Reasons are the most interesting data here and the
// least looked at: individually they're a shrug, in aggregate they're a
// diagnosis. "no time ×9" is a capacity problem. "waiting on Ana ×4" is a
// dependency problem. They want completely different fixes, and you cannot tell
// which you have from inside a single bad day.
//
// Pure and derived — this computes, it never writes. Everything comes from the
// log, the day records and the live tree.

/** How many days a review covers. A week: long enough for a pattern, short
 *  enough that you still remember it. */
export const REVIEW_WINDOW_DAYS = 7;

/** How many distinct reasons are worth listing before it stops being a summary. */
const MAX_REASONS = 6;
/** …and how many chronic offenders. */
const MAX_CHRONIC = 5;

export interface ReasonTally {
  reason: string;
  count: number;
}

export interface ChronicTask {
  task: Task;
  /** carried + postponed — how many times this one task has been put off. */
  deferrals: number;
}

export interface Review {
  from: ISODate;
  to: ISODate;
  /** Days closed, of the days that asked something of you. */
  rate: RecentRate;
  /** What happened in the window, by kind. */
  counts: Record<LogAction, number>;
  /** Reasons you gave, most common first. */
  reasons: ReasonTally[];
  /** Currently blocked, longest wait first. */
  waiting: Task[];
  /** The tasks you keep putting off, worst first. */
  chronic: ChronicTask[];
}

const EMPTY_COUNTS = (): Record<LogAction, number> => ({
  completed: 0,
  uncompleted: 0,
  postponed: 0,
  dropped: 0,
  brokeDown: 0,
  kept: 0,
  skipped: 0,
});

/**
 * Reasons are free text, so they're folded case-insensitively and trimmed before
 * counting — "No time" and "no time" are the same complaint, and a tally that
 * splits them hides the very pattern it exists to show. The most-used spelling
 * wins the label.
 */
function tallyReasons(reasons: string[]): ReasonTally[] {
  const byKey = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const raw of reasons) {
    const text = raw.trim();
    if (text === "") continue;
    const key = text.toLowerCase();
    const entry = byKey.get(key) ?? { count: 0, spellings: new Map() };
    entry.count++;
    entry.spellings.set(text, (entry.spellings.get(text) ?? 0) + 1);
    byKey.set(key, entry);
  }
  return [...byKey.values()]
    .map((entry) => {
      const best = [...entry.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return { reason: best, count: entry.count };
    })
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, MAX_REASONS);
}

export function buildReview(
  state: AppState,
  today: ISODate,
  window: number = REVIEW_WINDOW_DAYS
): Review {
  const from = addDays(today, -(window - 1));
  const inWindow = state.log.filter((e) => e.date >= from && e.date <= today);

  const counts = EMPTY_COUNTS();
  for (const e of inWindow) counts[e.action]++;

  const chronic: ChronicTask[] = [];
  walk(state.tasks, (t) => {
    const deferrals = t.carriedCount + t.postponedCount;
    // Two is where a task stops being unlucky and starts being a pattern.
    if (deferrals >= 2 && t.completed === false && t.wontDo == null) {
      chronic.push({ task: t, deferrals });
    }
  });
  chronic.sort((a, b) => b.deferrals - a.deferrals);

  return {
    from,
    to: today,
    rate: recentRate(state.days, today, window),
    counts,
    // Only the reasons attached to a *deferral* — a reason on a completion is a
    // note, not a diagnosis.
    reasons: tallyReasons(
      inWindow
        .filter((e) => e.action !== "completed" && e.action !== "uncompleted")
        .map((e) => e.reason ?? "")
    ),
    waiting: waitingOnOthers(state.tasks, today),
    chronic: chronic.slice(0, MAX_CHRONIC),
  };
}
