import { describe, it, expect } from "vitest";
import { coerceState } from "./persistence";

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
  it("round-trips currentTaskId and defaults it to null", () => {
    expect(coerceState({}).currentTaskId).toBeNull();
    expect(coerceState({ currentTaskId: "t9" }).currentTaskId).toBe("t9");
    expect(coerceState({ currentTaskId: 123 }).currentTaskId).toBeNull(); // junk → null
  });
});
