const NORMAL_HINTS: Array<[string, string]> = [
  ["j / k", "move"],
  ["↵", "edit"],
  ["→", "details"],
  ["space / ⌘↵", "done"],
  ["a / n", "new"],
  ["t", "plan"],
  ["⌘k", "more"],
  ["?", "help"],
];

const RECKONING_HINTS: Array<[string, string]> = [
  ["j / k", "select"],
  ["e", "done"],
  ["b", "break down"],
  ["s", "backlog"],
  ["d", "drop"],
  ["?", "help"],
];

export function StatusBar({ reckoning }: { reckoning: boolean }) {
  const hints = reckoning ? RECKONING_HINTS : NORMAL_HINTS;
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
