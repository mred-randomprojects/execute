import { useEffect, useRef, useState } from "react";
import type { Habit, HabitId, HabitMark, ISODate } from "../types";
import { markOn, withMark } from "../store/habits";
import { ActionChip } from "./ActionChip";

// "Did you…?" for one day, a habit at a time. Shared by the evening shutdown
// (today) and the morning prompt (yesterday): the two moments the app already
// owns, which is the whole trick to not forgetting to log — ask at a fixed
// moment instead of hoping someone remembers to visit a view.

const ANSWER_LABEL: Record<HabitMark, string> = {
  done: "did it",
  skip: "rest day",
  missed: "not today",
};

/** The next habit after `fromId` (wrapping) whose day is still unanswered. */
export function nextUnanswered(list: Habit[], date: ISODate, fromId: HabitId | null): HabitId | null {
  const start = list.findIndex((h) => h.id === fromId);
  for (let i = 1; i <= list.length; i++) {
    const h = list[(start + i + list.length) % list.length];
    if (h != null && markOn(h, date) == null) return h.id;
  }
  return null;
}

export function HabitCheckList({
  habits,
  date,
  cursorId,
  interactive,
  onSelect,
  onAnswer,
}: {
  habits: Habit[];
  date: ISODate;
  cursorId: HabitId | null;
  /** Whether the keys apply here right now (the cursor bar and chips show). */
  interactive: boolean;
  onSelect: (id: HabitId) => void;
  /** Answer for this habit; answering the same way again clears it. */
  onAnswer: (id: HabitId, mark: HabitMark) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {habits.map((h) => (
        <HabitAskRow
          key={h.id}
          habit={h}
          mark={markOn(h, date)}
          focused={interactive && h.id === cursorId}
          onSelect={() => onSelect(h.id)}
          onAnswer={(m) => onAnswer(h.id, m)}
        />
      ))}
    </div>
  );
}

function HabitAskRow({
  habit,
  mark,
  focused,
  onSelect,
  onAnswer,
}: {
  habit: Habit;
  mark: HabitMark | null;
  focused: boolean;
  onSelect: () => void;
  onAnswer: (m: HabitMark) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [focused]);
  return (
    <div
      ref={ref}
      onClick={onSelect}
      className={[
        "relative rounded px-3 py-2",
        focused ? "bg-surface-2" : "cursor-pointer hover:bg-surface-2/60",
      ].join(" ")}
    >
      {focused && <span className="absolute left-0 top-2 bottom-2 w-[2px] bg-accent" />}
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={[
            "grid h-[16px] w-[16px] shrink-0 place-items-center rounded-sm border text-[11px] leading-none",
            mark === "done"
              ? "border-accent bg-accent text-bg"
              : mark == null
                ? "border-line-strong text-transparent"
                : "border-line-strong text-ink-faint",
          ].join(" ")}
        >
          {mark === "done" ? "✓" : mark === "skip" ? "–" : mark === "missed" ? "×" : ""}
        </span>
        <span className={`min-w-0 flex-1 truncate text-[14px] ${mark == null ? "text-ink" : "text-ink-soft"}`}>
          {habit.name === "" ? "Untitled habit" : habit.name}
          {habit.cue !== "" && <span className="ml-2 text-[12px] italic text-ink-faint">{habit.cue}</span>}
        </span>
        {mark != null && <span className="mono shrink-0 text-[11px] text-ink-faint">{ANSWER_LABEL[mark]}</span>}
      </div>
      {focused && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-7">
          <ActionChip label="Did it" hint="y" tone="good" onClick={() => onAnswer("done")} />
          <ActionChip label="Rest day" hint="r" tone="soft" onClick={() => onAnswer("skip")} />
          <ActionChip label="Not today" hint="x" tone="soft" onClick={() => onAnswer("missed")} />
        </div>
      )}
    </div>
  );
}

/**
 * The same questions as a small modal, for a day the shutdown didn't cover —
 * opened from the morning band ("yesterday") or ⌘k. Owns its keys while open
 * (↑/↓, y/r/x, esc), like the confirm dialog, so nothing fires beneath it.
 */
export function HabitLogPanel({
  habits,
  date,
  title,
  onAnswer,
  onClose,
}: {
  /** Already narrowed to the day (habitsToLog). */
  habits: Habit[];
  date: ISODate;
  title: string;
  onAnswer: (id: HabitId, mark: HabitMark | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [cursorId, setCursorId] = useState<HabitId | null>(
    () => nextUnanswered(habits, date, null) ?? habits[0]?.id ?? null,
  );
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const left = habits.filter((h) => markOn(h, date) == null).length;

  const answer = (id: HabitId | null, mark: HabitMark) => {
    const h = habits.find((x) => x.id === id);
    if (h == null) return;
    const next = markOn(h, date) === mark ? null : mark;
    onAnswer(h.id, next);
    const after = habits.map((x) => (x.id === h.id ? withMark(x, date, next) : x));
    setCursorId(nextUnanswered(after, date, h.id) ?? h.id);
    ref.current?.focus(); // a clicked chip blurs itself; keep the keys here
  };
  const move = (dir: 1 | -1) => {
    const i = habits.findIndex((h) => h.id === cursorId);
    const next = habits[Math.min(Math.max(i + dir, 0), habits.length - 1)];
    if (next != null) setCursorId(next.id);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-8 pt-[14vh] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.metaKey || e.ctrlKey || e.altKey) return; // ⌘z & co. still reach the app
          e.stopPropagation();
          const k = e.key.toLowerCase();
          if (e.key === "Escape" || (e.key === "Enter" && left === 0)) onClose();
          else if (e.key === "ArrowDown") move(1);
          else if (e.key === "ArrowUp") move(-1);
          else if (k === "y") answer(cursorId, "done");
          else if (k === "r") answer(cursorId, "skip");
          else if (k === "x") answer(cursorId, "missed");
          else return;
          e.preventDefault();
        }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded border border-line bg-surface shadow-lg outline-none"
      >
        <div className="px-5 pb-3 pt-4">
          <h2 className="text-[15px] font-medium text-ink">{title}</h2>
          <p className="mt-1 text-[13px] text-ink-soft">
            {left === 0
              ? "All logged."
              : "Forgetting to log isn’t the same as not doing — say which it was."}
          </p>
        </div>
        <div className="max-h-[50vh] overflow-auto px-2 pb-2">
          <HabitCheckList
            habits={habits}
            date={date}
            cursorId={cursorId}
            interactive
            onSelect={(id) => {
              setCursorId(id);
              ref.current?.focus();
            }}
            onAnswer={(id, m) => answer(id, m)}
          />
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-line px-4 py-2.5 text-[11px] text-ink-faint">
          <span>
            <span className="kbd">y</span> did it · <span className="kbd">r</span> rest ·{" "}
            <span className="kbd">x</span> not today
          </span>
          <button onClick={onClose} className="flex items-center gap-1.5 rounded-sm px-2 py-1 text-[13px] text-ink-soft hover:text-ink">
            {left === 0 ? "Done" : "Later"} <span className="kbd">{left === 0 ? "↵" : "esc"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
