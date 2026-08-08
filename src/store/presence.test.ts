import { describe, it, expect } from "vitest";
import type { Task } from "../types";
import { defaultPresence } from "../types";
import { makeTask } from "./tasks";
import { NUDGE_TITLE_LIMIT, presenceSnapshot } from "./presence";

const open = (...texts: string[]): Task[] => texts.map((t) => makeTask(t));

describe("presenceSnapshot", () => {
  it("reports nothing left when nothing is open", () => {
    const snap = presenceSnapshot(defaultPresence(), []);
    expect(snap.remaining).toBe(0);
    expect(snap.titles).toEqual([]);
  });

  it("counts every open task but names only the first few", () => {
    const snap = presenceSnapshot(defaultPresence(), open("a", "b", "c", "d", "e"));
    expect(snap.remaining).toBe(5);
    expect(snap.titles).toHaveLength(NUDGE_TITLE_LIMIT);
    expect(snap.titles[0]).toBe("a");
  });

  it("drops untitled tasks from the names but still counts them", () => {
    // A notification reading "3 left today: , , " is worse than one that only
    // says how many.
    const snap = presenceSnapshot(defaultPresence(), open("real task", "", "   "));
    expect(snap.remaining).toBe(3);
    expect(snap.titles).toEqual(["real task"]);
  });

  it("carries the settings through untouched — the shell renders, it doesn't decide", () => {
    const presence = { ...defaultPresence(), nudges: false, morningHour: 7 };
    const snap = presenceSnapshot(presence, open("x"));
    expect(snap.nudges).toBe(false);
    expect(snap.morningHour).toBe(7);
    expect(snap.tray).toBe(true);
  });

  it("leaves the login item off until it's asked for", () => {
    // Everything else here is undone by flipping it back; a login item shows up
    // in the OS's own settings, so it never turns itself on.
    expect(defaultPresence().openAtLogin).toBe(false);
  });
});
