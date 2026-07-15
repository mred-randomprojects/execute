import { useEffect, useMemo, useRef, useState } from "react";
import { NO_SPELLCHECK } from "../ui/noSpellcheck";

export interface Command {
  id: string;
  label: string;
  aliases?: string[];
  hint?: string;
  run: (query: string) => void;
}

export function CommandPalette({
  commands,
  onClose,
}: {
  commands: Command[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return commands;
    const tokens = q.split(/\s+/).filter(Boolean);
    return commands.filter((c) => {
      // Alias shortcut: the query starts with a command alias (unchanged).
      if (c.aliases?.some((alias) => q.startsWith(alias.toLowerCase()))) return true;
      // Every whitespace-separated token must appear in the label, in order — so
      // "sche tod" matches "Schedule: Today" even though it isn't a contiguous
      // substring. A single token reduces to the old substring match, and we
      // don't re-sort, so the deliberate command ordering is preserved.
      const label = c.label.toLowerCase();
      let from = 0;
      for (const token of tokens) {
        const at = label.indexOf(token, from);
        if (at === -1) return false;
        from = at + token.length;
      }
      return true;
    });
  }, [commands, query]);

  useEffect(() => {
    if (sel > filtered.length - 1) setSel(0);
  }, [filtered.length, sel]);

  const run = (i: number) => {
    const c = filtered[i];
    if (c == null) return;
    const rawQuery = query;
    onClose();
    c.run(rawQuery);
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
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
          placeholder="Type a command…"
          className="w-full border-b border-line bg-transparent px-4 py-3 text-[15px] text-ink outline-none placeholder:text-ink-faint"
        />
        <div className="max-h-80 overflow-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-ink-faint">
              No commands
            </div>
          ) : (
            filtered.map((c, i) => (
              <button
                key={c.id}
                onMouseMove={() => setSel(i)}
                onClick={() => run(i)}
                className={[
                  "flex w-full items-center justify-between px-4 py-2 text-left text-[14px]",
                  i === sel ? "bg-surface-2 text-ink" : "text-ink-soft",
                ].join(" ")}
              >
                <span>{c.label}</span>
                {c.hint != null && <span className="kbd">{c.hint}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
