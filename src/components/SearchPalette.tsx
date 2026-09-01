import { useEffect, useMemo, useRef, useState } from "react";
import type { Project, Task, TaskId } from "../types";
import { NO_SPELLCHECK } from "../ui/noSpellcheck";
import {
  searchTasks,
  highlightSegments,
  type TaskSearchResult,
} from "../store/search";

/**
 * Full-text task finder: type a few letters, jump to the task. Matching is
 * subsequence-based ("byml" → "Buy milk"), searching every task's title and,
 * failing that, its notes — across all projects, dates, and completion states.
 * Picking a result hands its id back so the app can reveal and select it.
 *
 * Modeled on the schedule/project pickers so it feels like the rest of the app:
 * a search field over a keyboard-navigable list. Every keystroke stops here
 * (`stopPropagation`) so the outline's own shortcuts stay dormant while typing.
 */
export function SearchPalette({
  tasks,
  projects,
  onPick,
  onClose,
}: {
  tasks: Task[];
  projects: Project[];
  onPick: (id: TaskId) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selRef = useRef<HTMLButtonElement>(null);

  const results = useMemo(
    () => searchTasks(tasks, projects, query),
    [tasks, projects, query],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // A new query re-ranks the list; start from the top so the cursor isn't left
  // pointing at a row that just moved out from under it.
  useEffect(() => {
    setSel(0);
  }, [query]);

  // The list scrolls; keep the cursor in view as it walks past the fold.
  useEffect(() => {
    selRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [sel, results.length]);

  const pick = (result: TaskSearchResult | undefined) => {
    if (result == null) return;
    onClose();
    onPick(result.task.id);
  };

  const trimmed = query.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-8 pt-[12vh] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Search"
        className="w-full max-w-lg overflow-hidden rounded border border-line bg-surface shadow-lg outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          {...NO_SPELLCHECK}
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Own every keystroke while the finder is up.
            e.stopPropagation();
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(results[sel]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder="Find a task…"
          aria-label="Search tasks"
          className="w-full border-b border-line bg-transparent px-4 py-3 text-[15px] text-ink outline-none placeholder:text-ink-faint"
        />

        <div role="listbox" aria-label="Tasks" className="max-h-96 overflow-auto py-1">
          {trimmed === "" ? (
            <div className="px-4 py-6 text-center text-[13px] text-ink-faint">
              Type to search all your tasks
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-ink-faint">
              No tasks match “{trimmed}”
            </div>
          ) : (
            results.map((r, i) => (
              <ResultRow
                key={r.task.id}
                result={r}
                selected={i === sel}
                rowRef={i === sel ? selRef : null}
                onHover={() => setSel(i)}
                onPick={() => pick(r)}
              />
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line px-4 py-1.5 text-[11px] text-ink-faint">
          <span>↑↓ to navigate · ↵ to jump</span>
          {results.length > 0 && (
            <span>
              {results.length} match{results.length === 1 ? "" : "es"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultRow({
  result,
  selected,
  rowRef,
  onHover,
  onPick,
}: {
  result: TaskSearchResult;
  selected: boolean;
  rowRef: React.Ref<HTMLButtonElement>;
  onHover: () => void;
  onPick: () => void;
}) {
  const { task, project, ancestors, field, match } = result;
  const resolved = task.completed || task.wontDo != null;
  const glyph = task.completed ? "✓" : task.wontDo != null ? "✕" : task.waitingOn != null ? "◷" : "";

  // The breadcrumb: which project, and how deep — so two same-named tasks in
  // different corners are still tellable apart.
  const trail = [project?.name ?? "—", ...ancestors.map((a) => a.text)];

  return (
    <button
      ref={rowRef}
      role="option"
      aria-selected={selected}
      onMouseMove={onHover}
      onClick={onPick}
      className={[
        "flex w-full items-start gap-2.5 px-4 py-2 text-left",
        selected ? "bg-surface-2" : "",
      ].join(" ")}
    >
      <span
        aria-hidden
        className="mt-0.5 w-3 shrink-0 text-center text-[11px] text-ink-faint"
      >
        {glyph}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={[
            "block truncate text-[14px]",
            resolved ? "text-ink-faint line-through" : "text-ink",
          ].join(" ")}
        >
          {field === "text" ? (
            <Highlighted text={task.text} indices={match.indices} />
          ) : (
            task.text || "Untitled"
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-faint">
          {project != null && (
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: project.color }}
            />
          )}
          <span className="truncate">{trail.join(" › ")}</span>
        </span>
        {field === "notes" && (
          <span className="mt-0.5 block truncate text-[11px] text-ink-soft">
            <span className="mono mr-1 text-ink-faint">notes</span>
            <Highlighted {...notesSnippet(task.notes, match.indices)} />
          </span>
        )}
      </span>
    </button>
  );
}

/** Render a string with its matched chars emphasized. */
function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  const segments = highlightSegments(text, indices);
  return (
    <>
      {segments.map((seg, i) =>
        seg.hit ? (
          <span key={i} className="font-semibold text-accent">
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

/**
 * A short window of `notes` around the first matched char, with the match
 * indices rebased into the window — so a hit deep in a long note is still shown
 * (and highlighted) instead of truncated away.
 */
function notesSnippet(notes: string, indices: number[]): { text: string; indices: number[] } {
  const LEAD = 12;
  const WIDTH = 80;
  const first = indices[0] ?? 0;
  const start = Math.max(0, first - LEAD);
  const rawEnd = start + WIDTH;
  const end = Math.min(notes.length, rawEnd);
  const slice = notes.slice(start, end);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < notes.length ? "…" : "";
  const shifted = indices
    .filter((idx) => idx >= start && idx < end)
    .map((idx) => idx - start + prefix.length);
  return { text: `${prefix}${slice}${suffix}`, indices: shifted };
}
