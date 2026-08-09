import { describe, it, expect } from "vitest";
import type { DayRecord, ISODate } from "../types";
import { addDays } from "./dates";
import {
  bestRun,
  currentRun,
  dayStatus,
  heatmap,
  recentRate,
} from "./streak";

const TODAY: ISODate = "2026-08-08";
const ago = (n: number): ISODate => addDays(TODAY, -n);

/** A day that was closed, with `done` tasks finished. */
const closed = (date: ISODate, done = 2): DayRecord => ({
  date,
  committed: done,
  done,
  doneMinutes: done * 20,
  skipped: 0,
  closedAt: 1,
});
/** A day that asked something and never got an answer. */
const missed = (date: ISODate): DayRecord => ({
  date,
  committed: 3,
  done: 1,
  doneMinutes: 20,
  skipped: 0,
  closedAt: null,
});
/** A day the app saw, that asked nothing of you. */
const empty = (date: ISODate): DayRecord => ({
  date,
  committed: 0,
  done: 0,
  doneMinutes: 0,
  skipped: 0,
  closedAt: null,
});

describe("dayStatus", () => {
  it("counts a day with every commitment resolved as closed", () => {
    expect(dayStatus(closed(TODAY))).toBe("closed");
  });

  it("counts a day closed by declining everything as closed", () => {
    // Consciously deciding not to do something IS an outcome. The whole point of
    // the metric is that a mindful "no" beats a silent overrun.
    expect(
      dayStatus({ date: TODAY, committed: 3, done: 0, doneMinutes: 0, skipped: 3, closedAt: 5 })
    ).toBe("closed");
  });

  it("counts an unresolved day as missed", () => {
    expect(dayStatus(missed(TODAY))).toBe("missed");
  });

  it("treats a day that asked nothing as empty, not missed", () => {
    expect(dayStatus(empty(TODAY))).toBe("empty");
  });

  it("treats a day the app never saw as empty", () => {
    expect(dayStatus(undefined)).toBe("empty");
  });
});

describe("currentRun", () => {
  it("is zero with no history at all", () => {
    expect(currentRun([], TODAY)).toEqual({ days: 0, missed: 0 });
  });

  it("counts consecutive closed days ending today", () => {
    const days = [closed(ago(2)), closed(ago(1)), closed(TODAY)];
    expect(currentRun(days, TODAY)).toEqual({ days: 3, missed: 0 });
  });

  it("does not break just because today isn't closed yet", () => {
    // Otherwise the streak would read as broken every single morning, which is
    // the fastest way to make someone stop looking at it.
    const days = [closed(ago(2)), closed(ago(1))];
    expect(currentRun(days, TODAY)).toEqual({ days: 2, missed: 0 });
  });

  it("survives one missed day, and says so", () => {
    const days = [closed(ago(3)), closed(ago(2)), missed(ago(1)), closed(TODAY)];
    expect(currentRun(days, TODAY)).toEqual({ days: 3, missed: 1 });
  });

  it("ends after two missed days in a row", () => {
    const days = [
      closed(ago(4)),
      closed(ago(3)),
      missed(ago(2)),
      missed(ago(1)),
      closed(TODAY),
    ];
    expect(currentRun(days, TODAY)).toEqual({ days: 1, missed: 0 });
  });

  it("does not count a trailing miss it never spanned", () => {
    // The gap only counts once an older closed day proves it was a gap.
    const days = [missed(ago(3)), closed(ago(2)), closed(ago(1))];
    expect(currentRun(days, TODAY)).toEqual({ days: 2, missed: 0 });
  });

  it("walks straight through days that asked nothing", () => {
    // A weekend off must not cost you the run…
    const days = [closed(ago(4)), empty(ago(3)), empty(ago(2)), closed(ago(1))];
    expect(currentRun(days, TODAY)).toEqual({ days: 2, missed: 0 });
  });

  it("walks straight through days the app never saw", () => {
    // …and neither must a week away. Absence is neutral by design: coming back
    // to a broken streak is a reason not to come back.
    const days = [closed(ago(9)), closed(ago(1))];
    expect(currentRun(days, TODAY)).toEqual({ days: 2, missed: 0 });
  });

  it("NEVER grows from empty days — committing to nothing earns nothing", () => {
    // The incentive that matters most. If empty days counted, the safest way to
    // build a streak would be to stop committing to anything at all.
    const days = [empty(ago(3)), empty(ago(2)), empty(ago(1)), empty(TODAY)];
    expect(currentRun(days, TODAY).days).toBe(0);
  });
});

describe("bestRun", () => {
  it("is zero with no history", () => {
    expect(bestRun([], TODAY)).toBe(0);
  });

  it("finds the longest run, not the current one", () => {
    const days = [
      closed(ago(10)),
      closed(ago(9)),
      closed(ago(8)),
      missed(ago(7)),
      missed(ago(6)), // two in a row — that run is over
      closed(ago(1)),
    ];
    expect(bestRun(days, TODAY)).toBe(3);
  });

  it("applies the same one-day grace as the current run", () => {
    const days = [closed(ago(5)), missed(ago(4)), closed(ago(3)), closed(ago(2))];
    expect(bestRun(days, TODAY)).toBe(3);
  });
});

describe("heatmap", () => {
  it("returns whole weeks starting on a Monday", () => {
    const grid = heatmap([], TODAY, 4);
    expect(grid).toHaveLength(28);
    // 2026-08-08 is a Saturday, so the grid is four whole Mon→Sun weeks ending
    // Sun the 9th — today sits in the last column, with tomorrow beneath it.
    expect(grid[0].date).toBe("2026-07-13"); // a Monday
    expect(grid[grid.length - 1].date).toBe("2026-08-09"); // a Sunday
  });

  it("marks today and the days after it", () => {
    const grid = heatmap([], TODAY, 4);
    const today = grid.find((d) => d.date === TODAY);
    expect(today?.isToday).toBe(true);
    expect(today?.isFuture).toBe(false);
    expect(grid.find((d) => d.date === addDays(TODAY, 1))?.isFuture).toBe(true);
  });

  it("carries the done count through, so hollow days can look hollow", () => {
    const grid = heatmap([closed(ago(1), 6)], TODAY, 4);
    const day = grid.find((d) => d.date === ago(1));
    expect(day?.status).toBe("closed");
    expect(day?.done).toBe(6);
  });
});

describe("recentRate", () => {
  it("counts only the days that asked something of you", () => {
    const days = [closed(ago(1)), missed(ago(2)), empty(ago(3))];
    expect(recentRate(days, TODAY, 30)).toEqual({ closed: 1, counted: 2 });
  });

  it("is empty when nothing has been committed at all", () => {
    expect(recentRate([], TODAY, 30)).toEqual({ closed: 0, counted: 0 });
  });
});
