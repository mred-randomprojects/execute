import { useLayoutEffect, useMemo, useRef } from "react";
import type { ActionLogEntry } from "../types";
import type { HistoryStepView } from "../store/store";
import { toISO } from "../store/dates";

/**
 * The action history: every change you made, newest first, straight from the
 * store's append-only log. Undoing is an event here rather than an erasure, so
 * the panel is an honest account of what happened — not a view of what survived.
 *
 * The *snapshots* behind undo live in memory only, so a line is jumpable
 * (↵ rewinds through it, or replays it) only while its step is still on one of
 * the two stacks; older lines — and the undo/redo lines themselves — read as a
 * plain record. Presentational: the keyboard runs through the keymap's "history"
 * context, and App owns the cursor.
 */

/** Whether a log line still has a snapshot behind it, and in which direction. */
export type HistoryReach = "undo" | "redo" | "gone";

export interface HistoryRow {
  entry: ActionLogEntry;
  reach: HistoryReach;
}

/** Pair the persisted log with the snapshots still held in memory. */
export function buildHistoryRows(
  entries: ActionLogEntry[],
  undoSteps: HistoryStepView[],
  redoSteps: HistoryStepView[]
): HistoryRow[] {
  const reach = new Map<string, HistoryReach>();
  for (const s of undoSteps) reach.set(s.id, "undo");
  for (const s of redoSteps) reach.set(s.id, "redo");
  return entries.map((entry) => ({ entry, reach: reach.get(entry.id) ?? "gone" }));
}

function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(at: number, todayISODate: string): string {
  const iso = toISO(new Date(at));
  if (iso === todayISODate) return "Today";
  return new Date(at).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

const KIND_GLYPH: Record<ActionLogEntry["kind"], string> = { do: "·", undo: "↶", redo: "↷" };

/** "Complete “X”" → "complete “X”", so it reads under "Undid …". */
function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function lineText(entry: ActionLogEntry): string {
  if (entry.kind === "undo") return `Undid ${lowerFirst(entry.label)}`;
  if (entry.kind === "redo") return `Redid ${lowerFirst(entry.label)}`;
  return entry.label;
}

export function HistoryPanel({
  rows,
  sel,
  undoCount,
  today,
  onHover,
  onJump,
  onClose,
}: {
  rows: HistoryRow[];
  /** Index of the focused row (App owns it — the keymap drives the moves). */
  sel: number;
  /** How many steps are still reversible in this session. */
  undoCount: number;
  today: string;
  onHover: (index: number) => void;
  onJump: (row: HistoryRow) => void;
  onClose: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the focused row visible — the same contract every list here honours.
  useLayoutEffect(() => {
    listRef.current
      ?.querySelector(`[data-history-index="${sel}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [sel, rows.length]);

  // Day headers: emitted when the day changes walking newest → oldest.
  const headers = useMemo(() => {
    const out: Array<string | null> = [];
    let last = "";
    for (const { entry } of rows) {
      const day = dayLabel(entry.at, today);
      out.push(day === last ? null : day);
      last = day;
    }
    return out;
  }, [rows, today]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-8 pt-[10vh] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded border border-line bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
          <h2 className="text-[15px] text-ink">History</h2>
          <span className="text-[11px] text-ink-faint">
            {undoCount === 0
              ? "nothing to undo in this session"
              : `${undoCount} undoable in this session`}
          </span>
        </div>

        <div ref={listRef} role="listbox" aria-label="Action history" className="overflow-auto py-1">
          {rows.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-ink-faint">
              Nothing yet — your next change lands here.
            </div>
          ) : (
            rows.map((row, i) => {
              const isSel = i === sel;
              const header = headers[i];
              const undone = row.reach === "redo";
              return (
                <div key={row.entry.id}>
                  {header != null && (
                    <div className="px-4 pb-1 pt-3 text-[11px] uppercase tracking-wide text-ink-faint">
                      {header}
                    </div>
                  )}
                  <div
                    role="option"
                    aria-selected={isSel}
                    data-history-index={i}
                    onMouseMove={() => onHover(i)}
                    onClick={() => row.reach !== "gone" && onJump(row)}
                    className={[
                      "flex items-center gap-3 px-4 py-1.5 text-[13px]",
                      row.reach === "gone" ? "cursor-default" : "cursor-pointer",
                      isSel ? "bg-surface-2 text-ink" : "text-ink-soft",
                      // An action that's been taken back reads as struck through:
                      // it happened, and then it was undone.
                      undone ? "opacity-50" : "",
                    ].join(" ")}
                  >
                    <span className="w-16 shrink-0 whitespace-nowrap tabular-nums text-ink-faint">
                      {timeLabel(row.entry.at)}
                    </span>
                    <span className="w-3 shrink-0 text-center text-ink-faint">
                      {KIND_GLYPH[row.entry.kind]}
                    </span>
                    <span className={["truncate", undone ? "line-through" : ""].join(" ")}>
                      {lineText(row.entry)}
                    </span>
                    {isSel && row.reach !== "gone" && (
                      <span className="ml-auto shrink-0 whitespace-nowrap text-[11px] text-ink-faint">
                        {row.reach === "undo" ? "↵ rewind to here" : "↵ replay"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line px-4 py-1.5 text-[11px] text-ink-faint">
          <span>↑↓ to walk · ↵ to rewind · esc to close</span>
          <span>
            <span className="kbd">⌘z</span> undo · <span className="kbd">⌘⇧z</span> redo
          </span>
        </div>
      </div>
    </div>
  );
}
