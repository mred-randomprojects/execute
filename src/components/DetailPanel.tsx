import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ISODate, LogEntry, Project, ProjectId, Task, TaskPriority } from "../types";
import { renderBlock, renderInline } from "../ui/markdown";
import { NO_SPELLCHECK } from "../ui/noSpellcheck";

const PRIORITIES: Array<{ value: TaskPriority; label: string }> = [
  { value: 1, label: "Urgent" },
  { value: 2, label: "High" },
  { value: 3, label: "Medium" },
  { value: 4, label: "None" },
];

// Panel controls are reached by native Tab (the keyboard engine goes dormant
// inside the panel's data-keyzone), so they need a clear, on-brand focus ring.
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

const ACTION_LABEL: Record<string, string> = {
  completed: "Completed",
  uncompleted: "Reopened",
  postponed: "Postponed",
  dropped: "Dropped",
  brokeDown: "Broke down",
};

const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function exactLocal(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export interface DetailHandlers {
  onCommitNotes: (id: Task["id"], text: string) => void;
  onToggle: (id: Task["id"]) => void;
  onPriority: (id: Task["id"], p: TaskPriority) => void;
  onProject: (id: Task["id"], projectId: ProjectId) => void;
  onTogglePlan: (id: Task["id"]) => void;
  onBack: () => void;
}

export function DetailPanel({
  task,
  today,
  log,
  projects,
  handlers,
}: {
  task: Task;
  today: ISODate;
  log: LogEntry[];
  projects: Project[];
  handlers: DetailHandlers;
}) {
  const [notes, setNotes] = useState(task.notes);
  const [editing, setEditing] = useState(true); // open ready to type
  const notesRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setNotes(task.notes);
    setEditing(true);
  }, [task.id, task.notes]);

  useEffect(() => {
    if (editing) notesRef.current?.focus();
  }, [editing]);

  const commitNotes = () => handlers.onCommitNotes(task.id, notes);
  const plannedToday = task.plannedFor === today;

  const onNotesKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      commitNotes();
      handlers.onToggle(task.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      commitNotes();
      handlers.onBack();
    } else if (
      e.key === "ArrowLeft" &&
      e.currentTarget.selectionStart === 0 &&
      e.currentTarget.selectionEnd === 0
    ) {
      e.preventDefault();
      e.stopPropagation();
      commitNotes();
      handlers.onBack();
    }
  };

  return (
    <aside
      data-keyzone="panel"
      className="flex w-[360px] shrink-0 flex-col overflow-auto border-l border-line bg-surface px-5 pb-5 pt-8"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="eyebrow">Details</span>
        <button onClick={handlers.onBack} className="kbd" aria-label="Close panel">
          ← / esc
        </button>
      </div>

      {/* Title is read-only here (edit it inline in the list); renders markdown. */}
      <div className="mb-4 font-serif text-[20px] font-medium leading-snug tracking-tight text-ink [overflow-wrap:anywhere]">
        {task.text === "" ? (
          <span className="text-ink-faint">Untitled</span>
        ) : (
          renderInline(task.text)
        )}
      </div>

      <div className="eyebrow mb-1.5">Content</div>
      {editing || notes.trim() === "" ? (
        <textarea
          {...NO_SPELLCHECK}
          ref={notesRef}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            commitNotes();
            setEditing(false);
          }}
          onKeyDown={onNotesKeyDown}
          placeholder="Add details, links, context… (markdown supported)"
          className="min-h-[160px] flex-1 resize-none rounded border border-line bg-bg px-3 py-2 text-[14px] leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
        />
      ) : (
        <div
          onClick={() => setEditing(true)}
          className="min-h-[160px] flex-1 cursor-text rounded border border-transparent px-3 py-2 text-[14px] leading-relaxed text-ink hover:border-line"
        >
          {renderBlock(notes)}
        </div>
      )}

      <div className="mt-3 text-[11px] text-ink-faint">
        Created {exactLocal(task.createdAt)}
        {task.completedAt != null && <> · Completed {exactLocal(task.completedAt)}</>}
        <span className="ml-1">({LOCAL_TZ})</span>
      </div>

      <div className="mt-4">
        <div className="eyebrow mb-2">Priority</div>
        <div className="flex gap-1">
          {PRIORITIES.map((p) => (
            <button
              key={p.value}
              onClick={() => handlers.onPriority(task.id, p.value)}
              className={[
                "flex-1 rounded-sm border px-2 py-1.5 text-[12px] transition-colors",
                FOCUS_RING,
                task.priority === p.value
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line text-ink-soft hover:bg-surface-2",
              ].join(" ")}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <div className="eyebrow mb-2">Project</div>
        <div className="flex flex-wrap gap-1.5">
          {projects.map((project) => {
            const active = task.projectId === project.id;
            return (
              <button
                key={project.id}
                onClick={() => handlers.onProject(task.id, project.id)}
                className={[
                  "flex min-w-0 items-center gap-1.5 rounded-sm border px-2 py-1.5 text-[12px] transition-colors",
                  FOCUS_RING,
                  active
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line text-ink-soft hover:bg-surface-2",
                ].join(" ")}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: project.color }}
                />
                <span className="truncate">{project.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        <button
          onClick={() => handlers.onTogglePlan(task.id)}
          className={[
            "w-full rounded-sm border px-3 py-2 text-[13px] transition-colors",
            FOCUS_RING,
            plannedToday
              ? "border-accent bg-accent-soft text-accent"
              : "border-line text-ink-soft hover:bg-surface-2",
          ].join(" ")}
        >
          {plannedToday ? "Planned for today ✓" : "Plan for today"}
        </button>
      </div>

      {log.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <div className="eyebrow mb-1">History</div>
          <div className="mb-2 text-[11px] text-ink-faint">
            Times in your local timezone ({LOCAL_TZ})
          </div>
          <ul className="flex flex-col gap-2">
            {log.map((e) => (
              <li key={e.id} className="text-[12px] text-ink-soft">
                <span className="text-ink">{ACTION_LABEL[e.action] ?? e.action}</span>{" "}
                <span className="mono text-ink-faint">{exactLocal(e.at)}</span>
                {e.reason != null && e.reason !== "" && (
                  <div className="mt-0.5 text-ink-faint">“{e.reason}”</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
