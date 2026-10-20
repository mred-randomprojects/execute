import { useSyncExternalStore } from "react";
import { nanoid } from "nanoid";
import type {
  ActionLogEntry,
  AppState,
  HabitId,
  HabitMark,
  HabitMeasure,
  Horizon,
  ISODate,
  Presence,
  ProjectId,
  RecurrenceId,
  RecurrenceRule,
  TaskId,
  TaskPriority,
  ThemeName,
} from "../types";
import { ACTION_LOG_LIMIT, DEFAULT_PROJECT_ID, emptyState } from "../types";
import { findById } from "./tasks";
import { rebaseStep } from "./rebase";
import {
  coerceState,
  corruptStore,
  corruptStoreMessage,
  loadRaw,
  saveRaw,
  saveRawSync,
} from "./persistence";
import { commit, commitRebased, todayFor } from "../core/commit";
import {
  applyCommand,
  describeCommand,
  toggleWorkCommand,
  type Command,
  type CommandContext,
  type DayTally,
  type PostponeTarget,
} from "../core/commands";

export type { PostponeTarget } from "../core/commands";

// The desktop's shell around the core (src/core): the one in-memory state, its
// file on disk, undo/redo, and React's subscription. What a change *does*
// lives in core/commands, and what every change goes through in core/commit;
// this file only runs them against the state it holds.

// ─── Singleton store ────────────────────────────────────────────────

let state: AppState = emptyState();
let ready = false;
// Set when the initial load ultimately fails, so the UI can show a retry prompt
// instead of hanging on the blank loading screen forever.
let loadError: string | null = null;
// Set while the latest save to disk failed; cleared by the next one that lands.
// The app shows a banner meanwhile, and keeps retrying (see saveNow).
let saveError: string | null = null;
const listeners = new Set<() => void>();

const MAX_UNDO = 100;

/**
 * One reversible step: the state just before the action and the state it
 * produced. Undo and redo apply the difference between the two — the step's
 * footprint — on top of the state as it is by then (see store/rebase), never
 * one of the snapshots whole: changes that arrived from other devices in the
 * meantime are not the step's to take back. `id` is shared with the matching
 * {@link ActionLogEntry}, so the history panel can tell which of its
 * (persisted) lines are still reachable in memory.
 */
interface HistoryStep {
  id: string;
  label: string;
  at: number;
  before: AppState;
  after: AppState;
}

/** A history step as the UI sees it — no snapshot, just the line. */
export interface HistoryStepView {
  id: string;
  label: string;
  at: number;
}

let undoStack: HistoryStep[] = [];
let redoStack: HistoryStep[] = [];

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function notify() {
  for (const l of listeners) l();
}

// Optional hook fired right after each local persist. Cloud sync registers here
// (see src/sync/desktopSync) so it mirrors EVERY change without any per-mutation
// wiring — because it rides the single save choke point that dispatch()/undo() all
// funnel through, no mutation can silently skip a sync.
let onPersist: (() => void) | null = null;
export function setCloudSync(fn: (() => void) | null): void {
  onPersist = fn;
}

// Fired each time initStore finishes, whether the load worked or not — so a
// listener checks getLoaded(). Cloud PULL gates on this so it never merges
// remote data into — or races ahead of — the empty pre-load state (which
// initStore would then clobber on disk read), nor into the placeholder a failed
// load leaves behind.
const readyListeners = new Set<() => void>();
export function subscribeReady(cb: () => void): () => void {
  readyListeners.add(cb);
  if (ready) cb();
  return () => {
    readyListeners.delete(cb);
  };
}

/**
 * Adopt whole state pulled from the cloud (the PULL half of two-way sync).
 * Deliberately does NOT go through dispatch()/scheduleSave's `onPersist` hook, so
 * adopting a remote snapshot never schedules a push back — that would echo
 * forever. We still persist to local disk (durability) and notify subscribers.
 * Undo history is left intact: it holds the user's own edit steps, which a
 * remote change from another device doesn't invalidate — undo applies a step's
 * own footprint on top of whatever arrived since (see applyStep), so it can't
 * take the remote change back with it. Callers must only pass
 * a state that already reflects local edits (i.e. a merge, not a raw remote),
 * so this can't drop unsynced local work.
 */
export function adoptRemote(next: AppState): void {
  // The engine only runs once the store has loaded (see getLoaded), but a merge
  // landing on a store that failed to load would be written over the real file.
  if (!getLoaded()) return;
  state = next;
  notify();
  void saveNow();
}

