import { useRef, useState, useEffect } from "react";
import type { ISODate } from "../types";
import {
  monthKey,
  monthKeyOffset,
  monthLabel,
  weekKey,
  weekKeyOffset,
  weekLabel,
} from "../store/dates";
import { NO_SPELLCHECK } from "../ui/noSpellcheck";

/** What the user picked in the scheduler; App resolves it to plannedFor/horizon. */
export type ScheduleChoice =
  | "today"
  | "thisWeek"
  | "nextWeek"
  | "thisMonth"
  | "nextMonth"
  | "someday"
  | "inbox"
  | { date: ISODate };

interface Opt {
  key: Exclude<ScheduleChoice, { date: ISODate }>;
  label: string;
  sub: string | null;
  hint: string;
}

export function SchedulePicker({
  today,
  count,
  current,
  onPick,
  onClose,
}: {
  today: ISODate;
  count: number;
  current: string | null;
  onPick: (choice: ScheduleChoice) => void;
  onClose: () => void;
}) {
  const opts: Opt[] = [
    { key: "today", label: "Today", sub: null, hint: "t" },
    { key: "thisWeek", label: "This week", sub: weekLabel(weekKey(today)), hint: "w" },
    { key: "nextWeek", label: "Next week", sub: weekLabel(weekKeyOffset(today, 1)), hint: "e" },
    { key: "thisMonth", label: "This month", sub: monthLabel(monthKey(today)), hint: "m" },
    { key: "nextMonth", label: "Next month", sub: monthLabel(monthKeyOffset(today, 1)), hint: "n" },
    { key: "someday", label: "Someday", sub: null, hint: "s" },
    { key: "inbox", label: "Inbox", sub: null, hint: "i" },
  ];
  const initial = Math.max(0, opts.findIndex((o) => o.key === current));
  const [sel, setSel] = useState(initial);
  const [date, setDate] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const pick = (choice: ScheduleChoice) => {
    onClose();
    onPick(choice);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-8 pt-[16vh] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        ref={ref}
        tabIndex={-1}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSel((s) => Math.min(s + 1, opts.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSel((s) => Math.max(s - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(opts[sel].key);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else {
            const match = opts.find((o) => o.hint === e.key);
            if (match != null) {
              e.preventDefault();
              pick(match.key);
            }
          }
        }}
        className="w-full max-w-sm overflow-hidden rounded border border-line bg-surface shadow-lg outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mono border-b border-line px-4 py-2.5 text-[11px] uppercase tracking-[0.14em] text-ink-faint">
          Schedule{count > 1 ? ` · ${count} tasks` : ""}
        </div>
        <div className="py-1">
          {opts.map((o, i) => (
            <button
              key={o.key}
              onMouseMove={() => setSel(i)}
              onClick={() => pick(o.key)}
              className={[
                "flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-[14px]",
                i === sel ? "bg-surface-2 text-ink" : "text-ink-soft",
              ].join(" ")}
            >
              <span className="flex items-baseline gap-2">
                <span>{o.label}</span>
                {o.sub != null && <span className="mono text-[11px] text-ink-faint">{o.sub}</span>}
                {current === o.key && <span className="text-[11px] text-accent">●</span>}
              </span>
              <span className="kbd">{o.hint}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
          <span className="shrink-0 text-[12px] text-ink-faint">Or a date</span>
          <input
            {...NO_SPELLCHECK}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && date !== "") {
                e.preventDefault();
                pick({ date: date as ISODate });
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            className="flex-1 rounded-sm border border-line bg-transparent px-2 py-1 text-[13px] text-ink outline-none"
          />
        </div>
      </div>
    </div>
  );
}
