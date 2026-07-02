import type { ISODate, RecurrenceRule } from "../types";
import {
  dayOfMonth,
  daysBetween,
  daysInMonth,
  isoWeekday,
  monthDayLabel,
  monthsBetween,
  ordinal,
  parseISO,
  weekKey,
  weekStart,
  WEEKDAY_SHORT,
} from "./dates";

// Pure recurrence engine: given a rule and a day, does it fire? Plus the human
// labels used for grouping. No state, no dates-of-now — everything is derived
// from the rule + the day passed in, which keeps it trivially testable and the
// obvious place a smarter/AI scheduler could later hook in.

const WEEKEND = [6, 7];
const WEEKDAYS_MON_FRI = [1, 2, 3, 4, 5];

/** Monday (ISO week start) of the week containing `iso`. */
function weekStartOf(iso: ISODate): ISODate {
  return weekStart(weekKey(iso));
}

/** Clean up a rule: interval >= 1, weekdays sorted/deduped, weekly always has one. */
export function normalizeRule(rule: RecurrenceRule): RecurrenceRule {
  const interval = Math.max(1, Math.trunc(rule.interval));
  let weekdays = [...new Set(rule.weekdays.filter((d) => d >= 1 && d <= 7))].sort((a, b) => a - b);
  if (rule.freq === "week" && weekdays.length === 0) weekdays = [isoWeekday(rule.anchor)];
  return { ...rule, interval, weekdays };
}

export function defaultRule(anchor: ISODate): RecurrenceRule {
  return { freq: "day", interval: 1, weekdays: [], anchor, ends: { kind: "never" } };
}

/** Whether the cadence (ignoring the anchor floor and the end condition) lands on `date`. */
function matchesCadence(rule: RecurrenceRule, date: ISODate): boolean {
  const { freq, interval } = rule;
  if (freq === "day") {
    return daysBetween(rule.anchor, date) % interval === 0;
  }
  if (freq === "week") {
    const weekdays = rule.weekdays.length > 0 ? rule.weekdays : [isoWeekday(rule.anchor)];
    if (!weekdays.includes(isoWeekday(date))) return false;
    const weeks = daysBetween(weekStartOf(rule.anchor), weekStartOf(date)) / 7;
    return weeks % interval === 0;
  }
  if (freq === "month") {
    // Clamp so an anchor on the 31st still fires in short months (on their last day).
    const target = Math.min(dayOfMonth(rule.anchor), daysInMonth(date));
    if (dayOfMonth(date) !== target) return false;
    return monthsBetween(rule.anchor, date) % interval === 0;
  }
  // year
  const a = parseISO(rule.anchor);
  const d = parseISO(date);
  if (d.getMonth() !== a.getMonth()) return false;
  const target = Math.min(a.getDate(), daysInMonth(date));
  if (d.getDate() !== target) return false;
  return (d.getFullYear() - a.getFullYear()) % interval === 0;
}

/**
 * How many times the rule has fired from its anchor up to and including `date`
 * (1-based). Used only for the "after N times" end condition, so a day-by-day
 * walk from the anchor is fine (and capped for safety on ancient recurrences).
 */
function occurrenceOrdinal(rule: RecurrenceRule, date: ISODate): number {
  const span = daysBetween(rule.anchor, date);
  if (span < 0) return 0;
  if (span > 20_000) return Number.POSITIVE_INFINITY; // ~55y — treat as exhausted
  let count = 0;
  const end = parseISO(date);
  for (let d = parseISO(rule.anchor); d <= end; d.setDate(d.getDate() + 1)) {
    const iso: ISODate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
    if (matchesCadence(rule, iso)) count += 1;
  }
  return count;
}

function withinEnds(rule: RecurrenceRule, date: ISODate): boolean {
  switch (rule.ends.kind) {
    case "never":
      return true;
    case "on":
      return date <= rule.ends.date;
    case "after":
      return occurrenceOrdinal(rule, date) <= rule.ends.count;
  }
}

/** Does this recurrence offer itself on `date`? */
export function ruleFiresOn(rule: RecurrenceRule, date: ISODate): boolean {
  if (date < rule.anchor) return false;
  if (!matchesCadence(rule, date)) return false;
  return withinEnds(rule, date);
}

function sameSet(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function weekdaysLabel(weekdays: number[]): string {
  return weekdays.map((d) => WEEKDAY_SHORT[d]).join(", ");
}

/** Human label for a rule — also the key the Recurring view groups by. */
export function ruleLabel(rule: RecurrenceRule): string {
  const n = rule.interval;
  switch (rule.freq) {
    case "day":
      return n === 1 ? "Every day" : `Every ${n} days`;
    case "week": {
      const wd = rule.weekdays.length > 0 ? rule.weekdays : [isoWeekday(rule.anchor)];
      if (n === 1 && sameSet(wd, WEEKEND)) return "Every weekend day";
      if (n === 1 && sameSet(wd, WEEKDAYS_MON_FRI)) return "Every weekday";
      const every = n === 1 ? "Every week" : `Every ${n} weeks`;
      return `${every} on ${weekdaysLabel(wd)}`;
    }
    case "month": {
      const day = `the ${ordinal(dayOfMonth(rule.anchor))}`;
      return n === 1 ? `Monthly on ${day}` : `Every ${n} months on ${day}`;
    }
    case "year":
      return n === 1
        ? `Every year on ${monthDayLabel(rule.anchor)}`
        : `Every ${n} years on ${monthDayLabel(rule.anchor)}`;
  }
}

/** Short label for the "ends" clause, or null when it never ends. */
export function endsLabel(rule: RecurrenceRule): string | null {
  switch (rule.ends.kind) {
    case "never":
      return null;
    case "on":
      return `until ${monthDayLabel(rule.ends.date)}`;
    case "after":
      return `${rule.ends.count}×`;
  }
}

/** Stable sort weight so groups read day → week → month → year, then by interval. */
export function ruleSortKey(rule: RecurrenceRule): number {
  const freqOrder: Record<RecurrenceRule["freq"], number> = {
    day: 0,
    week: 1,
    month: 2,
    year: 3,
  };
  return freqOrder[rule.freq] * 1000 + Math.min(999, rule.interval);
}

export interface RecurrencePreset {
  label: string;
  rule: RecurrenceRule;
}

/** The quick-pick presets, phrased against a reference day (usually today). */
export function presetsFor(anchor: ISODate): RecurrencePreset[] {
  const base = { anchor, ends: { kind: "never" } as const };
  const wd = isoWeekday(anchor);
  const rules: RecurrenceRule[] = [
    { freq: "day", interval: 1, weekdays: [], ...base },
    { freq: "week", interval: 1, weekdays: WEEKEND, ...base },
    { freq: "week", interval: 1, weekdays: [wd], ...base },
    { freq: "week", interval: 2, weekdays: [wd], ...base },
    { freq: "month", interval: 1, weekdays: [], ...base },
    { freq: "year", interval: 1, weekdays: [], ...base },
  ];
  return rules.map((rule) => ({ label: ruleLabel(rule), rule }));
}
