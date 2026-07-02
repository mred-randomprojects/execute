import { describe, it, expect } from "vitest";
import {
  bucketMeta,
  groupRecurrencesByRule,
  groupTasksByBucket,
  groupTasksByProject,
  horizonLabel,
  prevVisibleSiblingId,
  projectSummaries,
  reckoningCards,
  recurringForToday,
  resolveZoom,
  suggestedDayFor,
  suggestedForToday,
  suppressedRecurrenceIds,
  taskBucket,
  viewPredicate,
  viewTasks,
  zoomParent,
} from "./selectors";
import type { Horizon, Recurrence, RecurrenceId, RecurrenceRule } from "./types";
import { makeTask } from "./store/tasks";
import { addDays } from "./store/dates";
import { defaultRule } from "./store/recurrence";
import {
  defaultProject,
  projectRowId,
  type Project,
  type ProjectId,
  type Task,
  type TaskId,
} from "./types";

function proj(id: string, name: string): Project {
  return { id: id as ProjectId, name, color: "#000", createdAt: 0 };
}
function task(text: string, projectId: string, plannedFor: string | null = null): Task {
  return { ...makeTask(text, projectId as ProjectId), plannedFor };
}
function withChildren(t: Task, children: Task[]): Task {
  return { ...t, children };
}

const projects = [defaultProject(), proj("work", "Work"), proj("life", "Life")];

describe("groupTasksByProject", () => {
  it("keeps project order from the projects list", () => {
    const tasks = [task("l", "life"), task("w", "work")];
    const names = groupTasksByProject(tasks, projects, { showEmpty: true }).map(
      (g) => g.project.name
    );
    expect(names).toEqual(["Inbox", "Work", "Life"]);
  });

  it("hides empty groups when showEmpty is false (task-focused views)", () => {
    const tasks = [task("w", "work")];
    const names = groupTasksByProject(tasks, projects).map((g) => g.project.name);
    expect(names).toEqual(["Work"]); // Inbox + Life are empty -> hidden
  });

  it("keeps every project when showEmpty is true (Projects view)", () => {
    const tasks = [task("w", "work")];
    const names = groupTasksByProject(tasks, projects, { showEmpty: true }).map(
      (g) => g.project.name
    );
    expect(names).toEqual(["Inbox", "Work", "Life"]);
  });

  it("buckets tasks whose project no longer exists into the Inbox", () => {
    const tasks = [task("orphan", "deleted-project")];
    const groups = groupTasksByProject(tasks, projects, { showEmpty: false });
    expect(groups.map((g) => g.project.name)).toEqual(["Inbox"]);
    expect(groups[0].tasks).toHaveLength(1);
  });

  it("emptying a project: it vanishes from a task view but survives in Projects", () => {
    // 'work' had one task; it was moved to 'life'.
    const tasks = [task("a", "life")];
    const taskView = groupTasksByProject(tasks, projects).map((g) => g.project.name);
    const projectsView = groupTasksByProject(tasks, projects, { showEmpty: true }).map(
      (g) => g.project.name
    );
    expect(taskView).not.toContain("Work");
    expect(projectsView).toContain("Work"); // never lost — this was the reported bug
  });
});

describe("viewPredicate", () => {
  const today = "2026-06-18";

  it("today: only tasks planned for today", () => {
    const p = viewPredicate("today", today);
    expect(p(task("a", "work", today))).toBe(true);
    expect(p(task("b", "work", "2026-06-17"))).toBe(false);
    expect(p(task("c", "work", null))).toBe(false);
  });

  it("projects view shows the whole tree, like 'all'", () => {
    const tasks = [task("planned", "work", today), task("someday", "life", null)];
    expect(viewTasks(tasks, "projects", today)).toHaveLength(2);
    expect(viewTasks(tasks, "all", today)).toHaveLength(2);
  });
});

