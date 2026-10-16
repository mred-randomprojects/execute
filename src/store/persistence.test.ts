import { describe, it, expect } from "vitest";
import { coerceState } from "./persistence";
import { SCHEMA_VERSION } from "../types";

// Minimal raw task shape (pre-v4 data has no `carriedCount` field at all).
function rawTask(extra: Record<string, unknown> = {}) {
  return { id: "t1", text: "a task", ...extra };
}

describe("persistence: schema v4 carriedCount migration", () => {
  it("defaults carriedCount to 0 for pre-v4 tasks that lack the field", () => {
    const state = coerceState({ tasks: [rawTask()] });
    expect(state.tasks[0].carriedCount).toBe(0);
  });

  it("preserves an existing carriedCount", () => {
    const state = coerceState({ tasks: [rawTask({ carriedCount: 3 })] });
    expect(state.tasks[0].carriedCount).toBe(3);
  });

  it("clamps a negative or fractional carriedCount to a non-negative int", () => {
    const neg = coerceState({ tasks: [rawTask({ carriedCount: -5 })] });
    expect(neg.tasks[0].carriedCount).toBe(0);
    const frac = coerceState({ tasks: [rawTask({ carriedCount: 2.7 })] });
    expect(frac.tasks[0].carriedCount).toBe(2);
    const junk = coerceState({ tasks: [rawTask({ carriedCount: "lots" })] });
    expect(junk.tasks[0].carriedCount).toBe(0);
  });

  it("migrates carriedCount on nested children too", () => {
    const state = coerceState({
      tasks: [rawTask({ children: [rawTask({ id: "c1", carriedCount: 1 })] })],
    });
    expect(state.tasks[0].carriedCount).toBe(0);
    expect(state.tasks[0].children[0].carriedCount).toBe(1);
  });
});

describe("persistence: 'kept' log action", () => {
  it("keeps a 'kept' log entry instead of coercing it to 'completed'", () => {
    const state = coerceState({
      log: [{ id: "l1", taskId: "t1", taskText: "a task", action: "kept", at: 1, date: "2026-06-24" }],
    });
    expect(state.log[0].action).toBe("kept");
  });

  it("still falls back to 'completed' for an unknown action", () => {
    const state = coerceState({
      log: [{ id: "l1", taskId: "t1", taskText: "a task", action: "bogus", at: 1, date: "2026-06-24" }],
    });
    expect(state.log[0].action).toBe("completed");
  });
});

describe("persistence: v5 recurrences", () => {
  it("round-trips a recurrence (rule + template subtree) through coercion", () => {
    const raw = {
      recurrences: [
        {
          id: "r1",
          createdAt: 5,
          rule: {
            freq: "week",
            interval: 2,
            weekdays: [6, 1, 6],
            anchor: "2026-06-01",
            ends: { kind: "after", count: 4 },
          },
          template: {
            id: "tpl1",
            text: "Morning ritual",
            children: [{ id: "s1", text: "Brush teeth" }],
          },
        },
      ],
    };
    const state = coerceState(raw);
    expect(state.recurrences).toHaveLength(1);
    const rec = state.recurrences[0];
    expect(rec.rule.freq).toBe("week");
    expect(rec.rule.interval).toBe(2);
    expect(rec.rule.weekdays).toEqual([1, 6]); // normalized: deduped + sorted
    expect(rec.rule.ends).toEqual({ kind: "after", count: 4 });
    expect(rec.template.text).toBe("Morning ritual");
    expect(rec.template.children[0].text).toBe("Brush teeth");
  });

  it("defaults to no recurrences and coerces the instance-link fields on tasks", () => {
    const empty = coerceState({ tasks: [rawTask()] });
    expect(empty.recurrences).toEqual([]);
    expect(empty.tasks[0].recurrenceId).toBeNull();
    expect(empty.tasks[0].occurrenceDate).toBeNull();

    const linked = coerceState({
      tasks: [rawTask({ recurrenceId: "r1", occurrenceDate: "2026-06-30" })],
    });
    expect(linked.tasks[0].recurrenceId).toBe("r1");
    expect(linked.tasks[0].occurrenceDate).toBe("2026-06-30");
  });

  it("drops a junk rule to a safe default rather than throwing", () => {
    const state = coerceState({
      recurrences: [{ id: "r1", rule: { freq: "bogus" }, template: { id: "t", text: "x" } }],
    });
    expect(state.recurrences[0].rule.freq).toBe("day");
    expect(state.recurrences[0].rule.interval).toBe(1);
  });
});

