import type { KeyBinding } from "./types";

// Declarative bindings. Each row maps a combo + context to an action id; the
// App wires action ids → handlers. Rows with a `description` show up in the `?`
// help overlay automatically. Inline capture keys (Enter/Tab/Up/Down inside a
// row's input) are handled locally by the input and documented in the help
// overlay's static "Editing" section.
//
// ── The bare-letter rule ────────────────────────────────────────────
// A bare letter is only allowed where it CANNOT fire by accident: inside a
// screen that owns the whole view (the task review, the Habits view) and
// prints the letter on the action chip you're looking at. In the
// outline — where you're browsing, and a stray keypress lands on a real task —
// bare letters are reserved for things that don't mutate anything: `n` (new),
// `p` (peek), the view digits, and the period brackets. Everything else goes
// through ⌘k, which is searchable, undoable-by-name and impossible to hit by
// accident. That is why there is no `t`, `w`, `b`, `c`, `h`, `g`, `e`, `r`,
// `q` or `m` here: each one mutated a task or swallowed the keyboard on a
// single unmodified keypress.
//
// The one exception is `s` (since v23): start / stop work on the focused task.
// It used to be schedule, which rewrote a date you might not notice; this
// changes nothing about the task you'd have to find again — it lights a banner
// at the top, a ▶ on the row and a clock in the sidebar the moment it lands,
// a second `s` stops it, and ⌘z takes it back. Asked for by name (2026-10-15):
// a timer has to cost one keystroke or it doesn't get started.

