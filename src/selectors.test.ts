import { describe, it, expect } from "vitest";
import {
  bucketMeta,
  groupTasksByBucket,
  groupTasksByProject,
  horizonLabel,
  projectSummaries,
  resolveZoom,
  taskBucket,
  viewPredicate,
  viewTasks,
  zoomParent,
} from "./selectors";
import type { Horizon } from "./types";
import { makeTask } from "./store/tasks";
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
