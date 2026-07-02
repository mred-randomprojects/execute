import type { Task } from "../types";
import { renderInline } from "../ui/markdown";

/** A prominent "right now" card naming the single task the user is focusing on. */
export function CurrentBanner({
  task,
  onFocus,
  onClear,
}: {
  task: Task;
  onFocus: () => void;
  onClear: () => void;
}) {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-md border border-accent/30 bg-accent-soft/50 px-4 py-3">
      <span
        className="mt-[2px] grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-accent text-bg"
        aria-hidden
      >
        <svg viewBox="0 0 16 16" width="15" height="15">
          <circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="8" cy="8" r="1.9" fill="currentColor" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <div className="eyebrow text-accent">Right now</div>
        <button
          type="button"
          onClick={onFocus}
          className="block text-left font-serif text-[20px] font-medium leading-snug tracking-tight text-ink"
          title="Jump to this task"
        >
          {task.text.trim() === "" ? "Untitled" : renderInline(task.text)}
        </button>
      </div>
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear current task"
        title="Release (c)"
        className="mt-[2px] grid h-7 w-7 shrink-0 place-items-center rounded-sm text-[18px] leading-none text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
      >
        ×
      </button>
    </div>
  );
}
