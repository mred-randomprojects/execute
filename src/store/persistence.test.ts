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
