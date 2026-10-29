import { useRef, useState } from "react";
import type { Habit, HabitId, HabitMark, ISODate } from "../types";
import { habitsToLog, markOn, noteOn, pendingOn } from "../store/habits";
import { NO_SPELLCHECK } from "../ui/noSpellcheck";
import { addDays } from "../store/dates";

// Habits on the phone: the moment you do one is rarely the moment you're at
// the desk, so this is where logging costs the least. Today's habits as tap
// targets, and yesterday's unlogged ones asked once, with a yes and a no.
// ✎ beside a chip writes today's note ("Steamed broccoli!"), the same per-day
// note the desktop's Habits view takes with `c`.

export function PhoneHabits({
  habits,
  today,
  onMark,
  onNote = () => {},
}: {
  habits: Habit[];
  today: ISODate;
  onMark: (id: HabitId, date: ISODate, mark: HabitMark | null) => void;
  /** Today's note on a habit (empty clears it). */
  onNote?: (id: HabitId, date: ISODate, note: string) => void;
}) {
  const [noting, setNoting] = useState<HabitId | null>(null);
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
        // One line that scrolls sideways: wrapped, five habits took five rows
        // (a long name fills one) before the first task.
        <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-10 sm:px-10">
          <span className="eyebrow mr-1 shrink-0">Habits</span>
          {todayList.map((h) => {
            const mark = markOn(h, today);
            const done = mark === "done";
            const name = h.name || "Untitled habit";
            const note = noteOn(h, today);
            return (
              <span key={h.id} className="flex shrink-0 items-center">
                <button
                  type="button"
                  aria-pressed={done}
                  onClick={() => onMark(h.id, today, done ? null : "done")}
                  className={[
                    "flex items-center gap-1.5 rounded-l-full border px-3 py-1.5 text-[14px]",
                    done
                      ? "border-accent/50 bg-accent-soft text-accent"
                      : mark != null
                        ? "border-line text-ink-faint"
                        : "border-line-strong text-ink-soft",
                  ].join(" ")}
                >
                  <span aria-hidden="true">{done ? "✓" : mark === "skip" ? "–" : mark === "missed" ? "×" : "○"}</span>
                  <span className="max-w-[140px] truncate">{name}</span>
                </button>
                <button
                  type="button"
                  aria-label={`${name}: ${note === "" ? "add a note for today" : "edit today’s note"}`}
                  onClick={() => setNoting(noting === h.id ? null : h.id)}
                  className={[
                    "rounded-r-full border border-l-0 px-2.5 py-1.5 text-[14px]",
                    note !== "" ? "border-accent/50 text-accent" : "border-line-strong text-ink-faint",
                  ].join(" ")}
                >
                  ✎
                </button>
              </span>
            );
          })}
        </div>
      )}

      {noting != null &&
        (() => {
          const h = todayList.find((x) => x.id === noting);
          if (h == null) return null;
          return (
            <NoteField
              key={h.id}
              name={h.name || "Untitled habit"}
              initial={noteOn(h, today)}
              onDone={(text) => {
                if (text != null && text.trim() !== noteOn(h, today)) onNote(h.id, today, text);
                setNoting(null);
              }}
            />
          );
        })()}

      {todayList.some((h) => noteOn(h, today) !== "") && noting == null && (
        <ul className="mt-2 flex flex-col gap-1 text-[13px]" aria-label="Today’s habit notes">
          {todayList
            .filter((h) => noteOn(h, today) !== "")
            .map((h) => (
              <li key={h.id} className="flex min-w-0 gap-2">
                {/* Capped: a long habit name squeezed the note into a column one word wide. */}
                <span className="max-w-[40%] shrink-0 truncate text-ink-faint">{h.name || "Untitled habit"}</span>
                <span className="min-w-0 flex-1 break-words text-ink-soft">{noteOn(h, today)}</span>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}

/** Today's note for one habit: ↵ or leaving the field saves, esc backs out. */
function NoteField({
  name,
  initial,
  onDone,
}: {
  name: string;
  initial: string;
  /** The text to save, or null to leave the note as it was. */
  onDone: (text: string | null) => void;
}) {
  const [text, setText] = useState(initial);
  // Once only: esc unmounts the field, and a browser may fire blur on the way out.
  const settled = useRef(false);
  const finish = (value: string | null) => {
    if (settled.current) return;
    settled.current = true;
    onDone(value);
  };
  return (
    <label className="mt-2 flex items-center gap-2 text-[13px]">
      <span className="max-w-[40%] shrink-0 truncate text-ink-faint">{name}</span>
      <input
        autoFocus
        {...NO_SPELLCHECK}
        value={text}
        placeholder="A line about today — “Steamed broccoli!”"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => finish(text)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            finish(null);
          }
        }}
        className="min-w-0 flex-1 rounded-sm border border-line-strong bg-surface px-2.5 py-1.5 text-[15px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
      />
    </label>
  );
}
