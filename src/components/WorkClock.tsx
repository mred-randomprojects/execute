import { useEffect, useRef, useState } from "react";
import { useTicking } from "../ui/useTicking";
import type { Task } from "../types";
import { renderInline } from "../ui/markdown";
import { NO_SPELLCHECK } from "../ui/noSpellcheck";
import {
  currentNote,
  formatClock,
  formatWorked,
  isRunning,
  runningSince,
  workedMs,
} from "../store/work";

/** "1h 05m of 1h 30m" — red once it's past the estimate. */
function Total({ task, now }: { task: Task; now: number }) {
  const worked = workedMs(task, now);
  const estimate = task.estimatedMinutes != null ? task.estimatedMinutes * 60_000 : null;
  const over = estimate != null && worked > estimate;
  return (
    <span className={over ? "text-bad" : undefined}>
      {formatWorked(worked)}
      {estimate != null && <> of {formatWorked(estimate)}</>}
      {over && <> · {formatWorked(worked - estimate)} over</>}
    </span>
  );
}

/** The estimate as a bar the time fills — only when there is an estimate. */
function EstimateBar({ task, now }: { task: Task; now: number }) {
  if (task.estimatedMinutes == null || task.estimatedMinutes <= 0) return null;
  const ratio = workedMs(task, now) / (task.estimatedMinutes * 60_000);
  return (
    <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
      <div
        className={["h-full rounded-full", ratio > 1 ? "bg-bad" : "bg-accent"].join(" ")}
        style={{ width: `${Math.min(100, ratio * 100)}%` }}
      />
    </div>
  );
}

/**
 * The task in progress, at the top of the outline: its clock, its time against
 * the estimate, and "currently: …" — where you are in it, edited in place.
 */
