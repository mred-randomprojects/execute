import { describe, it, expect } from "vitest";
import type { AppState, ISODate, LogAction, LogEntry, Task, TaskId } from "../types";
import { emptyState } from "../types";
import { makeTask } from "./tasks";
import { addDays } from "./dates";
import { buildReview } from "./review";

const TODAY: ISODate = "2026-08-09";
const ago = (n: number): ISODate => addDays(TODAY, -n);

let seq = 0;
const log = (
  action: LogAction,
  reason: string | null,
  date: ISODate = ago(1)
): LogEntry => ({
  id: `l${seq++}`,
  taskId: "t" as TaskId,
  taskText: "a task",
  action,
  reason,
  at: 0,
  date,
});

const state = (over: Partial<AppState> = {}): AppState => ({ ...emptyState(), ...over });

const task = (text: string, over: Partial<Task> = {}): Task => ({
  ...makeTask(text),
  ...over,
});

describe("buildReview", () => {
  it("covers a week ending today", () => {
    const r = buildReview(state(), TODAY);
    expect(r.to).toBe(TODAY);
    expect(r.from).toBe(ago(6));
  });

  it("counts what happened, by kind", () => {
    const r = buildReview(
      state({ log: [log("completed", null), log("postponed", null), log("postponed", null)] }),
      TODAY
    );
    expect(r.counts.completed).toBe(1);
    expect(r.counts.postponed).toBe(2);
    expect(r.counts.dropped).toBe(0);
  });

  it("ignores anything outside the window", () => {
    const r = buildReview(state({ log: [log("completed", null, ago(30))] }), TODAY);
    expect(r.counts.completed).toBe(0);
  });

  it("tallies reasons, most common first", () => {
    const r = buildReview(
      state({
        log: [
          log("postponed", "no time"),
          log("postponed", "no time"),
          log("kept", "waiting on Ana"),
        ],
      }),
      TODAY
    );
    expect(r.reasons).toEqual([
      { reason: "no time", count: 2 },
      { reason: "waiting on Ana", count: 1 },
    ]);
  });

  it("folds casing and whitespace — a split tally hides the pattern", () => {
    const r = buildReview(
      state({
        log: [
          log("postponed", "No time"),
          log("postponed", "no time"),
          log("kept", "  NO TIME  "),
        ],
      }),
      TODAY
    );
    expect(r.reasons).toHaveLength(1);
    expect(r.reasons[0].count).toBe(3);
  });

  it("labels a folded group with its most common spelling", () => {
    const r = buildReview(
      state({ log: [log("postponed", "no time"), log("kept", "no time"), log("kept", "No time")] }),
      TODAY
    );
    expect(r.reasons[0].reason).toBe("no time");
  });

  it("skips blank reasons rather than tallying an empty row", () => {
    const r = buildReview(
      state({ log: [log("postponed", null), log("postponed", ""), log("kept", "   ")] }),
      TODAY
    );
    expect(r.reasons).toEqual([]);
  });

  it("reads reasons off deferrals only — one on a completion is a note", () => {
    const r = buildReview(
      state({ log: [log("completed", "finally"), log("postponed", "no time")] }),
      TODAY
    );
    expect(r.reasons.map((x) => x.reason)).toEqual(["no time"]);
  });

  it("lists what you're blocked on, longest wait first", () => {
    const r = buildReview(
      state({
        tasks: [
          task("newer", { waitingOn: { who: "Bo", since: 9_000 } }),
          task("older", { waitingOn: { who: "Ana", since: 1_000 } }),
        ],
      }),
      TODAY
    );
    expect(r.waiting.map((t) => t.text)).toEqual(["older", "newer"]);
  });

  it("surfaces the tasks you keep putting off, worst first", () => {
    const r = buildReview(
      state({
        tasks: [
          task("mild", { carriedCount: 1, postponedCount: 1 }),
          task("chronic", { carriedCount: 3, postponedCount: 4 }),
          task("innocent", {}),
        ],
      }),
      TODAY
    );
    expect(r.chronic.map((c) => c.task.text)).toEqual(["chronic", "mild"]);
    expect(r.chronic[0].deferrals).toBe(7);
  });

  it("leaves resolved tasks out of the chronic list — that story is over", () => {
    const r = buildReview(
      state({
        tasks: [
          task("done at last", { carriedCount: 5, completed: true }),
          task("declined", { postponedCount: 5, wontDo: { reason: null, at: 0 } }),
        ],
      }),
      TODAY
    );
    expect(r.chronic).toEqual([]);
  });

  it("is empty and harmless on a brand-new store", () => {
    const r = buildReview(state(), TODAY);
    expect(r.reasons).toEqual([]);
    expect(r.waiting).toEqual([]);
    expect(r.chronic).toEqual([]);
    expect(r.rate).toEqual({ closed: 0, counted: 0 });
  });
});
