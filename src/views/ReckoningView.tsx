import { useEffect, useRef, useState } from "react";
import type { ISODate, Task, TaskId } from "../types";
import { relativeLabel } from "../store/dates";

function ActionChip({
  label,
  hint,
  tone,
  onClick,
}: {
  label: string;
  hint: string;
  tone: "good" | "accent" | "soft" | "bad";
  onClick: () => void;
}) {
  const tones: Record<string, string> = {
    good: "border-good/40 text-good hover:bg-good-soft",
    accent: "border-accent/40 text-accent hover:bg-accent-soft",
    soft: "border-line-strong text-ink-soft hover:bg-surface-2",
    bad: "border-bad/40 text-bad hover:bg-bad-soft",
  };
  return (
    <button
      tabIndex={-1}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        e.currentTarget.blur();
        onClick();
      }}
      className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[12px] font-medium transition-colors ${tones[tone]}`}
    >
      {label}
      <span className="kbd">{hint}</span>
    </button>
  );
}

function BreakdownPanel({
  task,
  today,
  onAddStep,
  onFinish,
}: {
  task: Task;
  today: ISODate;
  onAddStep: (text: string) => void;
  onFinish: () => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const todaySteps = task.children.filter((c) => c.plannedFor === today);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="eyebrow mb-2">Break it down</div>
      <h1 className="font-serif text-[28px] font-medium leading-tight tracking-tight text-ink">
        {task.text === "" ? "Untitled" : task.text}
      </h1>
      <p className="mt-2 text-[14px] text-ink-soft">
        What is the smallest piece you can actually finish today? Add one or more
        steps. Each becomes a task planned for today.
      </p>

      {task.children.length > 0 && (
        <ul className="mt-5 flex flex-col gap-1.5">
          {task.children.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-2 rounded-sm bg-surface-2 px-3 py-2 text-[14px] text-ink"
            >
              <span className="h-[6px] w-[6px] rounded-full bg-accent" />
              <span className="flex-1">{c.text}</span>
              {c.plannedFor === today && (
                <span className="rounded-sm bg-accent-soft px-1.5 py-[1px] text-[10px] font-medium text-accent">
                  today
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center gap-3 rounded border border-line bg-surface px-3 py-2 shadow-soft focus-within:border-line-strong">
        <span className="text-lg leading-none text-ink-faint">+</span>
        <input
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              const raw = value.trim();
              if (raw === "") {
                onFinish();
              } else {
                onAddStep(raw);
                setValue("");
              }
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onFinish();
            }
          }}
          placeholder="A small step you'll finish today…"
          className="flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-faint"
        />
        <span className="kbd">↵</span>
      </div>

      <div className="mt-3 flex items-center justify-between text-[12px] text-ink-faint">
        <span>
          {todaySteps.length === 0
            ? "Add at least one step to resolve this."
            : `${todaySteps.length} step${todaySteps.length === 1 ? "" : "s"} planned for today`}
        </span>
        <button
          onClick={onFinish}
          className="kbd"
          aria-label="Finish breakdown"
        >
          ↵ on empty to finish
        </button>
      </div>
    </div>
  );
}

export function ReckoningView({
  leftovers,
  cursorId,
  today,
  breakdownTask,
  reason,
  onReasonChange,
  onSelect,
  onComplete,
  onBacklog,
  onDrop,
  onStartBreakdown,
  onAddStep,
  onFinishBreakdown,
}: {
  leftovers: Task[];
  cursorId: TaskId | null;
  today: ISODate;
  breakdownTask: Task | null;
  reason: string;
  onReasonChange: (v: string) => void;
  onSelect: (id: TaskId) => void;
  onComplete: (id: TaskId) => void;
  onBacklog: (id: TaskId) => void;
  onDrop: (id: TaskId) => void;
  onStartBreakdown: (id: TaskId) => void;
  onAddStep: (parentId: TaskId, text: string) => void;
  onFinishBreakdown: () => void;
}) {
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-10 py-10">
      {breakdownTask != null ? (
        <BreakdownPanel
          task={breakdownTask}
          today={today}
          onAddStep={(text) => onAddStep(breakdownTask.id, text)}
          onFinish={onFinishBreakdown}
        />
      ) : (
        <>
          <header className="mb-6 border-b border-line pb-5">
            <div className="eyebrow mb-1.5 text-bad">The Reckoning</div>
            <h1 className="font-serif text-[32px] font-medium leading-none tracking-tight text-ink">
              Unfinished from before today
            </h1>
            <p className="mt-2 max-w-xl text-[14px] text-ink-soft">
              {leftovers.length} task{leftovers.length === 1 ? "" : "s"} you
              committed to didn't get done. Finish it, break it into something you
              can complete today, send it back to the backlog, or drop it. Today
              starts once this is clear.
            </p>
          </header>

          <div className="-mx-2 flex flex-1 flex-col gap-1.5 overflow-auto">
            {leftovers.map((t) => {
              const selected = cursorId === t.id;
              return (
                <div key={t.id}>
                  <div
                    onClick={() => onSelect(t.id)}
                    className={[
                      "relative flex items-center gap-3 rounded px-3 py-2.5",
                      selected ? "bg-surface-2" : "hover:bg-surface-2/60",
                    ].join(" ")}
                  >
                    {selected && (
                      <span className="absolute left-0 top-2 bottom-2 w-[2px] bg-accent" />
                    )}
                    <span className="mono shrink-0 text-[11px] text-bad">
                      {relativeLabel(t.plannedFor ?? today, today)}
                    </span>
                    <span className="flex-1 truncate text-[14px] text-ink">
                      {t.text === "" ? "Untitled" : t.text}
                    </span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <ActionChip label="Done" hint="e" tone="good" onClick={() => onComplete(t.id)} />
                      <ActionChip label="Break down" hint="b" tone="accent" onClick={() => onStartBreakdown(t.id)} />
                      <ActionChip label="Backlog" hint="s" tone="soft" onClick={() => onBacklog(t.id)} />
                      <ActionChip label="Drop" hint="d" tone="bad" onClick={() => onDrop(t.id)} />
                    </div>
                  </div>
                  {selected && (
                    <input
                      value={reason}
                      onChange={(e) => onReasonChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          e.stopPropagation();
                          e.currentTarget.blur();
                        }
                      }}
                      placeholder="Why didn't this get done? (optional — attached to your choice)"
                      className="mb-1 ml-3 mt-1 w-[calc(100%-1.5rem)] rounded-sm border border-line bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