function scheduleSave() {
  if (saveTimer != null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    // Checked when the timer fires, not when it was set. Until a load succeeds
    // `state` is the empty placeholder, and writing it would replace the real
    // file on disk; after a failed load an edit (or App's open-day effect) only
    // changes memory, which the next successful load replaces anyway.
    if (!getLoaded()) return;
    void saveNow();
    onPersist?.();
  }, 200);
}

// ─── Saving to disk ─────────────────────────────────────────────────
//
// Every save writes the whole state, so only the newest one matters: a result
// from an older save that is still in flight is ignored (`saveSeq`). A failure
// sets `saveError` and retries the current state with backoff — 1 s, 2 s, 4 s,
// up to every 30 s — until a save lands, which clears it.

const SAVE_RETRY_FIRST_MS = 1000;
const SAVE_RETRY_MAX_MS = 30_000;
let saveSeq = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = SAVE_RETRY_FIRST_MS;

/** Write the current state to disk now. Resolves true when it landed. Never
 * writes before a successful load (see getLoaded). */
export function saveNow(): Promise<boolean> {
  if (!getLoaded()) return Promise.resolve(false);
  if (retryTimer != null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  const seq = ++saveSeq;
  return saveRaw(state).then(
    () => {
      if (seq === saveSeq) settleSave(null);
      return true;
    },
    (e: unknown) => {
      if (seq === saveSeq) settleSave(e instanceof Error ? e.message : String(e));
      return false;
    },
  );
}

/** Record how the newest save ended: clear the error, or keep it and retry. */
function settleSave(error: string | null): void {
  if (error == null) {
    retryDelay = SAVE_RETRY_FIRST_MS;
    if (saveError != null) {
      saveError = null;
      notify();
    }
    return;
  }
  if (saveError !== error) {
    console.error("Saving to disk failed; retrying:", error);
    saveError = error;
    notify();
  }
  if (retryTimer != null) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void saveNow();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, SAVE_RETRY_MAX_MS);
}

/**
 * The window is going away (closed, reloaded, the app quitting): write a save
 * that is still waiting on its 200 ms debounce, or retrying after a failure,
 * before returning. A closing window can't wait for an async reply, so this
 * uses the bridge's synchronous save; a bridge without one gets an async save
 * started, which is the best left to do.
 */
