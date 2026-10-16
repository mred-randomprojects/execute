import type { Task, TaskId, WorkSession } from "../types";
import { isOpen } from "./tasks";

// ─── In progress, and the time it takes ─────────────────────────────
//
// One task at a time is the one you're working on (see InProgress in types).
// Starting another stops the last; finishing, declining, blocking or trashing
// it stops it at the store's choke point (`settleWork`), so no path that
// resolves a task can leave a timer running behind it.
//
// Pure: every function takes `now` and returns the same tree when nothing
// changed, so the choke point pays nothing on the writes that don't touch work.

/** True while time is running on it: in progress, last session still open. */
export function isRunning(t: Task): boolean {
  return t.inProgress != null && t.sessions.length > 0 && t.sessions[t.sessions.length - 1].end == null;
}

/** In progress but not running — the Mac slept, or the app was closed. */
export function isPaused(t: Task): boolean {
  return t.inProgress != null && !isRunning(t);
}

/** A task that can't be worked on: finished, declined, or waiting on someone. */
function settled(t: Task): boolean {
  return !isOpen(t) || t.waitingOn != null;
}

/**
 * Where an open session on a task that isn't in progress ends. The phone can
 * complete a task the Mac was timing, and the merge then hands over a settled
 * task with its session still open: it ended when the task settled. With no
 * such moment it ends where it began — time nobody measured isn't counted.
 */
function orphanEnd(t: Task, start: number): number {
  const at = t.completedAt ?? t.wontDo?.at ?? t.waitingOn?.since ?? start;
  return Math.max(start, at);
}

/** Time spent on this task alone, in ms, counting a running session up to `now`. */
export function workedMs(t: Task, now: number): number {
  let ms = 0;
  for (const s of t.sessions) {
    // An open session that isn't running (a settled task's, after a merge)
    // ends when the task settled — see orphanEnd.
    const end = s.end ?? (t.inProgress != null ? now : orphanEnd(t, s.start));
    ms += Math.max(0, end - s.start);
  }
  return ms;
}

/** The running session's start, or null when nothing runs. */
export function runningSince(t: Task): number | null {
  return isRunning(t) ? t.sessions[t.sessions.length - 1].start : null;
}

function walk(tasks: Task[], visit: (t: Task) => void): void {
  for (const t of tasks) {
    visit(t);
    walk(t.children, visit);
  }
}

/**
 * The task in progress. Normally there's one; if two devices each started one,
 * the most recently started wins until the next start settles it.
 */
export function workingOn(tasks: Task[]): Task | null {
  let best: Task | null = null;
  walk(tasks, (t) => {
    if (t.inProgress == null || settled(t)) return;
    if (best == null || t.inProgress.since > (best.inProgress?.since ?? -Infinity)) best = t;
  });
  return best;
}

/** Map every task that `fn` changes; untouched subtrees keep their identity. */
function mapTasks(tasks: Task[], fn: (t: Task) => Task): Task[] {
  let changed = false;
  const out = tasks.map((t) => {
    const children = t.children.length > 0 ? mapTasks(t.children, fn) : t.children;
    const self = fn(children === t.children ? t : { ...t, children });
    if (self !== t) changed = true;
    return self;
  });
  return changed ? out : tasks;
}

/** A stretch shorter than this (a double-tapped `s`) isn't kept at all. */
const MIN_SESSION_MS = 1000;

/** Close the open session, if any, at `at` (never before it started). */
function closeSession(sessions: WorkSession[], at: number): WorkSession[] {
  const last = sessions[sessions.length - 1];
  if (last == null || last.end != null) return sessions;
  const end = Math.max(last.start, at);
  const rest = sessions.slice(0, -1);
  return end - last.start < MIN_SESSION_MS ? rest : [...rest, { start: last.start, end }];
}

/** Not in progress any more: the session closes and the state clears. */
function stop(t: Task, now: number): Task {
  const sessions = closeSession(t.sessions, now);
  if (t.inProgress == null && sessions === t.sessions) return t;
  return { ...t, inProgress: null, sessions };
}

