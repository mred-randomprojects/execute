import { useEffect, useRef, useState } from "react";
import type { ISODate, Project, ProjectId, Task } from "../types";
import { addDays, relativeLabel } from "../store/dates";

/** The fields the phone can change on a task. */
export interface TaskPatch {
  text?: string;
  notes?: string;
  plannedFor?: ISODate | null;
  projectId?: ProjectId;
}

/**
 * The phone's task details: a bottom sheet over the list. Every change is
 * saved as it's made (title and notes when you leave the field), each as its
 * own small edit — there's no "save" to forget.
 */
export function TaskSheet({
  task,
  projects,
  canChangeProject,
  today,
  onUpdate,
  onToggle,
  onClose,
}: {
  task: Task;
  projects: Project[];
  /** Only a top-level task has a project of its own; a subtask's follows its parent. */
  canChangeProject: boolean;
  today: ISODate;
  onUpdate: (patch: TaskPatch) => void;
  onToggle: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(task.text);
  const [notes, setNotes] = useState(task.notes);
  // Follow edits that arrive from elsewhere while the sheet is open — but never
  // over a field that's being typed in.
  const typing = useRef<"text" | "notes" | null>(null);
  useEffect(() => {
    if (typing.current !== "text") setText(task.text);
  }, [task.text]);
  useEffect(() => {
    if (typing.current !== "notes") setNotes(task.notes);
  }, [task.notes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const commitText = () => {
    const t = text.trim();
    if (t !== "" && t !== task.text) onUpdate({ text: t });
    else setText(task.text);
  };
  const commitNotes = () => {
    if (notes !== task.notes) onUpdate({ notes });
  };

  const days: { label: string; value: ISODate | null }[] = [
    { label: "Today", value: today },
    { label: "Tomorrow", value: addDays(today, 1) },
    { label: "Next week", value: addDays(today, 7) },
    { label: "No date", value: null },
  ];

  const chip = (active: boolean) =>
    [
      "rounded-full border px-3 py-1.5 text-[13px] transition-colors",
      active ? "border-ink bg-ink text-bg" : "border-line bg-surface text-ink-soft active:bg-surface-2",
    ].join(" ");

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label="Task details">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/30" />
      <div className="relative max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-line bg-bg px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong" aria-hidden="true" />

        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onToggle}
            aria-label={task.completed ? "Mark incomplete" : "Mark complete"}
            className={[
              "mt-1 flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-sm border",
              task.completed ? "border-good bg-good text-white" : "border-line-strong text-transparent",
            ].join(" ")}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => (typing.current = "text")}
            onBlur={() => {
              typing.current = null;
              commitText();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            rows={Math.min(4, Math.max(1, Math.ceil(text.length / 32)))}
            aria-label="Title"
            className={[
              "min-w-0 flex-1 resize-none bg-transparent text-[18px] leading-snug outline-none",
              task.completed ? "text-ink-faint line-through" : "text-ink",
            ].join(" ")}
          />
        </div>

        <section className="mt-5">
          <h3 className="mono mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">When</h3>
          <div className="flex flex-wrap items-center gap-2">
            {days.map((d) => (
              <button
                key={d.label}
                type="button"
                onClick={() => onUpdate({ plannedFor: d.value })}
                className={chip(task.plannedFor === d.value)}
              >
                {d.label}
              </button>
            ))}
            <label className={chip(task.plannedFor != null && !days.some((d) => d.value === task.plannedFor))}>
              <span>
                {task.plannedFor != null && !days.some((d) => d.value === task.plannedFor)
                  ? relativeLabel(task.plannedFor, today)
                  : "Pick a day…"}
              </span>
              <input
                type="date"
                value={task.plannedFor ?? ""}
                onChange={(e) => onUpdate({ plannedFor: e.target.value === "" ? null : e.target.value })}
                className="sr-only"
              />
            </label>
          </div>
        </section>

        <section className="mt-5">
          <h3 className="mono mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">Project</h3>
          {canChangeProject ? (
            <select
              value={task.projectId}
              onChange={(e) => onUpdate({ projectId: e.target.value as ProjectId })}
              aria-label="Project"
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-[15px] text-ink"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-[14px] text-ink-soft">
              {projects.find((p) => p.id === task.projectId)?.name ?? "Inbox"}
              <span className="text-ink-faint"> · follows its parent task</span>
            </p>
          )}
        </section>

        <section className="mt-5">
          <h3 className="mono mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">Notes</h3>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onFocus={() => (typing.current = "notes")}
            onBlur={() => {
              typing.current = null;
              commitNotes();
            }}
            rows={4}
            placeholder="Add notes…"
            aria-label="Notes"
            className="w-full resize-y rounded-md border border-line bg-surface px-3 py-2 text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:border-ink-soft"
          />
        </section>

        <button
          type="button"
          // Leaving a field already saved it (blur fires before this click).
          onClick={onClose}
          className="mt-5 w-full rounded-md bg-ink py-3 text-[15px] font-medium text-bg active:opacity-90"
        >
          Done
        </button>
      </div>
    </div>
  );
}
