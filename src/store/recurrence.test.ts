import { describe, it, expect } from "vitest";
import type { ISODate, RecurrenceEnds, RecurrenceFreq, RecurrenceRule } from "../types";
import { defaultRule, normalizeRule, ruleFiresOn, ruleLabel } from "./recurrence";

function rule(
  freq: RecurrenceFreq,
  opts: Partial<Omit<RecurrenceRule, "freq">> = {}
): RecurrenceRule {
  return normalizeRule({
    freq,
    interval: opts.interval ?? 1,
    weekdays: opts.weekdays ?? [],
    anchor: opts.anchor ?? "2026-06-01", // a Monday
    ends: opts.ends ?? { kind: "never" },
  });
}

const fires = (r: RecurrenceRule, dates: ISODate[]) =>
  dates.filter((d) => ruleFiresOn(r, d));

describe("ruleFiresOn — daily", () => {
  it("fires every day from the anchor, never before it", () => {
    const r = rule("day");
    expect(ruleFiresOn(r, "2026-05-31")).toBe(false); // before anchor
    expect(ruleFiresOn(r, "2026-06-01")).toBe(true);
    expect(ruleFiresOn(r, "2026-06-02")).toBe(true);
  });

  it("respects an interval", () => {
    const r = rule("day", { interval: 3 }); // 06-01, 06-04, 06-07…
    expect(fires(r, ["2026-06-01", "2026-06-02", "2026-06-04", "2026-06-07"])).toEqual([
      "2026-06-01",
      "2026-06-04",
      "2026-06-07",
    ]);
  });
});

describe("ruleFiresOn — weekly", () => {
  it("fires only on the chosen weekday", () => {
    const r = rule("week", { weekdays: [1] }); // Mondays
    expect(ruleFiresOn(r, "2026-06-01")).toBe(true); // Mon
    expect(ruleFiresOn(r, "2026-06-08")).toBe(true); // Mon
    expect(ruleFiresOn(r, "2026-06-02")).toBe(false); // Tue
    expect(ruleFiresOn(r, "2026-06-06")).toBe(false); // Sat
  });

  it("phases a multi-week interval from the anchor's week", () => {
    const r = rule("week", { interval: 2, weekdays: [6] }); // every 2 weeks on Sat
    // anchor week (starts Mon 06-01) is week 0 → its Sat 06-06 fires; 06-13 (week 1) skips.
    expect(fires(r, ["2026-06-06", "2026-06-13", "2026-06-20", "2026-06-27"])).toEqual([
      "2026-06-06",
      "2026-06-20",
    ]);
  });

  it("handles a weekend-day rule", () => {
    const r = rule("week", { weekdays: [6, 7] });
    expect(ruleFiresOn(r, "2026-06-06")).toBe(true); // Sat
    expect(ruleFiresOn(r, "2026-06-07")).toBe(true); // Sun
    expect(ruleFiresOn(r, "2026-06-08")).toBe(false); // Mon
  });
});

describe("ruleFiresOn — monthly", () => {
  it("fires on the anchor's day-of-month", () => {
    const r = rule("month", { anchor: "2026-06-30" });
    expect(ruleFiresOn(r, "2026-07-30")).toBe(true);
    expect(ruleFiresOn(r, "2026-07-15")).toBe(false);
  });

  it("clamps a late day-of-month into short months", () => {
    const r = rule("month", { anchor: "2026-01-31" });
    expect(ruleFiresOn(r, "2026-02-28")).toBe(true); // clamped to Feb's last day
    expect(ruleFiresOn(r, "2026-03-31")).toBe(true);
    expect(ruleFiresOn(r, "2026-02-27")).toBe(false);
  });
});

describe("ruleFiresOn — yearly", () => {
  it("fires on the same month/day each interval", () => {
    const r = rule("year", { anchor: "2026-07-04" });
    expect(ruleFiresOn(r, "2027-07-04")).toBe(true);
    expect(ruleFiresOn(r, "2027-07-05")).toBe(false);
    expect(ruleFiresOn(r, "2026-07-04")).toBe(true);
  });
});

describe("ruleFiresOn — end conditions", () => {
  it("'on' stops firing after the end date", () => {
    const ends: RecurrenceEnds = { kind: "on", date: "2026-06-03" };
    const r = rule("day", { ends });
    expect(ruleFiresOn(r, "2026-06-03")).toBe(true);
    expect(ruleFiresOn(r, "2026-06-04")).toBe(false);
  });

  it("'after' stops firing past the occurrence count", () => {
    const r = rule("day", { ends: { kind: "after", count: 3 } });
    expect(fires(r, ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04"])).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
    ]);
  });

  it("counts 'after' occurrences by the cadence, not raw days", () => {
    const r = rule("week", { weekdays: [1], ends: { kind: "after", count: 2 } });
    // Mondays: 06-01 (#1), 06-08 (#2), 06-15 (#3 — past the cap).
    expect(ruleFiresOn(r, "2026-06-08")).toBe(true);
    expect(ruleFiresOn(r, "2026-06-15")).toBe(false);
  });
});

describe("normalizeRule", () => {
  it("clamps interval to >= 1 and dedupes/sorts weekdays", () => {
    const r = normalizeRule({
      freq: "week",
      interval: 0,
      weekdays: [3, 1, 3],
      anchor: "2026-06-01",
      ends: { kind: "never" },
    });
    expect(r.interval).toBe(1);
    expect(r.weekdays).toEqual([1, 3]);
  });

  it("gives a weekly rule the anchor's weekday when none is set", () => {
    const r = normalizeRule({
      freq: "week",
      interval: 1,
      weekdays: [],
      anchor: "2026-06-06", // Sat
      ends: { kind: "never" },
    });
    expect(r.weekdays).toEqual([6]);
  });
});

describe("ruleLabel", () => {
  it("labels the common patterns", () => {
    expect(ruleLabel(defaultRule("2026-06-01"))).toBe("Every day");
    expect(ruleLabel(rule("day", { interval: 3 }))).toBe("Every 3 days");
    expect(ruleLabel(rule("week", { weekdays: [6, 7] }))).toBe("Every weekend day");
    expect(ruleLabel(rule("week", { weekdays: [1, 2, 3, 4, 5] }))).toBe("Every weekday");
    expect(ruleLabel(rule("week", { interval: 2, weekdays: [6] }))).toBe("Every 2 weeks on Sat");
    expect(ruleLabel(rule("month", { anchor: "2026-06-04" }))).toBe("Monthly on the 4th");
    expect(ruleLabel(rule("year", { anchor: "2026-07-04" }))).toBe("Every year on Jul 4");
  });
});
