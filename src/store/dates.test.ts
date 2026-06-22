import { describe, it, expect } from "vitest";
import {
  isoWeekday,
  monthElapsed,
  monthKey,
  monthKeyOffset,
  monthLabel,
  weekElapsed,
  weekKey,
  weekKeyOffset,
  weekLabel,
} from "./dates";

// 2026-06-18 is a Thursday in ISO week 25.
const today = "2026-06-18";

describe("ISO week / month keys", () => {
  it("computes the ISO week key", () => {
    expect(weekKey(today)).toBe("2026-W25");
    expect(weekKey("2026-01-01")).toBe("2026-W01"); // Thursday → week 1
    expect(weekKey("2025-12-29")).toBe("2026-W01"); // Monday belongs to next year's W1
  });

  it("offsets weeks across boundaries", () => {
    expect(weekKeyOffset(today, 1)).toBe("2026-W26");
    expect(weekKeyOffset(today, -1)).toBe("2026-W24");
    expect(weekKeyOffset("2026-12-31", 1)).toBe("2027-W01");
  });

  it("computes month keys and offsets", () => {
    expect(monthKey(today)).toBe("2026-06");
    expect(monthKeyOffset(today, 1)).toBe("2026-07");
    expect(monthKeyOffset("2026-12-10", 1)).toBe("2027-01");
  });

  it("labels weeks and months", () => {
    expect(weekLabel("2026-W25")).toBe("Week 25");
    expect(monthLabel("2026-06")).toBe("June 2026");
    expect(monthLabel("2027-01")).toBe("January 2027");
  });
});

describe("period elapsed", () => {
  it("isoWeekday is Mon=1 … Sun=7", () => {
    expect(isoWeekday("2026-06-18")).toBe(4); // Thursday
    expect(isoWeekday("2026-06-15")).toBe(1); // Monday
    expect(isoWeekday("2026-06-21")).toBe(7); // Sunday
  });

  it("week is ~half elapsed by Thursday", () => {
    expect(weekElapsed("2026-06-18")).toBeCloseTo(3.5 / 7, 5);
    expect(weekElapsed("2026-06-15")).toBeCloseTo(0.5 / 7, 5); // Monday: just started
  });

  it("month elapsed scales with the day of month", () => {
    expect(monthElapsed("2026-06-18")).toBeCloseTo(17.5 / 30, 5);
    expect(monthElapsed("2026-02-01")).toBeCloseTo(0.5 / 28, 5);
  });
});
