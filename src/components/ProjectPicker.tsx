import { useEffect, useMemo, useRef, useState } from "react";
import type { Project, ProjectId } from "../types";
import { NO_SPELLCHECK } from "../ui/noSpellcheck";

/**
 * Filing picker: type a few letters of a project, pick it. Mirrors the schedule
 * picker (a search field over a keyboard list) so filing feels the same wherever
 * you are — over tasks in the outline, or over a recurring task's template in
 * the Recurring view.
 */
export function ProjectPicker({
  projects,
  count,
  current,
  subject,
  onPick,
  onClose,
}: {
  projects: Project[];
  count: number;
  /** The project things are filed under now — dotted in the list. */
  current: ProjectId | null;
  /** What's being filed, when it isn't plain tasks (e.g. "recurring task"). */
  subject?: string;
  onPick: (projectId: ProjectId) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selRef = useRef<HTMLButtonElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSel(0);
  }, [query]);

  useEffect(() => {
    selRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [sel, matches.length]);

  const pick = (projectId: ProjectId) => {
    onClose();
    onPick(projectId);
  };

  const label = subject ?? (count > 1 ? `${count} tasks` : null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-8 pt-[16vh] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Project"
        className="w-full max-w-sm overflow-hidden rounded border border-line bg-surface shadow-lg outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mono border-b border-line px-4 py-2.5 text-[11px] uppercase tracking-[0.14em] text-ink-faint">
          Project{label != null ? ` · ${label}` : ""}
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
              setSel((s) => Math.min(s + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const chosen = matches[sel];
              if (chosen != null) pick(chosen.id);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder="File under…"
          aria-label="Project name"
          className="w-full border-b border-line bg-transparent px-4 py-2.5 text-[14px] text-ink outline-none placeholder:text-ink-faint"
        />

        <div role="listbox" aria-label="Projects" className="max-h-80 overflow-auto py-1">
          {matches.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-ink-faint">
              No project matches “{query.trim()}”
            </div>
          ) : (
            matches.map((p, i) => (
              <button
                key={p.id}
                ref={i === sel ? selRef : null}
                role="option"
                aria-selected={i === sel}
                onMouseMove={() => setSel(i)}
                onClick={() => pick(p.id)}
                className={[
                  "flex w-full items-center gap-2 px-4 py-2 text-left text-[14px]",
                  i === sel ? "bg-surface-2 text-ink" : "text-ink-soft",
                ].join(" ")}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: p.color }}
                />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {current === p.id && <span className="shrink-0 text-[11px] text-accent">●</span>}
              </button>
            ))
          )}
        </div>

        <div className="border-t border-line px-4 py-1.5 text-[11px] text-ink-faint">
          ↑↓ to choose · ↵ to file
        </div>
      </div>
    </div>
  );
}
