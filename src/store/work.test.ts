import { describe, expect, it } from "vitest";
import type { Task, TaskId } from "../types";
import { makeTask } from "./tasks";
import {
  currentNote,
  formatClock,
  formatWorked,
  isPaused,
  isRunning,
  noteProgress,
  pauseWork,
  settleWork,
  startWork,
  stopWork,
  workedMs,
  workingOn,
} from "./work";
import { findById } from "./tasks";

const MIN = 60_000;
const t = (id: string, over: Partial<Task> = {}): Task => ({ ...makeTask(id), id: id as TaskId, ...over });
const get = (tasks: Task[], id: string): Task => {
  const found = findById(tasks, id as TaskId);
  if (found == null) throw new Error(`no ${id}`);
  return found;
};

describe("work: in progress and its timer", () => {
  it("starts, runs, and counts up to now", () => {
    const tasks = startWork([t("a")], "a" as TaskId, 1000);
    const a = get(tasks, "a");
    expect(isRunning(a)).toBe(true);
    expect(a.inProgress).toEqual({ since: 1000 });
    expect(workedMs(a, 1000 + 5 * MIN)).toBe(5 * MIN);
    expect(workingOn(tasks)?.id).toBe("a");
  });

  it("one at a time: starting another stops the last, keeping its time", () => {
    let tasks = startWork([t("a"), t("b", { children: [t("c")] })], "a" as TaskId, 0);
    tasks = startWork(tasks, "c" as TaskId, 10 * MIN);
    const a = get(tasks, "a");
    expect(a.inProgress).toBeNull();
    expect(a.sessions).toEqual([{ start: 0, end: 10 * MIN }]);
    expect(isRunning(get(tasks, "c"))).toBe(true);
    expect(workingOn(tasks)?.id).toBe("c");
  });

  it("stop keeps the time; a fresh start adds a second stretch", () => {
    let tasks = startWork([t("a")], "a" as TaskId, 0);
    tasks = stopWork(tasks, "a" as TaskId, 10 * MIN);
    expect(get(tasks, "a").inProgress).toBeNull();
    tasks = startWork(tasks, "a" as TaskId, 20 * MIN);
    expect(workedMs(get(tasks, "a"), 25 * MIN)).toBe(15 * MIN);
    expect(get(tasks, "a").sessions).toHaveLength(2);
  });

  it("pause closes the stretch and leaves it in progress; resuming keeps `since`", () => {
    let tasks = startWork([t("a")], "a" as TaskId, 0);
    tasks = pauseWork(tasks, 30 * MIN);
    const paused = get(tasks, "a");
    expect(isPaused(paused)).toBe(true);
    // Paused time doesn't count, however long it lasts.
    expect(workedMs(paused, 10 * 60 * MIN)).toBe(30 * MIN);
    tasks = startWork(tasks, "a" as TaskId, 10 * 60 * MIN);
    expect(get(tasks, "a").inProgress).toEqual({ since: 0 });
    expect(isRunning(get(tasks, "a"))).toBe(true);
  });

  it("a pause never ends a stretch before it began — and a stretch that short isn't kept", () => {
    const tasks = pauseWork(startWork([t("a")], "a" as TaskId, 50 * MIN), 10 * MIN);
    expect(get(tasks, "a").sessions).toEqual([]);
    expect(isPaused(get(tasks, "a"))).toBe(true);
  });

  it("a double-tapped s leaves no stretch behind", () => {
    let tasks = startWork([t("a")], "a" as TaskId, 0);
    tasks = stopWork(tasks, "a" as TaskId, 300);
    expect(get(tasks, "a").sessions).toEqual([]);
  });

  it("settling stops work on a finished, declined or blocked task", () => {
    for (const over of [
      { completed: true },
      { wontDo: { reason: null, at: 1 } },
      { waitingOn: { who: null, since: 1 } },
    ] satisfies Partial<Task>[]) {
      const running = startWork([t("a")], "a" as TaskId, 0);
      const resolved = running.map((x) => ({ ...x, ...over }));
      const settled = settleWork(resolved, 7 * MIN);
      expect(get(settled, "a").inProgress).toBeNull();
      expect(get(settled, "a").sessions).toEqual([{ start: 0, end: 7 * MIN }]);
    }
  });

  it("settling keeps only the newest start when a merge brings two", () => {
    const two = [
      t("a", { inProgress: { since: 0 }, sessions: [{ start: 0, end: null }] }),
      t("b", { inProgress: { since: 5 * MIN }, sessions: [{ start: 5 * MIN, end: null }] }),
    ];
    const settled = settleWork(two, 9 * MIN);
    expect(get(settled, "a").inProgress).toBeNull();
    expect(get(settled, "a").sessions).toEqual([{ start: 0, end: 9 * MIN }]);
    expect(isRunning(get(settled, "b"))).toBe(true);
  });

  it("settling closes an orphan open stretch at its start — no unmeasured time", () => {
    const orphan = [t("a", { sessions: [{ start: 3, end: null }] })];
    const settled = settleWork(orphan, 999);
    expect(get(settled, "a").sessions).toEqual([]); // nothing measured, nothing kept
    expect(workedMs(orphan[0], 999)).toBe(0);
  });

  it("an open stretch on a task settled elsewhere (the phone) ends when it settled", () => {
    const merged = [t("a", { completed: true, completedAt: 40 * MIN, sessions: [{ start: 10 * MIN, end: null }] })];
    expect(workedMs(merged[0], 99 * MIN)).toBe(30 * MIN);
    expect(get(settleWork(merged, 99 * MIN), "a").sessions).toEqual([{ start: 10 * MIN, end: 40 * MIN }]);
  });

  it("is free when nothing is in progress: the same tree comes back", () => {
    const tasks = [t("a", { children: [t("b")] })];
    expect(settleWork(tasks, 1)).toBe(tasks);
    expect(pauseWork(tasks, 1)).toBe(tasks);
  });

  it("won't start a settled task", () => {
    const tasks = [t("a", { completed: true })];
    expect(startWork(tasks, "a" as TaskId, 1)).toBe(tasks);
  });

  it("keeps a dated trail of 'currently', showing only this stretch's", () => {
    let tasks = startWork([t("a")], "a" as TaskId, 100);
    tasks = noteProgress(tasks, "a" as TaskId, "  reading the spec ", 200);
    tasks = noteProgress(tasks, "a" as TaskId, "reading the spec", 300); // same → no line
    tasks = noteProgress(tasks, "a" as TaskId, "writing", 400);
    const a = get(tasks, "a");
    expect(a.progress).toEqual([
      { at: 200, text: "reading the spec" },
      { at: 400, text: "writing" },
    ]);
    expect(currentNote(a)).toBe("writing");
    // Picked back up later: yesterday's note isn't where you are now.
    let later = stopWork(tasks, "a" as TaskId, 500);
    later = startWork(later, "a" as TaskId, 900);
    expect(currentNote(get(later, "a"))).toBeNull();
  });

  it("formats durations and clocks", () => {
    expect(formatWorked(40_000)).toBe("40s");
    expect(formatWorked(25 * MIN)).toBe("25m");
    expect(formatWorked(65 * MIN)).toBe("1h 05m");
    expect(formatClock(64_000)).toBe("1:04");
    expect(formatClock(3_723_000)).toBe("1:02:03");
  });
});