describe("persistence: v6 current task pointer", () => {
  it("v23: the old current task becomes in progress, paused, with a newer stamp", () => {
    const s = coerceState({
      currentTaskId: "t9",
      tasks: [{ id: "t1", text: "a", updatedAt: 5 }, { id: "t9", text: "b", updatedAt: 5 }],
    });
    const t9 = s.tasks.find((t) => t.id === "t9");
    expect(t9?.inProgress).not.toBeNull();
    expect(t9?.sessions).toEqual([]); // no invented time
    expect(t9?.updatedAt).toBeGreaterThan(5);
    expect(s.tasks.find((t) => t.id === "t1")?.inProgress).toBeNull();
    expect("currentTaskId" in s).toBe(false);
  });

  it("v23: a finished current task, or junk, adopts nothing", () => {
    const done = coerceState({ currentTaskId: "t9", tasks: [{ id: "t9", completed: true }] });
    expect(done.tasks[0].inProgress).toBeNull();
    const junk = coerceState({ currentTaskId: 123, tasks: [{ id: "t9" }] });
    expect(junk.tasks[0].inProgress).toBeNull();
  });

  it("v23: reads work strictly — malformed entries dropped, only the last session open", () => {
    const t = coerceState({
      tasks: [
        {
          id: "t1",
          inProgress: { since: 10 },
          sessions: [{ start: 30, end: null }, { start: 10, end: null }, { start: "x" }, { start: 50, end: 40 }],
          progress: [{ at: 2, text: "b" }, { at: 1, text: "a" }, { at: "x", text: "c" }],
        },
      ],
    }).tasks[0];
    expect(t.inProgress).toEqual({ since: 10 });
    // Sorted; an earlier open session is closed at its start; end < start → open.
    expect(t.sessions).toEqual([
      { start: 10, end: 10 },
      { start: 30, end: 30 },
      { start: 50, end: null },
    ]);
    expect(t.progress.map((n) => n.text)).toEqual(["a", "b"]);
    // Deterministic: a second read is identical (cloud docs are read every round).
    expect(coerceState({ tasks: [t] }).tasks[0].sessions).toEqual(t.sessions);
  });

  it("v23: a settled task is never in progress", () => {
    const t = coerceState({ tasks: [{ id: "t1", completed: true, inProgress: { since: 1 } }] }).tasks[0];
    expect(t.inProgress).toBeNull();
  });
});

describe("persistence: v7 won't-do resolution", () => {
  it("defaults a pre-v7 task's wontDo to null (open)", () => {
    expect(coerceState({ tasks: [rawTask()] }).tasks[0].wontDo).toBeNull();
  });

  it("round-trips a wontDo object with its reason and timestamp", () => {
    const state = coerceState({
      tasks: [rawTask({ wontDo: { reason: "not worth it", at: 42 } })],
    });
    expect(state.tasks[0].wontDo).toEqual({ reason: "not worth it", at: 42 });
  });

  it("tolerates a reasonless skip (reason → null)", () => {
    const state = coerceState({ tasks: [rawTask({ wontDo: { at: 7 } })] });
    expect(state.tasks[0].wontDo).toEqual({ reason: null, at: 7 });
  });

  it("drops wontDo when the task is also completed — completion wins", () => {
    const state = coerceState({
      tasks: [rawTask({ completed: true, wontDo: { reason: "x", at: 1 } })],
    });
    expect(state.tasks[0].completed).toBe(true);
    expect(state.tasks[0].wontDo).toBeNull();
  });

  it("keeps a 'skipped' log entry instead of coercing it to 'completed'", () => {
    const state = coerceState({
      log: [{ id: "l1", taskId: "t1", taskText: "a task", action: "skipped", at: 1, date: "2026-07-06" }],
    });
    expect(state.log[0].action).toBe("skipped");
  });

  it("stamps the CURRENT schema version, whatever the file claimed", () => {
    // Coercion is what upgrades an old document, so once it returns, the state
    // in hand IS the current shape. Echoing the stored number left real stores
    // reporting v1 while carrying v16 data.
    expect(coerceState({ schemaVersion: 1, tasks: [] }).schemaVersion).toBe(SCHEMA_VERSION);
    expect(coerceState({}).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("brings a genuinely ancient document all the way up, without dropping its tasks", () => {
    // A v1-era task: no wontDo, no counters, no waitingOn, no estimate.
    const ancient = coerceState({
      schemaVersion: 1,
      tasks: [{ id: "t1", text: "from the before times", completed: false }],
    });
    const t = ancient.tasks[0];
    expect(t.text).toBe("from the before times");
    expect(t.wontDo).toBeNull();
    expect(t.waitingOn).toBeNull();
    expect(t.carriedCount).toBe(0);
    expect(t.postponedCount).toBe(0);
    expect(ancient.days).toEqual([]);
    expect(ancient.presence.openAtLogin).toBe(false);
    expect(ancient.schemaVersion).toBe(SCHEMA_VERSION);
  });
});