describe("prevVisibleSiblingId", () => {
  const today = "2026-06-18";

  it("follows the view, skipping siblings it filters out", () => {
    const first = task("first", "work", today);
    const hidden = task("hidden", "work", null); // not planned → absent in Today
    const second = task("second", "work", today);
    const visible = viewTasks([first, hidden, second], "today", today);
    // Raw previous sibling of `second` is `hidden`; the visible one is `first`.
    expect(prevVisibleSiblingId(visible, second.id)).toBe(first.id);
  });

  it("returns null when first among the visible siblings", () => {
    const hidden = task("hidden", "work", null);
    const target = task("target", "work", today);
    const visible = viewTasks([hidden, target], "today", today);
    expect(prevVisibleSiblingId(visible, target.id)).toBeNull();
  });

  it("finds the previous sibling among children", () => {
    const a = task("a", "work");
    const b = task("b", "work");
    const parent = withChildren(task("p", "work"), [a, b]);
    expect(prevVisibleSiblingId([parent], b.id)).toBe(a.id);
    expect(prevVisibleSiblingId([parent], a.id)).toBeNull();
  });

  it("returns null for an id that isn't present", () => {
    expect(prevVisibleSiblingId([task("a", "work")], "nope" as TaskId)).toBeNull();
  });
});

describe("projectSummaries", () => {
  const today = "2026-06-18";

  it("counts open / today / done leaves per project", () => {
    const tasks = [
      task("a", "work", today), // open + today
      task("b", "work", null), // open
      { ...task("c", "work"), completed: true }, // done
      task("d", "life", null), // open
    ];
    const summaries = projectSummaries(tasks, projects, today);
    const work = summaries.find((s) => s.project.name === "Work");
    const life = summaries.find((s) => s.project.name === "Life");
    expect(work).toMatchObject({ open: 2, today: 1, done: 1 });
    expect(life).toMatchObject({ open: 1, today: 0, done: 0 });
  });

  it("lists every project (including empty ones) in project order", () => {
    const summaries = projectSummaries([], projects, today);
    expect(summaries.map((s) => s.project.name)).toEqual(["Inbox", "Work", "Life"]);
    expect(summaries.every((s) => s.open === 0 && s.done === 0)).toBe(true);
  });

  it("counts only leaves, not container parents", () => {
    const child = task("leaf", "work", today);
    const parent = withChildren(task("container", "work"), [child]);
    const summaries = projectSummaries([parent], projects, today);
    const work = summaries.find((s) => s.project.name === "Work");
    expect(work).toMatchObject({ open: 1, today: 1, done: 0 }); // parent not counted
  });
});

