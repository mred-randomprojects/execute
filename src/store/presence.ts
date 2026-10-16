import type { Habit, Presence, Task } from "../types";
import { runningSince } from "./work";

// What the desktop shell needs to know to be a presence: how much is left today,
// what it is, and which of the four surfaces the user has turned on. The renderer
// does the counting (it owns the tree and the notion of "today"); the main process
// only renders this — menu-bar title, dock badge, login item, two nudges.
//
// Kept pure and in its own file so the interesting part — *which* titles a
// notification is allowed to name — is testable without an Electron runtime.

/** How many task titles a nudge may name before it stops being glanceable. */
export const NUDGE_TITLE_LIMIT = 3;

export interface PresenceSnapshot extends Presence {
  /** Open, committed-to-today work — the number on the menu bar and the badge. */
  remaining: number;
  /** The first few of those, so a notification can say what rather than only how many. */
  titles: string[];
  /**
   * Habits still unanswered today. Never on the menu-bar number (that is the
   * day's commitments, and a habit isn't one) — only folded into the evening
   * nudge, which may now fire for habits alone. Still two nudges a day, total.
   */
  habitsLeft: number;
  habitNames: string[];
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

/**
 * Build the snapshot. Untitled tasks are dropped rather than sent as blanks: a
 * notification reading "3 left today: , , " is worse than one that just says 3.
 */
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
    titles: openToday
      .map((t) => t.text.trim())
      .filter((text) => text !== "")
      .slice(0, NUDGE_TITLE_LIMIT),
    habitsLeft: habitsLeftToday.length,
    habitNames: habitsLeftToday
      .map((h) => h.name.trim())
      .filter((name) => name !== "")
      .slice(0, NUDGE_TITLE_LIMIT),
  };
}
