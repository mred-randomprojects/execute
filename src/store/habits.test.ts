import { describe, it, expect } from "vitest";
import type { Habit, HabitId, HabitMark, ISODate } from "../types";
import { addDays, parseISO } from "./dates";
import {
  cadenceLabel,
  habitStart,
  normalizePerWeek,
  nudge,
  parseHabitName,
  habitsToLog,
  pendingOn,
  recentDays,
  strength,
  streak,
  weekProgress,
  withMark,
} from "./habits";

// 2026-09-07 and 2026-09-28 are Mondays.
function habit(perWeek: number, created: ISODate, checks: Record<ISODate, HabitMark> = {}): Habit {
  return {
    id: "h1" as HabitId,
    name: "Read",
    cue: "",
    perWeek,
    checks,
    archivedAt: null,
    createdAt: parseISO(created).getTime(),
    updatedAt: 0,
  };
}

/** `n` consecutive days from `from`, all marked `mark`. */
function run(from: ISODate, n: number, mark: HabitMark = "done"): Record<ISODate, HabitMark> {
  const out: Record<ISODate, HabitMark> = {};
  for (let i = 0; i < n; i++) out[addDays(from, i)] = mark;
  return out;
}

describe("basics", () => {
  it("clamps the weekly target to 1–7", () => {
    expect(normalizePerWeek(0)).toBe(1);
    expect(normalizePerWeek(9)).toBe(7);
    expect(normalizePerWeek(3.4)).toBe(3);
    expect(normalizePerWeek(Number.NaN)).toBe(7);
  });

  it("reads a cadence typed after the name", () => {
    expect(parseHabitName("Run 3x")).toEqual({ name: "Run", perWeek: 3 });
    expect(parseHabitName("Run 3 times a week")).toEqual({ name: "Run", perWeek: 3 });
    expect(parseHabitName("Lift 2x/wk ")).toEqual({ name: "Lift", perWeek: 2 });
    expect(parseHabitName("Stretch daily")).toEqual({ name: "Stretch", perWeek: 7 });
    expect(parseHabitName("Read 20 pages")).toEqual({ name: "Read 20 pages", perWeek: null });
    expect(parseHabitName("3x")).toEqual({ name: "3x", perWeek: null });
    expect(parseHabitName("Swim 9x")).toEqual({ name: "Swim 9x", perWeek: null });
  });

  it("labels the cadence", () => {
    expect(cadenceLabel(7)).toBe("Every day");
    expect(cadenceLabel(1)).toBe("Once a week");
    expect(cadenceLabel(3)).toBe("3× a week");
  });

  it("toggles marks without mutating", () => {
    const h = habit(7, "2026-09-07");
    const done = withMark(h, "2026-09-08", "done");
    expect(done.checks).toEqual({ "2026-09-08": "done" });
    expect(h.checks).toEqual({});
    expect(withMark(done, "2026-09-08", null).checks).toEqual({});
    expect(withMark(done, "2026-09-08", "done")).toBe(done);
  });

  it("starts at creation, or at an earlier backfilled day", () => {
    expect(habitStart(habit(7, "2026-09-07"))).toBe("2026-09-07");
    expect(habitStart(habit(7, "2026-09-07", { "2026-09-05": "done" }))).toBe("2026-09-05");
  });

  it("lists the recent days oldest first, ending today", () => {
    expect(recentDays("2026-10-02", 3)).toEqual(["2026-09-30", "2026-10-01", "2026-10-02"]);
  });
});

describe("weekProgress", () => {
  it("counts this ISO week against the target", () => {
    const h = habit(3, "2026-09-07", { "2026-09-28": "done", "2026-09-30": "done", "2026-09-27": "done" });
    // Friday: Mon + Wed count, last Sunday doesn't.
    expect(weekProgress(h, "2026-10-02")).toEqual({ done: 2, target: 3, remaining: 1, daysLeft: 3 });
  });

  it("scales the target down for a habit created mid-week", () => {
    // 5×/week created on Saturday: 2 days available → ceil(5·2/7) = 2.
    expect(weekProgress(habit(5, "2026-10-03"), "2026-10-03").target).toBe(2);
  });

  it("shrinks the target for rest days", () => {
    const daily = habit(7, "2026-09-07", { "2026-09-29": "skip" });
    expect(weekProgress(daily, "2026-10-02").target).toBe(6);
    const thrice = habit(3, "2026-09-07", run("2026-09-28", 3, "skip"));
    expect(weekProgress(thrice, "2026-10-02").target).toBe(2); // ceil(3·4/7)
  });
});

describe("strength", () => {
  it("is zero with nothing done, and today's open day doesn't count against it", () => {
    expect(strength(habit(7, "2026-10-02"), "2026-10-02")).toBe(0);
  });

  it("grows with a daily habit kept daily, reaching ~80% in about a month", () => {
    const h = habit(7, "2026-09-01", run("2026-09-01", 30));
    const s = strength(h, "2026-09-30");
    expect(s).toBeGreaterThan(0.75);
    expect(s).toBeLessThan(0.85);
  });

  it("forgives one miss: a dent, not a reset", () => {
    const kept = run("2026-08-01", 60);
    const before = strength(habit(7, "2026-08-01", kept), "2026-09-29");
    const missed = { ...kept };
    delete missed["2026-09-29"];
    const after = strength(habit(7, "2026-08-01", missed), "2026-09-29");
    expect(after).toBeLessThan(before);
    expect(before - after).toBeLessThan(0.06);
  });

  it("holds through rest days", () => {
    const kept = run("2026-09-01", 20);
    const base = strength(habit(7, "2026-09-01", kept), "2026-09-20");
    const rested = strength(habit(7, "2026-09-01", { ...kept, ...run("2026-09-21", 5, "skip") }), "2026-09-25");
    expect(rested).toBeCloseTo(base, 10);
  });

  it("treats 3× a week kept 3× a week as strong, not as 3/7", () => {
    const checks: Record<ISODate, HabitMark> = {};
    for (let w = 0; w < 12; w++) {
      const monday = addDays("2026-07-06", w * 7);
      checks[monday] = "done";
      checks[addDays(monday, 2)] = "done";
      checks[addDays(monday, 4)] = "done";
    }
    expect(strength(habit(3, "2026-07-06", checks), "2026-09-27")).toBeGreaterThan(0.8);
  });
});

