import type { Task } from "../types";

export interface MarkdownOptions {
  /** Include each task's notes (its description) under the item. */
  includeNotes: boolean;
}

// A task's own `text` is already markdown (it renders inline), so we embed it
// as-is. Completed → [x], anything else → [ ]. Children nest with 2-space indent
// (CommonMark task lists), so the whole subtree pastes cleanly into Obsidian,
// Notion, GitHub, etc.
function renderNode(task: Task, opts: MarkdownOptions, depth: number, out: string[]): void {
  const indent = "  ".repeat(depth);
  const box = task.completed ? "[x]" : "[ ]";
  const title = task.text.trim() === "" ? "Untitled" : task.text.trim();
  out.push(`${indent}- ${box} ${title}`);

  if (opts.includeNotes && task.notes.trim() !== "") {
    // Notes as a continuation of the list item: indented two spaces past the
    // dash; blank lines kept (unindented) so paragraph breaks survive.
    const noteIndent = `${indent}  `;
    for (const line of task.notes.replace(/\s+$/, "").split("\n")) {
      out.push(line.trim() === "" ? "" : `${noteIndent}${line}`);
    }
  }

  for (const child of task.children) renderNode(child, opts, depth + 1, out);
}

/** Serialize a task and its whole subtree to a markdown checklist. */
export function taskToMarkdown(task: Task, opts: MarkdownOptions): string {
  const out: string[] = [];
  renderNode(task, opts, 0, out);
  return out.join("\n");
}