export const keymap: KeyBinding[] = [
  // ── global ────────────────────────────────────────────────────────
  { key: "Escape", action: "dismiss", context: "global", displayKey: "esc", description: "close / cancel", section: "General" },
  { key: "Meta+z", action: "undo", context: "global", displayKey: "⌘ z", description: "undo", section: "General" },
  { key: "Meta+Z", action: "redo", context: "global", displayKey: "⌘ ⇧ z", description: "redo", section: "General" },
  { key: "Meta+y", action: "history.toggle", context: ["normal", "habits", "trash", "review"], displayKey: "⌘ y", description: "history — everything you just did", section: "General" },
  { key: "?", action: "help.toggle", context: ["normal", "habits", "trash", "review"], displayKey: "?", description: "keyboard help", section: "General" },
  { key: "Meta+k", action: "palette.open", context: ["normal", "habits", "trash", "review", "editing"], displayKey: "⌘ k", description: "command palette — everything lives here", section: "General" },
  { key: "Meta+f", action: "filter.open", context: ["normal", "habits", "trash", "editing"], displayKey: "⌘ f", description: "filter this view — only the tasks that match (↵ / ↓ into the list, esc clears)", section: "General" },
  { key: "Meta+F", action: "search.open", context: ["normal", "habits", "trash", "editing"], displayKey: "⌘ ⇧ f", description: "find — search all tasks (subsequence: “byml” → “Buy milk”)", section: "General" },

  // ── history panel ─────────────────────────────────────────────────
  { key: "ArrowDown", action: "history.down", context: "history", displayKey: "↑ / ↓", description: "walk the history", section: "History" },
  { key: "ArrowUp", action: "history.up", context: "history" },
  { key: "Enter", action: "history.jump", context: "history", displayKey: "↵", description: "rewind to just before this action (or replay it)", section: "History" },
  { key: "Meta+y", action: "dismiss", context: "history" },

  // ── views ─────────────────────────────────────────────────────────
  { key: "1", action: "view.today", context: ["normal", "habits", "trash"], displayKey: "1", description: "go to Today", section: "Views" },
  { key: "2", action: "view.backlog", context: ["normal", "habits", "trash"], displayKey: "2", description: "go to Backlog", section: "Views" },
  { key: "3", action: "view.all", context: ["normal", "habits", "trash"], displayKey: "3", description: "go to All", section: "Views" },
  { key: "4", action: "view.projects", context: ["normal", "habits", "trash"], displayKey: "4", description: "go to Projects", section: "Views" },
  { key: "5", action: "view.recurring", context: ["normal", "habits", "trash"], displayKey: "5", description: "go to Recurring", section: "Views" },
  { key: "6", action: "view.habits", context: ["normal", "habits", "trash"], displayKey: "6", description: "go to Habits & KPIs", section: "Views" },
  { key: "7", action: "view.trash", context: ["normal", "habits", "trash"], displayKey: "7", description: "go to Trash", section: "Views" },
  { key: "]", action: "period.next", context: ["normal", "habits", "trash"], displayKey: "[ / ]", description: "period tab: earlier / later (Today ↔ Tomorrow ↔ …)", section: "Views" },
  { key: "[", action: "period.prev", context: ["normal", "habits", "trash"] },

  // ── navigation (normal) ───────────────────────────────────────────
  { key: "ArrowDown", action: "cursor.down", context: "normal", displayKey: "↓", description: "move down", section: "Navigation" },
  { key: "ArrowUp", action: "cursor.up", context: "normal", displayKey: "↑", description: "move up", section: "Navigation" },
  { key: "Shift+ArrowDown", action: "select.down", context: "normal", displayKey: "⇧ ↓", description: "extend selection down", section: "Navigation" },
  { key: "Shift+ArrowUp", action: "select.up", context: "normal", displayKey: "⇧ ↑", description: "extend selection up", section: "Navigation" },
  { key: "Meta+a", action: "select.all", context: "normal", displayKey: "⌘ a", description: "select every task in this project — press again for every project", section: "Navigation" },
  { key: "Meta+ArrowUp", action: "cursor.first", context: "normal", displayKey: "⌘ ↑", description: "jump to first item", section: "Navigation" },
  { key: "Meta+ArrowDown", action: "cursor.last", context: "normal", displayKey: "⌘ ↓", description: "jump to last item", section: "Navigation" },
  { key: "ArrowRight", action: "panel.open", context: "normal", displayKey: "→", description: "expand · descend · edit details", section: "Navigation" },
  { key: "ArrowLeft", action: "panel.back", context: "normal", displayKey: "←", description: "collapse · out to parent · close panel", section: "Navigation" },

  // ── actions (normal) ──────────────────────────────────────────────
  // Bare keys here are non-mutating by design — see the rule at the top.
  { key: "Enter", action: "edit.start", context: "normal", displayKey: "↵", description: "edit task title", section: "Tasks" },
  { key: "n", action: "task.new", context: "normal", displayKey: "n", description: "new task below", section: "Tasks" },
  { key: "/", action: "capture.focus", context: "normal" },
  { key: "Meta+Enter", action: "task.toggle", context: ["normal", "editing"], displayKey: "⌘ ↵", description: "complete / uncomplete", section: "Tasks" },
  { key: "Tab", action: "task.indent", context: "normal", displayKey: "tab", description: "indent (make subtask) · edit notes when the panel is open", section: "Tasks" },
  { key: "Shift+Tab", action: "task.outdent", context: "normal", displayKey: "⇧ tab", description: "outdent", section: "Tasks" },
  { key: "Alt+ArrowUp", action: "reorder.up", context: "normal", displayKey: "⌥ ↑", description: "move task up", section: "Tasks" },
  { key: "Alt+ArrowDown", action: "reorder.down", context: "normal", displayKey: "⌥ ↓", description: "move task down", section: "Tasks" },
  { key: "Backspace", action: "task.trash", context: "normal", displayKey: "⌫", description: "won’t do · press again to trash", section: "Tasks", noRepeat: true },
  { key: "s", action: "task.work", context: "normal", displayKey: "s", description: "start working on it — in progress, timer on · again: stop · paused: resume", section: "Tasks", noRepeat: true },
  { key: "p", action: "task.peek", context: "normal", displayKey: "p", description: "peek — unwrap the title + notes in place", section: "Tasks" },
  { key: "Alt+Enter", action: "zoom.in", context: "normal", displayKey: "⌥ ↵", description: "zoom in / focus (esc backs out)", section: "Tasks" },

  // ── habits (its own view, its own keys) ──────────────────────────
  // Space is the one mutating bare key, and the reason this view has a context
  // of its own: a check-in has to cost one keystroke or it stops happening. It
  // can't land on a task — there are none here — and ⌘z takes it back.
  { key: "ArrowDown", action: "habits.down", context: "habits", displayKey: "↑ / ↓", description: "next / previous habit", section: "Habits" },
  { key: "ArrowUp", action: "habits.up", context: "habits" },
  { key: "Alt+ArrowUp", action: "habits.moveUp", context: "habits", displayKey: "⌥ ↑ / ⌥ ↓", description: "move it up / down its list", section: "Habits" },
  { key: "Alt+ArrowDown", action: "habits.moveDown", context: "habits" },
  { key: "ArrowLeft", action: "habits.dayPrev", context: "habits", displayKey: "← / →", description: "pick a day (the last two weeks)", section: "Habits" },
  { key: "ArrowRight", action: "habits.dayNext", context: "habits" },
  { key: " ", action: "habits.toggle", context: "habits", displayKey: "space", description: "check in / undo, on the picked day · on a KPI, log its number", section: "Habits" },
  { key: "Meta+Enter", action: "habits.toggle", context: "habits" },
  { key: "c", action: "habits.note", context: "habits", displayKey: "c", description: "note on the picked day — “Steamed broccoli!” · ↵ saves, emptied clears it", section: "Habits" },
  { key: "Enter", action: "habits.rename", context: "habits", displayKey: "↵", description: "rename · tab moves on to the cue", section: "Habits" },
  { key: "n", action: "habits.new", context: "habits", displayKey: "n", description: "new habit", section: "Habits" },
  { key: "k", action: "habits.newKpi", context: "habits", displayKey: "k", description: "new KPI — a number to log (“Dizzy spells 0-3+”, “DHI 0-100 monthly”)", section: "Habits" },
  { key: "Backspace", action: "habits.archive", context: "habits", displayKey: "⌫", description: "archive · on an archived habit, delete it", section: "Habits", noRepeat: true },

  // ── trash (deleted tasks, kept until you restore or delete them) ─
  // No letters: Trash is browsed like the outline. ↵ is the constructive key
  // (and ⌘z takes it back); ⌫ only asks — deleting forever needs a second ↵.
  { key: "ArrowDown", action: "trash.down", context: "trash", displayKey: "↑ / ↓", description: "next / previous deleted task", section: "Trash" },
  { key: "ArrowUp", action: "trash.up", context: "trash" },
  { key: "Meta+ArrowUp", action: "trash.first", context: "trash", displayKey: "⌘ ↑ / ⌘ ↓", description: "jump to the newest / oldest", section: "Trash" },
  { key: "Meta+ArrowDown", action: "trash.last", context: "trash" },
  { key: "Enter", action: "trash.restore", context: "trash", displayKey: "↵", description: "restore it to the outline", section: "Trash" },
  { key: "Backspace", action: "trash.purge", context: "trash", displayKey: "⌫", description: "delete it forever (asks first)", section: "Trash", noRepeat: true },

  // ── task review ───────────────────────────────────────────────────
  // It owns the screen while open and prints each letter on its chip.
  { key: "ArrowDown", action: "cursor.down", context: "review", displayKey: "↑ / ↓", description: "next / previous — overdue, today, then the week", section: "Task review" },
  { key: "ArrowUp", action: "cursor.up", context: "review" },
  { key: "e", action: "review.complete", context: "review", displayKey: "e", description: "mark it done", section: "Task review" },
  { key: "t", action: "review.today", context: "review", displayKey: "t", description: "today — keep an overdue one, take on a week one", section: "Task review" },
  { key: "ArrowRight", action: "review.tomorrow", context: "review", displayKey: "→", description: "tomorrow", section: "Task review" },
  { key: "b", action: "review.breakdown", context: "review", displayKey: "b", description: "break it into something you'd actually do today", section: "Task review" },
  { key: "s", action: "review.postpone", context: "review", displayKey: "s", description: "postpone — name the day", section: "Task review" },
  { key: "w", action: "review.wontDo", context: "review", displayKey: "w", description: "won’t do — a decision, not a failure", section: "Task review" },
  { key: "d", action: "review.drop", context: "review", displayKey: "d", description: "drop it", section: "Task review", noRepeat: true },
  { key: "l", action: "review.later", context: "review", displayKey: "l", description: "later — set it aside for this pass (nothing counted)", section: "Task review" },
  { key: "/", action: "review.reason", context: "review", displayKey: "/", description: "add why (optional) to the choice you make next", section: "Task review" },
];
