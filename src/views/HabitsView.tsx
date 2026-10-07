import { useEffect, useRef, useState } from "react";
import type { Habit, HabitId, HabitMark, HabitMeasure, ISODate } from "../types";
import {
  cadenceLabel,
  everyLabel,
  formatValue,
  kpiSummary,
  loggedInPeriod,
  rangeLabel,
  valueOn,
  habitStart,
  markOn,
  nudge,
  recentDays,
  streak,
  streakLabel,
  strength,
  weekProgress,
} from "../store/habits";
import { WEEKDAY_SHORT, formatLong, isoWeekday } from "../store/dates";
import { NO_SPELLCHECK } from "../ui/noSpellcheck";
import { KpiValueInput } from "../components/KpiValueInput";

/** How many days the check-in strip shows (and ←/→ can reach): two weeks. */
export const HABIT_STRIP_DAYS = 14;

/**
 * Past this many active habits the header says so. Not a cap — a nudge. Every
 * habit app that lets you start twelve at once watches you abandon all twelve;
 * the ones that work start with one and add the next when the first is boring.
 */
const PLENTY = 5;

export type HabitField = "name" | "cue" | "value";

export interface HabitEditing {
  id: HabitId;
  field: HabitField;
}

/**
 * A strip column: a little gap before each Monday, and the older of the two
 * weeks hidden on a narrow window so the habit's name keeps its room.
 */
function stripCellClass(d: ISODate, index: number, days: ISODate[]): string {
  const older = index < days.length - 7;
  const gap = isoWeekday(d) === 1 && index > 0 && !(older || index === days.length - 7) ? "ml-[5px]" : "";
  const gapWide = isoWeekday(d) === 1 && index > 0 ? "lg:ml-[5px]" : "";
  return [older ? "hidden lg:flex" : "flex", gap, gapWide].join(" ");
}

const NEXT_MARK: Record<"none" | HabitMark, HabitMark | null> = {
  none: "done",
  done: "skip",
  skip: null,
  missed: "done",
};

/**
 * One day in the strip. Click cycles: unlogged → done → rest day → unlogged
 * (an answered "not today" goes to done). Unlogged and answered-no look alike
 * but for a faint ×, because they score alike — the × only says it was asked.
 */
function DayCell({
  date,
  mark,
  beforeStart,
  isToday,
  isCursor,
  onClick,
}: {
  date: ISODate;
  mark: HabitMark | null;
  beforeStart: boolean;
  isToday: boolean;
  isCursor: boolean;
  onClick: () => void;
}) {
  const state =
    mark === "done"
      ? "done"
      : mark === "skip"
        ? "rest day"
        : mark === "missed"
          ? "not done"
          : beforeStart
            ? "before this habit"
            : isToday
              ? "open"
              : "not logged";
  return (
    <button
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation();
        e.currentTarget.blur();
        onClick();
      }}
      title={`${formatLong(date)} — ${state}`}
      aria-label={`${formatLong(date)}: ${state}`}
      className={[
        "grid h-[14px] w-[14px] shrink-0 place-items-center rounded-[3px] text-[9px] leading-none transition-colors",
        mark === "done"
          ? "bg-accent"
          : mark === "skip"
            ? "bg-surface-3 text-ink-faint"
            : beforeStart
              ? "border border-dashed border-line opacity-50"
              : isToday
                ? "border border-accent"
                : "border border-line-strong",
        isCursor ? "outline outline-2 outline-offset-1 outline-ink" : "",
      ].join(" ")}
    >
      {mark === "skip" ? "–" : mark === "missed" ? <span className="text-ink-faint">×</span> : null}
    </button>
  );
}

function StrengthMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <span className="flex w-[32px] shrink-0 items-center gap-1.5 lg:w-[84px]" title={`Strength ${pct}% — forgiving: a miss dents it, it doesn't reset it`}>
      <span className="hidden h-[4px] flex-1 overflow-hidden rounded-full bg-surface-3 lg:block">
        <span className="block h-full bg-accent" style={{ width: `${pct}%` }} />
      </span>
      <span className="mono w-[28px] text-right text-[11px] text-ink-soft">{pct}%</span>
    </span>
  );
}

function InlineInput({
  initial,
  placeholder,
  onCommit,
  onTab,
}: {
  initial: string;
  placeholder: string;
  onCommit: (value: string) => void;
  onTab?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const commit = (v: string) => {
    if (done.current) return;
    done.current = true;
    onCommit(v);
  };
  return (
    <input
      autoFocus
      {...NO_SPELLCHECK}
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => commit(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          commit(value);
        } else if (e.key === "Tab" && onTab != null) {
          e.preventDefault();
          done.current = true;
          onTab(value);
        }
      }}
      className="w-full min-w-0 bg-transparent text-inherit outline-none placeholder:text-ink-faint"
    />
  );
}