export function flushPendingSave(): void {
  const debounced = saveTimer != null;
  if (saveTimer != null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if ((!debounced && saveError == null) || !getLoaded()) return;
  const landed = saveRawSync(state);
  if (landed == null) {
    void saveNow();
  } else {
    if (retryTimer != null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    saveSeq += 1; // newer than any async save still in flight
    settleSave(landed ? null : "The last save before closing didn't reach the disk.");
  }
  if (debounced) onPersist?.();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** What {@link useStore} renders from. `ready` and `loadError` are part of it:
 * a failed load leaves `state` the same object, so a snapshot of `state` alone
 * looked unchanged and the app stayed on "Loading…" until something else
 * happened to re-render it. */
interface StoreSnapshot {
  state: AppState;
  ready: boolean;
  loadError: string | null;
  saveError: string | null;
}
let snapshot: StoreSnapshot = { state, ready, loadError, saveError };

function getSnapshot(): StoreSnapshot {
  // Same object while nothing changed, as useSyncExternalStore requires.
  if (
    snapshot.state !== state ||
    snapshot.ready !== ready ||
    snapshot.loadError !== loadError ||
    snapshot.saveError !== saveError
  ) {
    snapshot = { state, ready, loadError, saveError };
  }
  return snapshot;
}


/** Prepend one line to the action history, capped. `log` is the trail to extend
 *  — passed explicitly because undo restores an old snapshot but must carry the
 *  *current* log forward: the history records what happened, and an undo did. */
function withHistory(
  s: AppState,
  log: ActionLogEntry[],
  entry: ActionLogEntry,
): AppState {
  return { ...s, actionLog: [entry, ...log].slice(0, ACTION_LOG_LIMIT) };
}

function context(): CommandContext {
  return { now: Date.now(), newId: () => nanoid() };
}

/**
 * Run a command against the state (core/commands), commit it (core/commit),
 * and — when its history line isn't `null` — record it as an undo step. The
 * line is what makes a change undoable: `null` means an incidental change
 * (preferences, dev date, rollover bookkeeping), neither undoable nor worth a
 * history line.
 */
export function dispatch(command: Command): void {
  const prev = state;
  const ctx = context();
  const next = commit(prev, applyCommand(prev, command, ctx), ctx.now);
  // A guard that bailed (`markWontDo` on an already-skipped task, and friends)
  // changes nothing. Stop here: an undo step that does nothing, and a history
  // line for a change that never happened, are both worse than silence.
  if (next === prev) return;
  const label = describeCommand(prev, command, ctx.now);
  if (label == null) {
    state = next;
  } else {
    const id = nanoid();
    state = withHistory(next, next.actionLog, { id, label, kind: "do", at: ctx.now });
    undoStack = [{ id, label, at: ctx.now, before: prev, after: state }, ...undoStack].slice(0, MAX_UNDO);
    redoStack = []; // a new action forks the timeline — nothing left to redo
  }
  notify();
  scheduleSave();
}

// ─── Lifecycle ──────────────────────────────────────────────────────

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Reject if `p` hasn't settled within `ms`. A cold-start load that never comes
 * back (e.g. an IPC reply that never arrives) would otherwise hang `initStore`
 * forever — and with it the whole app on the loading screen. With a timeout it
 * fails instead, so the retry/error path can take over. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Loading your tasks timed out.")),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export async function initStore(loadTimeoutMs = 4000): Promise<void> {
  // Load the local store, retrying a couple of times so a transient read/IPC
  // hiccup on a cold start recovers on its own, and bounding each attempt so a
  // stuck load can't hang. CRITICAL: this must ALWAYS reach `ready = true`.
  // Previously any rejection (or a load that never resolved) left the app stuck
  // forever on the blank loading screen (`ready` never flipped); this makes that
  // impossible — a real failure now surfaces a retry prompt instead of hanging.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await withTimeout(loadRaw(), loadTimeoutMs);
      const corrupt = corruptStore(raw);
      if (corrupt != null) {
        // Not a blip that a retry could ride out: the file itself is unreadable.
        lastErr = new Error(corruptStoreMessage(corrupt.backup));
        break;
      }
      state = coerceState(raw);
      // Steps recorded before this load (keys pressed on the loading or error
      // screen) snapshot the empty placeholder: undoing one would put it back
      // over everything that just loaded.
      undoStack = [];
      redoStack = [];
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await delay(150);
    }
  }
  loadError =
    lastErr == null
      ? null
      : lastErr instanceof Error
        ? lastErr.message
        : "Failed to load your saved tasks.";
  if (lastErr != null) {
    console.error("initStore: could not load the local store", lastErr);
  }
  ready = true;
  notify();
  for (const l of readyListeners) l();
}

export function getState(): AppState {
  return state;
}

/** True once the first load attempt has finished, *successfully or not* — it
 * only means the loading screen can go. Anything that writes or syncs gates on
 * {@link getLoaded} instead. */
export function getReady(): boolean {
  return ready;
}

/** True once the local store has loaded successfully. Until then `state` is the
 * empty placeholder: nothing may save it to disk, sync it, or build on it. */
export function getLoaded(): boolean {
  return ready && loadError == null;
}

/** Non-null while the latest save to disk failed — the UI shows a banner, and
 * the store keeps retrying until a save lands. */
export function getSaveError(): string | null {
  return saveError;
}

/** Non-null when the initial load failed (after retries) — the UI shows a retry
 * prompt rather than leaving the user on a blank/hung loading screen. */
export function getLoadError(): string | null {
  return loadError;
}

export function useStore(): StoreSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}

// ─── App-level settings ─────────────────────────────────────────────

export function setTheme(theme: ThemeName): void {
  dispatch({ type: "setTheme", theme });
}

export function setDevDateOverride(date: ISODate | null): void {
  dispatch({ type: "setDevDateOverride", date });
}

export function markOpened(date: ISODate): void {
  dispatch({ type: "markOpened", date });
}

/**
 * Upsert today's {@link DayRecord} — the streak's raw material. Called from a
 * render effect on every change, so it MUST change nothing when nothing
 * actually moved: dispatch bails on an unchanged state, and that bail is the
 * only thing standing between this and an infinite render loop.
 *
 * Every field is a HIGH-WATER MARK, which is the whole reason this is stored
 * rather than counted from the tree on demand. The live tally shrinks as tasks
 * leave the day: carry your last task to tomorrow and today suddenly looks like
 * a day that asked nothing of you — so the record would forget the commitment
 * existed, and the day would read as empty instead of closed. Monotonic counts
 * remember what the day was actually asked to carry.
 *
 * `closedAt` is write-once for the same reason: the day was closed at the moment
 * it first reached zero, and taking on something new at 6pm is new work rather
 * than a retraction.
 */
export function recordDay(date: ISODate, tally: DayTally, closed: boolean): void {
  dispatch({ type: "recordDay", date, tally, closed });
}

