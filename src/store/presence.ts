import type { Presence, Task } from "../types";

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
}

/**
 * Build the snapshot. Untitled tasks are dropped rather than sent as blanks: a
 * notification reading "3 left today: , , " is worse than one that just says 3.
 */
export function presenceSnapshot(
  presence: Presence,
  openToday: Task[],
): PresenceSnapshot {
  return {
    ...presence,
    remaining: openToday.length,
    titles: openToday
      .map((t) => t.text.trim())
      .filter((text) => text !== "")
      .slice(0, NUDGE_TITLE_LIMIT),
  };
}
