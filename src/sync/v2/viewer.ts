import type { AppState } from "../../types";
import { SCHEMA_VERSION, emptyState } from "../../types";
import { META_DOC_ID, diffDocs, fromDocs, toDocs, type RawDocs } from "../docs";
import { placeTasks } from "../../store/placement";
import { FORMAT_DOC_ID, FORMAT_VERSION, HEARTBEAT_DOC_ID } from "./engine";
import { StaleViewError, docKey, type DocStore, type Expected, type ListenTarget } from "./port";

// ─── Sync v2: the web companion's view of the cloud ──────────────────
//
// The phone doesn't keep a local copy or run the merge: it shows the cloud and
// writes its own edits straight to it. It loads only what it shows — open
// tasks and tasks completed in the last RECENT_DAYS — plus projects, habits
// and meta, so a cold open costs a few hundred reads, not thousands.
//
// Each edit is an intent applied to the current view and written as field
// patches in a guarded transaction: if another device changed one of those
// documents in the meantime, nothing is written, the view refreshes, and the
// intent is applied again. Intents are idempotent ("set completed to true",
// "add this task"), so a retry can't flip anything twice.
//
// Edits are written one at a time, in the order they were made. One that fails
// (a bad mobile link, a timeout) is not dropped: it stays at the head of the
// queue, shown on screen as not saved yet, and is retried with backoff (and at
// once on `retryNow`, which the page calls when the network or the tab comes
// back). Everything made after it waits behind it, so a retry can never land
// an older edit over a newer one. The queue lives in memory only: on the
// shared origin, task text has no business in localStorage.

export const RECENT_DAYS = 14;
const DAY_MS = 86_400_000;
const MAX_ATTEMPTS = 3;
const REFRESH_WAIT_MS = 5_000;
/** How long a saved edit stays on screen while waiting for the cloud's echo. */
const OPTIMISTIC_MS = 5_000;
/** Waits before retrying an edit that failed to save; the last one repeats. */
export const RETRY_BACKOFF_MS: readonly number[] = [2_000, 5_000, 15_000, 30_000, 60_000];

export type ViewerEdit = (s: AppState) => AppState;

interface QueuedEdit {
  edit: ViewerEdit;
  resolve: () => void;
  reject: (e: unknown) => void;
  /** Whether the caller has been told it failed (once is enough). */
  told: boolean;
}

/** An edit that was saved but whose echo may not have reached the listeners yet. */
interface ShownEdit {
  edit: ViewerEdit;
  until: number;
}