/** Set the daily capacity budget, in blocks (clamped to ≥ 1). Not undoable. */
export function setDailyCapacityBlocks(blocks: number): void {
  dispatch({ type: "setDailyCapacityBlocks", blocks });
}

/** Choose how the reckoning renders (board vs. card review). Not undoable. */
export function setBoardPreferred(preferred: boolean): void {
  dispatch({ type: "setBoardPreferred", preferred });
}

/** Render every task row peeked (title unwrapped + notes inline). Not undoable. */
export function setWrapAll(on: boolean): void {
  dispatch({ type: "setWrapAll", on });
}

/** Hide (or show) completed and won't-do tasks. A view preference, not undoable. */
export function setHideCompleted(on: boolean): void {
  dispatch({ type: "setHideCompleted", on });
}

/**
 * Change how present the app is when its window isn't (menu bar, login item,
 * nudges). A per-device preference like the theme — not undoable, and writer-wins
 * on cloud merge.
 */
export function setPresence(patch: Partial<Presence>): void {
  dispatch({ type: "setPresence", patch });
}

// ─── In progress (store/work) ───────────────────────────────────────

/** Start or resume work on a task; whatever else was in progress stops. */
export function startWorking(id: TaskId): void {
  dispatch({ type: "startWork", id });
}

/** Stop working on a task. The time so far stays on it. */
export function stopWorking(id: TaskId): void {
  dispatch({ type: "stopWork", id });
}

/**
 * `s`: start what isn't in progress, resume what's paused, stop what's running.
 * Returns what it did, for the status line.
 */
export function toggleWorking(id: TaskId): "started" | "resumed" | "stopped" | null {
  const toggle = toggleWorkCommand(state, id);
  if (toggle == null) return null;
  dispatch(toggle.command);
  return toggle.result;
}

/**
 * Close the running session at `at` and leave the task in progress, paused —
 * the Mac slept or the app was closed, and that time wasn't anyone's work.
 * Not undoable: nothing the user did, and undo putting the time back would be
 * the wrong number.
 */
export function pauseWorkAt(at: number): void {
  dispatch({ type: "pauseWorkAt", at });
}

/** "Currently: …" on the task in progress — one dated line on its trail. */
export function setProgressNote(id: TaskId, text: string): void {
  dispatch({ type: "setProgressNote", id, text });
}

/**
 * Record one run of a palette command, feeding its frecency ranking (bumps the
 * count and stamps "now"). A usage stat, like theme — not undoable.
 */
export function recordCommandUse(id: string): void {
  dispatch({ type: "recordCommandUse", commandId: id });
}

/**
 * Forget a command's ranking (Raycast's "Reset Ranking"): drop its usage entry
 * so it falls back to its default position in the palette. No-op if unused.
 */
export function resetCommandRanking(id: string): void {
  dispatch({ type: "resetCommandRanking", commandId: id });
}

// ─── Insert ─────────────────────────────────────────────────────────

/** Create a sibling after `afterId` (or append to root when null). */
export function addTaskAfter(
  afterId: TaskId | null,
  text: string,
  plannedFor: ISODate | null = null,
  projectId?: ProjectId
): TaskId {
  const id = nanoid() as TaskId;
  dispatch({ type: "addTaskAfter", id, afterId, text, plannedFor, projectId });
  return id;
}

export function addTaskAtProjectStart(
  projectId: ProjectId,
  text: string,
  plannedFor: ISODate | null = null
): TaskId {
  const id = nanoid() as TaskId;
  dispatch({ type: "addTaskAtProjectStart", id, projectId, text, plannedFor });
  return id;
}

/** Append a child to `parentId`. Used by the breakdown flow. */
export function addChild(
  parentId: TaskId,
  text: string,
  plannedFor: ISODate | null = null
): TaskId {
  const id = nanoid() as TaskId;
  dispatch({ type: "addChild", id, parentId, text, plannedFor });
  return id;
}

// ─── Projects ───────────────────────────────────────────────────────

export function createProject(name: string): ProjectId {
  const id = nanoid() as ProjectId;
  dispatch({ type: "createProject", id, name });
  return id;
}

export function renameProject(id: ProjectId, name: string): void {
  dispatch({ type: "renameProject", id, name });
}

export function cycleProjectColor(id: ProjectId): void {
  dispatch({ type: "cycleProjectColor", id });
}

// ─── Mutate ─────────────────────────────────────────────────────────

export function setText(id: TaskId, text: string): void {
  dispatch({ type: "setText", id, text });
}