export function WorkBanner({
  task,
  onFocus,
  onToggle,
  onStop,
  onNote,
  noteSignal,
}: {
  task: Task;
  onFocus: () => void;
  /** Running → stop; paused → resume. */
  onToggle: () => void;
  /** Out of "in progress" altogether (the paused state's ×). */
  onStop: () => void;
  onNote: (text: string) => void;
  /** Bumped (⌘k → "currently") to open the note for typing. */
  noteSignal: number;
}) {
  const running = isRunning(task);
  const now = useTicking(running);
  const since = runningSince(task);
  const note = currentNote(task);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  const lastSignal = useRef(noteSignal);
  useEffect(() => {
    if (noteSignal === lastSignal.current) return;
    lastSignal.current = noteSignal;
    setDraft(note ?? "");
    setEditing(true);
  }, [noteSignal, note]);
  useEffect(() => {
    const el = inputRef.current;
    if (!editing || el == null) return;
    el.focus();
    // Caret at the end, like ↵ on a title: you're adding to where you are.
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() !== (note ?? "")) onNote(draft);
  };

  return (
    <div className="mb-4 rounded-md border border-accent/30 bg-accent-soft/50 px-4 py-3">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onToggle}
          className="mt-[2px] grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-accent text-bg transition-opacity hover:opacity-85"
          aria-label={running ? "Stop the timer" : "Resume the timer"}
          title={running ? "Stop (s)" : "Resume (s)"}
        >
          {running ? (
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
              <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden>
              <path d="M4.5 2.8v10.4L13 8z" fill="currentColor" />
            </svg>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="eyebrow flex items-baseline gap-2 text-accent">
            <span>{running ? "Working on" : "In progress · paused"}</span>
            {since != null && <span className="mono normal-case tracking-normal">{formatClock(now - since)}</span>}
          </div>
          <button
            type="button"
            onClick={onFocus}
            className="block text-left font-serif text-[20px] font-medium leading-snug tracking-tight text-ink"
            title="Jump to this task"
          >
            {task.text.trim() === "" ? "Untitled" : renderInline(task.text)}
          </button>
          {editing ? (
            <input
              {...NO_SPELLCHECK}
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  // Or the outline's ↵ (edit the title) would fire too: once
                  // the field blurs, the keyboard engine sees the list again.
                  e.stopPropagation();
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setDraft(note ?? "");
                  setEditing(false);
                }
              }}
              placeholder="Currently… (where you are in it — enter to save)"
              className="mt-1 w-full rounded-sm border border-line bg-bg px-2 py-1 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraft(note ?? "");
                setEditing(true);
              }}
              className="mt-0.5 block max-w-full truncate text-left text-[13px] text-ink-soft hover:text-ink"
              title="Where you are in it — kept with the time, in the task's details"
            >
              {note != null ? (
                <>
                  <span className="text-ink-faint">Currently:</span> {note}
                </>
              ) : (
                <span className="text-ink-faint">Currently… (click to say where you are)</span>
              )}
            </button>
          )}
          <div className="mono mt-1 text-[11px] text-ink-faint">
            <Total task={task} now={now} />
            {!running && <> · s resumes</>}
          </div>
          <EstimateBar task={task} now={now} />
        </div>
        {!running && (
          <button
            type="button"
            onClick={onStop}
            aria-label="No longer in progress"
            title="No longer in progress (the time stays on it)"
            className="mt-[2px] grid h-7 w-7 shrink-0 place-items-center rounded-sm text-[18px] leading-none text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

/** The row's chip: ▶ and the time so far while running, ❚❚ when paused. */
export function WorkChip({ task }: { task: Task }) {
  const running = isRunning(task);
  const now = useTicking(running);
  return (
    <span
      className={[
        "mono flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-[1px] text-[10px] font-medium",
        running ? "bg-accent text-white" : "bg-surface-2 text-ink-soft",
      ].join(" ")}
      title={running ? "In progress — s stops" : "In progress, paused — s resumes"}
    >
      <span aria-hidden>{running ? "▶" : "❚❚"}</span>
      {formatWorked(workedMs(task, now))}
    </span>
  );
}

/** Under the nav, in every view: what's in progress, one click away. */
export function SidebarWork({ task, onFocus }: { task: Task; onFocus: () => void }) {
  const running = isRunning(task);
  const now = useTicking(running);
  const since = runningSince(task);
  return (
    <button
      type="button"
      onClick={onFocus}
      className="mb-3 flex w-full items-center gap-2 rounded-sm border border-accent/30 bg-accent-soft/40 px-2.5 py-1.5 text-left text-[12px] text-ink transition-colors hover:bg-accent-soft/70"
      title={running ? "Working on this — click to jump to it" : "In progress, paused — click to jump to it"}
    >
      <span className={running ? "text-accent" : "text-ink-faint"} aria-hidden>
        {running ? "▶" : "❚❚"}
      </span>
      <span className="min-w-0 flex-1 truncate">{task.text.trim() === "" ? "Untitled" : task.text}</span>
      <span className="mono shrink-0 text-[11px] text-ink-faint">
        {since != null ? formatClock(now - since) : "paused"}
      </span>
    </button>
  );
}

/** The details panel's section: start/stop, the total, the stretches, the notes. */
export function WorkSection({
  task,
  onToggle,
}: {
  task: Task;
  onToggle: () => void;
}) {
  const running = isRunning(task);
  const now = useTicking(running);
  const [all, setAll] = useState(false);
  const sessions = [...task.sessions].reverse();
  const shown = all ? sessions : sessions.slice(0, 5);
  const notes = [...task.progress].reverse().filter((n) => n.text !== "");
  const day = (at: number) => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const clock = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="eyebrow">Time</div>
        <span className="mono text-[11px] text-ink-faint">
          <Total task={task} now={now} />
        </span>
      </div>
      <button
        onClick={onToggle}
        className={[
          "w-full rounded-sm border px-3 py-2 text-[13px] transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          running ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-soft hover:bg-surface-2",
        ].join(" ")}
      >
        {running ? "■ Stop working · s" : task.inProgress != null ? "▶ Resume · s" : "▶ Start working · s"}
      </button>
      <EstimateBar task={task} now={now} />
      {shown.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 text-[12px] text-ink-soft">
          {shown.map((s) => (
            <li key={s.start} className="flex justify-between gap-2">
              <span>
                {day(s.start)} · <span className="mono">{clock(s.start)}–{s.end != null ? clock(s.end) : "now"}</span>
              </span>
              <span className="mono text-ink-faint">
                {formatWorked((s.end ?? (task.inProgress != null ? now : s.start)) - s.start)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {sessions.length > shown.length && (
        <button onClick={() => setAll(true)} className="mt-1 text-[11px] text-ink-faint hover:text-ink">
          All {sessions.length} stretches
        </button>
      )}
      {notes.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] text-ink-faint">Where you were</div>
          <ul className="flex flex-col gap-1 text-[12px]">
            {notes.map((n) => (
              <li key={n.at} className="text-ink-soft">
                <span className="mono text-ink-faint">{day(n.at)} {clock(n.at)}</span> {n.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
