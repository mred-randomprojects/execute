import type { KeyBinding } from "./types";

// Declarative bindings. Each row maps a combo + context to an action id; the
// App wires action ids → handlers. Rows with a `description` are surfaced in the
// `?` help overlay automatically. Inline capture keys (Enter/Tab inside a row's
// input) are handled locally by the input and documented in the help overlay's
// static "Capture" section, so they're intentionally absent here.

export const keymap: KeyBinding[] = [
  // ── global ────────────────────────────────────────────────────────
  { key: "Escape", action: "dismiss", context: "global", displayKey: "esc", description: "close / cancel", section: "General" },
  { key: "Meta+z", action: "undo", context: "global", displayKey: "⌘ z", description: "undo", section: "General" },
  { key: "?", action: "help.toggle", context: ["normal", "reckoning"], displayKey: "?", description: "keyboard help", section: "General" },
  { key: "Meta+k", action: "palette.open", context: ["normal", "reckoning"], displayKey: "⌘ k", description: "command palette", section: "General" },

  // ── views ─────────────────────────────────────────────────────────
  { key: "Meta+1", action: "view.today", context: "normal", displayKey: "⌘ 1", description: "go to Today", section: "Views" },
  { key: "Meta+2", action: "view.backlog", context: "normal", displayKey: "⌘ 2", description: "go to Backlog", section: "Views" },
  { key: "Meta+3", action: "view.all", context: "normal", displayKey: "⌘ 3", description: "go to All", section: "Views" },

  // ── navigation (normal) ───────────────────────────────────────────
  { key: "ArrowDown", action: "cursor.down", context: "normal", displayKey: "↓ / j", description: "move cursor down", section: "Navigation" },
  { key: "j", action: "cursor.down", context: "normal" },
  { key: "ArrowUp", action: "cursor.up", context: "normal", displayKey: "↑ / k", description: "move cursor up", section: "Navigation" },
  { key: "k", action: "cursor.up", context: "normal" },
  { key: "ArrowLeft", action: "nav.left", context: "normal", displayKey: "←", description: "collapse / jump to parent", section: "Navigation" },
  { key: "h", action: "nav.left", context: "normal" },
  { key: "ArrowRight", action: "nav.right", context: "normal", displayKey: "→", description: "expand children", section: "Navigation" },
  { key: "l", action: "nav.right", context: "normal" },

  // ── actions (normal) ──────────────────────────────────────────────
  { key: "Enter", action: "edit.start", context: "normal", displayKey: "↵", description: "edit task", section: "Tasks" },
  { key: "o", action: "task.new", context: "normal", displayKey: "o", description: "new task below", section: "Tasks" },
  { key: " ", action: "task.toggle", context: "normal", displayKey: "space", description: "complete / uncomplete", section: "Tasks" },
  { key: "x", action: "task.toggle", context: "normal" },
  { key: "t", action: "task.planToday", context: "normal", displayKey: "t", description: "plan / unplan for today", section: "Tasks" },
  { key: "Tab", action: "task.indent", context: "normal", displayKey: "tab", description: "indent (make subtask)", section: "Tasks" },
  { key: "Shift+Tab", action: "task.outdent", context: "normal", displayKey: "⇧ tab", description: "outdent", section: "Tasks" },
  { key: "Backspace", action: "task.delete", context: "normal", displayKey: "⌫", description: "delete task", section: "Tasks" },
  { key: "c", action: "task.collapse", context: "normal", displayKey: "c", description: "collapse / expand", section: "Tasks" },
  { key: "m", action: "move.enter", context: "normal", displayKey: "m", description: "move mode (reorder)", section: "Tasks" },
  { key: "/", action: "capture.focus", context: "normal", displayKey: "/", description: "focus the capture bar", section: "Tasks" },

  // ── priority (normal) ─────────────────────────────────────────────
  { key: "1", action: "priority.1", context: "normal", displayKey: "1", description: "priority: urgent", section: "Priority" },
  { key: "2", action: "priority.2", context: "normal", displayKey: "2", description: "priority: high", section: "Priority" },
  { key: "3", action: "priority.3", context: "normal", displayKey: "3", description: "priority: medium", section: "Priority" },
  { key: "4", action: "priority.4", context: "normal", displayKey: "4", description: "priority: none", section: "Priority" },

  // ── move mode ─────────────────────────────────────────────────────
  { key: "ArrowDown", action: "cursor.down", context: "move", displayKey: "↑ / ↓", description: "choose position", section: "Move mode" },
  { key: "j", action: "cursor.down", context: "move" },
  { key: "ArrowUp", action: "cursor.up", context: "move" },
  { key: "k", action: "cursor.up", context: "move" },
  { key: "Enter", action: "move.dropSibling", context: "move", displayKey: "↵", description: "drop before cursor", section: "Move mode" },
  { key: "Meta+Enter", action: "move.dropChild", context: "move", displayKey: "⌘ ↵", description: "drop as child of cursor", section: "Move mode" },
  { key: "Escape", action: "move.cancel", context: "move", displayKey: "esc", description: "cancel move", section: "Move mode" },

  // ── reckoning gate ────────────────────────────────────────────────
  { key: "ArrowDown", action: "cursor.down", context: "reckoning", displayKey: "↑ / ↓", description: "next / previous leftover", section: "The Reckoning" },
  { key: "j", action: "cursor.down", context: "reckoning" },
  { key: "ArrowUp", action: "cursor.up", context: "reckoning" },
  { key: "k", action: "cursor.up", context: "reckoning" },
  { key: "e", action: "reck.complete", context: "reckoning", displayKey: "e", description: "mark it done", section: "The Reckoning" },
  { key: "b", action: "reck.breakdown", context: "reckoning", displayKey: "b", description: "break it down", section: "The Reckoning" },
  { key: "s", action: "reck.backlog", context: "reckoning", displayKey: "s", description: "send to backlog", section: "The Reckoning" },
  { key: "d", action: "reck.drop", context: "reckoning", displayKey: "d", description: "drop it", section: "The Reckoning" },
];