export function setNotes(id: TaskId, notes: string): void {
  dispatch({ type: "setNotes", id, notes });
}

export function toggleComplete(id: TaskId): void {
  dispatch({ type: "toggleComplete", id });
}

export function setCompleted(
  id: TaskId,
  completed: boolean,
  reason: string | null = null
): void {
  dispatch({ type: "setCompleted", id, completed, reason });
}

// ─── Won't do (intentionally skipped) ───────────────────────────────
//
// A parallel terminal state to `completed`, mutually exclusive with it. Marking
// won't-do clears completion; the reason is optional and captured after the fact
// (inline or in the detail panel), so `markWontDo` records the "skipped" log with
// a null reason and `setWontDoReason` back-fills both the task and that log entry.

/** Mark one task "won't do" (clears completion). No-op if already skipped. */
export function markWontDo(id: TaskId, reason: string | null = null): void {
  dispatch({ type: "markWontDo", id, reason });
}

/** Mark a batch "won't do" — each a "skipped" log entry, one undo step. */
export function markWontDoMany(ids: TaskId[], reason: string | null = null): void {
  dispatch({ type: "markWontDoMany", ids, reason });
}

/** Reopen a skipped task (or clear a skip). Logs a reopen for the record. */
export function clearWontDo(id: TaskId): void {
  dispatch({ type: "clearWontDo", id });
}

/** Toggle the won't-do state (detail-panel / mouse affordance). */
export function toggleWontDo(id: TaskId, reason: string | null = null): void {
  const t = findById(state.tasks, id);
  if (t == null) return;
  if (t.wontDo != null) clearWontDo(id);
  else markWontDo(id, reason);
}

// ─── Waiting on someone else ────────────────────────────────────────
//
// Not a resolution: the task stays open and stays yours eventually. It just
// steps out of the Reckoning and out of the day's tally while the ball is in
// someone else's court. Completing or declining clears it, because both settle
// the task — see {@link WaitingOn} for why this exists at all.

/** Mark a task blocked (optionally on whom). No-op on a resolved task. */
export function markWaiting(id: TaskId, who: string | null = null): void {
  dispatch({ type: "markWaiting", id, who });
}

/** Unblock a task — the ball is back in your court. */
export function clearWaiting(id: TaskId): void {
  dispatch({ type: "clearWaiting", id });
}

/** Set the reason on an already-skipped task, back-filling its log entry. */
export function setWontDoReason(id: TaskId, reason: string): void {
  dispatch({ type: "setWontDoReason", id, reason });
}

/**
 * Push tasks to another day (or into the undated backlog) as a *deliberate
 * postponement*: bumps {@link Task.postponedCount}, logs each one, and lands the
 * whole batch in a single undo step.
 *
 * The counter is the point. Plain rescheduling (`s` in the outline, the panel's
 * chips) stays uncounted — moving a plan around before its day arrives is just
 * planning. This is the path taken when a task *already came due and didn't get
 * done*, which is the only postponement worth holding someone to.
 */
export function postponeManyTo(
  ids: TaskId[],
  target: PostponeTarget,
  reason: string | null = null
): void {
  dispatch({ type: "postponeMany", ids, target, reason });
}

/**
 * Re-commit unfinished tasks to a day, unchanged — the Reckoning's "Keep for
 * today" and the evening shutdown's "→ Tomorrow". Bumps `carriedCount` (the
 * counter behind the "carried N×" badge) and logs each one. One update, so a
 * batch is a single undo step.
 *
 * Both callers bump the same counter on purpose. Facing a task at 6pm rather
 * than 9am the next morning is better *behaviour*, and it's rewarded where
 * rewards belong — the day closes, the streak grows, the morning gate never
 * fires. The counter isn't measuring virtue, it's measuring the task: this
 * really is the third day running that you've promised to do it.
 */
export function carryManyTo(
  ids: TaskId[],
  date: ISODate,
  reason: string | null = null
): void {
  dispatch({ type: "carryMany", ids, date, reason });
}

/** {@link carryManyTo}, aimed at today — the Reckoning's "Keep for today". */
export function keepManyForToday(ids: TaskId[], reason: string | null = null): void {
  carryManyTo(ids, todayFor(state, Date.now()), reason);
}

export function logBreakdown(id: TaskId): void {
  dispatch({ type: "logBreakdown", id });
}

/** Soft delete: move the subtree to the Trash. Optionally log it as a drop. */
export function trashTask(
  id: TaskId,
  opts?: { reason?: string | null; log?: boolean }
): void {
  dispatch({ type: "trashTask", id, reason: opts?.reason ?? null, log: opts?.log ?? false });
}