describe("streak", () => {
  it("daily: survives a single miss, breaks on two in a row", () => {
    const h = habit(7, "2026-09-01", {
      ...run("2026-09-01", 3), // 1–3
      // 4, 5 missed → break
      ...run("2026-09-06", 3), // 6–8
      // 9 missed (single — survives)
      ...run("2026-09-10", 2), // 10–11
    });
    expect(streak(h, "2026-09-11")).toEqual({ count: 5, unit: "day" });
  });

  it("daily: an unmarked today neither counts nor breaks", () => {
    const h = habit(7, "2026-09-01", run("2026-09-01", 4));
    expect(streak(h, "2026-09-05").count).toBe(4);
  });

  it("weekly: counts weeks that met the target; the current week only once met", () => {
    const checks = {
      ...run("2026-09-14", 2), // week of 14th: 2 ✓
      ...run("2026-09-21", 2), // week of 21st: 2 ✓
      "2026-09-28": "done" as const, // this week: 1 of 2 so far
    };
    const h = habit(2, "2026-09-14", checks);
    expect(streak(h, "2026-09-30")).toEqual({ count: 2, unit: "week" });
    expect(streak(withMark(h, "2026-09-30", "done"), "2026-09-30").count).toBe(3);
  });

  it("weekly: a short week breaks the run", () => {
    const h = habit(2, "2026-09-07", { ...run("2026-09-07", 2), "2026-09-14": "done", ...run("2026-09-21", 2) });
    expect(streak(h, "2026-09-30").count).toBe(1);
  });
});

describe("nudge & pendingOn", () => {
  it("daily: warns after a miss, never twice", () => {
    const h = habit(7, "2026-09-28", { "2026-09-29": "done" });
    expect(nudge(h, "2026-10-01")?.tone).toBe("warn"); // 30th missed
    expect(nudge(withMark(h, "2026-10-01", "done"), "2026-10-01")?.text).toBe("Done today");
    expect(nudge(h, "2026-09-30")).toBeNull(); // yesterday was done
  });

  it("weekly: says how many are left, and when every day counts", () => {
    const h = habit(3, "2026-09-07", { "2026-09-28": "done" });
    expect(nudge(h, "2026-09-29")?.text).toBe("2 more this week");
    expect(nudge(h, "2026-10-03")?.tone).toBe("warn"); // Sat: 2 left, 2 days
    expect(nudge(h, "2026-10-04")?.tone).toBe("neutral"); // Sun: out of reach
  });

  it("pending: daily until marked; weekly until the target is met", () => {
    const daily = habit(7, "2026-09-07");
    expect(pendingOn(daily, "2026-10-02")).toBe(true);
    expect(pendingOn(withMark(daily, "2026-10-02", "skip"), "2026-10-02")).toBe(false);
    const weekly = habit(1, "2026-09-07", { "2026-09-28": "done" });
    expect(pendingOn(weekly, "2026-10-02")).toBe(false);
    expect(pendingOn({ ...daily, archivedAt: 1 }, "2026-10-02")).toBe(false);
  });
});

describe("answered vs unlogged", () => {
  it("'missed' scores like an unlogged day but is no longer pending", () => {
    const blank = habit(7, "2026-09-28", run("2026-09-28", 3));
    const said = withMark(blank, "2026-10-01", "missed");
    expect(strength(said, "2026-10-02")).toBeCloseTo(strength(blank, "2026-10-02"), 10);
    expect(pendingOn(blank, "2026-10-01")).toBe(true);
    expect(pendingOn(said, "2026-10-01")).toBe(false);
  });

  it("an explicit miss still counts toward never-miss-twice", () => {
    const h = habit(7, "2026-09-28", { ...run("2026-09-28", 2), "2026-09-30": "missed", "2026-10-01": "missed" });
    expect(streak(h, "2026-10-01").count).toBe(0);
    expect(nudge(h, "2026-10-01")?.tone).toBe("warn");
  });

  it("a 'not today' answered today leaves no day left for the week", () => {
    const h = habit(3, "2026-09-07", { "2026-10-04": "missed" });
    expect(weekProgress(h, "2026-10-04").daysLeft).toBe(0);
  });

  it("lists pending and answered habits, but not met weekly ones or archived", () => {
    const daily = habit(7, "2026-09-07");
    const met = { ...habit(1, "2026-09-07", { "2026-09-28": "done" }), id: "h2" as HabitId };
    const answered = { ...habit(7, "2026-09-07", { "2026-10-02": "done" }), id: "h3" as HabitId };
    const gone = { ...habit(7, "2026-09-07"), id: "h4" as HabitId, archivedAt: 5 };
    const future = { ...habit(7, "2026-10-05"), id: "h5" as HabitId };
    expect(habitsToLog([daily, met, answered, gone, future], "2026-10-02").map((h) => h.id)).toEqual(["h1", "h3"]);
  });
});
