import { useEffect, useMemo, useRef, useState } from "react";
import type { ISODate } from "../types";
import { whenOptions } from "../store/when";
import type { ScheduleChoice } from "../store/when";
import { NO_SPELLCHECK } from "../ui/noSpellcheck";

export type { ScheduleChoice };

/**
 * The schedule picker: a search field over the "when" engine. You type what you
 * mean — "next week", "friday", "aug 20", "in 3 days", "12/25" — and the
 * matching rungs and concrete dates come back ranked, most specific first. No
 * mnemonic letters to remember: typing *is* the shortcut, and an empty query is
 * still the plain ladder, so `s ↵` remains a two-key path to Today.
 */
export function SchedulePicker({
  today,
  count,
  current,
  onPick,
  onClose,
}: {
  today: ISODate;
  count: number;
  /** The task's present rung, dotted in the list. Null for a concrete date. */
  current: string | null;
  onPick: (choice: ScheduleChoice) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selRef = useRef<HTMLButtonElement>(null);

  const opts = useMemo(() => whenOptions(query, today), [query, today]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Typing re-ranks the list under the cursor; land back on the best match.
  useEffect(() => {
    setSel(0);
  }, [query]);

  useEffect(() => {
    selRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [sel, opts.length]);

  const pick = (choice: ScheduleChoice) => {
    onClose();
    onPick(choice);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-8 pt-[16vh] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Schedule"
        className="w-full max-w-sm overflow-hidden rounded border border-line bg-surface shadow-lg outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mono flex items-center justify-between border-b border-line px-4 py-2.5 text-[11px] uppercase tracking-[0.14em] text-ink-faint">
          <span>Schedule{count > 1 ? ` · ${count} tasks` : ""}</span>
        </div>

        <input
          {...NO_SPELLCHECK}
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, opts.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const chosen = opts[sel];
              if (chosen != null) pick(chosen.choice);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder="When? next week · friday · aug 20 · in 3 days"
          aria-label="When"
          className="w-full border-b border-line bg-transparent px-4 py-2.5 text-[14px] text-ink outline-none placeholder:text-ink-faint"
        />

        {/* Tall enough that the whole ladder fits unscrolled; longer date lists scroll. */}
        <div role="listbox" aria-label="Schedule options" className="max-h-80 overflow-auto py-1">
          {opts.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-ink-faint">
              Nothing matches “{query.trim()}”
            </div>
          ) : (
            opts.map((o, i) => (
              <button
                key={o.key}
                ref={i === sel ? selRef : null}
                role="option"
                aria-selected={i === sel}
                onMouseMove={() => setSel(i)}
                onClick={() => pick(o.choice)}
                className={[
                  "flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-[14px]",
                  i === sel ? "bg-surface-2 text-ink" : "text-ink-soft",
                ].join(" ")}
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate">{o.label}</span>
                  {current === o.key && <span className="text-[11px] text-accent">●</span>}
                </span>
                {o.sub != null && (
                  <span className="mono shrink-0 text-[11px] text-ink-faint">{o.sub}</span>
                )}
              </button>
            ))
          )}
        </div>

        <div className="border-t border-line px-4 py-1.5 text-[11px] text-ink-faint">
          Type a day or a date · ↑↓ to choose · ↵ to schedule
        </div>
      </div>
    </div>
  );
}
