/**
 * A labelled verb with its keycap — the vocabulary of every ritual surface (the
 * Reckoning's cards, the planning board, the evening shutdown). Each chip states
 * the key that does the same thing, so the mouse path teaches the keyboard one.
 *
 * Lived as an identical copy in two views before the shutdown ritual needed a
 * third.
 */
export type ChipTone = "good" | "accent" | "soft" | "bad" | "today";

const TONES: Record<ChipTone, string> = {
  good: "border-good/40 text-good hover:bg-good-soft",
  accent: "border-accent/40 text-accent hover:bg-accent-soft",
  soft: "border-line-strong text-ink-soft hover:bg-surface-2",
  bad: "border-bad/40 text-bad hover:bg-bad-soft",
  today: "border-accent/40 text-accent hover:bg-accent-soft",
};

export function ActionChip({
  label,
  hint,
  tone,
  onClick,
}: {
  label: string;
  hint: string;
  tone: ChipTone;
  onClick: () => void;
}) {
  return (
    <button
      tabIndex={-1}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        e.currentTarget.blur();
        onClick();
      }}
      className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[12px] font-medium transition-colors ${TONES[tone]}`}
    >
      {label}
      <span className="kbd">{hint}</span>
    </button>
  );
}
