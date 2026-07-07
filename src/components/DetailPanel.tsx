import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ISODate, LogEntry, Project, ProjectId, Task, TaskPriority } from "../types";
import { renderBlock, renderInline } from "../ui/markdown";
import { countAll } from "../store/tasks";
import { copyText } from "../ui/clipboard";
import { NO_SPELLCHECK } from "../ui/noSpellcheck";
import type { ScheduleChoice } from "./SchedulePicker";

const PRIORITIES: Array<{ value: TaskPriority; label: string }> = [
  { value: 1, label: "Urgent" },
  { value: 2, label: "High" },
  { value: 3, label: "Medium" },
  { value: 4, label: "None" },
];

/** The current schedule as a chip key (null = a concrete date that isn't today/tomorrow). */
export type ScheduleTag = Exclude<ScheduleChoice, { date: ISODate }> | null;

const SCHEDULES: Array<{ value: Exclude<ScheduleChoice, { date: ISODate }>; label: string }> = [
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "thisWeek", label: "This week" },
  { value: "nextWeek", label: "Next week" },
  { value: "thisMonth", label: "This month" },
  { value: "nextMonth", label: "Next month" },
  { value: "someday", label: "Someday" },
  { value: "inbox", label: "Inbox" },
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
  kept: "Kept for today",
  skipped: "Won’t do",
};

