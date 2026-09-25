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
// tasks and tasks completed in the last RECENT_DAYS — plus projects and meta,
// so a cold open costs a few hundred reads, not thousands.
//
// Each edit is an intent applied to the current view and written as field
// patches in a guarded transaction: if another device changed one of those
// documents in the meantime, nothing is written, the view refreshes, and the
// intent is applied again. Intents are idempotent ("set completed to true",
// "add this task"), so a retry can't flip anything twice.

export const RECENT_DAYS = 14;
const DAY_MS = 86_400_000;
const MAX_ATTEMPTS = 3;
const REFRESH_WAIT_MS = 5_000;
/** How long an optimistic edit is shown while waiting for the cloud's echo. */
const OPTIMISTIC_MS = 5_000;

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
    };

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export class ViewerSync {
  private open = new Map<string, unknown>();
  private recent = new Map<string, unknown>();
  private projects = new Map<string, unknown>();
  private meta = new Map<string, unknown>();
  private got = new Set<string>();
  private unsubs: (() => void)[] = [];
  private deliveries = 0;
  private waiters = new Set<() => void>();
  private optimistic: { state: AppState; until: number } | null = null;

  constructor(
    private readonly store: DocStore,
    private readonly onChange: (s: ViewerSnapshot) => void,
    private readonly onError: (e: unknown) => void,
    private readonly now: () => number = Date.now,
  ) {}

  start(): void {
    const cutoff = this.now() - RECENT_DAYS * DAY_MS;
    const on = (name: string, into: Map<string, unknown>) => (docs: ReadonlyMap<string, unknown>) => {
      into.clear();
      for (const [k, v] of docs) into.set(k, v);
      this.got.add(name);
      this.deliveries++;
      if (name === "open" || name === "recent") this.optimistic = null;
      for (const w of [...this.waiters]) w();
      this.emit();
    };
    const listen = (name: string, target: ListenTarget, into: Map<string, unknown>, filter?: Parameters<DocStore["listen"]>[3]) =>
      this.unsubs.push(this.store.listen(target, on(name, into), (e) => this.onError(e), filter));
    listen("open", "tasks", this.open, { field: "completed", op: "==", value: false });
    listen("recent", "tasks", this.recent, { field: "completedAt", op: ">=", value: cutoff });
    listen("projects", "projects", this.projects);
    listen("meta", "meta", this.meta);
  }

  stop(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    for (const w of [...this.waiters]) w();
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
      tombstones: new Map(),
      log: new Map(),
      days: new Map(),
      meta: this.meta.get(META_DOC_ID) ?? null,
    };
    return fromDocs(raw, emptyState());
  }

  snapshot(): ViewerSnapshot {
    if (!["open", "recent", "projects", "meta"].every((n) => this.got.has(n))) return { phase: "loading" };
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
    const optimistic = this.optimistic != null && this.optimistic.until > Date.now() ? this.optimistic.state : null;
    return {
      phase: "ready",
      state: optimistic ?? this.view(),
      updatedAt,
      outdated: remoteVersion > SCHEMA_VERSION,
    };
  }

  private expected(id: string): Expected {
    const d = this.rawTasks().get(id);
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
   * Apply an edit (an idempotent intent over the current view) and write it.
   * Shows it at once; retries against a refreshed view if another device got
   * there first. Only task documents are ever written from here.
   */
  async apply(edit: (s: AppState) => AppState): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      const snap = this.snapshot();
      if (snap.phase !== "ready") throw new Error("Still loading — try again in a moment.");
      if (snap.outdated) throw new Error("A newer version of Execute saved this data. Reload the page to update.");
      const view = this.view();
      const edited = edit(view);
      const placed: AppState = { ...edited, tasks: placeTasks(view.tasks, edited.tasks, this.now()) };
      const writes = diffDocs(toDocs(view), toDocs(placed)).filter((w) => w.collection === "tasks");
      if (writes.length === 0) return;

      this.optimistic = { state: placed, until: Date.now() + OPTIMISTIC_MS };
      this.emit();
      const since = this.deliveries;
      try {
        await this.store.commit(writes, new Map(writes.map((w) => [docKey(w.collection, w.id), this.expected(w.id)])));
        return;
      } catch (e: unknown) {
        this.optimistic = null;
        this.emit();
        if (!(e instanceof StaleViewError) || attempt >= MAX_ATTEMPTS) throw e;
        await this.waitForDelivery(since);
      }
    }
  }
}
