import type { Habit, ISODate } from "../types";
import { addDays, weekKey, weekStart } from "./dates";
import { DEFAULT_MEASURE, habitStart, noteOn, strengthSeries, weekProgressOf, type DatedValue } from "./habits";

// ─── Trends: a habit or a KPI over time ──────────────────────────────
//
// What the Habits view's chart draws for the focused row. Pure: the numbers
// come from the same engine the rows use (strengthSeries, weekProgressOf), so
// the chart and the row never tell two stories.

export type TrendRange = "3m" | "6m" | "1y" | "all";

export const TREND_RANGES: { key: TrendRange; label: string; days: number | null }[] = [
  { key: "3m", label: "3M", days: 91 },
  { key: "6m", label: "6M", days: 182 },
  { key: "1y", label: "1Y", days: 365 },
  { key: "all", label: "All", days: null },
];

export function nextTrendRange(r: TrendRange): TrendRange {
  const i = TREND_RANGES.findIndex((x) => x.key === r);
  return TREND_RANGES[(i + 1) % TREND_RANGES.length].key;
}

/**
 * The first day the chart shows. A fixed range always spans its full length,
 * even for a young habit — empty space on the left says "this is new" — while
 * "All" starts where the habit does (at least two weeks, so a new one isn't a
 * single point stretched across the chart).
 */
export function trendFrom(h: Habit, today: ISODate, range: TrendRange): ISODate {
  const days = TREND_RANGES.find((x) => x.key === range)?.days ?? null;
  if (days != null) return addDays(today, -(days - 1));
  const start = habitStart(h);
  const twoWeeks = addDays(today, -13);
  return start < twoWeeks ? start : twoWeeks;
}

export interface TrendWeek {
  /** The Monday. */
  start: ISODate;
  done: number;
  target: number;
}

export interface HabitTrend {
  kind: "habit";
  /** 0–1, one point a day from the later of `from` and the habit's start. */
  strength: DatedValue[];
  /** Every week that overlaps the range and the habit's life, oldest first. */
  weeks: TrendWeek[];
}

export interface KpiPoint extends DatedValue {
  note: string;
}

export interface KpiTrend {
  kind: "kpi";
  /** Every logged value in the range, oldest first. */
  points: KpiPoint[];
  /**
   * Daily KPIs: the average of the logged days in the 7 ending on each day —
   * the row's "7d" number, as a line. Days with nothing logged in their
   * window have no point. Null for weekly and monthly KPIs, where every value
   * already is a period.
   */
  average: DatedValue[] | null;
}

export function habitTrend(h: Habit, today: ISODate, from: ISODate): HabitTrend {
  const strength = strengthSeries(h, today).filter((p) => p.date >= from);
  const weeks: TrendWeek[] = [];
  const start = habitStart(h);
  for (let monday = weekStart(weekKey(from)); monday <= today; monday = addDays(monday, 7)) {
    if (addDays(monday, 6) < start) continue;
    const p = weekProgressOf(h, weekKey(monday), today);
    weeks.push({ start: monday, done: p.done, target: p.target });
  }
  return { kind: "habit", strength, weeks };
}

export function kpiTrend(h: Habit, today: ISODate, from: ISODate): KpiTrend {
  const inRange = (d: ISODate) => d >= from && d <= today;
  const points = Object.keys(h.values)
    .filter(inRange)
    .sort()
    .map((d) => ({ date: d, value: h.values[d], note: noteOn(h, d) }));
  if ((h.measure ?? DEFAULT_MEASURE).every !== "day") return { kind: "kpi", points, average: null };
  const average: DatedValue[] = [];
  for (let d = from; d <= today; d = addDays(d, 1)) {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 7; i++) {
      const v = h.values[addDays(d, -i)];
      if (v != null) {
        sum += v;
        n++;
      }
    }
    if (n > 0) average.push({ date: d, value: sum / n });
  }
  return { kind: "kpi", points, average };
}

export function trendOf(h: Habit, today: ISODate, range: TrendRange): HabitTrend | KpiTrend {
  const from = trendFrom(h, today, range);
  return h.measure != null ? kpiTrend(h, today, from) : habitTrend(h, today, from);
}
