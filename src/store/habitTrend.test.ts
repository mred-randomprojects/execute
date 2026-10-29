import { describe, it, expect } from "vitest";
import type { Habit, HabitId, HabitMark, ISODate, KpiEvery } from "../types";
import { addDays, parseISO } from "./dates";
import { strength, strengthSeries } from "./habits";
import { habitTrend, kpiTrend, nextTrendRange, trendFrom } from "./habitTrend";

// 2026-09-28 and 2026-10-05 are Mondays.
function habit(perWeek: number, created: ISODate, checks: Record<ISODate, HabitMark> = {}): Habit {
  return {
    id: "h1" as HabitId,
    name: "Read",
    cue: "",
    perWeek,
    checks,
    checkedAt: {},
    measure: null,
    values: {},
    notes: {},
    archivedAt: null,
    rank: 0,
    createdAt: parseISO(created).getTime(),
    updatedAt: 0,
  };
}

const kpi = (every: KpiEvery, values: Record<ISODate, number>, created: ISODate = "2026-09-01"): Habit => ({
  ...habit(7, created),
  measure: { min: 0, max: 3, openTop: true, every },
  values,
});

describe("strengthSeries", () => {
  it("ends on the row's strength, open today included", () => {
    const checks: Record<ISODate, HabitMark> = { "2026-10-01": "done", "2026-10-02": "missed", "2026-10-04": "skip" };
    const h = habit(7, "2026-09-25", checks);
    for (const today of ["2026-10-03", "2026-10-04", "2026-10-05"]) {
      const s = strengthSeries(h, today);
      expect(s[s.length - 1].date).toBe(today);
      expect(s[s.length - 1].value).toBeCloseTo(strength(h, today), 12);
    }
  });

  it("matches strength as of each past day", () => {
    const h = habit(3, "2026-09-01", { "2026-09-02": "done", "2026-09-04": "done", "2026-09-09": "done" });
    const s = strengthSeries(h, "2026-09-20");
    // A past day with a mark scores the same as strength() on it.
    expect(s.find((p) => p.date === "2026-09-09")?.value).toBeCloseTo(strength(h, "2026-09-09"), 12);
    expect(s).toHaveLength(20);
  });
});

describe("habitTrend", () => {
  it("lists every week the habit lived through, with done and target", () => {
    const h = habit(7, "2026-10-01", { "2026-10-01": "done", "2026-10-05": "done", "2026-10-06": "done" });
    const t = habitTrend(h, "2026-10-07", "2026-09-01");
    expect(t.weeks).toEqual([
      { start: "2026-09-28", done: 1, target: 4 },
      { start: "2026-10-05", done: 2, target: 7 },
    ]);
    expect(t.strength[0].date).toBe("2026-10-01");
    expect(t.strength[t.strength.length - 1].date).toBe("2026-10-07");
  });
});

describe("kpiTrend", () => {
  it("averages the logged days of the last 7, daily only", () => {
    const k = kpi("day", { "2026-10-01": 1, "2026-10-03": 3, "2026-10-20": 2 });
    const t = kpiTrend(k, "2026-10-21", "2026-10-01");
    expect(t.points.map((p) => p.value)).toEqual([1, 3, 2]);
    const avg = new Map((t.average ?? []).map((p) => [p.date, p.value]));
    expect(avg.get("2026-10-01")).toBe(1);
    expect(avg.get("2026-10-03")).toBe(2);
    expect(avg.get("2026-10-09")).toBe(3); // 10-03 is still in the window
    expect(avg.has("2026-10-10")).toBe(false); // nothing logged in its 7 days
    expect(avg.get("2026-10-20")).toBe(2);
  });

  it("has no average for a weekly KPI, and drops values outside the range", () => {
    const k = kpi("week", { "2026-08-01": 1, "2026-10-01": 2 });
    const t = kpiTrend(k, "2026-10-21", "2026-09-01");
    expect(t.points).toEqual([{ date: "2026-10-01", value: 2, note: "" }]);
    expect(t.average).toBeNull();
  });
});

describe("ranges", () => {
  it("spans a fixed range in full and 'all' from the start (two weeks at least)", () => {
    const h = habit(7, "2026-01-10");
    expect(trendFrom(h, "2026-10-21", "3m")).toBe(addDays("2026-10-21", -90));
    expect(trendFrom(h, "2026-10-21", "all")).toBe("2026-01-10");
    expect(trendFrom(habit(7, "2026-10-20"), "2026-10-21", "all")).toBe("2026-10-08");
    expect(nextTrendRange("all")).toBe("3m");
  });
});
