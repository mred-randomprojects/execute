import type { Habit, Presence, Task } from "../types";
import { runningSince } from "./work";

// What the desktop shell needs to know to be a presence: how much is left today,
// what's in progress, and which surfaces the user has turned on. The renderer
// does the counting (it owns the tree and the notion of "today"); the main
// process only renders this — menu-bar title and menu, dock badge, login item.

export interface PresenceSnapshot extends Presence {
  /** Open, committed-to-today work — the number on the menu bar and the badge. */
  remaining: number;
  /**
   * Habits still unanswered today — a line in the menu-bar menu. Never on the
   * number (that is the day's commitments, and a habit isn't one).
   */
  habitsLeft: number;
  /**
   * The task in progress, so the menu bar can run its clock while the window
   * is closed: when the running session began (null = paused) and the time
   * already on it before that. The shell does the ticking.
   */
  working: { title: string; runningSince: number | null; workedBefore: number } | null;
}

function working(t: Task | null): PresenceSnapshot["working"] {
  if (t == null) return null;
  const since = runningSince(t);
  let before = 0;
  for (const s of t.sessions) if (s.end != null) before += Math.max(0, s.end - s.start);
  return { title: t.text.trim() || "Untitled", runningSince: since, workedBefore: before };
}

export function presenceSnapshot(
  presence: Presence,
  openToday: Task[],
  habitsLeftToday: Habit[] = [],
  inProgress: Task | null = null,
): PresenceSnapshot {
  return {
    ...presence,
    working: working(inProgress),
    remaining: openToday.length,
    habitsLeft: habitsLeftToday.length,
  };
}
