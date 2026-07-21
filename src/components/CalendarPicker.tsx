import { useEffect, useRef, useState } from "react";
import type { ISODate } from "../types";
import { addDays, monthDayLabel, isoWeekday, WEEKDAY_SHORT } from "../store/dates";
import {
  CAL_STEP_MIN,
  MAX_START_MIN,
  MIN_DURATION_MIN,
  defaultDurationMinutes,
  defaultStartMinutes,
  formatClock,
  formatDuration,
  toEpochMs,
} from "../store/calendar";

/** No event longer than a workday from a single quick add. */
const MAX_DURATION_MIN = 12 * 60;

export interface CalendarChoice {
  startMs: number;
  durationMin: number;
}

/** Human day label: Today / Tomorrow / "Wed Jul 22". */
function dayLabel(dayISO: ISODate, today: ISODate): string {
  if (dayISO === today) return "Today";
  if (dayISO === addDays(today, 1)) return "Tomorrow";
  return `${WEEKDAY_SHORT[isoWeekday(dayISO)]} ${monthDayLabel(dayISO)}`;
}

/**
 * Quick "Add to calendar" — three fields (Day · Time · Length), all pre-filled so
 * Enter · Enter · Enter ships the event on sensible defaults. Fully keyboard-driven,
 * on the SchedulePicker model: a focused container swallows every keystroke
 * (stopPropagation) so no global shortcut leaks and there's never a focus fight.
 *   ↑/↓  adjust the active field (day ±1, time & length ±15m)
 *   ←/→ or Tab  move between fields · Enter  next field, then confirm · Esc  cancel
 */
export function CalendarPicker({
  title,
  today,
  initialDayISO,
  estimatedMinutes,
  nowMs,
  silent = false,
  onConfirm,
  onClose,
}: {
  title: string;
  today: ISODate;
  /** Where the day field starts (the task's planned date if any, else today). */
  initialDayISO: ISODate;
  estimatedMinutes: number | null;
  nowMs: number;
  /** True when confirming creates the event silently (vs. opening a browser tab). */
  silent?: boolean;
  onConfirm: (choice: CalendarChoice) => void;
  onClose: () => void;
}) {
  // A future plannedFor seeds the day; a past/absent one falls back to today —
  // you can never schedule an event before today from here.
  const startDay = initialDayISO < today ? today : initialDayISO;
  const [dayISO, setDayISO] = useState<ISODate>(startDay);
  const [startMin, setStartMin] = useState(() => defaultStartMinutes(nowMs, startDay, today));
  const [durationMin, setDurationMin] = useState(() => defaultDurationMinutes(estimatedMinutes));
  const [field, setField] = useState(0); // 0 = day, 1 = time, 2 = length
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const stepDay = (delta: number) => {
    const cand = addDays(dayISO, delta);
    setDayISO(cand < today ? today : cand); // clamp: never before today
  };

  const adjust = (delta: number) => {
    if (field === 0) stepDay(delta);
    else if (field === 1)
      setStartMin((v) => Math.min(MAX_START_MIN, Math.max(0, v + delta * CAL_STEP_MIN)));
    else
      setDurationMin((v) =>
        Math.min(MAX_DURATION_MIN, Math.max(MIN_DURATION_MIN, v + delta * CAL_STEP_MIN)),
      );
  };

  const confirm = () => {
    onClose();
    onConfirm({ startMs: toEpochMs(dayISO, startMin), durationMin });
  };

  const rows: { key: string; label: string; value: string }[] = [
    { key: "day", label: "Day", value: dayLabel(dayISO, today) },
    { key: "time", label: "Time", value: formatClock(startMin) },
    { key: "length", label: "Length", value: formatDuration(durationMin) },
  ];

  const endLabel = formatClock(startMin + durationMin);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-8 pt-[16vh] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        ref={ref}
        role="dialog"
        aria-label="Add to calendar"
        tabIndex={-1}
        onKeyDown={(e) => {
          e.stopPropagation(); // own every keystroke — no global shortcut leaks through
          if (e.key === "ArrowUp") {
            e.preventDefault();
            adjust(1);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            adjust(-1);
          } else if (e.key === "ArrowRight" || (e.key === "Tab" && !e.shiftKey)) {
            e.preventDefault();
            setField((f) => Math.min(f + 1, rows.length - 1));
          } else if (e.key === "ArrowLeft" || (e.key === "Tab" && e.shiftKey)) {
            e.preventDefault();
            setField((f) => Math.max(f - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (field < rows.length - 1) setField((f) => f + 1);
            else confirm();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        className="w-full max-w-sm overflow-hidden rounded border border-line bg-surface shadow-lg outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mono border-b border-line px-4 py-2.5 text-[11px] uppercase tracking-[0.14em] text-ink-faint">
          Add to calendar
        </div>
        <div className="truncate px-4 pt-3 text-[14px] text-ink" title={title}>
          {title.trim() === "" ? "Untitled" : title}
        </div>
        <div className="px-2 py-2">
          {rows.map((r, i) => {
            const active = i === field;
            return (
              <button
                key={r.key}
                onMouseMove={() => setField(i)}
                onClick={() => (i === rows.length - 1 ? confirm() : setField(i + 1))}
                className={[
                  "flex w-full items-center justify-between gap-3 rounded-sm px-2 py-2 text-left",
                  active ? "bg-surface-2 text-ink" : "text-ink-soft",
                ].join(" ")}
              >
                <span className="text-[12px] uppercase tracking-[0.1em] text-ink-faint">
                  {r.label}
                </span>
                <span className="flex items-center gap-2">
                  <span className="mono text-[14px] tabular-nums text-ink">{r.value}</span>
                  {active && <span className="kbd shrink-0">↑↓</span>}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2 text-[12px] text-ink-soft">
          <span className="mono">
            {dayLabel(dayISO, today)} · {formatClock(startMin)} – {endLabel}
          </span>
          <span className="text-ink-faint">
            <span className="kbd">↵</span>{" "}
            {field < rows.length - 1 ? "next" : silent ? "add to calendar" : "open in calendar"}
          </span>
        </div>
      </div>
    </div>
  );
}
