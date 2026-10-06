import { useEffect } from "react";
import type { RefObject } from "react";
import { NO_SPELLCHECK } from "../ui/noSpellcheck";

/**
 * The view filter's field (⌘f), pinned above the current view. Typing narrows
 * the view live; ↵ or ↓ hands the keyboard to the list with the filter still
 * on; esc clears it and closes the bar. While the field has focus it owns
 * every key except ⌘k, so the outline's shortcuts stay dormant beneath it.
 */
export function FilterBar({
  inputRef,
  query,
  matches,
  onChange,
  onLeave,
  onClose,
}: {
  inputRef: RefObject<HTMLInputElement>;
  query: string;
  /** How many rows survive the filter, or null while the query is blank. */
  matches: number | null;
  onChange: (query: string) => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    inputRef.current?.focus();
  }, [inputRef]);

  return (
    <div className="mx-auto w-full page-width shrink-0 px-10 pt-9">
      <div className="flex items-center gap-2.5 rounded border border-line bg-surface px-3 py-1.5 focus-within:border-accent/60">
        <span aria-hidden="true" className="text-[13px] text-ink-faint">
          ⌕
        </span>
        <input
          {...NO_SPELLCHECK}
          ref={inputRef}
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            const key = e.key.toLowerCase();
            // ⌘k and ⌘⇧f still reach the app: the palette, the all-tasks finder.
            if (e.metaKey && (key === "k" || (key === "f" && e.shiftKey))) return;
            e.stopPropagation();
            if (e.metaKey && key === "f") {
              e.preventDefault();
              e.currentTarget.select();
            } else if (e.key === "Enter" || e.key === "ArrowDown") {
              e.preventDefault();
              onLeave();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder="Filter this view…"
          aria-label="Filter this view"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-faint"
        />
        {matches != null && (
          <span className="mono shrink-0 text-[11px] text-ink-faint">
            {matches === 0 ? "no matches" : `${matches} shown`}
          </span>
        )}
        <button
          type="button"
          tabIndex={-1}
          onClick={onClose}
          title="Clear the filter (esc)"
          className="shrink-0 text-[13px] leading-none text-ink-faint hover:text-ink"
        >
          ×
        </button>
      </div>
    </div>
  );
}
