import { useEffect, useRef, useState } from "react";
import type { Habit, HabitId, HabitMark, ISODate, Project, Task, TaskId } from "../types";
import type { DayTally } from "../selectors";
import { ActionChip } from "../components/ActionChip";
import { BreakdownPanel } from "../components/BreakdownPanel";
import { DeferralBadges } from "../components/DeferralBadges";
import { NO_SPELLCHECK } from "../ui/noSpellcheck";
import { answeredOn, formatValue, markOn, valueOn } from "../store/habits";
import { KpiValueInput } from "../components/KpiValueInput";

/** One line of Shutdown's list: an open task of today's, or one of today's habits. */
export type ShutRow =
  | { kind: "task"; id: TaskId; task: Task }
  | { kind: "habit"; id: HabitId; habit: Habit };

/** Where a task sits: its project and the titles of its ancestors, root first. */
export interface TaskContext {
  project: Project | null;
  path: string[];
}

const HABIT_ANSWER: Record<HabitMark, string> = {
  done: "did it",
  skip: "rest day",
  missed: "not today",
};

/**
 * The shutdown: close the day deliberately, instead of discovering tomorrow
 * morning that you didn't.
 *
 * The Reckoning sits at the worst hour of the day — cold, before you've
 * started — and a day late: at 9am you're guessing why yesterday's task didn't
 * happen, where at the end of the day you still remember. So this is the same
 * accounting, moved to the moment you stop, and pointed at tomorrow.
 *
 * One list, one cursor: today's open tasks, then today's habits, each row with
 * its own verbs (the letters never overlap, so a key can only mean one thing on
 * the row it lands on). A shutdown can happen mid-afternoon, so every row also
 * takes "later today" — not a decision, just "not yet, still today" — and a
 * pass where everything left is "later" ends as *done for now*, not closed.
 * Every task carries its context (project › parent), because a subtask's title
 * alone rarely says what it's part of.
 */
