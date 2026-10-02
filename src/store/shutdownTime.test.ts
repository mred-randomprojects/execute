import { describe, it, expect } from "vitest";
import { defaultPresence, type Presence } from "../types";
import { coerceState } from "./persistence";
import { isShutdownTime, parseClock, shutdownScheduleLabel, shutdownTimeOn } from "./shutdownTime";

// 2026-10-02 is a Friday, 2026-10-03 a Saturday.
const p = (over: Partial<Presence> = {}): Presence => ({ ...defaultPresence(), ...over });

describe("parseClock", () => {
  it("reads the ways people type a time", () => {
    expect(parseClock("14:15")).toBe("14:15");
    expect(parseClock("14.15")).toBe("14:15");
    expect(parseClock("1415")).toBe("14:15");
    expect(parseClock("14h")).toBe("14:00");
    expect(parseClock("9")).toBe("09:00");
    expect(parseClock("2:15pm")).toBe("14:15");
    expect(parseClock("2 p.m.")).toBe("14:00");
    expect(parseClock("12am")).toBe("00:00");
    expect(parseClock("12pm")).toBe("12:00");
  });
  it("refuses what isn't a time", () => {
    for (const bad of ["25:00", "14:60", "13pm", "noonish", "", "1:5"]) expect(parseClock(bad)).toBeNull();
  });
});

describe("the schedule", () => {
  const sched = p({ shutdownWeekdayAt: "14:15", shutdownWeekendAt: "11:00", shutdownWeekendOn: false });

  it("picks the time for the kind of day, or none when it's off", () => {
    expect(shutdownTimeOn(sched, "2026-10-02")).toBe("14:15");
    expect(shutdownTimeOn(sched, "2026-10-03")).toBeNull();
  });

  it("says when it's arrived, by the minute", () => {
    expect(isShutdownTime(sched, "2026-10-02", new Date(2026, 9, 2, 14, 14))).toBe(false);
    expect(isShutdownTime(sched, "2026-10-02", new Date(2026, 9, 2, 14, 15))).toBe(true);
    expect(isShutdownTime(sched, "2026-10-03", new Date(2026, 9, 3, 23, 0))).toBe(false);
  });

  it("labels it", () => {
    expect(shutdownScheduleLabel(sched)).toBe("weekdays 14:15 · weekends off");
    expect(shutdownScheduleLabel(p())).toBe("every day 18:00");
  });

  it("an upgrade carries the old evening hour over to both kinds of day", () => {
    const presence = coerceState({ presence: { eveningHour: 17 } }).presence;
    expect(presence).toMatchObject({
      shutdownWeekdayAt: "17:00",
      shutdownWeekdayOn: true,
      shutdownWeekendAt: "17:00",
      shutdownWeekendOn: true,
    });
    const kept = coerceState({ presence: { shutdownWeekdayAt: "14:15", shutdownWeekendOn: false } }).presence;
    expect(kept.shutdownWeekdayAt).toBe("14:15");
    expect(kept.shutdownWeekendOn).toBe(false);
    expect(coerceState({ presence: { shutdownWeekdayAt: "9:5" } }).presence.shutdownWeekdayAt).toBe("18:00");
  });
});
