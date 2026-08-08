import { useEffect, useRef, useState } from "react";
import type { ISODate, Task } from "../types";
import { NO_SPELLCHECK } from "../ui/noSpellcheck";

/**
 * "What is the smallest piece you can actually finish?" — the one move that
 * turns a task you keep failing into one you'll do.
 *
 * Shared by both rituals, which differ only in *when* the small step lands: the
 * Reckoning plans it for today (the day is ahead of you), the evening shutdown
 * for tomorrow (today is spent). Everything else about the act is identical.
 */
export function BreakdownPanel({
  task,
  stepDate,
  when,
  onAddStep,
  onFinish,
}: {
  task: Task;
  /** The day each new step is committed to. */
  stepDate: ISODate;
  /** How that day reads in the prompt — "today" / "tomorrow". */
  when: string;
  onAddStep: (text: string) => void;
  onFinish: () => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const steps = task.children.filter((c) => c.plannedFor === stepDate);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="eyebrow mb-2">Break it down</div>
      <h1 className="font-serif text-[28px] font-medium leading-tight tracking-tight text-ink">
        {task.text === "" ? "Untitled" : task.text}
      </h1>
      <p className="mt-2 text-[14px] text-ink-soft">
        What is the smallest piece you can actually finish {when}? Add one or more
        steps. Each becomes a task planned for {when}.
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
              {c.plannedFor === stepDate && (
                <span className="rounded-sm bg-accent-soft px-1.5 py-[1px] text-[10px] font-medium text-accent">
                  {when}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center gap-3 rounded border border-line bg-surface px-3 py-2 shadow-soft focus-within:border-line-strong">
        <span className="text-lg leading-none text-ink-faint">+</span>
        <input
          {...NO_SPELLCHECK}
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
          placeholder={`A small step you'll finish ${when}…`}
          className="flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-faint"
        />
        <span className="kbd">↵</span>
      </div>

      <div className="mt-3 flex items-center justify-between text-[12px] text-ink-faint">
        <span>
          {steps.length === 0
            ? "Add at least one step to resolve this."
            : `${steps.length} step${steps.length === 1 ? "" : "s"} planned for ${when}`}
        </span>
        <button onClick={onFinish} className="kbd" aria-label="Finish breakdown">
          ↵ on empty to finish
        </button>
      </div>
    </div>
  );
}