describe("Later buckets (fuzzy horizons)", () => {
  const today = "2026-06-18"; // Thursday, ISO week 25, June 2026
  const horizon = (h: Horizon): Task => ({ ...task("x", "work"), horizon: h });

  it("buckets horizons, with anchored periods carrying forward", () => {
    expect(taskBucket(task("inbox", "work"), today)).toBe("inbox");
    expect(taskBucket(horizon({ unit: "someday", anchor: null }), today)).toBe("someday");
    expect(taskBucket(horizon({ unit: "week", anchor: "2026-W25" }), today)).toBe("thisWeek");
    expect(taskBucket(horizon({ unit: "week", anchor: "2026-W26" }), today)).toBe("nextWeek");
    expect(taskBucket(horizon({ unit: "week", anchor: "2026-W20" }), today)).toBe("thisWeek"); // stale → carries in
    expect(taskBucket(horizon({ unit: "month", anchor: "2026-06" }), today)).toBe("thisMonth");
    expect(taskBucket(horizon({ unit: "month", anchor: "2026-07" }), today)).toBe("nextMonth");
  });

  it("labels buckets with concrete periods + elapsed for the active ones", () => {
    expect(bucketMeta("thisWeek", today)).toMatchObject({ label: "This week", sublabel: "Week 25" });
    expect(bucketMeta("thisWeek", today).elapsed).toBeCloseTo(3.5 / 7, 5);
    expect(bucketMeta("thisMonth", today)).toMatchObject({ label: "This month", sublabel: "June 2026" });
    expect(bucketMeta("nextMonth", today)).toMatchObject({ label: "Next month", sublabel: "July 2026", elapsed: null });
    expect(bucketMeta("someday", today)).toMatchObject({ sublabel: null, elapsed: null });
  });

  it("horizonLabel gives a chip for the by-project layout", () => {
    expect(horizonLabel(task("x", "work"), today)).toBeNull(); // inbox → no chip
    expect(horizonLabel(horizon({ unit: "week", anchor: "2026-W26" }), today)).toBe("next week");
    expect(horizonLabel(horizon({ unit: "someday", anchor: null }), today)).toBe("someday");
  });

  it("groups roots into buckets in fixed order with done/total counts", () => {
    const tasks = [
      horizon({ unit: "someday", anchor: null }),
      { ...horizon({ unit: "week", anchor: "2026-W25" }), completed: true },
      horizon({ unit: "week", anchor: "2026-W25" }),
      task("untriaged", "work"),
    ];
    const groups = groupTasksByBucket(tasks, tasks, today);
    expect(groups.map((g) => g.meta.id)).toEqual(["thisWeek", "someday", "inbox"]);
    const thisWeek = groups[0];
    expect(thisWeek).toMatchObject({ done: 1, total: 2 });
  });

  it("completion counts come from the full tree, not just the shown tasks", () => {
    const open = horizon({ unit: "week", anchor: "2026-W25" });
    const closed = { ...horizon({ unit: "week", anchor: "2026-W25" }), completed: true };
    const groups = groupTasksByBucket([open], [open, closed], today); // view hides the completed one
    expect(groups[0]).toMatchObject({ done: 1, total: 2 });
    expect(groups[0].tasks).toHaveLength(1); // but only the open one is listed
  });
});

describe("suggestedDayFor (soft horizon → suggested day)", () => {
  const horizon = (h: Horizon): Task => ({ ...task("x", "work"), horizon: h });
  const monday = "2026-06-15"; // Monday of ISO week 25
  const thisWeek: Horizon = { unit: "week", anchor: "2026-W25" };

  it("aims for mid-week (Wednesday) when set early in the week", () => {
    expect(suggestedDayFor(horizon(thisWeek), monday)).toBe("2026-06-17"); // Wed
  });

  it("pushes into what's left once the midpoint passed: Thursday → Friday", () => {
    expect(suggestedDayFor(horizon(thisWeek), "2026-06-18")).toBe("2026-06-19"); // Fri
  });

  it("aims for mid-month for a month horizon", () => {
    const midJune = suggestedDayFor(horizon({ unit: "month", anchor: "2026-06" }), "2026-06-01");
    expect(midJune).toBe("2026-06-16"); // floor(30/2) = index 15 → the 16th
  });

  it("a next-week horizon stays in the future, not today", () => {
    const s = suggestedDayFor(horizon({ unit: "week", anchor: "2026-W26" }), monday);
    expect(s).toBe("2026-06-24"); // next Wednesday
    expect(s != null && s > monday).toBe(true);
  });

  it("surfaces today to re-triage a horizon whose window already passed", () => {
    expect(suggestedDayFor(horizon({ unit: "week", anchor: "2026-W20" }), monday)).toBe(monday);
  });

  it("returns null for someday, inbox, dated, and completed", () => {
    const base = task("x", "work");
    expect(suggestedDayFor({ ...base, horizon: { unit: "someday", anchor: null } }, monday)).toBeNull();
    expect(suggestedDayFor({ ...base, horizon: null }, monday)).toBeNull(); // inbox
    expect(suggestedDayFor({ ...base, plannedFor: monday }, monday)).toBeNull(); // already dated
    expect(suggestedDayFor({ ...horizon(thisWeek), completed: true }, monday)).toBeNull();
  });

  it("suggestedForToday gathers only the tasks whose suggested day is today", () => {
    const wednesday = addDays(monday, 2);
    const due = horizon(thisWeek); // → Wednesday
    const later = horizon({ unit: "week", anchor: "2026-W26" }); // → next week
    expect(suggestedForToday([due, later], wednesday).map((t) => t.id)).toEqual([due.id]);
  });
});

