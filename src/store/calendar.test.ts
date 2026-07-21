import { describe, expect, it } from "vitest";
import type { ISODate } from "../types";
import {
  CAL_STEP_MIN,
  MAX_START_MIN,
  MIN_DURATION_MIN,
  clockLabelFromMs,
  defaultDurationMinutes,
  defaultStartMinutes,
  formatClock,
  formatDuration,
  gcalTemplateUrl,
  isOnDay,
  stepClamped,
  toEpochMs,
} from "./calendar";

const iso = (s: string) => s as ISODate;

describe("stepClamped", () => {
  it("adds delta and clamps to bounds", () => {
    expect(stepClamped(600, 15, 0, MAX_START_MIN)).toBe(615);
    expect(stepClamped(0, -15, 0, MAX_START_MIN)).toBe(0); // floor
    expect(stepClamped(MAX_START_MIN, 15, 0, MAX_START_MIN)).toBe(MAX_START_MIN); // ceil
  });
});

describe("defaultStartMinutes", () => {
  it("snaps to the next quarter-hour when scheduling today", () => {
    // 10:07 local → next boundary is 10:15.
    const now = new Date(2026, 6, 21, 10, 7).getTime();
    expect(defaultStartMinutes(now, iso("2026-07-21"), iso("2026-07-21"))).toBe(10 * 60 + 15);
  });

  it("moves strictly forward even when already on a boundary", () => {
    const now = new Date(2026, 6, 21, 10, 0).getTime(); // exactly 10:00
    expect(defaultStartMinutes(now, iso("2026-07-21"), iso("2026-07-21"))).toBe(10 * 60 + 15);
  });

  it("never spills past the last slot of the day", () => {
    const now = new Date(2026, 6, 21, 23, 58).getTime();
    expect(defaultStartMinutes(now, iso("2026-07-21"), iso("2026-07-21"))).toBe(MAX_START_MIN);
  });

  it("anchors a future day at 9:00", () => {
    const now = new Date(2026, 6, 21, 10, 7).getTime();
    expect(defaultStartMinutes(now, iso("2026-07-25"), iso("2026-07-21"))).toBe(9 * 60);
  });
});

describe("defaultDurationMinutes", () => {
  it("uses the effort estimate, snapped to a quarter-hour", () => {
    expect(defaultDurationMinutes(40)).toBe(45); // 40 → nearest 15
    expect(defaultDurationMinutes(60)).toBe(60);
    expect(defaultDurationMinutes(20)).toBe(15); // 20 → nearest 15
  });

  it("never goes below the minimum", () => {
    expect(defaultDurationMinutes(5)).toBe(MIN_DURATION_MIN);
  });

  it("falls back to 30m without an estimate", () => {
    expect(defaultDurationMinutes(null)).toBe(30);
    expect(defaultDurationMinutes(0)).toBe(30);
  });
});

describe("formatClock", () => {
  it("renders a 12-hour clock", () => {
    expect(formatClock(0)).toBe("12:00 AM");
    expect(formatClock(9 * 60)).toBe("9:00 AM");
    expect(formatClock(12 * 60)).toBe("12:00 PM");
    expect(formatClock(14 * 60 + 30)).toBe("2:30 PM");
    expect(formatClock(23 * 60 + 45)).toBe("11:45 PM");
  });
});

describe("formatDuration", () => {
  it("renders compact h/m", () => {
    expect(formatDuration(40)).toBe("40m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(90)).toBe("1h 30m");
  });
});

describe("toEpochMs / isOnDay", () => {
  it("round-trips a local day + time", () => {
    const ms = toEpochMs(iso("2026-07-21"), 14 * 60 + 30);
    const d = new Date(ms);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(21);
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(30);
  });

  it("isOnDay matches the local calendar day", () => {
    const ms = toEpochMs(iso("2026-07-21"), 30);
    expect(isOnDay(ms, iso("2026-07-21"))).toBe(true);
    expect(isOnDay(ms, iso("2026-07-22"))).toBe(false);
  });

  it("clockLabelFromMs reads back the local time", () => {
    const ms = toEpochMs(iso("2026-07-21"), 14 * 60 + 30);
    expect(clockLabelFromMs(ms)).toBe("2:30 PM");
  });
});

describe("gcalTemplateUrl", () => {
  it("builds a template URL with local wall-clock start/end and ctz", () => {
    const startMs = toEpochMs(iso("2026-07-21"), 14 * 60 + 30);
    const url = gcalTemplateUrl({
      title: "Ship the pipeline",
      details: "notes here",
      startMs,
      durationMin: 40,
      timeZone: "America/New_York",
    });
    const parsed = new URL(url);
    expect(parsed.hostname).toBe("calendar.google.com");
    expect(parsed.searchParams.get("action")).toBe("TEMPLATE");
    expect(parsed.searchParams.get("text")).toBe("Ship the pipeline");
    expect(parsed.searchParams.get("dates")).toBe("20260721T143000/20260721T151000");
    expect(parsed.searchParams.get("details")).toBe("notes here");
    expect(parsed.searchParams.get("ctz")).toBe("America/New_York");
  });

  it("falls back to a placeholder title and omits empty details", () => {
    const url = gcalTemplateUrl({
      title: "   ",
      startMs: toEpochMs(iso("2026-07-21"), 60),
      durationMin: CAL_STEP_MIN,
      timeZone: "UTC",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("text")).toBe("Untitled task");
    expect(parsed.searchParams.has("details")).toBe(false);
  });
});