/**
 * Start (or resume) work on `id`, stopping whatever else was in progress.
 * Resuming a paused task keeps its `since`; a running one is left alone.
 */
export function startWork(tasks: Task[], id: TaskId, now: number): Task[] {
  return mapTasks(tasks, (t) => {
    if (t.id !== id) return t.inProgress != null || isOpenSession(t) ? stop(t, now) : t;
    if (settled(t) || isRunning(t)) return t;
    return {
      ...t,
      inProgress: t.inProgress ?? { since: now },
      sessions: [...closeSession(t.sessions, now), { start: now, end: null }],
    };
  });
}

/** Stop work on `id`: the time so far is kept, the task leaves "in progress". */
export function stopWork(tasks: Task[], id: TaskId, now: number): Task[] {
  return mapTasks(tasks, (t) => (t.id === id ? stop(t, now) : t));
}

/**
 * Close every running session at `at` and leave the task in progress, paused.
 * For time nobody was there for: the Mac asleep, the app closed.
 */
export function pauseWork(tasks: Task[], at: number): Task[] {
  return mapTasks(tasks, (t) => {
    if (!isOpenSession(t)) return t;
    return { ...t, sessions: closeSession(t.sessions, at) };
  });
}

function isOpenSession(t: Task): boolean {
  return t.sessions.length > 0 && t.sessions[t.sessions.length - 1].end == null;
}

/**
 * The choke point's rule: a settled task is not in progress, and neither is
 * anything but the newest start. Also closes a session left open on a task
 * that isn't in progress (a merge can produce one) — see orphanEnd.
 */
export function settleWork(tasks: Task[], now: number): Task[] {
  const keep = workingOn(tasks)?.id ?? null;
  return mapTasks(tasks, (t) => {
    if (t.inProgress == null) {
      if (!isOpenSession(t)) return t;
      const last = t.sessions[t.sessions.length - 1];
      return { ...t, sessions: closeSession(t.sessions, orphanEnd(t, last.start)) };
    }
    if (t.id === keep) return t;
    return stop(t, now);
  });
}

/** Nothing in `tasks` in progress — for what leaves the tree (the Trash). */
export function stopAll(tasks: Task[], now: number): Task[] {
  return mapTasks(tasks, (t) => stop(t, now));
}

/** Set "currently: …" on `id` — appended to its trail unless it says the same. */
export function noteProgress(tasks: Task[], id: TaskId, text: string, now: number): Task[] {
  const clean = text.trim();
  return mapTasks(tasks, (t) => {
    if (t.id !== id) return t;
    const last = t.progress[t.progress.length - 1];
    if ((last?.text ?? "") === clean) return t;
    // Clearing the note is a line of its own ("" = nothing in particular), so
    // the trail shows when you stopped saying where you were.
    if (last == null && clean === "") return t;
    return { ...t, progress: [...t.progress, { at: Math.max(now, (last?.at ?? -Infinity) + 1), text: clean }] };
  });
}

/** Where you are in the task, if you said: the last note, while in progress. */
export function currentNote(t: Task): string | null {
  if (t.inProgress == null) return null;
  const last = t.progress[t.progress.length - 1];
  // Only a note written during this stretch: yesterday's "currently" on a task
  // you just picked back up would be a stale answer to "where am I?".
  if (last == null || last.at < t.inProgress.since || last.text === "") return null;
  return last.text;
}

/** A trail for a fresh copy: no time, no state, no notes. */
export function withoutWork(t: Task): Task {
  if (t.inProgress == null && t.sessions.length === 0 && t.progress.length === 0) return t;
  return { ...t, inProgress: null, sessions: [], progress: [] };
}

// ─── Display ────────────────────────────────────────────────────────

/** "1h 05m", "25m", "40s" — a duration for a label. */
export function formatWorked(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return `${Math.max(0, Math.floor(ms / 1000))}s`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** "12:04" / "1:02:04" — a running clock. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}