describe("zoom (Workflowy-style hoist)", () => {
  // project(Work) → task1 → task2 → task3 ; plus a separate task4
  const t3 = task("task3", "work");
  const t2 = withChildren(task("task2", "work"), [t3]);
  const t1 = withChildren(task("task1", "work"), [t2]);
  const t4 = task("task4", "work");
  const tasks = [t1, t4];

  it("zooming into task1 shows its subtree and the project breadcrumb", () => {
    const z = resolveZoom(tasks, projects, { kind: "task", id: t1.id }, "All tasks");
    expect(z).not.toBeNull();
    expect(z?.title).toBe("task1");
    // subtree is task1's children; task3 is reachable nested under task2
    expect(z?.subtree.map((t) => t.text)).toEqual(["task2"]);
    expect(z?.crumbs.map((c) => c.label)).toEqual(["All tasks", "Work"]);
  });

  it("deep zoom lists every ancestor as a crumb", () => {
    const z = resolveZoom(tasks, projects, { kind: "task", id: t3.id }, "All tasks");
    expect(z?.title).toBe("task3");
    expect(z?.crumbs.map((c) => c.label)).toEqual(["All tasks", "Work", "task1", "task2"]);
    expect(z?.crumbs[1].id).toBe(projectRowId("work" as ProjectId));
    expect(z?.crumbs[2].id).toBe(t1.id);
  });

  it("zooming into a project shows its root tasks", () => {
    const z = resolveZoom(tasks, projects, { kind: "project", id: "work" as ProjectId }, "Projects");
    expect(z?.kind).toBe("project");
    expect(z?.title).toBe("Work");
    expect(z?.subtree.map((t) => t.text)).toEqual(["task1", "task4"]);
    expect(z?.crumbs.map((c) => c.label)).toEqual(["Projects"]);
  });

  it("returns null for a deleted target", () => {
    expect(resolveZoom(tasks, projects, { kind: "task", id: "gone" as TaskId }, "All")).toBeNull();
    expect(
      resolveZoom(tasks, projects, { kind: "project", id: "gone" as ProjectId }, "All")
    ).toBeNull();
  });

  it("zoomParent climbs task → parent task → project → out", () => {
    expect(zoomParent(tasks, { kind: "task", id: t3.id })).toEqual({ kind: "task", id: t2.id });
    expect(zoomParent(tasks, { kind: "task", id: t1.id })).toEqual({
      kind: "project",
      id: "work",
    });
    expect(zoomParent(tasks, { kind: "project", id: "work" as ProjectId })).toBeNull();
  });
});

