import type { KeyBinding } from "./types";

// Declarative bindings. Each row maps a combo + context to an action id; the
// App wires action ids → handlers. Rows with a `description` show up in the `?`
// help overlay automatically. Inline capture keys (Enter/Tab/Up/Down inside a
// row's input) are handled locally by the input and documented in the help
// overlay's static "Editing" section.
//
// ── The bare-letter rule ────────────────────────────────────────────
// A bare letter is only allowed where it CANNOT fire by accident: inside a
// modal ritual (the Reckoning, Shutdown, Plan, the board) that owns the whole
// screen and prints the letter on the action chip you're looking at. In the
// outline — where you're browsing, and a stray keypress lands on a real task —
// bare letters are reserved for things that don't mutate anything: `n` (new),
// `p` (peek), the view digits, and the period brackets. Everything else goes
// through ⌘k, which is searchable, undoable-by-name and impossible to hit by
// accident. That is why there is no `t`, `w`, `b`, `c`, `h`, `g`, `s`, `e`,
// `r`, `q` or `m` here: each one mutated a task or swallowed the keyboard on a
// single unmodified keypress.

export const keymap: KeyBinding[] = [
  // ── global ────────────────────────────────────────────────────────
  { key: "Escape", action: "dismiss", context: "global", displayKey: "esc", description: "close / cancel", section: "General" },
  { key: "Meta+z", action: "undo", context: "global", displayKey: "⌘ z", description: "undo", section: "General" },
  { key: "Meta+Z", action: "redo", context: "global", displayKey: "⌘ ⇧ z", description: "redo", section: "General" },
  { key: "Meta+y", action: "history.toggle", context: ["normal", "habits", "reckoning", "board"], displayKey: "⌘ y", description: "history — everything you just did", section: "General" },
  { key: "?", action: "help.toggle", context: ["normal", "habits", "reckoning", "board"], displayKey: "?", description: "keyboard help", section: "General" },
  { key: "Meta+k", action: "palette.open", context: ["normal", "habits", "reckoning", "board", "editing"], displayKey: "⌘ k", description: "command palette — everything lives here", section: "General" },
  { key: "Meta+f", action: "search.open", context: ["normal", "habits", "editing"], displayKey: "⌘ f", description: "find — search all tasks (subsequence: “byml” → “Buy milk”)", section: "General" },

  // ── history panel ─────────────────────────────────────────────────
  { key: "ArrowDown", action: "history.down", context: "history", displayKey: "↑ / ↓", description: "walk the history", section: "History" },
  { key: "ArrowUp", action: "history.up", context: "history" },
  { key: "Enter", action: "history.jump", context: "history", displayKey: "↵", description: "rewind to just before this action (or replay it)", section: "History" },
  { key: "Meta+y", action: "dismiss", context: "history" },

  // ── views ─────────────────────────────────────────────────────────
  { key: "1", action: "view.today", context: ["normal", "habits"], displayKey: "1", description: "go to Today", section: "Views" },
  { key: "2", action: "view.backlog", context: ["normal", "habits"], displayKey: "2", description: "go to Backlog", section: "Views" },
  { key: "3", action: "view.all", context: ["normal", "habits"], displayKey: "3", description: "go to All", section: "Views" },
  { key: "4", action: "view.projects", context: ["normal", "habits"], displayKey: "4", description: "go to Projects", section: "Views" },
  { key: "5", action: "view.recurring", context: ["normal", "habits"], displayKey: "5", description: "go to Recurring", section: "Views" },
  { key: "6", action: "view.habits", context: ["normal", "habits"], displayKey: "6", description: "go to Habits", section: "Views" },
  { key: "7", action: "view.trash", context: ["normal", "habits"], displayKey: "7", description: "go to Trash", section: "Views" },
  { key: "]", action: "period.next", context: ["normal", "habits"], displayKey: "[ / ]", description: "period tab: earlier / later (Today ↔ Tomorrow ↔ …)", section: "Views" },
  { key: "[", action: "period.prev", context: ["normal", "habits"] },

  // ── navigation (normal) ───────────────────────────────────────────
  { key: "ArrowDown", action: "cursor.down", context: "normal", displayKey: "↓", description: "move down", section: "Navigation" },
  { key: "ArrowUp", action: "cursor.up", context: "normal", displayKey: "↑", description: "move up", section: "Navigation" },
  { key: "Shift+ArrowDown", action: "select.down", context: "normal", displayKey: "⇧ ↓", description: "extend selection down", section: "Navigation" },
  { key: "Shift+ArrowUp", action: "select.up", context: "normal", displayKey: "⇧ ↑", description: "extend selection up", section: "Navigation" },
  { key: "Meta+a", action: "select.all", context: "normal", displayKey: "⌘ a", description: "select every task in this project — press again for every project", section: "Navigation" },
  { key: "Meta+ArrowUp", action: "cursor.first", context: "normal", displayKey: "⌘ ↑", description: "jump to first item", section: "Navigation" },
  { key: "Meta+ArrowDown", action: "cursor.last", context: "normal", displayKey: "⌘ ↓", description: "jump to last item", section: "Navigation" },
  { key: "ArrowRight", action: "panel.open", context: "normal", displayKey: "→", description: "expand · descend · details panel", section: "Navigation" },
  { key: "ArrowLeft", action: "panel.back", context: "normal", displayKey: "←", description: "collapse · out to parent · close panel", section: "Navigation" },

  // ── actions (normal) ──────────────────────────────────────────────
  // Bare keys here are non-mutating by design — see the rule at the top.
  { key: "Enter", action: "edit.start", context: "normal", displayKey: "↵", description: "edit task title", section: "Tasks" },
  { key: "n", action: "task.new", context: "normal", displayKey: "n", description: "new task below", section: "Tasks" },
  { key: "/", action: "capture.focus", context: ["normal", "reckoning", "board"] },
  { key: "Meta+Enter", action: "task.toggle", context: ["normal", "editing"], displayKey: "⌘ ↵", description: "complete / uncomplete", section: "Tasks" },
  { key: "Tab", action: "task.indent", context: "normal", displayKey: "tab", description: "indent (make subtask) · edit notes when the panel is open", section: "Tasks" },
  { key: "Shift+Tab", action: "task.outdent", context: "normal", displayKey: "⇧ tab", description: "outdent", section: "Tasks" },
  { key: "Alt+ArrowUp", action: "reorder.up", context: "normal", displayKey: "⌥ ↑", description: "move task up", section: "Tasks" },
  { key: "Alt+ArrowDown", action: "reorder.down", context: "normal", displayKey: "⌥ ↓", description: "move task down", section: "Tasks" },
  { key: "Backspace", action: "task.trash", context: "normal", displayKey: "⌫", description: "won’t do · press again to trash", section: "Tasks", noRepeat: true },
  { key: "p", action: "task.peek", context: "normal", displayKey: "p", description: "peek — unwrap the title + notes in place", section: "Tasks" },
  { key: "Alt+Enter", action: "zoom.in", context: "normal", displayKey: "⌥ ↵", description: "zoom in / focus (esc backs out)", section: "Tasks" },

  // ── habits (its own view, its own keys) ──────────────────────────
  // Space is the one mutating bare key, and the reason this view has a context
  // of its own: a check-in has to cost one keystroke or it stops happening. It
  // can't land on a task — there are none here — and ⌘z takes it back.
  { key: "ArrowDown", action: "habits.down", context: "habits", displayKey: "↑ / ↓", description: "next / previous habit", section: "Habits" },
  { key: "ArrowUp", action: "habits.up", context: "habits" },
  { key: "ArrowLeft", action: "habits.dayPrev", context: "habits", displayKey: "← / →", description: "pick a day (the last two weeks)", section: "Habits" },
  { key: "ArrowRight", action: "habits.dayNext", context: "habits" },
  { key: " ", action: "habits.toggle", context: "habits", displayKey: "space", description: "check in / undo, on the picked day", section: "Habits" },
  { key: "Meta+Enter", action: "habits.toggle", context: "habits" },
  { key: "Enter", action: "habits.rename", context: "habits", displayKey: "↵", description: "rename · tab moves on to the cue", section: "Habits" },
  { key: "n", action: "habits.new", context: "habits", displayKey: "n", description: "new habit", section: "Habits" },
  { key: "Backspace", action: "habits.archive", context: "habits", displayKey: "⌫", description: "archive · on an archived habit, delete it", section: "Habits", noRepeat: true },

  // ── plan (the morning ritual; shutdown's other half) ─────────────
  // Modal: it owns the screen and prints these letters on its chips.
  { key: "ArrowDown", action: "cursor.down", context: "plan", displayKey: "↑ / ↓", description: "next / previous", section: "Plan" },
  { key: "ArrowUp", action: "cursor.up", context: "plan" },
  { key: "t", action: "plan.accept", context: "plan", displayKey: "t / ↵", description: "take it on today", section: "Plan" },
  { key: "Enter", action: "plan.accept", context: "plan" },
  { key: "s", action: "plan.push", context: "plan", displayKey: "s", description: "not today — pick another day", section: "Plan" },

  // ── shutdown (the evening ritual) ─────────────────────────────────
  { key: "ArrowDown", action: "cursor.down", context: "shutdown", displayKey: "↑ / ↓", description: "next / previous task", section: "Shutdown" },
  { key: "ArrowUp", action: "cursor.up", context: "shutdown" },
  { key: "e", action: "shut.complete", context: "shutdown", displayKey: "e", description: "mark it done", section: "Shutdown" },
  { key: "t", action: "shut.carry", context: "shutdown", displayKey: "t", description: "carry it to tomorrow", section: "Shutdown" },
  { key: "b", action: "shut.breakdown", context: "shutdown", displayKey: "b", description: "break it into something you'd actually do tomorrow", section: "Shutdown" },
  { key: "s", action: "shut.postpone", context: "shutdown", displayKey: "s", description: "postpone — name the day", section: "Shutdown" },
  { key: "w", action: "shut.wontDo", context: "shutdown", displayKey: "w", description: "won’t do — a decision, not a failure", section: "Shutdown" },
  { key: "d", action: "shut.drop", context: "shutdown", displayKey: "d", description: "drop it", section: "Shutdown", noRepeat: true },
  { key: "y", action: "shut.habitDone", context: "shutdown", displayKey: "y / r / x", description: "habits (once the tasks are settled): did it · rest day · not today", section: "Shutdown" },
  { key: "r", action: "shut.habitRest", context: "shutdown" },
  { key: "x", action: "shut.habitNo", context: "shutdown" },
  { key: "T", action: "shut.carryAll", context: "shutdown", displayKey: "⇧ t", description: "carry everything left to tomorrow", section: "Shutdown" },

  // ── reckoning gate ────────────────────────────────────────────────
  { key: "ArrowDown", action: "cursor.down", context: "reckoning", displayKey: "↑ / ↓", description: "next / previous task", section: "The Reckoning" },
  { key: "ArrowUp", action: "cursor.up", context: "reckoning" },
  { key: "ArrowRight", action: "reck.nextCard", context: "reckoning", displayKey: "← / →", description: "previous / next group", section: "The Reckoning" },
  { key: "ArrowLeft", action: "reck.prevCard", context: "reckoning" },
  { key: "e", action: "reck.complete", context: "reckoning", displayKey: "e", description: "mark it done", section: "The Reckoning" },
  { key: "t", action: "reck.keep", context: "reckoning", displayKey: "t", description: "keep it for today", section: "The Reckoning" },
  { key: "b", action: "reck.breakdown", context: "reckoning", displayKey: "b", description: "break it down", section: "The Reckoning" },
  { key: "s", action: "reck.postpone", context: "reckoning", displayKey: "s", description: "postpone — name the day you'll do it", section: "The Reckoning" },
  { key: "d", action: "reck.drop", context: "reckoning", displayKey: "d", description: "drop it", section: "The Reckoning" },
  { key: "S", action: "reck.postponeAll", context: "reckoning", displayKey: "⇧ s", description: "postpone the whole group", section: "The Reckoning" },
  { key: "D", action: "reck.dropAll", context: "reckoning", displayKey: "⇧ d", description: "drop the whole group", section: "The Reckoning" },
  { key: "v", action: "board.toggle", context: "reckoning", displayKey: "v", description: "switch to the planning board", section: "The Reckoning" },

  // ── planning board (the reckoning's two-panel skin) ──────────────
  { key: "ArrowDown", action: "board.cursorDown", context: "board", displayKey: "↑ / ↓", description: "move within a column", section: "Planning board" },
  { key: "ArrowUp", action: "board.cursorUp", context: "board" },
  { key: "Tab", action: "board.switchColumn", context: "board", displayKey: "tab", description: "switch column (leftovers ↔ today)", section: "Planning board" },
  { key: "Shift+Tab", action: "board.switchColumn", context: "board" },
  { key: "ArrowRight", action: "board.pull", context: "board", displayKey: "→ / ↵", description: "pull a leftover into today", section: "Planning board" },
  { key: "Enter", action: "board.pull", context: "board" },
  { key: "ArrowLeft", action: "board.sendBack", context: "board", displayKey: "←", description: "send a today task back to leftovers", section: "Planning board" },
  { key: "s", action: "board.push", context: "board", displayKey: "s", description: "postpone — name the day you'll do it", section: "Planning board" },
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
