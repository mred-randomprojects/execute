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

// Trash has keys of its own: the outline's edit / details / done / new do nothing here.
const TRASH_HINTS: Array<[string, string]> = [
  ["↑ / ↓", "move"],
  ["↵", "restore"],
  ["⌫", "delete forever"],
  ["⌘z", "undo"],
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
  ["space", "check in"],
  ["↵", "rename"],
  ["n / k", "new habit / KPI"],
  ["⌫", "archive"],
  ["⌘k", "rest day · more"],
  ["⌥↑↓", "reorder"],
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
  // One line, always. On a narrow window the hints that don't fit wrap onto a
  // second line that is clipped away, instead of growing the bar into the list
  // (Habits' nine took two lines at the default window size). The last hint is
  // the way out or the way to the rest (? help, esc, v), so it is pinned right
  // and never the one that goes.
  const rest = hints.slice(0, -1);
  const last = hints[hints.length - 1];
  return (
    <div className="flex items-start gap-4 border-t border-line bg-surface px-5 py-2">
      <div className="flex h-5 min-w-0 flex-1 flex-wrap content-start items-center gap-x-4 gap-y-2 overflow-hidden">
        {rest.map((hint) => (
          <Hint key={hint[1]} hint={hint} />
        ))}
      </div>
      {last != null && <Hint hint={last} />}
    </div>
  );
}

function Hint({ hint: [keys, label] }: { hint: [string, string] }) {
  return (
    <span className="flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] text-ink-faint">
      <span className="kbd">{keys}</span>
      {label}
    </span>
  );
}