function HabitRow({
  habit,
  today,
  days,
  focused,
  cursorDay,
  editing,
  onSelect,
  onSelectDay,
  onMark,
  onCommit,
  onEdit,
}: {
  habit: Habit;
  today: ISODate;
  days: ISODate[];
  focused: boolean;
  cursorDay: ISODate | null;
  editing: HabitField | null;
  onSelect: () => void;
  onSelectDay: (date: ISODate) => void;
  onMark: (date: ISODate, mark: HabitMark | null) => void;
  onCommit: (field: HabitField, value: string, then: HabitField | null) => void;
  onEdit: (field: HabitField) => void;
}) {
  const archived = habit.archivedAt != null;
  const start = habitStart(habit);
  const todayMark = markOn(habit, today);
  const week = weekProgress(habit, today);
  const tip = archived ? null : nudge(habit, today);
  const run = streak(habit, today);

  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) rowRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [focused]);

  return (
    <div
      ref={rowRef}
      onClick={onSelect}
      className={[
        "relative flex items-center gap-3 rounded px-3 py-2.5 select-none",
        focused ? "bg-surface-2" : "cursor-default hover:bg-surface-2/60",
        archived ? "opacity-60" : "",
      ].join(" ")}
    >
      {focused && <span className="absolute left-0 top-2 bottom-2 w-[2px] bg-accent" />}

      <button
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          e.currentTarget.blur();
          onMark(today, todayMark === "done" ? null : "done");
        }}
        title={todayMark === "done" ? "Done today — click to undo" : "Check in for today"}
        aria-label={`Check in ${habit.name || "habit"} for today`}
        aria-pressed={todayMark === "done"}
        className={[
          "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-sm border text-[12px] leading-none",
          todayMark === "done" ? "border-accent bg-accent text-bg" : "border-line-strong text-transparent hover:border-accent",
        ].join(" ")}
      >
        ✓
      </button>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] text-ink">
          {editing === "name" ? (
            <InlineInput
              initial={habit.name}
              placeholder="A habit, small enough to do on a bad day"
              onCommit={(v) => onCommit("name", v, null)}
              onTab={(v) => onCommit("name", v, "cue")}
            />
          ) : (
            <span onDoubleClick={() => onEdit("name")}>
              {habit.name === "" ? <span className="text-ink-faint">Untitled habit</span> : habit.name}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-ink-faint">
          {editing === "cue" ? (
            <span className="min-w-0 flex-1 italic">
              <InlineInput
                initial={habit.cue}
                placeholder="When? “after my morning coffee”"
                onCommit={(v) => onCommit("cue", v, null)}
              />
            </span>
          ) : (
            <>
              {habit.cue !== "" && (
                <>
                  <span className="truncate italic" onDoubleClick={() => onEdit("cue")}>
                    {habit.cue}
                  </span>
                  <span>·</span>
                </>
              )}
              <span className="shrink-0">{cadenceLabel(habit.perWeek)}</span>
              {archived && <span className="shrink-0">· archived</span>}
              {tip != null && (
                <>
                  <span>·</span>
                  <span
                    className={[
                      "truncate",
                      tip.tone === "good" ? "text-good" : tip.tone === "warn" ? "text-mid" : "",
                    ].join(" ")}
                  >
                    {tip.text}
                  </span>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-[3px]">
        {days.map((d, i) => (
          <span key={d} className={stripCellClass(d, i, days)}>
            <DayCell
              date={d}
              mark={markOn(habit, d)}
              beforeStart={d < start}
              isToday={d === today}
              isCursor={focused && cursorDay === d}
              onClick={() => {
                onSelectDay(d);
                onMark(d, NEXT_MARK[markOn(habit, d) ?? "none"]);
              }}
            />
          </span>
        ))}
      </div>

      <span
        className="mono w-[52px] shrink-0 text-right text-[11px] text-ink-soft"
        title="Done this week, of this week's target"
      >
        {week.done}/{week.target}
        <span className="text-ink-faint"> wk</span>
      </span>
      <StrengthMeter value={strength(habit, today)} />
      <span className="mono w-[64px] shrink-0 text-right text-[11px] text-ink-soft" title={run.unit === "day" ? "Done days in a row — one miss is forgiven, two in a row end it" : "Weeks in a row that met the target"}>
        {streakLabel(run)}
      </span>
    </div>
  );
}

/** One KPI day: shaded by where the value sits in the range, the number on it. */
function ValueCell({
  date,
  measure,
  value,
  beforeStart,
  isToday,
  isCursor,
  onClick,
}: {
  date: ISODate;
  measure: HabitMeasure;
  value: number | null;
  beforeStart: boolean;
  isToday: boolean;
  isCursor: boolean;
  onClick: () => void;
}) {
  const share = value == null ? 0 : (value - measure.min) / (measure.max - measure.min);
  const pct = Math.round(15 + Math.max(0, Math.min(1, share)) * 85);
  const label = value == null ? (beforeStart ? "before this KPI" : "not logged") : formatValue(measure, value);
  return (
    <button
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation();
        e.currentTarget.blur();
        onClick();
      }}
      title={`${formatLong(date)} — ${label}`}
      aria-label={`${formatLong(date)}: ${label}`}
      style={
        value == null
          ? undefined
          : {
              backgroundColor: `color-mix(in srgb, var(--accent) ${pct}%, transparent)`,
              color: pct > 55 ? "var(--bg)" : "var(--ink)",
            }
      }
      className={[
        "mono grid h-[16px] w-[20px] shrink-0 place-items-center rounded-[3px] text-[9px] leading-none transition-colors",
        value != null
          ? ""
          : beforeStart
            ? "border border-dashed border-line opacity-50"
            : isToday
              ? "border border-accent"
              : "border border-line-strong",
        isCursor ? "outline outline-2 outline-offset-1 outline-ink" : "",
      ].join(" ")}
    >
      {value == null ? null : formatValue(measure, value)}
    </button>
  );
}

function KpiRow({
  habit,
  measure,
  today,
  days,
  focused,
  cursorDay,
  editing,
  onSelect,
  onSelectDay,
  onValue,
  onCommit,
  onEdit,
  onCancelValue,
}: {
  habit: Habit;
  measure: HabitMeasure;
  today: ISODate;
  days: ISODate[];
  focused: boolean;
  cursorDay: ISODate;
  editing: HabitField | null;
  onSelect: () => void;
  onSelectDay: (date: ISODate) => void;
  onValue: (date: ISODate, value: number | null) => void;
  onCommit: (field: HabitField, value: string, then: HabitField | null) => void;
  onEdit: (field: HabitField) => void;
  onCancelValue: () => void;
}) {
  const archived = habit.archivedAt != null;
  const start = habitStart(habit);
  const summary = kpiSummary(habit, today);
  const todayValue = valueOn(habit, today);
  const periodDone = loggedInPeriod(habit, today) != null;
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) rowRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [focused]);

  return (
    <div
      ref={rowRef}
      onClick={onSelect}
      className={[
        "relative flex flex-col rounded px-3 py-2.5 select-none",
        focused ? "bg-surface-2" : "cursor-default hover:bg-surface-2/60",
        archived ? "opacity-60" : "",
      ].join(" ")}
    >
      {focused && <span className="absolute left-0 top-2 bottom-2 w-[2px] bg-accent" />}
      <div className="flex items-center gap-3">
        <button
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            e.currentTarget.blur();
            onSelectDay(today);
            onEdit("value");
          }}
          title={todayValue == null ? "Log today’s value" : `Today: ${formatValue(measure, todayValue)} — click to change`}
          aria-label={`Log ${habit.name || "KPI"} for today`}
          className={[
            "mono grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-sm border px-0.5 text-[10px] leading-none",
            todayValue != null ? "border-accent bg-accent text-bg" : "border-line-strong text-ink-faint hover:border-accent",
          ].join(" ")}
        >
          {todayValue == null ? "#" : formatValue(measure, todayValue)}
        </button>

        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] text-ink">
            {editing === "name" ? (
              <InlineInput
                initial={habit.name}
                placeholder="What to measure — a range and “weekly”/“monthly” can follow: “Dizzy spells 0-3+”"
                onCommit={(v) => onCommit("name", v, null)}
                onTab={(v) => onCommit("name", v, "cue")}
              />
            ) : (
              <span onDoubleClick={() => onEdit("name")}>
                {habit.name === "" ? <span className="text-ink-faint">Untitled KPI</span> : habit.name}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-ink-faint">
            {editing === "cue" ? (
              <span className="min-w-0 flex-1 italic">
                <InlineInput
                  initial={habit.cue}
                  placeholder="When to log it? “at dinner”"
                  onCommit={(v) => onCommit("cue", v, null)}
                />
              </span>
            ) : (
              <>
                {habit.cue !== "" && (
                  <>
                    <span className="truncate italic" onDoubleClick={() => onEdit("cue")}>
                      {habit.cue}
                    </span>
                    <span>·</span>
                  </>
                )}
                <span className="mono shrink-0">{rangeLabel(measure)}</span>
                <span>·</span>
                <span className="shrink-0">{everyLabel(measure.every)}</span>
                {archived && <span className="shrink-0">· archived</span>}
                {!archived && measure.every !== "day" && (
                  <span className={periodDone ? "shrink-0 text-good" : "shrink-0"}>
                    · {periodDone ? `logged this ${measure.every}` : `not logged this ${measure.every} yet`}
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-[3px]">
          {days.map((d, i) => (
            <span key={d} className={stripCellClass(d, i, days)}>
              <ValueCell
                date={d}
                measure={measure}
                value={valueOn(habit, d)}
                beforeStart={d < start}
                isToday={d === today}
                isCursor={focused && cursorDay === d}
                onClick={() => {
                  onSelectDay(d);
                  onEdit("value");
                }}
              />
            </span>
          ))}
        </div>

        <span className="mono w-[44px] shrink-0 text-right text-[12px] text-ink" title={summary.title}>
          {summary.main}
        </span>
        <span className="mono w-[64px] shrink-0 text-right text-[11px] text-ink-soft" title={summary.title}>
          {summary.aside}
        </span>
      </div>
      {editing === "value" && (
        <div className="mt-2 flex items-center gap-2 pl-[30px] text-[12px] text-ink-soft">
          <span className="shrink-0">{cursorDay === today ? "Today" : formatLong(cursorDay)}:</span>
          <KpiValueInput
            measure={measure}
            value={valueOn(habit, cursorDay)}
            autoFocus
            onCommit={(v) => onValue(cursorDay, v)}
            onCancel={onCancelValue}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Habits: the things you keep rather than finish. A list, a two-week strip per
 * habit, and one key to check in — the whole loop is meant to take seconds,
 * because the cost of logging is the first thing that kills a habit tracker.
 */
export function HabitsView({
  habits,
  today,
  cursorId,
  dayOffset,
  editing,
  onSelect,
  onSelectDay,
  onMark,
  onCommit,
  onEdit,
  onNew,
  onNewKpi,
  onValue,
}: {
  /** Active habits, then active KPIs, then the archive — the order the cursor walks. */
  habits: Habit[];
  today: ISODate;
  cursorId: HabitId | null;
  /** Days back from today the day cursor sits on (0 = today). */
  dayOffset: number;
  editing: HabitEditing | null;
  onSelect: (id: HabitId) => void;
  onSelectDay: (id: HabitId, date: ISODate) => void;
  onMark: (id: HabitId, date: ISODate, mark: HabitMark | null) => void;
  onCommit: (id: HabitId, field: HabitField, value: string, then: HabitField | null) => void;
  onEdit: (id: HabitId, field: HabitField) => void;
  onNew: () => void;
  onNewKpi: () => void;
  onValue: (id: HabitId, date: ISODate, value: number | null) => void;
}) {
  const days = recentDays(today, HABIT_STRIP_DAYS);
  const cursorDay = days[days.length - 1 - dayOffset] ?? today;
  const active = habits.filter((h) => h.archivedAt == null && h.measure == null);
  const kpis = habits.filter((h) => h.archivedAt == null && h.measure != null);
  const archived = habits.filter((h) => h.archivedAt != null);
  const doneToday = active.filter((h) => markOn(h, today) === "done").length;
  const kpisLogged = kpis.filter((h) => loggedInPeriod(h, today) != null).length;

  const row = (h: Habit) =>
    h.measure != null ? (
      <KpiRow
        key={h.id}
        habit={h}
        measure={h.measure}
        today={today}
        days={days}
        focused={h.id === cursorId}
        cursorDay={cursorDay}
        editing={editing?.id === h.id ? editing.field : null}
        onSelect={() => onSelect(h.id)}
        onSelectDay={(d) => onSelectDay(h.id, d)}
        onValue={(d, v) => onValue(h.id, d, v)}
        onCommit={(field, value, then) => onCommit(h.id, field, value, then)}
        onEdit={(field) => onEdit(h.id, field)}
        onCancelValue={() => onCommit(h.id, "value", "", null)}
      />
    ) : (
    <HabitRow
      key={h.id}
      habit={h}
      today={today}
      days={days}
      focused={h.id === cursorId}
      cursorDay={cursorDay}
      editing={editing?.id === h.id ? editing.field : null}
      onSelect={() => onSelect(h.id)}
      onSelectDay={(d) => onSelectDay(h.id, d)}
      onMark={(d, m) => onMark(h.id, d, m)}
      onCommit={(field, value, then) => onCommit(h.id, field, value, then)}
      onEdit={(field) => onEdit(h.id, field)}
    />
  );

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-6 py-10 lg:px-10">
      <header className="mb-5 flex items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <div className="eyebrow mb-1.5 text-accent">Habits &amp; KPIs</div>
          <h1 className="font-serif text-[32px] font-medium leading-none tracking-tight text-ink">
            {active.length === 0 && kpis.length > 0
              ? kpisLogged === kpis.length
                ? "All measured."
                : `${kpisLogged} of ${kpis.length} measured.`
              : active.length === 0
              ? "Start with one."
              : doneToday === active.length
                ? "All kept today."
                : `${doneToday} of ${active.length} kept today.`}
          </h1>
          <p className="mt-2 max-w-xl text-[14px] text-ink-soft">
            {active.length === 0
              ? "Something small enough to do on your worst day — two minutes is plenty. Grow it once showing up is automatic."
              : active.length > PLENTY
                ? `${active.length} at once is a lot. Habits draw on the same attention — the ones that stick usually arrive one at a time.`
                : "Showing up beats intensity. Miss a day and nothing resets — just don’t miss twice."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button tabIndex={-1} onClick={onNew} className="shrink-0 rounded-sm border border-line px-2.5 py-1 text-[12px] text-ink-soft hover:border-line-strong hover:text-ink"
            title="New habit (n)"
          >
            New habit <span className="kbd ml-1">n</span>
          </button>
          <button tabIndex={-1} onClick={onNewKpi} className="shrink-0 rounded-sm border border-line px-2.5 py-1 text-[12px] text-ink-soft hover:border-line-strong hover:text-ink"
            title="New KPI — a number to log, not a yes/no (k)"
          >
            New KPI <span className="kbd ml-1">k</span>
          </button>
        </div>
      </header>

      {active.length > 0 && (
        <div className="mb-1 flex items-center gap-3 px-3 text-[10px] text-ink-faint" aria-hidden="true">
          <span className="w-[18px] shrink-0" />
          <span className="flex-1" />
          <div className="mono flex shrink-0 items-center gap-[3px]">
            {days.map((d, i) => (
              <span
                key={d}
                className={[stripCellClass(d, i, days), "w-[14px] justify-center", d === today ? "text-accent" : ""].join(" ")}
              >
                {WEEKDAY_SHORT[isoWeekday(d)][0]}
              </span>
            ))}
          </div>
          <span className="w-[52px] shrink-0 text-right">week</span>
          <span className="w-[32px] shrink-0 text-right lg:w-[84px]">
            <span className="hidden lg:inline">strength</span>
            <span className="lg:hidden" title="strength">str</span>
          </span>
          <span className="w-[64px] shrink-0 text-right">streak</span>
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-auto">
        {habits.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-[13px] text-ink-faint">
            Press <span className="kbd">n</span> to add a habit, or <span className="kbd">k</span> for a KPI — a number to
            log each day, like a symptom or a score.
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {active.map(row)}
            {kpis.length > 0 && (
              <>
                <div className={`${active.length > 0 ? "mt-6" : ""} mb-1 flex items-center gap-3 px-3 text-[10px] text-ink-faint`}>
                  <span className="eyebrow flex-1" title="Measured, not kept: one number per day (or week, or month). No streaks, no strength.">
                    KPIs
                  </span>
                  <div className="mono flex shrink-0 items-center gap-[3px]" aria-hidden="true">
                    {days.map((d, i) => (
                      <span
                        key={d}
                        className={[stripCellClass(d, i, days), "w-[20px] justify-center", d === today ? "text-accent" : ""].join(" ")}
                      >
                        {WEEKDAY_SHORT[isoWeekday(d)][0]}
                      </span>
                    ))}
                  </div>
                  <span className="w-[44px] shrink-0 text-right" title="Daily: the 7-day average. Weekly/monthly: the latest value.">
                    7d / last
                  </span>
                  <span className="w-[64px] shrink-0 text-right">vs</span>
                </div>
                {kpis.map(row)}
              </>
            )}
            {archived.length > 0 && (
              <div className="eyebrow mt-6 mb-1 px-3">Archived</div>
            )}
            {archived.map(row)}
          </div>
        )}
      </div>
    </div>
  );
}