export type ViewerSnapshot =
  | { phase: "loading" }
  /** The desktop hasn't moved the data to the per-item format yet. */
  | { phase: "notMigrated" }
  | {
      phase: "ready";
      state: AppState;
      /** When the cloud last had news: the newest edit loaded, or the desktop's heartbeat. */
      updatedAt: number | null;
      /** The data was written by a newer schema: read-only until this page reloads. */
      outdated: boolean;
      /**
       * Edits made here that aren't in the cloud yet because a write failed —
       * shown in `state`, retried until they land. 0 when nothing has failed.
       */
      unsaved: number;
      /** Why the oldest unsaved edit hasn't been saved, while there is one. */
      saveError: string | null;
    };

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export class ViewerSync {
  private open = new Map<string, unknown>();
  private recent = new Map<string, unknown>();
  private projects = new Map<string, unknown>();
  private habits = new Map<string, unknown>();
  private meta = new Map<string, unknown>();
  private got = new Set<string>();
  private unsubs: (() => void)[] = [];
  private deliveries = 0;
  private waiters = new Set<() => void>();
  /** Edits not yet in the cloud, oldest first; the head is the one being written. */
  private queue: QueuedEdit[] = [];
  /** Saved edits still shown until the listeners echo them. */
  private shown: ShownEdit[] = [];
  private writing = false;
  private stopped = false;
  private failures = 0;
  private lastError: string | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly store: DocStore,
    private readonly onChange: (s: ViewerSnapshot) => void,
    private readonly onError: (e: unknown) => void,
    private readonly now: () => number = Date.now,
  ) {}

  start(): void {
    this.stopped = false;
    const cutoff = this.now() - RECENT_DAYS * DAY_MS;
    const on = (name: string, into: Map<string, unknown>) => (docs: ReadonlyMap<string, unknown>) => {
      into.clear();
      for (const [k, v] of docs) into.set(k, v);
      this.got.add(name);
      this.deliveries++;
      if (name === "open" || name === "recent") this.shown = [];
      for (const w of [...this.waiters]) w();
      this.emit();
    };
    const listen = (name: string, target: ListenTarget, into: Map<string, unknown>, filter?: Parameters<DocStore["listen"]>[3]) =>
      this.unsubs.push(this.store.listen(target, on(name, into), (e) => this.onError(e), filter));
    listen("open", "tasks", this.open, { field: "completed", op: "==", value: false });
    listen("recent", "tasks", this.recent, { field: "completedAt", op: ">=", value: cutoff });
    listen("projects", "projects", this.projects);
    listen("habits", "habits", this.habits);
    listen("meta", "meta", this.meta);
  }

  stop(): void {
    this.stopped = true;
    for (const u of this.unsubs) u();
    this.unsubs = [];
    for (const w of [...this.waiters]) w();
    if (this.retryTimer != null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const dropped = this.queue;
    this.queue = [];
    this.shown = [];
    for (const q of dropped) q.reject(new Error("Signed out before this change was saved."));
  }

  private emit(): void {
    this.onChange(this.snapshot());
  }

  private rawTasks(): Map<string, unknown> {
    return new Map([...this.recent, ...this.open]);
  }

  private view(): AppState {
    const raw: RawDocs = {
      tasks: this.rawTasks(),
      projects: this.projects,
      recurrences: new Map(),
      habits: this.habits,
      tombstones: new Map(),
      log: new Map(),
      days: new Map(),
      meta: this.meta.get(META_DOC_ID) ?? null,
    };
    return fromDocs(raw, emptyState());
  }

  snapshot(): ViewerSnapshot {
    if (!["open", "recent", "projects", "habits", "meta"].every((n) => this.got.has(n))) return { phase: "loading" };
    const format = this.meta.get(FORMAT_DOC_ID);
    if (!isObject(format) || typeof format.version !== "number" || format.version < FORMAT_VERSION) {
      return { phase: "notMigrated" };
    }
    const metaState = this.meta.get(META_DOC_ID);
    const remoteVersion = isObject(metaState) && typeof metaState.schemaVersion === "number" ? metaState.schemaVersion : 0;
    const heartbeat = this.meta.get(HEARTBEAT_DOC_ID);
    let updatedAt = isObject(heartbeat) && typeof heartbeat.at === "number" ? heartbeat.at : null;
    for (const d of this.rawTasks().values()) {
      if (!isObject(d)) continue;
      for (const k of ["updatedAt", "movedAt"] as const) {
        const v = d[k];
        if (typeof v === "number" && (updatedAt == null || v > updatedAt)) updatedAt = v;
      }
    }
    const failed = this.lastError != null && this.queue.length > 0;
    return {
      phase: "ready",
      state: this.withLocalEdits(this.view()),
      updatedAt,
      outdated: remoteVersion > SCHEMA_VERSION,
      unsaved: failed ? this.queue.length : 0,
      saveError: failed ? this.lastError : null,
    };
  }

  /**
   * The cloud's view with this page's own edits on top: the saved ones whose
   * echo hasn't arrived yet, then every one still waiting to be saved, in the
   * order they were made. Intents are idempotent, so one the view already
   * holds changes nothing.
   */
  private withLocalEdits(view: AppState): AppState {
    const t = Date.now();
    this.shown = this.shown.filter((e) => e.until > t);
    let s = view;
    for (const e of [...this.shown.map((x) => x.edit), ...this.queue.map((q) => q.edit)]) s = this.placed(s, e);
    return s;
  }

  /** `edit` applied to `s`, with new and moved tasks ranked (store/placement). */
  private placed(s: AppState, edit: ViewerEdit): AppState {
    const edited = edit(s);
    return edited === s ? s : { ...edited, tasks: placeTasks(s.tasks, edited.tasks, this.now()) };
  }

  private expected(collection: "tasks" | "habits", id: string): Expected {
    const d = collection === "habits" ? this.habits.get(id) : this.rawTasks().get(id);
    return d === undefined ? { exists: false } : { exists: true, data: d };
  }

  private waitForDelivery(since: number): Promise<void> {
    if (this.deliveries > since) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(waiter);
        resolve();
      };
      const waiter = () => {
        if (this.deliveries > since) done();
      };
      const timer = setTimeout(done, REFRESH_WAIT_MS);
      this.waiters.add(waiter);
    });
  }

  /**
   * Make an edit (an idempotent intent over the current view): shown at once,
   * then written after every edit made before it. Resolves once it is in the
   * cloud. If writing it fails it stays queued and shown, and is retried until
   * it lands; the promise rejects with that first failure, so the caller can
   * say so, but the edit is not lost. Rejects without queuing only when no
   * write is possible at all (still loading, or data from a newer schema).
   */
  apply(edit: ViewerEdit): Promise<void> {
    const snap = this.snapshot();
    if (snap.phase !== "ready") return Promise.reject(new Error("Still loading — try again in a moment."));
    if (snap.outdated) {
      return Promise.reject(new Error("A newer version of Execute saved this data. Reload the page to update."));
    }
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ edit, resolve, reject, told: false });
      this.emit();
      void this.pump();
    });
  }

  /** Try the unsaved edits again now (the network or the tab just came back). */
  retryNow(): void {
    if (this.queue.length === 0 || this.writing || this.stopped) return;
    if (this.retryTimer != null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    void this.pump();
  }

  /** Write the queue, oldest first, until it's empty or a write fails. */
  private async pump(): Promise<void> {
    if (this.writing || this.stopped) return;
    this.writing = true;
    try {
      while (this.queue.length > 0 && !this.stopped) {
        const head = this.queue[0];
        try {
          await this.write(head.edit);
        } catch (e: unknown) {
          if (this.stopped) return;
          this.failures += 1;
          this.lastError = e instanceof Error ? e.message : String(e);
          if (!head.told) {
            head.told = true;
            head.reject(e);
          }
          this.emit();
          this.scheduleRetry();
          return;
        }
        if (this.stopped) return;
        this.queue.shift();
        this.failures = 0;
        this.lastError = null;
        this.shown.push({ edit: head.edit, until: Date.now() + OPTIMISTIC_MS });
        head.resolve();
        this.emit();
      }
    } finally {
      this.writing = false;
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer != null) clearTimeout(this.retryTimer);
    const delay = RETRY_BACKOFF_MS[Math.min(this.failures, RETRY_BACKOFF_MS.length) - 1];
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.pump();
    }, delay);
  }

  /**
   * Write one edit against the current view, retrying on a refreshed view if
   * another device changed one of its documents first.
   */
  private async write(edit: ViewerEdit): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      const snap = this.snapshot();
      if (snap.phase !== "ready") throw new Error("Still loading — try again in a moment.");
      if (snap.outdated) throw new Error("A newer version of Execute saved this data. Reload the page to update.");
      const view = this.view();
      const placed = this.placed(view, edit);
      const writes = diffDocs(toDocs(view), toDocs(placed)).flatMap((w) =>
        w.collection === "tasks" || w.collection === "habits" ? [{ ...w, collection: w.collection }] : [],
      );
      if (writes.length === 0) return;

      const since = this.deliveries;
      try {
        await this.store.commit(
          writes,
          new Map(writes.map((w) => [docKey(w.collection, w.id), this.expected(w.collection, w.id)])),
        );
        return;
      } catch (e: unknown) {
        if (!(e instanceof StaleViewError) || attempt >= MAX_ATTEMPTS) throw e;
        await this.waitForDelivery(since);
      }
    }
  }
}
