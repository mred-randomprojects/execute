import { describe, it, expect } from "vitest";
import { subsequenceMatch, searchTasks, highlightSegments } from "./search";
import { makeTask } from "./tasks";
import { defaultProject, type Project, type ProjectId } from "../types";

describe("subsequenceMatch", () => {
  it("matches non-adjacent chars in order, case-insensitively", () => {
    const m = subsequenceMatch("byml", "Buy milk");
    expect(m).not.toBeNull();
    // B(0) y(2) m(4) l(6)
    expect(m?.indices).toEqual([0, 2, 4, 6]);
  });

  it("rejects when a char is missing or out of order", () => {
    expect(subsequenceMatch("xyz", "Buy milk")).toBeNull();
    expect(subsequenceMatch("kmil", "milk")).toBeNull(); // right letters, wrong order
  });

  it("treats an empty query as no match", () => {
    expect(subsequenceMatch("", "anything")).toBeNull();
  });

  it("rejects a query longer than the text", () => {
    expect(subsequenceMatch("milkshake", "milk")).toBeNull();
  });

  it("prefers a contiguous run over a scattered alignment", () => {
    // Greedy-leftmost would grab the stray p's near the start; the DP should
    // instead land the whole run on "apple".
    const m = subsequenceMatch("app", "a purple apple");
    expect(m?.indices).toEqual([9, 10, 11]);
  });

  it("scores a contiguous prefix match above a scattered one", () => {
    const contiguous = subsequenceMatch("report", "report draft")!;
    const scattered = subsequenceMatch("report", "read the porter")!;
    expect(contiguous.score).toBeGreaterThan(scattered.score);
  });

  it("rewards word-boundary starts", () => {
    // "gc" as the initials of two words beats "gc" buried mid-word.
    const initials = subsequenceMatch("gc", "git commit")!;
    const buried = subsequenceMatch("gc", "logic check")!;
    expect(initials.score).toBeGreaterThan(buried.score);
  });
});

describe("highlightSegments", () => {
  it("splits into alternating hit / non-hit runs that rebuild the original", () => {
    const text = "Buy milk";
    const indices = [0, 2, 4, 6];
    const segs = highlightSegments(text, indices);
    // The segments must reconstruct the original string exactly…
    expect(segs.map((s) => s.text).join("")).toBe(text);
    // …and the hit segments must cover exactly the matched indices.
    const hitPositions: number[] = [];
    let pos = 0;
    for (const s of segs) {
      if (s.hit) for (let i = 0; i < s.text.length; i++) hitPositions.push(pos + i);
      pos += s.text.length;
    }
    expect(hitPositions).toEqual(indices);
  });

  it("coalesces adjacent matched chars into one run", () => {
    const segs = highlightSegments("apple", [1, 2, 3]);
    expect(segs).toEqual([
      { text: "a", hit: false },
      { text: "ppl", hit: true },
      { text: "e", hit: false },
    ]);
  });

  it("handles no indices", () => {
    expect(highlightSegments("hello", [])).toEqual([{ text: "hello", hit: false }]);
  });
});

describe("searchTasks", () => {
  const inbox = defaultProject();
  const work: Project = { id: "p-work" as ProjectId, name: "Work", color: "#123456", createdAt: 0 };
  const projects = [inbox, work];

  it("returns nothing for a blank query", () => {
    const tasks = [makeTask("Buy milk")];
    expect(searchTasks(tasks, projects, "")).toEqual([]);
    expect(searchTasks(tasks, projects, "   ")).toEqual([]);
  });

  it("finds a matching task and attaches its project", () => {
    const t = { ...makeTask("Buy milk"), projectId: work.id };
    const res = searchTasks([t], projects, "byml");
    expect(res).toHaveLength(1);
    expect(res[0].task.id).toBe(t.id);
    expect(res[0].project?.id).toBe(work.id);
    expect(res[0].field).toBe("text");
  });

  it("searches nested tasks and records the ancestor path", () => {
    const child = makeTask("Draft the release notes");
    const parent = { ...makeTask("Ship v2"), children: [child] };
    const res = searchTasks([parent], projects, "notes");
    expect(res).toHaveLength(1);
    expect(res[0].task.id).toBe(child.id);
    expect(res[0].ancestors.map((a) => a.id)).toEqual([parent.id]);
  });

  it("finds completed and won't-do tasks too", () => {
    const done = { ...makeTask("Buy milk"), completed: true, completedAt: 1 };
    const skipped = { ...makeTask("Milk the schedule"), wontDo: { reason: null, at: 1 } };
    expect(searchTasks([done], projects, "milk")).toHaveLength(1);
    expect(searchTasks([skipped], projects, "milk")).toHaveLength(1);
  });

  it("falls back to notes when the title doesn't match, and ranks it below a title hit", () => {
    const byNotes = { ...makeTask("Groceries"), notes: "remember the oat milk" };
    const byTitle = makeTask("Buy milk");
    const res = searchTasks([byNotes, byTitle], projects, "milk");
    expect(res).toHaveLength(2);
    expect(res[0].task.id).toBe(byTitle.id); // title match first
    expect(res[0].field).toBe("text");
    const notesResult = res.find((r) => r.task.id === byNotes.id)!;
    expect(notesResult.field).toBe("notes");
  });

  it("ranks a contiguous title match above a scattered one", () => {
    const scattered = makeTask("Prepare a launch note"); // p·l·a·n spread across words
    const exact = makeTask("Plan the offsite");
    const res = searchTasks([scattered, exact], projects, "plan");
    expect(res[0].task.id).toBe(exact.id);
  });

  it("respects the result limit", () => {
    const tasks = Array.from({ length: 10 }, (_, i) => makeTask(`Task number ${i}`));
    expect(searchTasks(tasks, projects, "task", 3)).toHaveLength(3);
  });

  it("breaks score ties by most recently updated", () => {
    const older = { ...makeTask("Review budget"), updatedAt: 100 };
    const newer = { ...makeTask("Review budget"), updatedAt: 200 };
    const res = searchTasks([older, newer], projects, "review budget");
    expect(res[0].task.id).toBe(newer.id);
  });

  it("leaves project undefined when the task's project is gone", () => {
    const orphan = { ...makeTask("Orphaned"), projectId: "p-deleted" as ProjectId };
    const res = searchTasks([orphan], projects, "orph");
    expect(res[0].project).toBeUndefined();
  });
});
