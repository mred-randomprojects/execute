import { useMemo } from "react";
import type { DayRecord, ISODate } from "../types";
import { currentRun, heatmap, recentRate, type HeatDay } from "../store/streak";
import { formatLong } from "../store/dates";

const WEEKS = 10;

/**
 * Four intensities. The floor still reads clearly as green, because a closed day
 * must never be mistaken for an empty one — but a day closed by declining
 * everything stays visibly paler than one you actually cleared. The streak is
 * forgiving; the picture isn't.
 */
function doneShade(done: number): string {
  if (done >= 6) return "bg-good";
  if (done >= 3) return "bg-good/70";
  if (done >= 1) return "bg-good/45";
  return "bg-good/30";
}

function squareClass(day: HeatDay): string {
  if (day.isFuture) return "bg-transparent";
  // Today isn't missed, it's unfinished. Painting the current day red at 9am
  // would be the app calling a loss before the day has been played.
  if (day.isToday && day.status !== "closed") {
    return day.committed > 0 ? "bg-accent/25" : "bg-line";
  }
  switch (day.status) {
    case "closed":
      return doneShade(day.done);
    case "missed":
      return "bg-bad/35";
    case "empty":
      return "bg-line";
  }
}

function tooltip(day: HeatDay): string {
  const when = formatLong(day.date);
  if (day.isFuture) return when;
  if (day.isToday && day.status !== "closed") {
    return day.committed > 0
      ? `Today — ${day.committed - day.done} still open`
      : "Today — nothing committed yet";
  }
  switch (day.status) {
    case "closed":
      return `${when} — closed · ${day.done} of ${day.committed} done`;
    case "missed":
      return `${when} — ${day.committed - day.done} left unresolved`;
    case "empty":
      return `${when} — nothing committed`;
  }
}

/**
 * The closing streak: a run counter and ten weeks of squares.
 *
 * Sits in the sidebar rather than behind a command, because its whole job is to
 * be seen without being asked for — a passive reminder that days get closed,
 * next to the counts you already glance at.
 */
export function DayStreak({
  days,
  today,
  onOpenReview,
}: {
  days: DayRecord[];
  today: ISODate;
  /** The squares show the shape of the week; the review shows why it's that shape. */
  onOpenReview: () => void;
}) {
  const grid = useMemo(() => heatmap(days, today, WEEKS), [days, today]);
  const run = useMemo(() => currentRun(days, today), [days, today]);
  const rate = useMemo(() => recentRate(days, today, 30), [days, today]);

  // Column-major: each column is one week, each row one weekday.
  const columns: HeatDay[][] = [];
  for (let i = 0; i < grid.length; i += 7) columns.push(grid.slice(i, i + 7));

  return (
    <button
      onClick={onOpenReview}
      title="Review your week"
      className="w-full rounded-sm px-2.5 pb-1 pt-2 text-left transition-colors hover:bg-surface-2/60"
    >
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="eyebrow">Closed</span>
        <span className="mono text-[11px] text-ink-faint" title="Days closed, of the days that asked something of you">
          {rate.counted > 0 ? `${rate.closed}/${rate.counted} · 30d` : "—"}
        </span>
      </div>

      <div className="flex gap-[2px]" role="img" aria-label={`Closed ${run.days} days running`}>
        {columns.map((week) => (
          <div key={week[0].date} className="flex flex-col gap-[2px]">
            {week.map((day) => (
              <span
                key={day.date}
                title={tooltip(day)}
                className={[
                  "h-[9px] w-[9px] rounded-[2px]",
                  squareClass(day),
                  day.isToday ? "ring-1 ring-accent ring-offset-0" : "",
                ].join(" ")}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="mt-1.5 text-[11px] text-ink-soft">
        {run.days === 0 ? (
          <span className="text-ink-faint">Close today to start a run.</span>
        ) : (
          <>
            <span className="text-ink">
              {run.days} day{run.days === 1 ? "" : "s"} running
            </span>
            {/* The grace is shown, never hidden — a forgiving number that lies
                about what happened is worth less than no number. */}
            {run.missed > 0 && (
              <span className="text-ink-faint">
                {" "}
                · {run.missed} missed
              </span>
            )}
          </>
        )}
      </div>
    </button>
  );
}
