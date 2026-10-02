import type { Habit, HabitMark, ISODate } from "../types";
import { addDays, toISO, weekKey, weekStart } from "./dates";

// ─── Habits: the pure engine ─────────────────────────────────────────
//
// Everything a habit row shows is derived here from `checks` and the date —
// nothing is stored but the marks themselves. The numbers, and why these ones
// (docs/habits.md has the long version):
//
//   • This week, against a weekly target. The unit a habit is judged in is the
//     week, not the day: "3× a week" forgives a bad Monday by design.
//   • Strength — an exponential moving average, Loop Habit Tracker's idea. One
//     missed day dents it; it does not zero it. A streak counter that resets on
//     a single miss is what makes people quit ("I broke it, so why bother"),
//     and research on habit formation says one miss doesn't measurably hurt.
//   • A streak that survives a single miss: for a daily habit it breaks only on
//     two misses in a row — "never miss twice" — and for a weekly one only on
//     a week that fell short.
//
// This module is the swap point for any smarter scoring later.

export const PER_WEEK_MIN = 1;
export const PER_WEEK_MAX = 7;

/** Oldest first, ties by id — one canonical order, so two devices agree on it. */
export function sortHabits(habits: Habit[]): Habit[] {
  return [...habits].sort(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Clamp a weekly target into 1–7 whole days. */
export function normalizePerWeek(n: number): number {
  if (!Number.isFinite(n)) return PER_WEEK_MAX;
  return Math.min(PER_WEEK_MAX, Math.max(PER_WEEK_MIN, Math.round(n)));
}

export const isDaily = (h: Pick<Habit, "perWeek">): boolean => h.perWeek >= PER_WEEK_MAX;

const CADENCE_SUFFIX = /\s+(?:(\d)\s*(?:x|×|times)(?:\s*(?:a|per|\/)\s*w(?:ee)?k)?|(daily|every\s*day))\s*$/i;

/**
 * A name as typed, with a trailing cadence read off it: "Run 3x" → Run, 3×
 * a week; "Stretch daily" → Stretch, every day. `perWeek` is null when the
 * name carries none (or reads as nothing but one — "3x" alone stays a name).
 */
export function parseHabitName(raw: string): { name: string; perWeek: number | null } {
  const text = raw.trim();
  const m = CADENCE_SUFFIX.exec(text);
  if (m == null || m.index === 0) return { name: text, perWeek: null };
  const perWeek = m[2] != null ? PER_WEEK_MAX : Number(m[1]);
  if (perWeek < PER_WEEK_MIN || perWeek > PER_WEEK_MAX) return { name: text, perWeek: null };
  return { name: text.slice(0, m.index).trim(), perWeek };
}

/** "Every day", "Once a week", "3× a week". */
export function cadenceLabel(perWeek: number): string {
  if (perWeek >= PER_WEEK_MAX) return "Every day";
  if (perWeek <= 1) return "Once a week";
  return `${perWeek}× a week`;
}

export function markOn(h: Habit, date: ISODate): HabitMark | null {
  return h.checks[date] ?? null;
}

/** The habit with `date` set to `mark` (or cleared, for null). */
export function withMark(h: Habit, date: ISODate, mark: HabitMark | null): Habit {
  if (markOn(h, date) === mark) return h;
  const checks = { ...h.checks };
  if (mark == null) delete checks[date];
  else checks[date] = mark;
  return { ...h, checks };
}

/**
 * The first day the habit is accountable for: the day it was created, or the
 * earliest day marked, whichever is first (backfilling a day before creation
 * is allowed — that's a record, not a cheat).
 */
export function habitStart(h: Habit): ISODate {
  let start = toISO(new Date(h.createdAt));
  for (const d of Object.keys(h.checks)) if (d < start) start = d;
  return start;
}

// ─── The week ────────────────────────────────────────────────────────

export interface WeekProgress {
  done: number;
  /**
   * Days to hit this week. The weekly target, scaled down for days the habit
   * didn't exist yet (a 5×-a-week habit created on Saturday asks for 2, not an
   * impossible 5) and for rest days (each `skip` shrinks it in proportion).
   */
  target: number;
  remaining: number;
  /** Unmarked days from today through Sunday, today included. */
  daysLeft: number;
}

function weekProgressOf(h: Habit, key: string, today: ISODate): WeekProgress {
  const start = habitStart(h);
  const monday = weekStart(key);
  let done = 0;
  let skipped = 0;
  let available = 0;
  let daysLeft = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    if (d < start) continue;
    available++;
    const mark = markOn(h, d);
    if (mark === "done") done++;
    else if (mark === "skip") skipped++;
    else if (mark == null && d >= today) daysLeft++;
  }
  const target = Math.ceil((h.perWeek * Math.max(0, available - skipped)) / 7);
  return { done, target, remaining: Math.max(0, target - done), daysLeft };
}

export function weekProgress(h: Habit, today: ISODate): WeekProgress {
  return weekProgressOf(h, weekKey(today), today);
}

// ─── Strength ────────────────────────────────────────────────────────

/**
 * 0–1: how established the habit is. Each day nudges the score toward 1 (done)
 * or 0 (missed); rest days and the not-yet-over today leave it alone. A done
 * day is worth 7/perWeek, so a 3×-a-week habit kept 3× a week converges near
 * the top just as a daily one kept daily does.
 *
 * The half-life (Loop's: 13 days for a daily habit, longer for sparser ones)
 * is what makes it forgiving — one miss costs a few points, a month of misses
 * costs most of it. Reaching ~80% takes about a month of keeping it, which is
 * roughly how long a new behaviour takes to start feeling automatic.
 */
export function strength(h: Habit, today: ISODate): number {
  const rate = h.perWeek / 7;
  const keep = Math.pow(0.5, Math.sqrt(rate) / 13);
  let score = 0;
  for (let d = habitStart(h); d <= today; d = addDays(d, 1)) {
    const mark = markOn(h, d);
    if (d === today && mark == null) break; // today isn't over yet
    if (mark === "skip") continue;
    const value = mark === "done" ? 1 / rate : 0;
    score = Math.min(1, score * keep + (1 - keep) * value);
  }
  return score;
}

// ─── Streak ──────────────────────────────────────────────────────────

export interface Streak {
  count: number;
  unit: "day" | "week";
}

/**
 * Daily habits: done days in the current run, where a run survives a single
 * missed day and breaks on the second in a row. Weekly habits: weeks in a row
 * that met their target (this week counts once it's met, and never breaks the
 * run while it's still in progress).
 */
export function streak(h: Habit, today: ISODate): Streak {
  const start = habitStart(h);
  if (isDaily(h)) {
    let count = 0;
    let missesInARow = 0;
    // An unmarked today is still open: it neither counts nor breaks anything.
    let d = markOn(h, today) == null ? addDays(today, -1) : today;
    for (; d >= start; d = addDays(d, -1)) {
      const mark = markOn(h, d);
      if (mark === "done") {
        count++;
        missesInARow = 0;
      } else if (mark !== "skip") {
        missesInARow++;
        if (missesInARow >= 2) break;
      }
    }
    return { count, unit: "day" };
  }

  let count = 0;
  const current = weekProgress(h, today);
  if (current.target > 0 && current.remaining === 0) count++;
  for (let key = weekKey(addDays(weekStart(weekKey(today)), -1)); ; ) {
    const monday = weekStart(key);
    if (addDays(monday, 6) < start) break;
    const p = weekProgressOf(h, key, today);
    if (p.remaining > 0) break;
    if (p.target > 0) count++;
    key = weekKey(addDays(monday, -1));
  }
  return { count, unit: "week" };
}

export function streakLabel(s: Streak): string {
  if (s.count === 0) return "";
  return s.unit === "day" ? `${s.count}d streak` : `${s.count}w streak`;
}

// ─── The one line of coaching ────────────────────────────────────────

export type NudgeTone = "good" | "warn" | "neutral";

export interface Nudge {
  text: string;
  tone: NudgeTone;
}

/**
 * What, if anything, the row should say about today. Kept to one short line
 * and only ever about what can still be done — never a scolding about the past.
 */
export function nudge(h: Habit, today: ISODate): Nudge | null {
  const mark = markOn(h, today);
  if (isDaily(h)) {
    if (mark === "done") return { text: "Done today", tone: "good" };
    if (mark === "skip") return { text: "Rest day", tone: "neutral" };
    const yesterday = addDays(today, -1);
    const before = markOn(h, yesterday);
    if (yesterday >= habitStart(h) && before !== "done" && before !== "skip") {
      if (mark === "missed") return { text: "Two in a row — tomorrow, just the smallest version", tone: "warn" };
      return { text: "Missed yesterday — don’t miss twice", tone: "warn" };
    }
    return null;
  }
  const p = weekProgress(h, today);
  if (p.target > 0 && p.remaining === 0) return { text: "Week done", tone: "good" };
  if (mark === "skip") return { text: "Rest day", tone: "neutral" };
  if (p.remaining > p.daysLeft) {
    return { text: "Out of reach this week — every one still counts", tone: "neutral" };
  }
  if (p.remaining === p.daysLeft) {
    return {
      text: p.remaining === 1 ? "Today’s the last chance this week" : `${p.remaining} more — every day left this week`,
      tone: "warn",
    };
  }
  return { text: `${p.remaining} more this week`, tone: "neutral" };
}

/**
 * Still an open question on `date`: active, that day unlogged, and either daily
 * or with that week's target not yet met (a 2×-a-week habit already done twice
 * isn't asked about again). Drives the sidebar badge, the shutdown step, the
 * morning prompt and the evening nudge.
 */
export function pendingOn(h: Habit, date: ISODate): boolean {
  if (h.archivedAt != null || markOn(h, date) != null) return false;
  if (habitStart(h) > date) return false;
  return isDaily(h) || weekProgress(h, date).remaining > 0;
}

/**
 * The habits a check-in list shows for `date`: everything still pending plus
 * everything already answered that day, so an answer doesn't make its row
 * vanish from under the cursor. Active habits only, in their usual order.
 */
export function habitsToLog(habits: Habit[], date: ISODate): Habit[] {
  return habits.filter(
    (h) => h.archivedAt == null && habitStart(h) <= date && (markOn(h, date) != null || pendingOn(h, date)),
  );
}

/** The last `n` days ending today, oldest first — the row's check-in strip. */
export function recentDays(today: ISODate, n: number): ISODate[] {
  const out: ISODate[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(addDays(today, -i));
  return out;
}