describe("reckoningCards", () => {
  const today = "2026-06-24";
  const yest = "2026-06-23";

  it("makes a single-leaf card for a top-level leftover (no parents)", () => {
    const leaf = task("solo", "work", yest);
    const cards = reckoningCards([leaf], today);
    expect(cards).toHaveLength(1);
    expect(cards[0].root.id).toBe(leaf.id);
    expect(cards[0].leaves).toHaveLength(1);
    expect(cards[0].leaves[0].task.id).toBe(leaf.id);
    expect(cards[0].leaves[0].parents).toEqual([]);
  });

  it("groups a parent's stranded subtasks under the top-level root", () => {
    const done = { ...task("email", "work", yest), completed: true };
    const left = task("order tiles", "work", yest);
    const parent = withChildren(task("kitchen", "work", yest), [done, left]);
    const cards = reckoningCards([parent], today);
    expect(cards).toHaveLength(1);
    expect(cards[0].root.id).toBe(parent.id); // the container, not a leftover itself
    expect(cards[0].leaves.map((l) => l.task.text)).toEqual(["order tiles"]);
    expect(cards[0].leaves[0].parents).toEqual([]); // immediate parent IS the root
  });

  it("exposes intermediate ancestors for deeply nested leftovers", () => {
    const leaf = task("deep step", "work", yest);
    const mid = withChildren(task("mid", "work"), [leaf]);
    const root = withChildren(task("root", "work"), [mid]);
    const cards = reckoningCards([root], today);
    expect(cards[0].root.id).toBe(root.id);
    expect(cards[0].leaves[0].parents.map((p) => p.text)).toEqual(["mid"]);
  });

  it("keeps cards in tree order and multiple leaves within a card", () => {
    const a1 = task("a1", "work", yest);
    const a2 = task("a2", "work", yest);
    const rootA = withChildren(task("A", "work"), [a1, a2]);
    const b = task("B", "work", yest);
    const cards = reckoningCards([rootA, b], today);
    expect(cards.map((c) => c.root.text)).toEqual(["A", "B"]);
    expect(cards[0].leaves.map((l) => l.task.text)).toEqual(["a1", "a2"]);
    expect(cards[1].leaves.map((l) => l.task.text)).toEqual(["B"]);
  });

  it("ignores completed, undated, and future-dated tasks", () => {
    const future = task("future", "work", "2026-06-30");
    const done = { ...task("done", "work", yest), completed: true };
    const noDate = task("nodate", "work", null);
    expect(reckoningCards([future, done, noDate], today)).toEqual([]);
  });
});

// ─── Recurrences ────────────────────────────────────────────────────

function rec(id: string, rule: RecurrenceRule, template: Task): Recurrence {
  return { id: id as RecurrenceId, template, rule, createdAt: 0 };
}
/** An accepted instance of recurrence `recId` for `occ`. */
function instance(recId: string, occ: string, completed: boolean): Task {
  return {
    ...task("instance", "work"),
    recurrenceId: recId as RecurrenceId,
    occurrenceDate: occ,
    completed,
    plannedFor: occ,
  };
}

describe("groupRecurrencesByRule", () => {
  it("buckets by pattern label, day before week", () => {
    const daily1 = rec("a", defaultRule("2026-06-01"), task("A", "work"));
    const daily2 = rec("b", defaultRule("2026-06-01"), task("B", "work"));
    const weekly = rec(
      "c",
      { freq: "week", interval: 1, weekdays: [1], anchor: "2026-06-01", ends: { kind: "never" } },
      task("C", "work")
    );
    const groups = groupRecurrencesByRule([weekly, daily1, daily2]);
    expect(groups.map((g) => g.label)).toEqual(["Every day", "Every week on Mon"]);
    expect(groups[0].recurrences.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("recurringForToday + suppression", () => {
  const today = "2026-06-30";
  const daily = rec("a", defaultRule("2026-06-01"), task("Water plants", "work"));

  it("offers a recurrence that fires today with no open instance", () => {
    expect(recurringForToday([daily], [], today).map((r) => r.id)).toEqual(["a"]);
  });

  it("suppresses while an accepted instance is still open", () => {
    const tasks = [instance("a", today, false)];
    expect(suppressedRecurrenceIds(tasks, today).has("a" as RecurrenceId)).toBe(true);
    expect(recurringForToday([daily], tasks, today)).toEqual([]);
  });

  it("stays suppressed today even after that instance is completed", () => {
    const tasks = [instance("a", today, true)]; // done today → don't re-offer today
    expect(recurringForToday([daily], tasks, today)).toEqual([]);
  });

  it("re-offers once the only instance is a completed one from a past day", () => {
    const tasks = [instance("a", "2026-06-29", true)];
    expect(recurringForToday([daily], tasks, today).map((r) => r.id)).toEqual(["a"]);
  });

  it("does not offer a recurrence that doesn't fire today", () => {
    const notToday = rec(
      "z",
      { freq: "week", interval: 1, weekdays: [1], anchor: "2026-06-01", ends: { kind: "never" } },
      task("Mon only", "work")
    ); // today is a Tuesday
    expect(recurringForToday([notToday], [], today)).toEqual([]);
  });
});