const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function exactLocal(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** A read-only status box for a subtask: done ✓ / won't-do ✕ / open. */
function SubtaskGlyph({ task }: { task: Task }) {
  const done = task.completed;
  const skipped = task.wontDo != null;
  return (
    <span
      aria-hidden
      className={[
        "mt-[2px] grid h-[14px] w-[14px] shrink-0 place-items-center rounded-[3px] border text-white",
        done ? "border-good bg-good" : skipped ? "border-bad bg-bad" : "border-line-strong",
      ].join(" ")}
    >
      {done ? (
        <svg viewBox="0 0 16 16" width="9" height="9">
          <path d="M13 4.5 6.5 11 3 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : skipped ? (
        <svg viewBox="0 0 16 16" width="9" height="9">
          <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </span>
  );
}

/** The task's subtree, read-only — so hidden (e.g. completed) children stay visible here. */
function SubtaskTree({ task, depth }: { task: Task; depth: number }) {
  const resolved = task.completed || task.wontDo != null;
  return (
    <>
      <div className="flex items-start gap-2 py-[3px]" style={{ paddingLeft: `${depth * 14}px` }}>
        <SubtaskGlyph task={task} />
        <span
          className={[
            "text-[13px] leading-snug [overflow-wrap:anywhere]",
            resolved ? "text-ink-faint line-through" : "text-ink-soft",
          ].join(" ")}
        >
          {task.text === "" ? "Untitled" : renderInline(task.text)}
        </span>
      </div>
      {task.children.map((c) => (
        <SubtaskTree key={c.id} task={c} depth={depth + 1} />
      ))}
    </>
  );
}

export interface DetailHandlers {
  onCommitNotes: (id: Task["id"], text: string) => void;
  onToggle: (id: Task["id"]) => void;
  /** Toggle the "won't do" (intentionally skipped) state. */
  onToggleWontDo: (id: Task["id"]) => void;
  /** Save the reason on an already-skipped task. */
  onCommitReason: (id: Task["id"], reason: string) => void;
  onPriority: (id: Task["id"], p: TaskPriority) => void;
  onProject: (id: Task["id"], projectId: ProjectId) => void;
  /** Apply a schedule (the Schedule chips + exact-date field). */
  onSchedule: (id: Task["id"], choice: ScheduleChoice) => void;
  onBack: () => void;
}

export function DetailPanel({
  task,
  scheduleTag,
  log,
  projects,
  handlers,
  editSignal,
}: {
  task: Task;
  scheduleTag: ScheduleTag;
  log: LogEntry[];
  projects: Project[];
  handlers: DetailHandlers;
  /** Bumped by the parent (Tab from the list) to dive into the notes editor. */
  editSignal: number;
}) {
  const [notes, setNotes] = useState(task.notes);
  const [reason, setReason] = useState(task.wontDo?.reason ?? "");
  const [planDate, setPlanDate] = useState(task.plannedFor ?? "");
  // Open in preview: focus stays on the list so ↑/↓ keep navigating and the
  // panel follows. Editing the notes is an explicit step (Tab → editSignal).
  const [editing, setEditing] = useState(false);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setNotes(task.notes);
    setEditing(false);
  }, [task.id, task.notes]);
  useEffect(() => {
    setReason(task.wontDo?.reason ?? "");
  }, [task.id, task.wontDo?.reason]);
  useEffect(() => {
    setPlanDate(task.plannedFor ?? "");
  }, [task.id, task.plannedFor]);

  // React only to *changes* in editSignal, not to its value on mount — otherwise
  // reopening the panel after a previous Tab would steal focus into the notes.
  const lastEditSignal = useRef(editSignal);
  useEffect(() => {
    if (editSignal !== lastEditSignal.current) {
      lastEditSignal.current = editSignal;
      setEditing(true);
    }
  }, [editSignal]);

  useEffect(() => {
    if (editing) notesRef.current?.focus();
  }, [editing]);

  const commitNotes = () => handlers.onCommitNotes(task.id, notes);
  const commitPlanDate = () => {
    if (planDate !== "" && planDate !== task.plannedFor) {
      handlers.onSchedule(task.id, { date: planDate });
    }
  };
  const wontDo = task.wontDo != null;
  // Counts come from the full subtree the panel is handed, so they're accurate
  // even when the list is hiding completed children.
  const childProgress = task.children.length > 0 ? countAll(task) : null;

  // Leave the notes editor but keep the panel open: blur returns the keyboard to
  // the list (context → normal), so previewing resumes from the same task.
  const exitToPreview = () => {
    commitNotes();
    setEditing(false);
    notesRef.current?.blur();
  };

  const onNotesKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      commitNotes();
      handlers.onToggle(task.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      exitToPreview();
    } else if (
      e.key === "ArrowLeft" &&
      e.currentTarget.selectionStart === 0 &&
      e.currentTarget.selectionEnd === 0
    ) {
      e.preventDefault();
      e.stopPropagation();
      exitToPreview();
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

      {childProgress != null && (
        <div className="mb-4">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="eyebrow">Subtasks</span>
            <span className="mono text-[11px] text-ink-faint">
              {childProgress.done}/{childProgress.total} done
            </span>
          </div>
          <div className="rounded border border-line bg-bg px-2.5 py-1.5">
            {task.children.map((c) => (
              <SubtaskTree key={c.id} task={c} depth={0} />
            ))}
          </div>
        </div>
      )}

      <div className="mb-1.5 flex items-center justify-between">
        <span className="eyebrow">Content</span>
        {!editing && (
          <span className="text-[11px] text-ink-faint">
            <span className="kbd">tab</span> to edit
          </span>
        )}
      </div>
      {editing || notes.trim() === "" ? (
        <textarea
          {...NO_SPELLCHECK}
          ref={notesRef}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          // Empty notes render the textarea in preview too; focusing it (click or
          // the Tab dive) is what actually enters edit mode, so it stays mounted.
          onFocus={() => setEditing(true)}
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
        {task.wontDo != null && <> · Won’t do {exactLocal(task.wontDo.at)}</>}
        <span className="ml-1">({LOCAL_TZ})</span>
      </div>

      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink-faint">
        <span>ID</span>
        <button
          onClick={() => void copyText(task.id)}
          className={`mono rounded-sm bg-surface-2 px-1.5 py-[1px] text-ink-soft transition-colors hover:text-ink ${FOCUS_RING}`}
          title="Click to copy the full task ID"
        >
          {task.id} ⧉
        </button>
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
        <div className="eyebrow mb-2">Schedule</div>
        <div className="flex flex-wrap gap-1.5">
          {SCHEDULES.map((o) => {
            const active = scheduleTag === o.value;
            return (
              <button
                key={o.value}
                onClick={() => handlers.onSchedule(task.id, active ? "inbox" : o.value)}
                className={[
                  "rounded-sm border px-2 py-1.5 text-[12px] transition-colors",
                  FOCUS_RING,
                  active
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line text-ink-soft hover:bg-surface-2",
                ].join(" ")}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="shrink-0 text-[12px] text-ink-faint">Or a date</span>
          <input
            {...NO_SPELLCHECK}
            type="date"
            aria-label="Schedule date"
            value={planDate}
            onChange={(e) => setPlanDate(e.target.value)}
            onBlur={commitPlanDate}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            className="min-w-0 flex-1 rounded-sm border border-line bg-transparent px-2 py-1 text-[13px] text-ink outline-none focus:border-line-strong"
          />
        </div>
      </div>

      <div className="mt-3">
        <button
          onClick={() => handlers.onToggleWontDo(task.id)}
          className={[
            "w-full rounded-sm border px-3 py-2 text-[13px] transition-colors",
            FOCUS_RING,
            wontDo
              ? "border-bad bg-bad-soft text-bad"
              : "border-line text-ink-soft hover:bg-surface-2",
          ].join(" ")}
        >
          {wontDo ? "Won’t do ✕ — click to reopen" : "Mark won’t do"}
        </button>
        {wontDo && (
          <input
            {...NO_SPELLCHECK}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => handlers.onCommitReason(task.id, reason)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            placeholder="Why not? (optional)"
            className="mt-2 w-full rounded-sm border border-line bg-bg px-3 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
          />
        )}
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
