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
  ["e", "done"],
  ["b", "break down"],
  ["s", "postpone"],
  ["d", "drop"],
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
  ["⌫", "archive"],
  ["⌘k", "target · rest day · more"],
  ["?", "help"],
];

export function StatusBar({
  reckoning,
  shutdown,
  habits = false,
  shutdownHabits = false,
}: {
  reckoning: boolean;
  shutdown: boolean;
  habits?: boolean;
  /** Shutdown has reached its habit step. */
  shutdownHabits?: boolean;
}) {
  const hints = reckoning
    ? RECKONING_HINTS
    : shutdown
      ? shutdownHabits
        ? SHUTDOWN_HABIT_HINTS
        : SHUTDOWN_HINTS
      : habits
        ? HABITS_HINTS
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