export function restoreFromTrash(taskId: TaskId): void {
  dispatch({ type: "restoreFromTrash", id: taskId });
}

export function purgeFromTrash(taskId: TaskId): void {
  dispatch({ type: "purgeFromTrash", id: taskId });
}

export function emptyTrash(): void {
  dispatch({ type: "emptyTrash" });
}

// Both reorders take `visible`: the task ids rendered in the *same section* as
// the cursor, so a move hops over filtered-out siblings (and over anything the
// view re-listed elsewhere) instead of silently swapping past them. This one
// stays inside the tree — it never moves a task between projects — which is what
// the views that re-sort their groups (Later's buckets, the multi-day day
// headings) want: their sections stop short of the project divider.
export function reorder(
  selectedIds: TaskId[],
  dir: "up" | "down",
  visible?: Set<TaskId>
): void {
  dispatch({ type: "reorder", ids: selectedIds, dir, visible: visible == null ? null : [...visible] });
}

// …and this one lets a root task at a group's edge cross the divider into the
// neighbouring project, which is only meaningful in the plain outline.
export function reorderAcrossProjects(
  selectedIds: TaskId[],
  dir: "up" | "down",
  visible?: Set<TaskId>
): void {
  dispatch({
    type: "reorderAcrossProjects",
    ids: selectedIds,
    dir,
    visible: visible == null ? null : [...visible],
  });
}

// ─── Bulk operations (multi-select) — each a single undo step ────────

export function trashMany(ids: TaskId[]): void {
  dispatch({ type: "trashMany", ids });
}

/** Reckoning "Drop all": trash a batch of leftovers, each logged as dropped. */
export function dropManyWithLog(ids: TaskId[], reason: string | null = null): void {
  dispatch({ type: "dropManyWithLog", ids, reason });
}

export function setCompletedMany(ids: TaskId[], completed: boolean): void {
  dispatch({ type: "setCompletedMany", ids, completed });
}

export function setPlannedForMany(ids: TaskId[], date: ISODate | null): void {
  dispatch({ type: "setPlannedForMany", ids, date });
}

/** Set a fuzzy horizon (this/next week·month, someday) — clears any concrete date. */
export function setHorizonMany(ids: TaskId[], horizon: Horizon | null): void {
  dispatch({ type: "setHorizonMany", ids, horizon });
}

export function setPriority(id: TaskId, priority: TaskPriority): void {
  dispatch({ type: "setPriority", id, priority });
}

/** Set (or clear, with null) the effort estimate on a batch — one undo step. */
export function setEstimatedMinutesMany(ids: TaskId[], minutes: number | null): void {
  dispatch({ type: "setEstimatedMinutesMany", ids, minutes });
}

export function setPlannedFor(id: TaskId, plannedFor: ISODate | null): void {
  dispatch({ type: "setPlannedFor", id, plannedFor });
}

/**
 * Stamp when this task was last blocked out on the calendar (from "Add to
 * calendar"). Decoupled from the real event — just a display cue. `null` clears
 * it. Kept out of the undo stack: the event itself already lives in the user's
 * calendar, so undo here would only desync the badge from reality.
 */
export function setScheduledAt(id: TaskId, at: number | null): void {
  dispatch({ type: "setScheduledAt", id, at });
}

export function setProjectForMany(ids: TaskId[], projectId: ProjectId): void {
  dispatch({ type: "setProjectForMany", ids, projectId });
}

// ─── Outline structure ──────────────────────────────────────────────

// `underId` is the previous *visible* sibling chosen by the view (so Tab nests
// under the row above, not under a filtered-out sibling). When omitted, falls
// back to the raw previous sibling.
export function indent(id: TaskId, underId?: TaskId | null): void {
  dispatch({ type: "indent", id, underId: underId ?? null });
}

export function outdent(id: TaskId): void {
  dispatch({ type: "outdent", id });
}

export function reorderSibling(activeId: TaskId, overId: TaskId): void {
  dispatch({ type: "reorderSibling", activeId, overId });
}

export function moveBefore(taskId: TaskId, beforeId: TaskId): void {
  dispatch({ type: "moveBefore", id: taskId, beforeId });
}

export function moveAfter(taskId: TaskId, afterId: TaskId): void {
  dispatch({ type: "moveAfter", id: taskId, afterId });
}

export function moveAsChild(taskId: TaskId, newParentId: TaskId): void {
  dispatch({ type: "moveAsChild", id: taskId, parentId: newParentId });
}

