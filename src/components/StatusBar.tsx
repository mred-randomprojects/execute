const NORMAL_HINTS: Array<[string, string]> = [
  ["↑ / ↓", "move"],
  ["↵", "edit"],
  ["→", "details"],
  ["⌘↵", "done"],
  ["s", "start / stop"],
  ["n", "new"],
  ["⌘k", "everything else"],
  ["?", "help"],
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

const REVIEW_HINTS: Array<[string, string]> = [
  ["↑ / ↓", "move"],
  ["e", "done"],
  ["t", "today"],
  ["→", "tomorrow"],
  ["b", "break down"],
  ["s", "postpone"],
  ["w", "won’t do"],
  ["l", "later"],
  ["esc", "leave"],
];

const HABITS_HINTS: Array<[string, string]> = [
  ["↑ / ↓", "move"],
  ["← / →", "pick a day"],
  ["space", "check in"],
  ["c", "note"],
  ["↵", "rename"],
  ["n / k", "new habit / KPI"],
  ["⌫", "archive"],
  ["⌘k", "not today · rest day · more"],
  ["⌥↑↓", "reorder"],
  ["?", "help"],
];

export function StatusBar({
  review,
  habits = false,
  view,
}: {
  review: boolean;
  habits?: boolean;
  /** Only "projects" (the index, not a zoomed project) and "trash" change the hints. */
  view?: "projects" | "trash" | null;
}) {
  const hints = review
    ? REVIEW_HINTS
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
  // the way out or the way to the rest (? help, esc), so it is pinned right
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
