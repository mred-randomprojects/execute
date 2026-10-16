// @vitest-environment node
// The core runs with no DOM, no React and no store singleton: anything that
// isn't the desktop app (a script, a server) can load it and change the state.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AppState, HabitId, ProjectId, RecurrenceId, RecurrenceRule, TaskId } from "../types";
import { emptyState } from "../types";
import { findById } from "../store/tasks";
import { applyCommand, describeCommand, runCommand, toggleWorkCommand, type Command, type CommandContext } from "./commands";

const NOW = Date.UTC(2026, 9, 16, 15, 0, 0);

/** A context with a fixed clock and predictable ids, so runs can be compared. */
function ctx(now = NOW): CommandContext {
  let n = 0;
  return { now, newId: () => `id${++n}` };
}

/** Run commands one after another, each a millisecond after the last. */
function run(s: AppState, ...cmds: Command[]): AppState {
  return cmds.reduce((acc, cmd, i) => runCommand(acc, cmd, ctx(NOW + i)), s);
}

const A = "task-a" as TaskId;
const B = "task-b" as TaskId;

function withTwo(): AppState {
  return run(
    emptyState(),
    { type: "addTaskAfter", id: A, afterId: null, text: "write the report", plannedFor: null },
    { type: "addTaskAfter", id: B, afterId: A, text: "send it", plannedFor: null },
  );
}

function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
}

