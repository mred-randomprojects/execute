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
  { key: "?", action: "help.toggle", context: ["normal", "reckoning", "board"], displayKey: "?", description: "keyboard help", section: "General" },
  { key: "Meta+k", action: "palette.open", context: ["normal", "reckoning", "board", "editing"], displayKey: "⌘ k", description: "command palette", section: "General" },

  // ── views ─────────────────────────────────────────────────────────
  { key: "1", action: "view.today", context: "normal", displayKey: "1", description: "go to Today", section: "Views" },
  { key: "2", action: "view.backlog", context: "normal", displayKey: "2", description: "go to Backlog", section: "Views" },
  { key: "3", action: "view.all", context: "normal", displayKey: "3", description: "go to All", section: "Views" },
  { key: "4", action: "view.projects", context: "normal", displayKey: "4", description: "go to Projects", section: "Views" },
  { key: "5", action: "view.recurring", context: "normal", displayKey: "5", description: "go to Recurring", section: "Views" },
  { key: "6", action: "view.trash", context: "normal", displayKey: "6", description: "go to Trash", section: "Views" },
  { key: "]", action: "period.next", context: "normal", displayKey: "[ / ]", description: "period tab: earlier / later (Today ↔ Tomorrow ↔ …)", section: "Views" },
  { key: "[", action: "period.prev", context: "normal" },
  { key: "h", action: "filter.hideCompleted", context: "normal", displayKey: "h", description: "hide / show completed & won't-do", section: "Views" },
  { key: "g", action: "later.toggleLayout", context: "normal", displayKey: "g", description: "Later: group by date / project", section: "Views" },

  // ── navigation (normal) ───────────────────────────────────────────
  { key: "ArrowDown", action: "cursor.down", context: "normal", displayKey: "↓ / j", description: "move down", section: "Navigation" },
  { key: "j", action: "cursor.down", context: "normal" },
  { key: "ArrowUp", action: "cursor.up", context: "normal", displayKey: "↑ / k", description: "move up", section: "Navigation" },
  { key: "k", action: "cursor.up", context: "normal" },
  { key: "Shift+ArrowDown", action: "select.down", context: "normal", displayKey: "⇧ ↓", description: "extend selection down", section: "Navigation" },
  { key: "Shift+ArrowUp", action: "select.up", context: "normal", displayKey: "⇧ ↑", description: "extend selection up", section: "Navigation" },
  { key: "Meta+ArrowUp", action: "cursor.first", context: "normal", displayKey: "⌘ ↑", description: "jump to first item", section: "Navigation" },
  { key: "Meta+ArrowDown", action: "cursor.last", context: "normal", displayKey: "⌘ ↓", description: "jump to last item", section: "Navigation" },
  { key: "ArrowRight", action: "panel.open", context: "normal", displayKey: "→ / l", description: "expand · descend · details panel", section: "Navigation" },
  { key: "l", action: "panel.open", context: "normal" },
  { key: "ArrowLeft", action: "panel.back", context: "normal", displayKey: "←", description: "collapse · out to parent · close panel", section: "Navigation" },

  // ── actions (normal) ──────────────────────────────────────────────
  { key: "Enter", action: "edit.start", context: "normal", displayKey: "↵", description: "edit task title", section: "Tasks" },
  { key: "a", action: "task.new", context: "normal", displayKey: "a / n / o", description: "new task below", section: "Tasks" },
  { key: "n", action: "task.new", context: "normal" },
  { key: "o", action: "task.new", context: "normal" },
  { key: "/", action: "capture.focus", context: ["normal", "reckoning", "board"] },
  { key: "e", action: "estimate.open", context: "normal", displayKey: "e", description: "estimate effort (blocks of ~20m)", section: "Tasks" },
  { key: " ", action: "task.toggle", context: "normal", displayKey: "space", description: "complete / uncomplete", section: "Tasks" },
  { key: "Meta+Enter", action: "task.toggle", context: ["normal", "editing"], displayKey: "⌘ ↵", description: "complete / uncomplete", section: "Tasks" },
  { key: "t", action: "task.scheduleLater", context: "normal", displayKey: "t", description: "schedule one step later (today → tomorrow → … → inbox, wraps)", section: "Tasks" },
  { key: "T", action: "task.scheduleEarlier", context: "normal", displayKey: "⇧ t", description: "schedule one step sooner (… → tomorrow → today → inbox)", section: "Tasks" },
  { key: "s", action: "schedule.open", context: "normal", displayKey: "s", description: "schedule (this week, someday, a date…)", section: "Tasks" },
  { key: "r", action: "recurrence.repeat", context: "normal", displayKey: "r", description: "set repeat (in Recurring)", section: "Tasks" },
  { key: "Tab", action: "task.indent", context: "normal", displayKey: "tab", description: "indent (make subtask) · edit notes when the panel is open", section: "Tasks" },
  { key: "Shift+Tab", action: "task.outdent", context: "normal", displayKey: "⇧ tab", description: "outdent", section: "Tasks" },
  { key: "Alt+ArrowUp", action: "reorder.up", context: "normal", displayKey: "⌥ ↑", description: "move task up", section: "Tasks" },
  { key: "Alt+ArrowDown", action: "reorder.down", context: "normal", displayKey: "⌥ ↓", description: "move task down", section: "Tasks" },
  { key: "Backspace", action: "task.trash", context: "normal", displayKey: "⌫", description: "won’t do · press again to trash", section: "Tasks", noRepeat: true },
  { key: "w", action: "task.reason", context: "normal", displayKey: "w", description: "won’t do · edit the reason (why)", section: "Tasks" },
  { key: "p", action: "task.peek", context: "normal", displayKey: "p", description: "peek — unwrap the title + notes in place", section: "Tasks" },
  { key: "c", action: "task.current", context: "normal", displayKey: "c", description: "set / clear current (focus) task", section: "Tasks" },
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
  { key: "v", action: "board.toggle", context: "reckoning", displayKey: "v", description: "switch to the planning board", section: "The Reckoning" },

  // ── planning board (the reckoning's two-panel skin) ──────────────
  { key: "ArrowDown", action: "cursor.down", context: "board", displayKey: "↑ / ↓ / j / k", description: "move between leftovers", section: "Planning board" },
  { key: "j", action: "cursor.down", context: "board" },
  { key: "ArrowUp", action: "cursor.up", context: "board" },
  { key: "k", action: "cursor.up", context: "board" },
  { key: "ArrowRight", action: "board.pull", context: "board", displayKey: "→ / l / ↵", description: "pull into today", section: "Planning board" },
  { key: "l", action: "board.pull", context: "board" },
  { key: "Enter", action: "board.pull", context: "board" },
  { key: "s", action: "board.push", context: "board", displayKey: "s", description: "push to later (this week, next week…)", section: "Planning board" },
  { key: "e", action: "board.complete", context: "board", displayKey: "e", description: "mark it done", section: "Planning board" },
  { key: "b", action: "board.breakdown", context: "board", displayKey: "b", description: "break it down", section: "Planning board" },
  { key: "d", action: "board.drop", context: "board", displayKey: "d", description: "drop it", section: "Planning board", noRepeat: true },
  { key: "1", action: "board.estimate1", context: "board", displayKey: "1 – 8", description: "estimate: N blocks of ~20m", section: "Planning board" },
  { key: "2", action: "board.estimate2", context: "board" },
  { key: "3", action: "board.estimate3", context: "board" },
  { key: "4", action: "board.estimate4", context: "board" },
  { key: "5", action: "board.estimate5", context: "board" },
  { key: "6", action: "board.estimate6", context: "board" },
  { key: "7", action: "board.estimate7", context: "board" },
  { key: "8", action: "board.estimate8", context: "board" },
  { key: "0", action: "board.estimateClear", context: "board", displayKey: "0", description: "clear the estimate", section: "Planning board" },
  { key: "v", action: "board.toggle", context: "board", displayKey: "v", description: "back to the card review", section: "Planning board" },
];
