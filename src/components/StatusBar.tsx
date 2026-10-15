const NORMAL_HINTS: Array<[string, string]> = [
  ["↑ / ↓", "move"],
  ["↵", "edit"],
  ["→", "details"],
  ["⌘↵", "done"],
  ["n", "new"],
  ["⌘k", "everything else"],
  ["?", "help"],
];

const RECKONING_HINTS: Array<[string, string]> = [
  ["↑ / ↓", "select"],
  ["← / →", "group"],
  ["e", "done"],
  ["t", "keep"],
  ["b", "break down"],
  ["s", "postpone"],
  ["d", "drop"],
  ["v", "board"],
  ["?", "help"],
];

// The board is the reckoning's other skin, with its own keys: showing the
// cards' hints here sent ← / → / tab / 1–8 to a footer inside the board, and
// left this bar naming keys the board doesn't lead with.
const BOARD_HINTS: Array<[string, string]> = [
  ["→", "to today"],
  ["←", "back"],
  ["tab", "switch column"],
  ["e", "done"],
  ["b", "break down"],
  ["s", "postpone"],
  ["d", "drop"],
  ["1 – 8", "estimate"],
  ["v", "cards"],
];

const PROJECTS_HINTS: Array<[string, string]> = [
  ["↑ / ↓", "move"],
  ["→", "open"],
  ["↵", "rename"],
  ["n", "new project"],
  ["⌘k", "everything else"],
  ["?", "help"],
];

// Trash is mouse-driven: the outline's edit / details / done / new do nothing here.
const TRASH_HINTS: Array<[string, string]> = [
  ["⌘z", "undo"],
  ["1 – 7", "views"],
  ["?", "help"],
];

const SHUTDOWN_HINTS: Array<[string, string]> = [
  ["↑ / ↓", "select"],
  ["e", "done"],
  ["l", "later today"],
  ["t", "tomorrow"],
  ["b", "break down"],
  ["s", "postpone"],
  ["w", "won’t do"],
  ["esc", "leave"],
];

const SHUTDOWN_HABIT_HINTS: Array<[string, string]> = [
  ["↑ / ↓", "select"],
  ["y", "did it"],
  ["l", "later today"],
  ["r", "rest day"],
  ["x", "not today"],
  ["esc", "leave"],
];

const HABITS_HINTS: Array<[string, string]> = [
  ["↑ / ↓", "move"],
  ["← / →", "pick a day"],
  ["space", "check in · log"],
  ["↵", "rename · tab cue"],
  ["n / k", "new habit / KPI"],
  ["⌥↑↓", "reorder"],
  ["⌫", "archive"],
  ["⌘k", "target · rest day · more"],
  ["?", "help"],
];

export function StatusBar({
  reckoning,
  board = false,
  shutdown,
  habits = false,
  view,
  shutdownHabits = false,
}: {
  reckoning: boolean;
  /** The reckoning is showing as the planning board. */
  board?: boolean;
  shutdown: boolean;
  habits?: boolean;
  /** Only "projects" (the index, not a zoomed project) and "trash" change the hints. */
  view?: "projects" | "trash" | null;
  /** Shutdown has reached its habit step. */
  shutdownHabits?: boolean;
}) {
  const hints = reckoning
    ? board
      ? BOARD_HINTS
      : RECKONING_HINTS
    : shutdown
      ? shutdownHabits
        ? SHUTDOWN_HABIT_HINTS
        : SHUTDOWN_HINTS
      : habits
        ? HABITS_HINTS
        : view === "projects"
          ? PROJECTS_HINTS
          : view === "trash"
            ? TRASH_HINTS
            : NORMAL_HINTS;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-surface px-5 py-2">
      {hints.map(([keys, label]) => (
        <span key={label} className="flex items-center gap-1.5 text-[11px] text-ink-faint">
          <span className="kbd">{keys}</span>
          {label}
        </span>
      ))}
    </div>
  );
}
