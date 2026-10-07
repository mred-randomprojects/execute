import type { Habit, HabitId, HabitMark, ISODate } from "../types";
import { habitsToLog, markOn, pendingOn } from "../store/habits";
import { addDays } from "../store/dates";

// Habits on the phone: the moment you do one is rarely the moment you're at
// the desk, so this is where logging costs the least. Today's habits as tap
// targets, and yesterday's unlogged ones asked once, with a yes and a no.

export function PhoneHabits({
  habits,
  today,
  onMark,
}: {
  habits: Habit[];
  today: ISODate;
  onMark: (id: HabitId, date: ISODate, mark: HabitMark | null) => void;
}) {
  // KPIs want a number, and the phone can't log one yet — yes/no habits only.
  const yesNo = habits.filter((h) => h.measure == null);
  const todayList = habitsToLog(yesNo, today);
  const yesterday = addDays(today, -1);
  const unloggedYesterday = yesNo.filter((h) => pendingOn(h, yesterday));
  if (todayList.length === 0 && unloggedYesterday.length === 0) return null;

  return (
    <section aria-label="Habits" className="mb-4">
      {unloggedYesterday.length > 0 && (
        <div className="mb-3 rounded-md border border-line bg-surface px-3 py-2.5">
          <p className="mb-2 text-[13px] text-ink">
            <span className="font-medium">Yesterday’s habits?</span>{" "}
            <span className="text-ink-soft">Not logged yet.</span>
          </p>
          <ul className="flex flex-col gap-1.5">
            {unloggedYesterday.map((h) => (
              <li key={h.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[14px]">{h.name || "Untitled habit"}</span>
                <button
                  type="button"
                  onClick={() => onMark(h.id, yesterday, "done")}
                  aria-label={`${h.name}: did it yesterday`}
                  className="rounded border border-accent/40 px-3 py-1.5 text-[13px] font-medium text-accent"
                >
                  ✓ Did it
                </button>
                <button
                  type="button"
                  onClick={() => onMark(h.id, yesterday, "missed")}
                  aria-label={`${h.name}: not yesterday`}
                  className="rounded border border-line-strong px-3 py-1.5 text-[13px] text-ink-soft"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {todayList.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow mr-1">Habits</span>
          {todayList.map((h) => {
            const mark = markOn(h, today);
            const done = mark === "done";
            return (
              <button
                key={h.id}
                type="button"
                aria-pressed={done}
                onClick={() => onMark(h.id, today, done ? null : "done")}
                className={[
                  "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[14px]",
                  done
                    ? "border-accent/50 bg-accent-soft text-accent"
                    : mark != null
                      ? "border-line text-ink-faint"
                      : "border-line-strong text-ink-soft",
                ].join(" ")}
              >
                <span aria-hidden="true">{done ? "✓" : mark === "skip" ? "–" : mark === "missed" ? "×" : "○"}</span>
                <span className="max-w-[180px] truncate">{h.name || "Untitled habit"}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
