import { useEffect, useMemo, useRef, useState } from "react";
import { NO_SPELLCHECK } from "../ui/noSpellcheck";
import type { CommandUsage } from "../types";
import { frecencyScore } from "../store/frecency";

export interface Command {
  id: string;
  label: string;
  aliases?: string[];
  hint?: string;
  run: (query: string) => void;
}

export function CommandPalette({
  commands,
  usage = {},
  onClose,
  onUse,
  onResetRanking,
  now,
}: {
  commands: Command[];
  /** Frecency memory keyed by command id — drives ranking. Defaults to empty. */
  usage?: Record<string, CommandUsage>;
  onClose: () => void;
  /** Record that a command was run (bumps its frecency). */
  onUse?: (id: string) => void;
  /** Forget a command's ranking (Raycast's "Reset Ranking"). */
  onResetRanking?: (id: string) => void;
  /** Injectable clock for deterministic ranking in tests; defaults to now. */
  now?: number;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  // Freeze "now" at open so the ranking stays stable while the palette is up
  // (a command run mid-session mustn't re-sort the list under the cursor).
  const [clock] = useState(() => now ?? Date.now());

  useEffect(() => {
    ref.current?.focus();
  }, []);

  // Rank by frecency (most used × most recent first), keeping the deliberate
  // authored order as the tiebreaker — so unused commands (all scoring 0) stay
  // exactly where they were placed. Stable sort + a decorated index guarantees
  // it. The subsequence filter below preserves this order, so both the empty
  // list and any search are ranked the same way.
  const ranked = useMemo(() => {
    return commands
      .map((c, i) => ({ c, i, score: frecencyScore(usage[c.id], clock) }))
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map((x) => x.c);
  }, [commands, usage, clock]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return ranked;
    const tokens = q.split(/\s+/).filter(Boolean);
    return ranked.filter((c) => {
      // Alias shortcut: the query starts with a command alias (unchanged).
      if (c.aliases?.some((alias) => q.startsWith(alias.toLowerCase()))) return true;
      // Every whitespace-separated token must appear in the label, in order — so
      // "sche tod" matches "Schedule: Today" even though it isn't a contiguous
      // substring. A single token reduces to the old substring match, and we
      // don't re-sort, so the frecency ordering above is preserved.
      const label = c.label.toLowerCase();
      let from = 0;
      for (const token of tokens) {
        const at = label.indexOf(token, from);
        if (at === -1) return false;
        from = at + token.length;
      }
      return true;
    });
  }, [ranked, query]);

  useEffect(() => {
    if (sel > filtered.length - 1) setSel(0);
  }, [filtered.length, sel]);

  const run = (i: number) => {
    const c = filtered[i];
    if (c == null) return;
    const rawQuery = query;
    onUse?.(c.id);
    onClose();
    c.run(rawQuery);
  };

  const hasRanking = (c: Command | undefined): boolean => c != null && usage[c.id] != null;
  const selHasRanking = hasRanking(filtered[sel]);

  const resetSelected = () => {
    const c = filtered[sel];
    if (c != null && hasRanking(c)) onResetRanking?.(c.id);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-8 pt-[12vh] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded border border-line bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          {...NO_SPELLCHECK}
          ref={ref}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              e.stopPropagation();
              setSel((s) => Math.min(s + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              e.stopPropagation();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              run(sel);
            } else if ((e.metaKey || e.ctrlKey) && e.key === "Backspace") {
              // Reset the highlighted command's ranking — but only from an empty
              // query, so we never steal ⌘⌫'s "clear the line" mid-search.
              if (query === "" && selHasRanking) {
                e.preventDefault();
                e.stopPropagation();
                resetSelected();
              }
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
          placeholder="Type a command…"
          className="w-full border-b border-line bg-transparent px-4 py-3 text-[15px] text-ink outline-none placeholder:text-ink-faint"
        />
        <div role="listbox" aria-label="Commands" className="max-h-80 overflow-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-ink-faint">
              No commands
            </div>
          ) : (
            filtered.map((c, i) => {
              const isSel = i === sel;
              const showReset = isSel && hasRanking(c);
              return (
                <div
                  key={c.id}
                  role="option"
                  aria-selected={isSel}
                  onMouseMove={() => setSel(i)}
                  onClick={() => run(i)}
                  className={[
                    "flex w-full cursor-pointer items-center justify-between px-4 py-2 text-left text-[14px]",
                    isSel ? "bg-surface-2 text-ink" : "text-ink-soft",
                  ].join(" ")}
                >
                  <span className="truncate pr-2">{c.label}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {c.hint != null && <span className="kbd">{c.hint}</span>}
                    {showReset && (
                      <button
                        type="button"
                        aria-label="Reset ranking"
                        title="Reset ranking"
                        // Keep the input focused so keyboard flow survives a click.
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onResetRanking?.(c.id);
                        }}
                        className="rounded px-1 text-[13px] text-ink-faint hover:bg-surface hover:text-ink"
                      >
                        ↺
                      </button>
                    )}
                  </span>
                </div>
              );
            })
          )}
        </div>
        <div className="flex items-center justify-between border-t border-line px-4 py-1.5 text-[11px] text-ink-faint">
          <span>↑↓ to navigate · ↵ to run</span>
          {selHasRanking && query === "" && (
            <span>
              <span className="kbd">⌘⌫</span> reset ranking
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
