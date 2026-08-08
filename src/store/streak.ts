import type { DayRecord, ISODate } from "../types";
import { addDays, isoWeekday } from "./dates";

// The closing streak.
//
// What it counts is the one design decision that matters here. A streak of
// "finished everything" breaks on the first bad day and then actively
// demoralises — and since a bad day is guaranteed eventually, it teaches you to
// stop looking. So the streak counts days you **closed**: every commitment the
// day carried ended with an outcome. Finishing counts. Consciously declining
// counts. Facing a leftover in the Reckoning and moving it on purpose counts.
// Only leaving something unresolved doesn't.
//
// Two traps this has to avoid, both of which would make the number worse than no
// number at all:
//
//   1. REWARDING AVOIDANCE. If a day with no commitments counted as closed, the
//      safest way to grow a streak would be to stop committing to anything —
//      the exact opposite of the point. So an empty day is *neutral*: it can't
//      extend a run and it can't break one.
//   2. PUNISHING ABSENCE. If a day the app never saw broke the run, then coming
//      back after a week away would start with a loss, at the moment motivation
//      is already lowest. Absence is neutral too. The heatmap still shows the
//      gap, so the truth stays on screen while the number stays forgiving.
//
// On top of that, one isolated missed day doesn't end a run — it's recorded and
// shown ("11 days · 1 missed"), but the run survives. Two in a row ends it. A
// product whose whole thesis is "you cannot do everything every day" has no
// business breaking your streak the first time you don't.

/** How many consecutive un-closed days end a run. */
export const STREAK_BREAKS_AFTER = 2;

/** Hard bound on the date walks, so a corrupt date can't spin forever. */
const MAX_LOOKBACK = 800;

/** What a day was, as far as the streak is concerned. */
export type DayStatus = "closed" | "missed" | "empty";

export function dayStatus(record: DayRecord | undefined): DayStatus {
  // No record at all: the app never saw the day. Neutral, deliberately.
  if (record == null) return "empty";
  if (record.closedAt != null) return "closed";
  // Nothing was ever asked of this day, so nothing was left undone.
  if (record.committed === 0) return "empty";
  return "missed";
}

export interface Run {
  /** Closed days in the current run. */
  days: number;
  /** Single missed days the grace carried the run through — shown, not hidden. */
  missed: number;
}

export function indexByDate(days: DayRecord[]): Map<ISODate, DayRecord> {
  return new Map(days.map((d) => [d.date, d]));
}

/**
 * The run ending now. Today is special: it is still being lived, so closing it
 * extends the run while *not* closing it (yet) neither counts nor breaks —
 * otherwise the streak would read as broken every morning.
 */
export function currentRun(days: DayRecord[], today: ISODate): Run {
  const byDate = indexByDate(days);
  let closed = 0;
  let missed = 0;
  // A miss only counts as *inside* the run once an older closed day proves it was
  // a gap rather than the edge — otherwise a run would report a trailing miss it
  // never actually spanned.
  let pendingMiss = false;

  if (dayStatus(byDate.get(today)) === "closed") closed++;

  let cursor = addDays(today, -1);
  for (let i = 0; i < MAX_LOOKBACK; i++) {
    const status = dayStatus(byDate.get(cursor));
    if (status === "closed") {
      closed++;
      if (pendingMiss) {
        missed++;
        pendingMiss = false;
      }
    } else if (status === "missed") {
      if (pendingMiss) break; // two in a row — the run is over
      if (closed === 0) break; // nothing to extend
      pendingMiss = true;
    }
    // "empty" falls through: neither counted nor a break.
    cursor = addDays(cursor, -1);
  }
  return { days: closed, missed };
}

/** The longest run ever recorded, under the same rules. */
export function bestRun(days: DayRecord[], today: ISODate): number {
  const byDate = indexByDate(days);
  const dates = days.map((d) => d.date).filter((d) => d <= today).sort();
  if (dates.length === 0) return 0;

  let best = 0;
  let closed = 0;
  let pendingMiss = false;
  let cursor = dates[0];
  for (let i = 0; i < MAX_LOOKBACK && cursor <= today; i++) {
    const status = dayStatus(byDate.get(cursor));
    if (status === "closed") {
      closed++;
      pendingMiss = false;
      if (closed > best) best = closed;
    } else if (status === "missed") {
      if (pendingMiss) {
        closed = 0;
        pendingMiss = false;
      } else if (closed > 0) {
        pendingMiss = true;
      }
    }
    cursor = addDays(cursor, 1);
  }
  return best;
}

/** One square of the heatmap. */
export interface HeatDay {
  date: ISODate;
  status: DayStatus;
  /** Tasks finished that day — the square's intensity, so hollow days look hollow. */
  done: number;
  committed: number;
  isToday: boolean;
  isFuture: boolean;
}

/**
 * The last `weeks` weeks as squares, oldest first, starting on a Monday so the
 * grid reads as calendar columns. Runs to the end of the current week, with the
 * days after today marked so they can render as blanks rather than misses.
 */
export function heatmap(days: DayRecord[], today: ISODate, weeks: number): HeatDay[] {
  const byDate = indexByDate(days);
  // Back to the Monday of the week `weeks - 1` weeks ago.
  const start = addDays(today, -((weeks - 1) * 7 + (isoWeekday(today) - 1)));
  const out: HeatDay[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const date = addDays(start, i);
    const record = byDate.get(date);
    out.push({
      date,
      status: dayStatus(record),
      done: record?.done ?? 0,
      committed: record?.committed ?? 0,
      isToday: date === today,
      isFuture: date > today,
    });
  }
  return out;
}

/** How many of the last `n` days that had commitments were closed. */
export interface RecentRate {
  closed: number;
  /** Days in the window that actually asked something of you. */
  counted: number;
}

export function recentRate(days: DayRecord[], today: ISODate, n: number): RecentRate {
  const byDate = indexByDate(days);
  let closed = 0;
  let counted = 0;
  for (let i = 0; i < n; i++) {
    const status = dayStatus(byDate.get(addDays(today, -i)));
    if (status === "empty") continue;
    counted++;
    if (status === "closed") closed++;
  }
  return { closed, counted };
}