// ─── Recurrences (repeating-task definitions) ───────────────────────
//
// Templates live only there, never in `tasks`, so they can't reckon or be
// counted. Node-level edits address a template by any of its task ids and find
// the owning recurrence; whole-recurrence edits take the recurrence id.

/** Create a recurrence with a one-line template. Returns both ids for focus/edit. */
export function createRecurrence(
  text: string,
  rule: RecurrenceRule,
  projectId: ProjectId = DEFAULT_PROJECT_ID
): { id: RecurrenceId; taskId: TaskId } {
  const id = nanoid() as RecurrenceId;
  const taskId = nanoid() as TaskId;
  dispatch({ type: "createRecurrence", id, taskId, text, rule, projectId });
  return { id, taskId };
}

export function setRecurrenceRule(id: RecurrenceId, rule: RecurrenceRule): void {
  dispatch({ type: "setRecurrenceRule", id, rule });
}

/**
 * File a recurrence under a project. The whole template moves together (root and
 * steps), because that's what accepting clones into a real task — an accepted
 * occurrence lands in this project, at the top of it.
 */
export function setRecurrenceProject(id: RecurrenceId, projectId: ProjectId): void {
  dispatch({ type: "setRecurrenceProject", id, projectId });
}

export function deleteRecurrence(id: RecurrenceId): void {
  dispatch({ type: "deleteRecurrence", id });
}

export function setRecurrenceText(taskId: TaskId, text: string): void {
  dispatch({ type: "setRecurrenceText", taskId, text });
}

/** Add an empty step: a child of `taskId`, or a sibling after it. Returns its id. */
export function addRecurrenceStep(taskId: TaskId, mode: "child" | "sibling"): TaskId {
  const stepId = nanoid() as TaskId;
  dispatch({ type: "addRecurrenceStep", taskId, stepId, mode });
  return stepId;
}

export function indentRecurrenceNode(taskId: TaskId, underId?: TaskId | null): void {
  dispatch({ type: "indentRecurrenceNode", taskId, underId: underId ?? null });
}

export function outdentRecurrenceNode(taskId: TaskId): void {
  dispatch({ type: "outdentRecurrenceNode", taskId });
}

/** Remove a step; removing the template root deletes the whole recurrence. */
export function removeRecurrenceNode(taskId: TaskId): void {
  dispatch({ type: "removeRecurrenceNode", taskId });
}

/**
 * Accept a recurrence for today: materialize its template as a real task (dated
 * for today, linked back to the recurrence for suppression). Returns the new
 * instance's root id for focusing, or null if the recurrence is gone.
 */
export function acceptRecurrence(recId: RecurrenceId, today: ISODate): TaskId | null {
  if (!state.recurrences.some((r) => r.id === recId)) return null;
  const id = nanoid() as TaskId;
  dispatch({ type: "acceptRecurrence", recurrenceId: recId, id, today });
  return id;
}

// ─── Habits ─────────────────────────────────────────────────────────
//
// Their own array, like recurrences: nothing there reaches `tasks`, so a habit
// can never reckon or move the day's counts. Every change is undoable and named.

/** Create a daily habit with this name — or, given a measure, a KPI. Returns its id. */
export function createHabit(name: string, perWeek = 7, measure: HabitMeasure | null = null): HabitId {
  const id = nanoid() as HabitId;
  dispatch({ type: "createHabit", id, name, perWeek, measure });
  return id;
}

export function renameHabit(id: HabitId, name: string): void {
  dispatch({ type: "renameHabit", id, name });
}

export function setHabitCue(id: HabitId, cue: string): void {
  dispatch({ type: "setHabitCue", id, cue });
}

export function setHabitPerWeek(id: HabitId, perWeek: number): void {
  dispatch({ type: "setHabitPerWeek", id, perWeek });
}

/** Set (or clear, with null) one day's mark. */
export function markHabit(id: HabitId, date: ISODate, mark: HabitMark | null): void {
  dispatch({ type: "markHabit", id, date, mark });
}

/** Done ↔ not done for that day (a rest day becomes done). */
export function toggleHabitDone(id: HabitId, date: ISODate): void {
  const h = state.habits.find((x) => x.id === id);
  if (h == null) return;
  markHabit(id, date, h.checks[date] === "done" ? null : "done");
}

/** Rest day ↔ unmarked for that day. */
export function toggleHabitSkip(id: HabitId, date: ISODate): void {
  const h = state.habits.find((x) => x.id === id);
  if (h == null) return;
  markHabit(id, date, h.checks[date] === "skip" ? null : "skip");
}

