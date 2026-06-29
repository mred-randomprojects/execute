import type { ISODate } from "../types";

// Everything reasons in local-calendar days. ISODate is "YYYY-MM-DD".

export function toISO(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today's date — honouring the dev override used to exercise rollover. */
export function todayISO(override: ISODate | null): ISODate {
  if (override != null && override !== "") return override;
  return toISO(new Date());
}

export function parseISO(iso: ISODate): Date {
  const [y, m, d] = iso.split("-").map((n) => Number(n));
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(iso: ISODate, n: number): ISODate {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** A planned date is a "leftover" if it's strictly before today. */
export function isLeftover(plannedFor: ISODate | null, today: ISODate): boolean {
  return plannedFor != null && plannedFor < today;
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "Tuesday, June 17" */
export function formatLong(iso: ISODate): string {
  const d = parseISO(iso);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Relative label for a planned date vs today: "today", "yesterday", "3d ago", "in 2d". */
export function relativeLabel(plannedFor: ISODate, today: ISODate): string {
  const a = parseISO(plannedFor).getTime();
  const b = parseISO(today).getTime();
  const days = Math.round((a - b) / 86_400_000);
  if (days === 0) return "today";
  if (days === -1) return "yesterday";
  if (days === 1) return "tomorrow";
  if (days < 0) return `${-days}d ago`;
  return `in ${days}d`;
}

// ─── ISO weeks & months (for fuzzy horizons) ────────────────────────
// Keys are stable, comparable strings: weeks "YYYY-Www", months "YYYY-MM".

/** ISO-8601 weekday, Mon=1 … Sun=7. */
export function isoWeekday(iso: ISODate): number {
  const day = parseISO(iso).getDay(); // Sun=0 … Sat=6
  return day === 0 ? 7 : day;
}

/** ISO-8601 {weekYear, week} — week 1 is the week containing the year's first Thursday. */
function isoWeekParts(iso: ISODate): { weekYear: number; week: number } {
  const d = parseISO(iso);
  // Shift to the Thursday of this week, then count weeks from Jan 4th's week.
  const thursday = new Date(d);
  thursday.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const weekYear = thursday.getFullYear();
  const firstThursday = new Date(weekYear, 0, 4);
  firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3);
  const week =
    1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return { weekYear, week };
}

/** Stable, comparable ISO-week key, e.g. "2026-W25". */
export function weekKey(iso: ISODate): string {
  const { weekYear, week } = isoWeekParts(iso);
  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}

/** Month key, e.g. "2026-06". */
export function monthKey(iso: ISODate): string {
  return iso.slice(0, 7);
}

/** The week key `offset` weeks from `iso` (offset may be negative). */
export function weekKeyOffset(iso: ISODate, offset: number): string {
  return weekKey(addDays(iso, offset * 7));
}

/** The month key `offset` months from `iso`. */
export function monthKeyOffset(iso: ISODate, offset: number): string {
  const d = parseISO(iso);
  const m = new Date(d.getFullYear(), d.getMonth() + offset, 1);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
}

/** Monday (ISO week start) of a week key like "2026-W26". */
export function weekStart(key: string): ISODate {
  const [yStr, wStr] = key.split("-W");
  const weekYear = Number(yStr);
  const week = Number(wStr);
  // ISO week 1 is the week (Mon–Sun) containing Jan 4; find that Monday, step weeks.
  const jan4 = new Date(weekYear, 0, 4);
  const daysSinceMonday = (jan4.getDay() + 6) % 7;
  const week1Monday = new Date(weekYear, 0, 4 - daysSinceMonday);
  week1Monday.setDate(week1Monday.getDate() + (week - 1) * 7);
  return toISO(week1Monday);
}

/** First day of a month key like "2026-06". */
export function monthStart(key: string): ISODate {
  return `${key}-01`;
}

/** Last day of a month key like "2026-06". */
export function monthEnd(key: string): ISODate {
  const [y, m] = key.split("-").map((n) => Number(n));
  return toISO(new Date(y, m, 0)); // day 0 of the next month = last day of this one
}

/** "Week 25" from a week key. */
export function weekLabel(key: string): string {
  const week = Number(key.slice(key.indexOf("W") + 1));
  return `Week ${week}`;
}

/** "June 2026" from a month key. */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map((n) => Number(n));
  return `${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** Fraction (0–1) of the current ISO week that has elapsed (today counted half-done). */
export function weekElapsed(today: ISODate): number {
  return clamp01((isoWeekday(today) - 0.5) / 7);
}

/** Fraction (0–1) of the current calendar month that has elapsed. */
export function monthElapsed(today: ISODate): number {
  const d = parseISO(today);
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return clamp01((d.getDate() - 0.5) / daysInMonth);
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
