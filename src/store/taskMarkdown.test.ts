import { describe, it, expect } from "vitest";
import type { Task, TaskId } from "../types";
import { DEFAULT_PROJECT_ID } from "../types";
import { taskToMarkdown } from "./taskMarkdown";

function task(text: string, over: Partial<Task> = {}): Task {
  return {
    id: (text || "t") as TaskId,
    projectId: DEFAULT_PROJECT_ID,
    text,
    notes: "",
    completed: false,
    completedAt: null,
    wontDo: null,
    children: [],
    createdAt: 0,
    updatedAt: 0,
    priority: 4,
    plannedFor: null,
    horizon: null,
    labels: [],
    estimatedMinutes: null,
    carriedCount: 0,
    recurrenceId: null,
    occurrenceDate: null,
    scheduledAt: null,
    ...over,
  };
}

describe("taskToMarkdown", () => {
  it("nests the subtree with checkboxes", () => {
    const t = task("Parent", {
      children: [task("Child A", { completed: true }), task("Child B", { children: [task("Grandchild")] })],
    });
    expect(taskToMarkdown(t, { includeNotes: false })).toBe(
      ["- [ ] Parent", "  - [x] Child A", "  - [ ] Child B", "    - [ ] Grandchild"].join("\n"),
    );
  });

  it("includes notes under the item when asked, indented", () => {
    const t = task("Write report", { notes: "outline first\nthen prose" });
    expect(taskToMarkdown(t, { includeNotes: true })).toBe(
      ["- [ ] Write report", "  outline first", "  then prose"].join("\n"),
    );
  });

  it("omits notes when includeNotes is false", () => {
    const t = task("X", { notes: "secret" });
    expect(taskToMarkdown(t, { includeNotes: false })).toBe("- [ ] X");
  });

  it("labels empty titles as Untitled", () => {
    expect(taskToMarkdown(task(""), { includeNotes: false })).toBe("- [ ] Untitled");
  });
});