export function ShutdownView({
  rows,
  cursorId,
  later,
  today,
  shutdownAt,
  contextOf,
  tally,
  tomorrowCount,
  breakdownTask,
  tomorrow,
  reason,
  reasonTick,
  onReasonChange,
  onSelect,
  onComplete,
  onCarry,
  onPostpone,
  onWontDo,
  onDrop,
  onStartBreakdown,
  onCarryAll,
  onLater,
  onHabitAnswer,
  onKpiValue,
  onMove,
  onAddStep,
  onFinishBreakdown,
  onExit,
}: {
  rows: ShutRow[];
  cursorId: string | null;
  /** Rows set aside as "later today" in this pass. */
  later: ReadonlySet<string>;
  today: ISODate;
  /** Today's configured shutdown time, if any — shown in the eyebrow. */
  shutdownAt: string | null;
  contextOf: (id: TaskId) => TaskContext;
  tally: DayTally;
  /** How much is already committed to tomorrow — the load you're adding to. */
  tomorrowCount: number;
  breakdownTask: Task | null;
  tomorrow: ISODate;
  reason: string;
  /** Bumped (by `/`) to open and focus the focused task's reason field. */
  reasonTick: number;
  onReasonChange: (v: string) => void;
  onSelect: (id: string) => void;
  onComplete: (id: TaskId) => void;
  onCarry: (id: TaskId) => void;
  onPostpone: (id: TaskId) => void;
  onWontDo: (id: TaskId) => void;
  onDrop: (id: TaskId) => void;
  onStartBreakdown: (id: TaskId) => void;
  onCarryAll: () => void;
  onLater: (id: string) => void;
  onHabitAnswer: (id: HabitId, mark: HabitMark) => void;
  /** A KPI's number for today (null clears it). */
  onKpiValue: (id: HabitId, value: number | null) => void;
  /** ↑/↓ from inside a KPI's field. */
  onMove: (dir: 1 | -1) => void;
  onAddStep: (parentId: TaskId, text: string) => void;
  onFinishBreakdown: () => void;
  onExit: () => void;
}) {
  if (breakdownTask != null) {
    return (
      <div className="mx-auto flex h-full w-full page-width flex-col px-10 py-10">
        <BreakdownPanel
          task={breakdownTask}
          stepDate={tomorrow}
          when="tomorrow"
          onAddStep={(text) => onAddStep(breakdownTask.id, text)}
          onFinish={onFinishBreakdown}
        />
      </div>
    );
  }

  const tasks = rows.filter((r): r is Extract<ShutRow, { kind: "task" }> => r.kind === "task");
  const habits = rows.filter((r): r is Extract<ShutRow, { kind: "habit" }> => r.kind === "habit");
  const tasksLeft = tasks.filter((r) => !later.has(r.id)).length;
  const habitsLeft = habits.filter((r) => !later.has(r.id) && !answeredOn(r.habit, today)).length;
  const laterCount =
    tasks.filter((r) => later.has(r.id)).length +
    habits.filter((r) => later.has(r.id) && !answeredOn(r.habit, today)).length;
  const resolvedToday = tally.done + tally.skipped;
  const allAnswered = tasksLeft === 0 && habitsLeft === 0;

  const title =
    tasksLeft > 0
      ? "Close the day"
      : habitsLeft > 0
        ? "And your habits"
        : laterCount > 0
          ? "Done for now"
          : "The day is closed.";

  const laterWords = [
    tasks.filter((r) => later.has(r.id)).length,
    habits.filter((r) => later.has(r.id) && !answeredOn(r.habit, today)).length,
  ];
  const laterPhrase = [
    laterWords[0] > 0 ? `${laterWords[0]} ${laterWords[0] === 1 ? "task" : "tasks"}` : null,
    laterWords[1] > 0 ? `${laterWords[1]} ${laterWords[1] === 1 ? "habit" : "habits"}` : null,
  ]
    .filter((x) => x != null)
    .join(" and ");

  return (
    <div className="mx-auto flex h-full w-full page-width flex-col px-10 py-10">
      <header className="mb-5 border-b border-line pb-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="eyebrow mb-1.5 text-accent">
              Shutdown{shutdownAt != null ? ` · ${shutdownAt}` : ""}
            </div>
            <h1 className="font-serif text-[32px] font-medium leading-none tracking-tight text-ink">{title}</h1>
          </div>
          <button tabIndex={-1} onClick={onExit} className="kbd shrink-0" aria-label="Leave shutdown">
            esc
          </button>
        </div>

        {/* Where the pass stands, at a glance — instead of a paragraph. */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]" aria-label="Progress">
          {tasks.length > 0 && <Pill noun="task" left={tasksLeft} later={laterWords[0]} />}
          {habits.length > 0 && <Pill noun="habit" left={habitsLeft} later={laterWords[1]} />}
          {resolvedToday > 0 && (
            <span className="rounded-full px-2.5 py-[2px] text-ink-faint">{resolvedToday} settled today</span>
          )}
        </div>
        <p className="mt-2 max-w-xl text-[13px] text-ink-soft">
          {tasksLeft > 0 ? (
            <>
              Give each one an ending while you still remember why — or{" "}
              <span className="kbd">l</span> if you’re still on it today.
            </>
          ) : habitsLeft > 0 ? (
            <>Did each one happen today?</>
          ) : laterCount > 0 ? (
            <>
              {laterPhrase} still today. Run Shutdown again when you stop — <span className="kbd">⌘k</span> or the
              menu bar.
            </>
          ) : (
            <>
              Nothing left unresolved — and nothing waiting to ambush you in the morning.
              {tomorrowCount > 0 && ` ${tomorrowCount} already lined up for tomorrow.`}
            </>
          )}
        </p>
      </header>

      <div className="flex flex-1 flex-col overflow-auto">
        {allAnswered && laterCount === 0 && (
          <div className="mb-6 rounded-lg border border-good/30 bg-good-soft px-6 py-8 text-center">
            <p className="font-serif text-[22px] text-ink">Nothing left to decide.</p>
            <p className="mt-2 text-[13px] text-ink-soft">
              Press <span className="kbd">esc</span> and stop working.
            </p>
          </div>
        )}

        {tasks.length > 0 && (
          <section className="mb-6">
            <SectionHeading label="Tasks" left={tasksLeft} later={laterWords[0]} />
            <div className="flex flex-col gap-1">
              {tasks.map((r) => (
                <ShutTaskRow
                  key={r.id}
                  task={r.task}
                  context={contextOf(r.task.id)}
                  focused={r.id === cursorId}
                  isLater={later.has(r.id)}
                  reason={reason}
                  reasonTick={reasonTick}
                  onReasonChange={onReasonChange}
                  onSelect={() => onSelect(r.id)}
                  onComplete={() => onComplete(r.task.id)}
                  onLater={() => onLater(r.id)}
                  onCarry={() => onCarry(r.task.id)}
                  onStartBreakdown={() => onStartBreakdown(r.task.id)}
                  onPostpone={() => onPostpone(r.task.id)}
                  onWontDo={() => onWontDo(r.task.id)}
                  onDrop={() => onDrop(r.task.id)}
                />
              ))}
            </div>
            {tasksLeft > 1 && (
              <div className="mt-3 flex items-center gap-1.5 px-3 text-[11px] text-ink-faint">
                <span className="mr-1">
                  All {tasksLeft} still waiting, unchanged
                  {tomorrowCount > 0 && ` (tomorrow already holds ${tomorrowCount})`}:
                </span>
                <ActionChip label="Carry to tomorrow" hint="⇧T" tone="soft" onClick={onCarryAll} />
              </div>
            )}
          </section>
        )}

        {habits.length > 0 && (
          <section className="mb-6">
            <SectionHeading label="Habits today" left={habitsLeft} later={laterWords[1]} />
            <div className="flex flex-col gap-1">
              {habits.map((r) =>
                r.habit.measure != null ? (
                  <ShutKpiRow
                    key={r.id}
                    habit={r.habit}
                    value={valueOn(r.habit, today)}
                    focused={r.id === cursorId}
                    isLater={later.has(r.id)}
                    onSelect={() => onSelect(r.id)}
                    onValue={(v) => onKpiValue(r.habit.id, v)}
                    onMove={onMove}
                    onLater={() => onLater(r.id)}
                  />
                ) : (
                  <ShutHabitRow
                    key={r.id}
                    habit={r.habit}
                    mark={markOn(r.habit, today)}
                    focused={r.id === cursorId}
                    isLater={later.has(r.id)}
                    onSelect={() => onSelect(r.id)}
                    onAnswer={(m) => onHabitAnswer(r.habit.id, m)}
                    onLater={() => onLater(r.id)}
                  />
                ),
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** "2 tasks left · 1 later", "1 habit later today", or "✓ tasks" when settled. */
function Pill({ noun, left, later }: { noun: string; left: number; later: number }) {
  const tone =
    left > 0
      ? "border-line-strong text-ink-soft"
      : later > 0
        ? "border-accent/40 text-accent"
        : "border-good/40 text-good";
  const text =
    left > 0
      ? `${plural(left, noun)} left${later > 0 ? ` · ${later} later` : ""}`
      : later > 0
        ? `${plural(later, noun)} later today`
        : `✓ ${noun}s`;
  return <span className={`rounded-full border px-2.5 py-[2px] ${tone}`}>{text}</span>;
}

function SectionHeading({ label, left, later }: { label: string; left: number; later: number }) {
  const status =
    left > 0 ? `${left} to go` : later > 0 ? `${later} later today` : "all answered";
  return (
    <div className="eyebrow mb-1.5 flex items-baseline gap-2 px-3">
      <span>{label}</span>
      <span className="text-ink-faint">· {status}</span>
    </div>
  );
}

/** Rows scroll into view when the cursor lands on them (keyboard-first rule). */
function useScrollIntoView(focused: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [focused]);
  return ref;
}

function LaterTag() {
  return <span className="mono shrink-0 text-[11px] text-accent">later today</span>;
}

function ShutTaskRow({
  task,
  context,
  focused,
  isLater,
  reason,
  reasonTick,
  onReasonChange,
  onSelect,
  onComplete,
  onLater,
  onCarry,
  onStartBreakdown,
  onPostpone,
  onWontDo,
  onDrop,
}: {
  task: Task;
  context: TaskContext;
  focused: boolean;
  isLater: boolean;
  reason: string;
  reasonTick: number;
  onReasonChange: (v: string) => void;
  onSelect: () => void;
  onComplete: () => void;
  onLater: () => void;
  onCarry: () => void;
  onStartBreakdown: () => void;
  onPostpone: () => void;
  onWontDo: () => void;
  onDrop: () => void;
}) {
  const ref = useScrollIntoView(focused);
  const inputRef = useRef<HTMLInputElement>(null);
  const [reasonOpen, setReasonOpen] = useState(false);
  useEffect(() => {
    if (!focused) setReasonOpen(false);
  }, [focused]);
  // `/` asks for the field: open it and put the cursor in it — on the focused
  // row only. Every row tracks the tick, so one focused *later* doesn't open.
  const seenTick = useRef(reasonTick);
  useEffect(() => {
    if (reasonTick === seenTick.current) return;
    seenTick.current = reasonTick;
    if (!focused) return;
    setReasonOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [reasonTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const showReason = focused && (reasonOpen || reason !== "");

  return (
    <div
      ref={ref}
      onClick={onSelect}
      className={[
        "relative rounded px-3 py-2.5",
        focused ? "bg-surface-2" : "cursor-pointer hover:bg-surface-2/60",
        isLater && !focused ? "opacity-60" : "",
      ].join(" ")}
    >
      {focused && <span className="absolute left-0 top-2 bottom-2 w-[2px] bg-accent" />}

      {/* Context first: a subtask's title rarely says what it belongs to. */}
      <div className="mb-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-ink-faint">
        {context.project != null && (
          <>
            <span
              className="h-[7px] w-[7px] shrink-0 rounded-full"
              style={{ backgroundColor: context.project.color }}
            />
            <span className="shrink-0">{context.project.name}</span>
          </>
        )}
        {context.path.map((p, i) => (
          <span key={i} className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden="true">›</span>
            <span className="truncate" title={p}>
              {p}
            </span>
          </span>
        ))}
      </div>

      <div className="flex items-start gap-3">
        <span className={`flex-1 text-[14px] ${focused ? "text-ink" : "text-ink-soft"}`}>
          {task.text === "" ? "Untitled" : task.text}
        </span>
        {isLater && <LaterTag />}
        <DeferralBadges task={task} />
      </div>

      {focused && task.notes.trim() !== "" && (
        <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-soft">{task.notes}</p>
      )}

      {focused && (
        <div className="mt-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <ActionChip label="Done" hint="e" tone="good" onClick={onComplete} />
            <ActionChip label={isLater ? "Ask me now" : "Later today"} hint="l" tone="today" onClick={onLater} />
            <ActionChip label="Tomorrow" hint="t" tone="soft" onClick={onCarry} />
            <ActionChip label="Break down" hint="b" tone="accent" onClick={onStartBreakdown} />
            <ActionChip label="Postpone…" hint="s" tone="soft" onClick={onPostpone} />
            <ActionChip label="Won’t do" hint="w" tone="soft" onClick={onWontDo} />
            <ActionChip label="Drop" hint="d" tone="bad" onClick={onDrop} />
          </div>
          {showReason ? (
            <input
              ref={inputRef}
              {...NO_SPELLCHECK}
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Escape" || e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
                }
              }}
              placeholder="Why? (optional — attached to whatever you choose next)"
              className="mt-2 w-full rounded-sm border border-line bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
            />
          ) : (
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                setReasonOpen(true);
                requestAnimationFrame(() => inputRef.current?.focus());
              }}
              className="mt-2 text-[11px] text-ink-faint hover:text-ink-soft"
            >
              + why? (optional) <span className="kbd ml-1">/</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ShutHabitRow({
  habit,
  mark,
  focused,
  isLater,
  onSelect,
  onAnswer,
  onLater,
}: {
  habit: Habit;
  mark: HabitMark | null;
  focused: boolean;
  isLater: boolean;
  onSelect: () => void;
  onAnswer: (m: HabitMark) => void;
  onLater: () => void;
}) {
  const ref = useScrollIntoView(focused);
  const dim = (mark != null || isLater) && !focused;
  return (
    <div
      ref={ref}
      onClick={onSelect}
      className={[
        "relative rounded px-3 py-2.5",
        focused ? "bg-surface-2" : "cursor-pointer hover:bg-surface-2/60",
        dim ? "opacity-60" : "",
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
        <span className={`min-w-0 flex-1 truncate text-[14px] ${focused ? "text-ink" : "text-ink-soft"}`}>
          {habit.name === "" ? "Untitled habit" : habit.name}
          {habit.cue !== "" && <span className="ml-2 text-[12px] italic text-ink-faint">{habit.cue}</span>}
        </span>
        {mark != null ? (
          <span className="mono shrink-0 text-[11px] text-ink-faint">{HABIT_ANSWER[mark]}</span>
        ) : (
          isLater && <LaterTag />
        )}
      </div>
      {focused && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-7">
          <ActionChip label="Did it" hint="y" tone="good" onClick={() => onAnswer("done")} />
          <ActionChip label={isLater ? "Ask me now" : "Later today"} hint="l" tone="today" onClick={onLater} />
          <ActionChip label="Rest day" hint="r" tone="soft" onClick={() => onAnswer("skip")} />
          <ActionChip label="Not today" hint="x" tone="soft" onClick={() => onAnswer("missed")} />
        </div>
      )}
    </div>
  );
}

/**
 * A KPI in the shutdown: one number. The field takes the keyboard as soon as
 * the cursor lands — type it, ↵, and the cursor moves on; ↑/↓ and `l` work
 * from inside it, esc hands the keys back to the list.
 */
function ShutKpiRow({
  habit,
  value,
  focused,
  isLater,
  onSelect,
  onValue,
  onMove,
  onLater,
}: {
  habit: Habit;
  value: number | null;
  focused: boolean;
  isLater: boolean;
  onSelect: () => void;
  onValue: (v: number | null) => void;
  onMove: (dir: 1 | -1) => void;
  onLater: () => void;
}) {
  const ref = useScrollIntoView(focused);
  const m = habit.measure;
  if (m == null) return null;
  const dim = (value != null || isLater) && !focused;
  return (
    <div
      ref={ref}
      onClick={onSelect}
      className={[
        "relative rounded px-3 py-2.5",
        focused ? "bg-surface-2" : "cursor-pointer hover:bg-surface-2/60",
        dim ? "opacity-60" : "",
      ].join(" ")}
    >
      {focused && <span className="absolute left-0 top-2 bottom-2 w-[2px] bg-accent" />}
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="mono grid h-[16px] min-w-[16px] shrink-0 place-items-center rounded-sm border border-line-strong px-0.5 text-[10px] leading-none text-ink-soft"
        >
          {value == null ? "#" : formatValue(m, value)}
        </span>
        <span className={`min-w-0 flex-1 truncate text-[14px] ${focused ? "text-ink" : "text-ink-soft"}`}>
          {habit.name === "" ? "Untitled KPI" : habit.name}
          {habit.cue !== "" && <span className="ml-2 text-[12px] italic text-ink-faint">{habit.cue}</span>}
        </span>
        {value != null ? (
          <span className="mono shrink-0 text-[11px] text-ink-faint">logged</span>
        ) : (
          isLater && <LaterTag />
        )}
      </div>
      {focused && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-7">
          <KpiValueInput
            key={`${habit.id}:${value ?? ""}`}
            measure={m}
            value={value}
            autoFocus
            onCommit={onValue}
            onMove={onMove}
            onLater={onLater}
          />
          <ActionChip label={isLater ? "Ask me now" : "Later today"} hint="l" tone="today" onClick={onLater} />
        </div>
      )}
    </div>
  );
}
