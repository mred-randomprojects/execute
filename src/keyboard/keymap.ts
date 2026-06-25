import type { KeyBinding } from "./types";

// Declarative bindings. Each row maps a combo + context to an action id; the
// App wires action ids → handlers. Rows with a `description` show up in the `?`
// help overlay automatically. Inline capture keys (Enter/Tab/Up/Down inside a
// row's input) are handled locally by the input and documented in the help
// overlay's static "Editing" section.

export const keymap: KeyBinding[] = [
  // ── global ────────────────────────────────────────────────────────
  { key: "Escape", action: "dismiss", context: "global", displayKey: "esc", description: "close / cancel", section: "General" },
  { key: "Meta+z", action: "undo", context: "global", displayKey: "⌘ z", description: "undo", section: "General" },
  { key: "?", action: "help.toggle", context: ["normal", "reckoning"], displayKey: "?", description: "keyboard help", section: "General" },
  { key: "Meta+k", action: "palette.open", context: ["normal", "reckoning", "editing"], displayKey: "⌘ k", description: "command palette", section: "General" },

  // ── views ─────────────────────────────────────────────────────────
  { key: "1", action: "view.today", context: "normal", displayKey: "1", description: "go to Today", section: "Views" },
  { key: "2", action: "view.backlog", context: "normal", displayKey: "2", description: "go to Backlog", section: "Views" },
  { key: "3", action: "view.all", context: "normal", displayKey: "3", description: "go to All", section: "Views" },
  { key: "4", action: "view.projects", context: "normal", displayKey: "4", description: "go to Projects", section: "Views" },
  { key: "5", action: "view.trash", context: "normal", displayKey: "5", description: "go to Trash", section: "Views" },
  { key: "h", action: "filter.hideCompleted", context: "normal", displayKey: "h", description: "hide / show completed", section: "Views" },
  { key: "g", action: "later.toggleLayout", context: "normal", displayKey: "g", description: "Later: group by date / project", section: "Views" },

  // ── navigation (normal) ───────────────────────────────────────────
  { key: "ArrowDown", action: "cursor.down", context: "normal", displayKey: "↓ / j", description: "move down", section: "Navigation" },
  { key: "j", action: "cursor.down", context: "normal" },
  { key: "ArrowUp", action: "cursor.up", context: "normal", displayKey: "↑ / k", description: "move up", section: "Navigation" },
  { key: "k", action: "cursor.up", context: "normal" },
  { key: "Shift+ArrowDown", action: "select.down", context: "normal", displayKey: "⇧ ↓", description: "extend selection down", section: "Navigation" },
  { key: "Shift+ArrowUp", action: "select.up", context: "normal", displayKey: "⇧ ↑", description: "extend selection up", section: "Navigation" },
  { key: "ArrowRight", action: "panel.open", context: "normal", displayKey: "→ / l", description: "expand · descend · details panel", section: "Navigation" },
  { key: "l", action: "panel.open", context: "normal" },
  { key: "ArrowLeft", action: "panel.back", context: "normal", displayKey: "←", description: "collapse · out to parent · close panel", section: "Navigation" },

  // ── actions (normal) ──────────────────────────────────────────────
  { key: "Enter", action: "edit.start", context: "normal", displayKey: "↵", description: "edit task title", section: "Tasks" },
  { key: "a", action: "task.new", context: "normal", displayKey: "a / n / o", description: "new task below", section: "Tasks" },
  { key: "n", action: "task.new", context: "normal" },
  { key: "o", action: "task.new", context: "normal" },
  { key: "/", action: "capture.focus", context: ["normal", "reckoning"] },
  { key: " ", action: "task.toggle", context: "normal", displayKey: "space", description: "complete / uncomplete", section: "Tasks" },
  { key: "Meta+Enter", action: "task.toggle", context: ["normal", "editing"], displayKey: "⌘ ↵", description: "complete / uncomplete", section: "Tasks" },
  { key: "t", action: "task.planToday", context: "normal", displayKey: "t", description: "plan / unplan for today", section: "Tasks" },
  { key: "s", action: "schedule.open", context: "normal", displayKey: "s", description: "schedule (this week, someday, a date…)", section: "Tasks" },
  { key: "Tab", action: "task.indent", context: "normal", displayKey: "tab", description: "indent (make subtask)", section: "Tasks" },
  { key: "Shift+Tab", action: "task.outdent", context: "normal", displayKey: "⇧ tab", description: "outdent", section: "Tasks" },
  { key: "Meta+ArrowUp", action: "reorder.up", context: "normal", displayKey: "⌘ ↑", description: "move task up", section: "Tasks" },
  { key: "Meta+ArrowDown", action: "reorder.down", context: "normal", displayKey: "⌘ ↓", description: "move task down", section: "Tasks" },
  { key: "Alt+ArrowUp", action: "reorder.up", context: "normal" },
  { key: "Alt+ArrowDown", action: "reorder.down", context: "normal" },
  { key: "Backspace", action: "task.trash", context: "normal", displayKey: "⌫", description: "move to trash (subtrees confirm)", section: "Tasks", noRepeat: true },
  { key: "c", action: "task.collapse", context: "normal", displayKey: "c", description: "collapse / expand", section: "Tasks" },
  { key: "Alt+Enter", action: "zoom.in", context: "normal", displayKey: "⌥ ↵", description: "zoom in / focus (esc backs out)", section: "Tasks" },
  { key: "m", action: "move.enter", context: "normal", displayKey: "m", description: "move mode (re-parent)", section: "Tasks" },

  // ── move mode ─────────────────────────────────────────────────────
  { key: "ArrowDown", action: "cursor.down", context: "move", displayKey: "↑ / ↓", description: "choose position", section: "Move mode" },
  { key: "j", action: "cursor.down", context: "move" },
  { key: "ArrowUp", action: "cursor.up", context: "move" },
  { key: "k", action: "cursor.up", context: "move" },
  { key: "Enter", action: "move.dropSibling", context: "move", displayKey: "↵", description: "drop before cursor", section: "Move mode" },
  { key: "Meta+Enter", action: "move.dropChild", context: "move", displayKey: "⌘ ↵", description: "drop as child of cursor", section: "Move mode" },
  { key: "Escape", action: "move.cancel", context: "move", displayKey: "esc", description: "cancel move", section: "Move mode" },

  // ── reckoning gate ────────────────────────────────────────────────
  { key: "ArrowDown", action: "cursor.down", context: "reckoning", displayKey: "↑ / ↓", description: "next / previous task", section: "The Reckoning" },
  { key: "j", action: "cursor.down", context: "reckoning" },
  { key: "ArrowUp", action: "cursor.up", context: "reckoning" },
  { key: "k", action: "cursor.up", context: "reckoning" },
  { key: "ArrowRight", action: "reck.nextCard", context: "reckoning", displayKey: "← / →", description: "previous / next group", section: "The Reckoning" },
  { key: "ArrowLeft", action: "reck.prevCard", context: "reckoning" },
  { key: "e", action: "reck.complete", context: "reckoning", displayKey: "e", description: "mark it done", section: "The Reckoning" },
  { key: "t", action: "reck.keep", context: "reckoning", displayKey: "t", description: "keep it for today", section: "The Reckoning" },
  { key: "b", action: "reck.breakdown", context: "reckoning", displayKey: "b", description: "break it down", section: "The Reckoning" },
  { key: "s", action: "reck.backlog", context: "reckoning", displayKey: "s", description: "send to backlog", section: "The Reckoning" },
  { key: "d", action: "reck.drop", context: "reckoning", displayKey: "d", description: "drop it", section: "The Reckoning" },
  { key: "S", action: "reck.backlogAll", context: "reckoning", displayKey: "⇧ s", description: "backlog the whole group", section: "The Reckoning" },
  { key: "D", action: "reck.dropAll", context: "reckoning", displayKey: "⇧ d", description: "drop the whole group", section: "The Reckoning" },
];
