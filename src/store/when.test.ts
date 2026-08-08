import { describe, it, expect } from "vitest";
import type { ISODate } from "../types";
import { parseWhenDates, whenOptions, whenDateLabel } from "./when";

// Anchor every case to a known Saturday: 2026-08-08 (ISO week 32).
const TODAY: ISODate = "2026-08-08";

const keys = (q: string, today: ISODate = TODAY) => whenOptions(q, today).map((o) => o.key);
const first = (q: string, today: ISODate = TODAY) => whenOptions(q, today)[0];

describe("whenOptions — the ladder", () => {
  it("offers the whole ladder, in order, for an empty query", () => {
    expect(keys("")).toEqual([
      "today",
      "tomorrow",
      "thisWeek",
      "nextWeek",
      "thisMonth",
      "nextMonth",
      "someday",
      "inbox",
    ]);
  });

  it("finds a rung by typing its name", () => {
    expect(keys("next week")).toEqual(["nextWeek"]);
    expect(keys("someday")).toEqual(["someday"]);
  });

  it("matches words in order, not just contiguously", () => {
    expect(keys("nex mon")).toEqual(["nextMonth"]);
  });

  it("finds a rung by alias", () => {
    expect(keys("later")).toEqual(["someday"]);
    expect(keys("unschedule")).toEqual(["inbox"]);
    expect(keys("tmr")).toEqual(["tomorrow"]);
  });

  it("says nothing rather than guessing when it can't read the query", () => {
    expect(whenOptions("qqq", TODAY)).toEqual([]);
  });

  it("labels the near rungs with the day they resolve to", () => {
    const opts = whenOptions("", TODAY);
    expect(opts[0].sub).toBe("Aug 8");
    expect(opts[1].sub).toBe("Aug 9");
  });
});

describe("parseWhenDates — weekdays", () => {
  it("reads a bare weekday as the soonest one still ahead", () => {
    expect(parseWhenDates("friday", TODAY)).toEqual(["2026-08-14"]);
    expect(parseWhenDates("mon", TODAY)).toEqual(["2026-08-10"]);
  });

  it("never resolves a weekday to today (Saturday, on a Saturday)", () => {
    expect(parseWhenDates("saturday", TODAY)).toEqual(["2026-08-15"]);
  });

  it("reads 'next <weekday>' as that day in the following week", () => {
    // Today is Sat of week 32, so next week is Mon 10 – Sun 16.
    expect(parseWhenDates("next friday", TODAY)).toEqual(["2026-08-14"]);
    // From a Monday, "next friday" jumps a week past "friday".
    expect(parseWhenDates("friday", "2026-08-10")).toEqual(["2026-08-14"]);
    expect(parseWhenDates("next friday", "2026-08-10")).toEqual(["2026-08-21"]);
  });

  it("reads the weekend as the coming Saturday", () => {
    expect(parseWhenDates("weekend", "2026-08-10")).toEqual(["2026-08-15"]);
  });
});

describe("parseWhenDates — offsets", () => {
  it("counts days, weeks, months and years out", () => {
    expect(parseWhenDates("in 3 days", TODAY)).toEqual(["2026-08-11"]);
    expect(parseWhenDates("3d", TODAY)).toEqual(["2026-08-11"]);
    expect(parseWhenDates("2 weeks", TODAY)).toEqual(["2026-08-22"]);
    expect(parseWhenDates("1 month", TODAY)).toEqual(["2026-09-08"]);
    expect(parseWhenDates("1y", TODAY)).toEqual(["2027-08-08"]);
  });

  it("clamps the day when the target month is short", () => {
    expect(parseWhenDates("in 1 month", "2026-01-31")).toEqual(["2026-02-28"]);
  });
});

describe("parseWhenDates — explicit dates", () => {
  it("reads an ISO date", () => {
    expect(parseWhenDates("2027-03-15", TODAY)).toEqual(["2027-03-15"]);
  });

  it("reads month + day, either way round", () => {
    expect(parseWhenDates("aug 20", TODAY)).toEqual(["2026-08-20"]);
    expect(parseWhenDates("20 august", TODAY)).toEqual(["2026-08-20"]);
    expect(parseWhenDates("sept 1 2027", TODAY)).toEqual(["2027-09-01"]);
  });

  it("rolls a month/day that has already passed into next year", () => {
    expect(parseWhenDates("mar 1", TODAY)).toEqual(["2027-03-01"]);
  });

  it("offers both readings of an ambiguous slash date, month/day first", () => {
    expect(parseWhenDates("4/5", TODAY)).toEqual(["2027-04-05", "2027-05-04"]);
  });

  it("keeps only the reading that is a real date", () => {
    expect(parseWhenDates("12/25", TODAY)).toEqual(["2026-12-25"]);
    expect(parseWhenDates("25/12", TODAY)).toEqual(["2026-12-25"]);
  });

  it("reads a bare day-of-month as its next occurrence", () => {
    expect(parseWhenDates("20", TODAY)).toEqual(["2026-08-20"]);
    expect(parseWhenDates("3rd", TODAY)).toEqual(["2026-09-03"]);
  });

  it("skips months too short for the day", () => {
    expect(parseWhenDates("31", "2026-09-15")).toEqual(["2026-10-31"]);
  });

  it("rejects impossible dates instead of rolling them over", () => {
    expect(parseWhenDates("feb 30", TODAY)).toEqual([]);
  });

  it("ignores the words people wrap a date in", () => {
    expect(parseWhenDates("on friday", TODAY)).toEqual(["2026-08-14"]);
    expect(parseWhenDates("  Aug 20, 2027 ", TODAY)).toEqual(["2027-08-20"]);
  });
});

describe("whenOptions — dates and rungs together", () => {
  it("puts the parsed date first, above any rung that also matches", () => {
    const opts = whenOptions("mon", TODAY);
    expect(opts[0].key).toBe("date:2026-08-10");
    expect(opts[0].choice).toEqual({ date: "2026-08-10" });
    // "This month" / "Next month" still match the letters, below the date.
    expect(opts.slice(1).map((o) => o.key)).toContain("thisMonth");
  });

  it("titles a date with its weekday, adding the year when it isn't this one", () => {
    expect(first("aug 20")?.label).toBe("Thursday, August 20");
    expect(whenDateLabel("2027-03-15", TODAY)).toBe("Monday, March 15, 2027");
  });

  it("shows how far off the date is", () => {
    expect(first("aug 20")?.sub).toBe("in 12d");
  });
});
