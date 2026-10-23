import { describe, it, expect } from "vitest";
import type { Habit, Task } from "../types";
import { defaultPresence } from "../types";
import { makeTask } from "./tasks";
import { presenceSnapshot } from "./presence";

const open = (...texts: string[]): Task[] => texts.map((t) => makeTask(t));

describe("presenceSnapshot", () => {
  it("counts what's open today, and nothing when nothing is", () => {
    expect(presenceSnapshot(defaultPresence(), []).remaining).toBe(0);
    expect(presenceSnapshot(defaultPresence(), open("a", "b", "c")).remaining).toBe(3);
  });

  it("carries the settings through untouched — the shell renders, it doesn't decide", () => {
    const presence = { ...defaultPresence(), tray: false };
    const snap = presenceSnapshot(presence, open("x"));
    expect(snap.tray).toBe(false);
    expect(snap.openAtLogin).toBe(false);
  });

  it("leaves the login item off until it's asked for", () => {
    // Everything else here is undone by flipping it back; a login item shows up
    // in the OS's own settings, so it never turns itself on.
    expect(defaultPresence().openAtLogin).toBe(false);
  });

  it("carries today's unanswered habits for the menu, apart from the task count", () => {
    const habit = (name: string) => ({
      id: name as Habit["id"],
      name,
      cue: "",
      perWeek: 7,
      checks: {},
      checkedAt: {},
      measure: null,
      values: {},
      notes: {},
      archivedAt: null,
      rank: 0,
      createdAt: 0,
      updatedAt: 0,
    });
    const snap = presenceSnapshot(defaultPresence(), open("a"), [habit("Run"), habit(" ")]);
    expect(snap.remaining).toBe(1);
    expect(snap.habitsLeft).toBe(2);
  });
});