describe("the core (no UI)", () => {
  it("imports nothing from a platform: no React, Firebase, Electron or window", () => {
    const dir = __dirname;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      const src = readFileSync(join(dir, file), "utf8");
      expect(src, file).not.toMatch(/from "(react|firebase[^"]*|electron)"/);
      expect(src, file).not.toMatch(/\bwindow\./);
    }
  });

  it("creates a task with the caller's id, stamped and placed", () => {
    const s = withTwo();
    const a = findById(s.tasks, A);
    expect(a?.text).toBe("write the report");
    expect(a?.createdAt).toBe(NOW);
    expect(a?.rank).not.toBe("");
    expect(s.tasks.map((t) => t.id)).toEqual([A, B]);
  });

  it("is pure: never mutates its input, and the same inputs give the same state", () => {
    const s = deepFreeze(withTwo());
    const cmd: Command = { type: "toggleComplete", id: A };
    const once = runCommand(s, cmd, ctx());
    expect(runCommand(s, cmd, ctx())).toEqual(once);
    expect(findById(s.tasks, A)?.completed).toBe(false);
  });

  it("commands are plain data: a JSON round trip runs the same", () => {
    const s = withTwo();
    const cmd: Command = { type: "reorder", ids: [B], dir: "up", visible: [A, B] };
    const wire = JSON.parse(JSON.stringify(cmd)) as Command;
    expect(runCommand(s, wire, ctx())).toEqual(runCommand(s, cmd, ctx()));
    expect(runCommand(s, cmd, ctx()).tasks.map((t) => t.id)).toEqual([B, A]);
  });

  it("a command that changes nothing returns the very same state", () => {
    const s = run(withTwo(), { type: "markWontDo", id: A, reason: null });
    expect(runCommand(s, { type: "markWontDo", id: A, reason: null }, ctx())).toBe(s);
    expect(runCommand(s, { type: "clearWaiting", id: A }, ctx())).toBe(s);
    expect(runCommand(s, { type: "renameProject", id: "p" as ProjectId, name: "  " }, ctx())).toBe(s);
  });

  it("completing logs it with the context's id and day, and stops its timer", () => {
    const s = run(withTwo(), { type: "startWork", id: A }, { type: "toggleComplete", id: A });
    const a = findById(s.tasks, A);
    expect(a?.completed).toBe(true);
    expect(a?.inProgress).toBeNull(); // settled at the choke point (core/commit)
    expect(s.log[0]).toMatchObject({ id: "id1", taskId: A, action: "completed", date: "2026-10-16" });
  });

  it("stamps the changed field group for the merge", () => {
    const s = run(withTwo(), { type: "setNotes", id: A, notes: "draft in docs" });
    const a = findById(s.tasks, A);
    expect(a?.clocks.notes).toBe(NOW + 0);
    expect(a?.clocks.text).toBeUndefined();
  });

  it("trashing leaves a tombstone; deleting for good marks it purged", () => {
    const trashed = run(withTwo(), { type: "trashTask", id: A, reason: null, log: false });
    expect(findById(trashed.tasks, A)).toBeUndefined();
    expect(trashed.tombstones).toContainEqual({ id: A, deletedAt: NOW, purged: false });
    const purged = run(trashed, { type: "purgeFromTrash", id: A });
    expect(purged.trash).toEqual([]);
    expect(purged.tombstones.find((t) => t.id === A)?.purged).toBe(true);
  });

  it("postponing counts and logs; plain rescheduling doesn't", () => {
    const target = { plannedFor: "2026-10-20", horizon: null };
    const s = run(withTwo(), { type: "postponeMany", ids: [A], target, reason: "no time" });
    expect(findById(s.tasks, A)).toMatchObject({ plannedFor: "2026-10-20", postponedCount: 1 });
    expect(s.log[0]).toMatchObject({ action: "postponed", reason: "no time" });
    const moved = run(withTwo(), { type: "setPlannedFor", id: A, plannedFor: "2026-10-20" });
    expect(findById(moved.tasks, A)?.postponedCount).toBe(0);
    expect(moved.log).toEqual([]);
  });

  it("accepting a recurrence materializes its template with the caller's id", () => {
    const rule: RecurrenceRule = { freq: "day", interval: 1, weekdays: [], anchor: "2026-10-01", ends: { kind: "never" } };
    const rec = "rec" as RecurrenceId;
    const s = run(
      emptyState(),
      { type: "createRecurrence", id: rec, taskId: "tpl" as TaskId, text: "stretch", rule, projectId: emptyState().projects[0].id },
      { type: "addRecurrenceStep", taskId: "tpl" as TaskId, stepId: "step" as TaskId, mode: "child" },
      { type: "acceptRecurrence", recurrenceId: rec, id: "today" as TaskId, today: "2026-10-16" },
    );
    const instance = findById(s.tasks, "today" as TaskId);
    expect(instance).toMatchObject({ text: "stretch", plannedFor: "2026-10-16", recurrenceId: rec });
    expect(instance?.children.map((c) => c.id)).toEqual(["id1"]);
  });

  it("habits: created, checked in, and deleted with a tombstone", () => {
    const h = "h" as HabitId;
    const s = run(
      emptyState(),
      { type: "createHabit", id: h, name: "Walk", perWeek: 5, measure: null },
      { type: "markHabit", id: h, date: "2026-10-16", mark: "done" },
    );
    expect(s.habits[0]).toMatchObject({ name: "Walk", perWeek: 5, checks: { "2026-10-16": "done" } });
    const gone = run(s, { type: "deleteHabit", id: h });
    expect(gone.tombstones.map((t) => t.id)).toContain(h);
  });

  it("names undoable changes, and leaves incidental ones unnamed", () => {
    const s = withTwo();
    expect(describeCommand(s, { type: "toggleComplete", id: A }, NOW)).toBe("Complete “write the report”");
    expect(describeCommand(s, { type: "setCompletedMany", ids: [A, B], completed: true }, NOW)).toBe("Complete 2 tasks");
    expect(describeCommand(s, { type: "setTheme", theme: "ivory" }, NOW)).toBeNull();
    expect(describeCommand(s, { type: "pauseWorkAt", at: NOW }, NOW)).toBeNull();
  });

  it("the s toggle: start, then stop, then resume", () => {
    let s = withTwo();
    const step = () => {
      const t = toggleWorkCommand(s, A);
      if (t == null) throw new Error("not workable");
      s = runCommand(s, t.command, ctx(NOW + 10_000 * s.log.length + Date.UTC(1970, 0, 1, 0, 0, s.actionLog.length)));
      return t.result;
    };
    expect(step()).toBe("started");
    s = runCommand(s, { type: "pauseWorkAt", at: NOW + 5000 }, ctx(NOW + 6000));
    expect(step()).toBe("resumed");
    expect(step()).toBe("stopped");
    expect(toggleWorkCommand(run(s, { type: "toggleComplete", id: A }), A)).toBeNull();
  });

  it("applyCommand alone doesn't stamp: commit is a separate step", () => {
    const s = withTwo();
    const raw = applyCommand(s, { type: "setText", id: A, text: "new" }, ctx(NOW + 99));
    expect(findById(raw.tasks, A)?.updatedAt).toBe(findById(s.tasks, A)?.updatedAt);
    expect(findById(runCommand(s, { type: "setText", id: A, text: "new" }, ctx(NOW + 99)).tasks, A)?.updatedAt).toBe(NOW + 99);
  });
});
