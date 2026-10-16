// When the app stopped watching: the Mac asleep, the screen locked, the app
// not running at all. The timer on the task in progress (src/store/work.ts)
// asks this for the first such moment after its session started, and closes
// the session there — so a night asleep or a weekend with the app quit never
// lands on a task as hours worked.
//
// It lives in the main process, not the window, because closing the window
// isn't leaving: on macOS the app keeps running in the menu bar, and a timer
// that paused every time the window closed would be wrong all day.

const fs = require("node:fs");

/** Down for less than this (a relaunch to update, a crash and restart) still counts as worked. */
const RESTART_GRACE_MS = 5 * 60_000;
/** How many off moments to remember — far more than a session spans. */
const MAX_OFFS = 100;

/**
 * @param {{ file: string, now?: () => number }} opts
 *   `file` holds the last moment the app was alive, written by `beat()`.
 */
function createAwake({ file, now = Date.now }) {
  let previousAliveAt = null;
  try {
    const at = Number(JSON.parse(fs.readFileSync(file, "utf8")).at);
    if (Number.isFinite(at)) previousAliveAt = at;
  } catch {
    // First run, or unreadable: we just don't know when it last ran.
  }
  const startedAt = now();
  /** @type {number[]} */
  const offs = [];

  return {
    /** Record that the app is alive now (call it every minute and on quit). */
    beat() {
      try {
        fs.writeFileSync(file, JSON.stringify({ at: now() }));
      } catch {
        // Losing one beat costs at most a minute of accuracy.
      }
    },
    /** The Mac is going to sleep, or the screen just locked. */
    off(at = now()) {
      offs.push(at);
      if (offs.length > MAX_OFFS) offs.shift();
    },
    /**
     * The first moment at or after `since` that nobody was there, or null.
     * A sleep or a lock in this run, or else — if the app started after
     * `since` and had been down for a while — when it was last alive.
     */
    firstOffSince(since) {
      if (typeof since !== "number" || !Number.isFinite(since)) return null;
      let first = null;
      for (const at of offs) if (at >= since && (first == null || at < first)) first = at;
      if (first != null) return first;
      if (since < startedAt && previousAliveAt != null && startedAt - previousAliveAt > RESTART_GRACE_MS) {
        return Math.max(since, previousAliveAt);
      }
      return null;
    },
  };
}

module.exports = { createAwake, RESTART_GRACE_MS };