/** Not today ↔ unmarked for that day. */
export function toggleHabitMissed(id: HabitId, date: ISODate): void {
  const h = state.habits.find((x) => x.id === id);
  if (h == null) return;
  markHabit(id, date, h.checks[date] === "missed" ? null : "missed");
}

/** A KPI's range or cadence. */
export function setHabitMeasure(id: HabitId, measure: HabitMeasure): void {
  dispatch({ type: "setHabitMeasure", id, measure });
}

/** Log a KPI's number for a day (or clear it, with null). */
export function setKpiValue(id: HabitId, date: ISODate, value: number | null): void {
  dispatch({ type: "setKpiValue", id, date, value });
}

/** One place up or down within its list (habits, KPIs, or the archive). */
export function moveHabit(id: HabitId, dir: 1 | -1): void {
  dispatch({ type: "moveHabit", id, dir });
}

/** Retire a habit from the active list, keeping its history; or bring it back. */
export function setHabitArchived(id: HabitId, archived: boolean): void {
  dispatch({ type: "setHabitArchived", id, archived });
}

/** Delete a habit and its whole history. Undoable; tombstoned for the merge. */
export function deleteHabit(id: HabitId): void {
  dispatch({ type: "deleteHabit", id });
}

// ─── Undo / redo / history ──────────────────────────────────────────
//
// Undo is a stack of steps, each the pair of whole states around one action —
// coarse to record, but it means every change that goes through dispatch() is
// reversible without any per-mutation inverse to write (or forget). Applying a
// step takes only its footprint (store/rebase), never a snapshot whole. Redo is
// its mirror: undoing moves a step across to the redo stack, and any *new*
// action forks the timeline and clears it.
//
// The action log is the one thing that never rewinds. It is an account of what
// you did, so undoing records a line rather than erasing one.

/**
 * Apply a step's footprint — backwards for undo, forwards for redo — on top of
 * the state as it is now, and record the move. Only what the step changed
 * moves (store/rebase): a task captured on the phone since, a check-in made
 * there, another device's rename all stay as they are.
 *
 * The result is stamped against the state we're leaving, like any change:
 * what comes back is stamped `now` (past its own deletion record, too), or the
 * cloud's newer copy of what the step did would win the next merge and hand
 * it straight back; and tombstones are diffed against that state as well, so
 * undoing a *create* leaves a record behind, or the cloud reads the pushed copy
 * back as a fresh add and the task returns.
 */
function applyStep(step: HistoryStep, kind: "undo" | "redo"): void {
  const current = state;
  const rebased =
    kind === "undo" ? rebaseStep(step.after, step.before, current) : rebaseStep(step.before, step.after, current);
  const now = Date.now();
  state = withHistory(commitRebased(current, rebased, now), current.actionLog, {
    id: nanoid(),
    label: step.label,
    kind,
    at: now,
  });
  notify();
  scheduleSave();
}

export function undo(): void {
  const step = undoStack[0];
  if (step == null) return;
  undoStack = undoStack.slice(1);
  redoStack = [step, ...redoStack].slice(0, MAX_UNDO);
  applyStep(step, "undo");
}

export function redo(): void {
  const step = redoStack[0];
  if (step == null) return;
  redoStack = redoStack.slice(1);
  undoStack = [step, ...undoStack].slice(0, MAX_UNDO);
  applyStep(step, "redo");
}

/** Undo everything back through the step with this history id, inclusive. */
export function undoThrough(historyId: string): void {
  const idx = undoStack.findIndex((e) => e.id === historyId);
  if (idx === -1) return;
  for (let i = 0; i <= idx; i++) undo();
}

/** Redo forward through the step with this history id, inclusive. */
export function redoThrough(historyId: string): void {
  const idx = redoStack.findIndex((e) => e.id === historyId);
  if (idx === -1) return;
  for (let i = 0; i <= idx; i++) redo();
}

export function canUndo(): boolean {
  return undoStack.length > 0;
}

export function canRedo(): boolean {
  return redoStack.length > 0;
}

/** How many steps are still reversible — without materialising the stack. */
export function undoDepth(): number {
  return undoStack.length;
}

const toView = (e: HistoryStep): HistoryStepView => ({ id: e.id, label: e.label, at: e.at });

/** The reversible steps, newest first. Only these history lines can be jumped
 *  to — the log outlives the session, the snapshots don't. */
export function getUndoSteps(): HistoryStepView[] {
  return undoStack.map(toView);
}

/** The steps waiting to be redone, most-recently-undone first. */
export function getRedoSteps(): HistoryStepView[] {
  return redoStack.map(toView);
}
