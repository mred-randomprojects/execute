import type { AppState } from "../../types";
import { SCHEMA_VERSION } from "../../types";
import {
  META_DOC_ID,
  asRaw,
  diffDocs,
  fromDocs,
  toDocs,
  type CloudDocs,
  type Collection,
  type DocWrite,
  type MetaDoc,
  type RawDocs,
} from "../docs";
import { jsonEqual, mergeStates } from "../merge";
import {
  MAX_BATCH,
  StaleViewError,
  docKey,
  type DocStore,
  type Expected,
  type ListenTarget,
} from "./port";

// ─── Sync v2: the desktop's sync engine over per-item documents ──────
//
// The cloud is a set of small documents (see ../docs). Each round:
//
//   1. read the documents this device listens to into a state (`fromDocs`),
//   2. merge that into the local state (`mergeStates` — the one merge) and
//      adopt the result locally if it changed,
//   3. diff the merged state against the documents and commit the difference.
//
// Commits to documents that already exist are GUARDED: they run in a
// transaction that first checks each document is still exactly what this
// device merged against. A document someone else changed in between fails the
// check (StaleViewError), nothing is written, and the next round merges the
// change first. Transactions also fail instead of queueing when offline, so a
// laptop waking up can never replay a stale write over a newer one from the
// phone. Only brand-new documents in bulk (the first upload) and log lines —
// neither of which anyone else can have written — go out as plain batches.
//
// The first round on a cloud that still has only the v1 single document
// migrates: merge v1 in, upload everything, verify it reads back, then write
// meta/format and freeze v1 so outdated clients stop writing it.

export const FORMAT_DOC_ID = "format";
export const HEARTBEAT_DOC_ID = "heartbeat";
export const FORMAT_VERSION = 2;

/** The local side: the store, seen through the few calls the engine needs. */
export interface EngineHost {
  /** False until the local store has loaded — never sync a pre-load empty state. */
  ready(): boolean;
  getLocal(): AppState;
  /** Increases on every local change; lets the caller know what a round covered. */
  version(): number;
  /** Replace the local state with a merge result (not an undoable edit). */
  adopt(next: AppState): void;
}

/** The one-time move from the v1 single document. */
export interface Migration {
  /** The v1 document as a state, or null if there is none. */
  loadV1(): Promise<AppState | null>;
  /** Mark v1 superseded so outdated clients refuse to write it. Idempotent. */
  freezeV1(): Promise<void>;
}

/** Where the log watermark lives: per device, never synced. */
export interface Watermark {
  get(): number;
  set(at: number): void;
}

export type EngineStatus =
  | { kind: "stopped" }
  | { kind: "starting" }
  | { kind: "migrating"; detail: string }
  | { kind: "syncing"; writes: number }
  /** A guarded write met a newer copy in the cloud; merging it before retrying. */
  | { kind: "waiting" }
  /** Local and cloud agree, as of local version `version`. */
  | { kind: "inSync"; at: number; version: number }
  | { kind: "error"; message: string; retryAt: number | null }
  /** The documents don't read back as written: stopped rather than loop. */
  | { kind: "halted"; message: string }
  /** The cloud was written by a newer schema: stopped until this app updates. */
  | { kind: "outdated"; remoteVersion: number };

export interface EngineOptions {
  migration?: Migration;
  onStatus?: (s: EngineStatus) => void;
  /** Clock for stamps written to the cloud (heartbeat, migratedAt). */
  now?: () => number;
  /** How often an idle, healthy engine touches meta/heartbeat. Default 1 hour. */
  heartbeatMs?: number;
  /** How long to wait for the cloud to echo a commit. Default 20 s. */
  deliveryTimeoutMs?: number;
  /** Retry delays after consecutive failures; the last repeats. */
  backoffMs?: readonly number[];
}

/** Everything the desktop needs; the log is written, never read back. */
const LISTENED: readonly ListenTarget[] = [
  "tasks",
  "projects",
  "recurrences",
  "tombstones",
  "days",
  "meta",
];
/** Collections whose unreadable leftovers (junk, expired tombstones) get deleted. */
const CLEANABLE: readonly Collection[] = ["tasks", "projects", "recurrences", "tombstones", "days"];
/** Above this many writes, brand-new documents go out as plain batches. */
const BULK_THRESHOLD = 100;
/** Guarded writes per transaction: each is also a read, so stay well under 500. */
const GUARDED_CHUNK = 200;
const MAX_PASSES = 6;
const MAX_STALE_IN_A_ROW = 5;
const V1_TIMEOUT_MS = 30_000;
/**
 * The last line of defence against an oscillation nobody foresaw: more rounds
 * than this that commit without any local edit behind them, inside the window,
 * and the engine stops instead of burning the daily write quota.
 */
const UNPROMPTED_LIMIT = 30;
const UNPROMPTED_WINDOW_MS = 10 * 60_000;

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function withoutLog(docs: CloudDocs): CloudDocs {
  return { ...docs, log: new Map() };
}

/**
 * The documents of a state as a reader would see them: through `fromDocs` once,
 * so read-side normalisation (tombstone expiry, sorting, coercion) applies to
 * both sides of a diff alike and can never show up as a difference that no
 * write could fix.
 */
export function canonicalDocs(state: AppState): CloudDocs {
  return toDocs(fromDocs(asRaw(toDocs(state)), state));
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export class DocSync {
  private raw = new Map<ListenTarget, ReadonlyMap<string, unknown>>();
  private delivered = new Map<ListenTarget, number>();
  private waiters = new Set<() => void>();
  private unsubs: (() => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerDue = Infinity;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private again = false;
  private stopped = true;
  private halted = false;
  private lastCommittedKey: string | null = null;
  private failures = 0;
  private staleInARow = 0;
  private v1Merged = false;
  private settledVersion: number | null = null;
  private unprompted: number[] = [];
  private status: EngineStatus = { kind: "stopped" };

  constructor(
    private readonly store: DocStore,
    private readonly host: EngineHost,
    private readonly watermark: Watermark,
    private readonly opts: EngineOptions = {},
  ) {}

  getStatus(): EngineStatus {
    return this.status;
  }

  /** Per collection, how many documents the listeners currently hold. */
  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [t, docs] of this.raw) out[t] = docs.size;
    return out;
  }

  /** The meta/format document, if the cloud has been migrated. */
  format(): Record<string, unknown> | null {
    const f = this.raw.get("meta")?.get(FORMAT_DOC_ID);
    return isObject(f) ? f : null;
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private setStatus(s: EngineStatus): void {
    this.status = s;
    this.opts.onStatus?.(s);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.halted = false;
    this.setStatus({ kind: "starting" });
    this.listenAll();
  }

  stop(): void {
    this.stopped = true;
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.raw.clear();
    if (this.timer != null) clearTimeout(this.timer);
    if (this.retryTimer != null) clearTimeout(this.retryTimer);
    this.timer = null;
    this.timerDue = Infinity;
    this.retryTimer = null;
    for (const w of [...this.waiters]) w();
    this.setStatus({ kind: "stopped" });
  }

  private listenAll(): void {
    for (const target of LISTENED) {
      this.unsubs.push(
        this.store.listen(
          target,
          (docs) => {
            this.raw.set(target, docs);
            this.delivered.set(target, (this.delivered.get(target) ?? 0) + 1);
            for (const w of [...this.waiters]) w();
            this.request();
          },
          (e) => this.onListenError(e),
        ),
      );
    }
  }

  /** A failed listener is dead; tear them all down and try again after a pause. */
  private onListenError(e: unknown): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.raw.clear();
    this.fail(e);
  }

  private listening(): boolean {
    return LISTENED.every((t) => this.raw.has(t));
  }

  /** Schedule a round. Calls coalesce; a sooner request wins over a later one. */
  request(delayMs = 0): void {
    if (this.stopped) return;
    if (this.running) {
      this.again = true;
      return;
    }
    const due = Date.now() + delayMs;
    if (this.timer != null && this.timerDue <= due) return;
    if (this.timer != null) clearTimeout(this.timer);
    this.timerDue = due;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.timerDue = Infinity;
      void this.reconcile();
    }, delayMs);
  }

  /** Retry now if failed, else just sync soon — for wake, online and focus events. */
  kick(): void {
    if (this.status.kind === "error" && this.retryTimer != null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
      if (this.unsubs.length === 0 && !this.stopped) this.listenAll();
    }
    this.request();
  }

  /** Run rounds until quiet. For tests and the manual "sync now". */
  async syncNow(): Promise<void> {
    for (let i = 0; i < 12; i++) {
      if (this.timer != null) {
        clearTimeout(this.timer);
        this.timer = null;
        this.timerDue = Infinity;
      }
      this.again = false;
      await this.reconcile();
      if (!this.again && this.timer == null) return;
    }
  }

  private fail(e: unknown): void {
    this.failures += 1;
    const backoff = this.opts.backoffMs ?? [5_000, 15_000, 60_000, 5 * 60_000];
    const delay = backoff[Math.min(this.failures, backoff.length) - 1];
    this.lastCommittedKey = null;
    this.setStatus({
      kind: "error",
      message: e instanceof Error ? e.message : String(e),
      retryAt: Date.now() + delay,
    });
    if (this.retryTimer != null) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.stopped) return;
      if (this.unsubs.length === 0) this.listenAll();
      this.request();
    }, delay);
  }

  private async reconcile(): Promise<void> {
    if (this.stopped || this.halted) return;
    if (this.running) {
      this.again = true;
      return;
    }
    if (!this.host.ready() || !this.listening()) return;
    this.running = true;
    try {
      await this.round();
      this.failures = 0;
    } catch (e: unknown) {
      if (e instanceof StaleViewError && this.staleInARow < MAX_STALE_IN_A_ROW) {
        // Someone else changed a document we were about to write. Its delivery
        // is on the way and calls request(); that round merges it first.
        this.staleInARow += 1;
        this.lastCommittedKey = null;
        this.setStatus({ kind: "waiting" });
      } else {
        this.fail(e);
      }
    } finally {
      this.running = false;
      if (this.again && !this.stopped && !this.halted) {
        this.again = false;
        this.request();
      }
    }
  }

  private isMigrated(): boolean {
    const f = this.format();
    return f != null && typeof f.version === "number" && f.version >= FORMAT_VERSION;
  }

  private remoteSchemaVersion(): number {
    const m = this.raw.get("meta")?.get(META_DOC_ID);
    return isObject(m) && typeof m.schemaVersion === "number" ? m.schemaVersion : 0;
  }

  private cloudView(local: AppState): AppState {
    const get = (t: ListenTarget) => this.raw.get(t) ?? new Map<string, unknown>();
    const raw: RawDocs = {
      tasks: get("tasks"),
      projects: get("projects"),
      recurrences: get("recurrences"),
      tombstones: get("tombstones"),
      log: new Map(),
      days: get("days"),
      meta: get("meta").get(META_DOC_ID) ?? null,
    };
    return fromDocs(raw, local);
  }

  /** The writes that would bring the documents in line with `local`. */
  pending(local: AppState, view: AppState = this.cloudView(local)): DocWrite[] {
    const next = withoutLog(canonicalDocs(local));
    const prev = withoutLog(toDocs(view));
    // meta/state is compared against what the document literally says, not its
    // coerced reading (which always reports this app's schema version) — or a
    // newer schema would never be announced to older clients.
    // A patch only makes sense for a document the cloud really has. The reader
    // fills in defaults for missing ones (the Inbox project, say), so the
    // canonical view can "have" a document the cloud doesn't: write it whole.
    const writes = diffDocs({ ...prev, meta: next.meta }, next).map((w): DocWrite => {
      if (w.op !== "patch" || w.collection === "meta") return w;
      if (this.raw.get(w.collection)?.has(w.id) === true) return w;
      const data = next[w.collection].get(w.id);
      return data == null ? w : { collection: w.collection, id: w.id, op: "set", data };
    });
    const rawMeta = this.raw.get("meta")?.get(META_DOC_ID);
    if (!isObject(rawMeta)) {
      writes.push({ collection: "meta", id: META_DOC_ID, op: "set", data: next.meta });
    } else {
      const fields: Partial<MetaDoc> = {};
      if (rawMeta.schemaVersion !== next.meta.schemaVersion) fields.schemaVersion = next.meta.schemaVersion;
      if ((rawMeta.lastOpenedDate ?? null) !== next.meta.lastOpenedDate) {
        fields.lastOpenedDate = next.meta.lastOpenedDate;
      }
      if (Object.keys(fields).length > 0) {
        writes.push({ collection: "meta", id: META_DOC_ID, op: "patch", fields });
      }
    }
    // Documents no reader can see — junk, tombstones past their expiry, day
    // records past the cap — are garbage: delete them.
    for (const c of CLEANABLE) {
      for (const id of this.raw.get(c)?.keys() ?? []) {
        if (!next[c].has(id) && !prev[c].has(id)) writes.push({ collection: c, id, op: "delete" });
      }
    }
    const mark = this.watermark.get();
    for (const e of local.log) {
      if (e.at > mark) writes.push({ collection: "log", id: e.id, op: "set", data: e });
    }
    return writes;
  }

  private expected(collection: string, id: string): Expected {
    const d = this.raw.get(collection as ListenTarget)?.get(id);
    return d === undefined ? { exists: false } : { exists: true, data: d };
  }

  private async commitAll(writes: DocWrite[], bulk: boolean, logThrough: number): Promise<void> {
    const blind: DocWrite[] = [];
    const guarded: DocWrite[] = [];
    for (const w of writes) {
      const exists = this.raw.get(w.collection as ListenTarget)?.has(w.id) ?? false;
      if (w.collection === "log" || (bulk && w.op === "set" && !exists)) blind.push(w);
      else guarded.push(w);
    }
    for (let i = 0; i < blind.length; i += MAX_BATCH) {
      await this.store.commit(blind.slice(i, i + MAX_BATCH));
    }
    // Log lines only ever go out blind, so they're all in by now: don't let a
    // later failure send every one of them again.
    if (logThrough > this.watermark.get()) this.watermark.set(logThrough);
    for (let i = 0; i < guarded.length; i += GUARDED_CHUNK) {
      const chunk = guarded.slice(i, i + GUARDED_CHUNK);
      const expect = new Map(chunk.map((w) => [docKey(w.collection, w.id), this.expected(w.collection, w.id)]));
      await this.store.commit(chunk, expect);
    }
  }

  /** Resolve true once every target has delivered since `since`, false on timeout. */
  private waitForDelivery(targets: ReadonlySet<ListenTarget>, since: ReadonlyMap<ListenTarget, number>): Promise<boolean> {
    const heard = () => [...targets].every((t) => (this.delivered.get(t) ?? 0) > (since.get(t) ?? 0));
    if (heard()) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.waiters.delete(waiter);
        resolve(ok);
      };
      const waiter = () => {
        if (this.stopped) finish(false);
        else if (heard()) finish(true);
      };
      const timer = setTimeout(() => finish(false), this.opts.deliveryTimeoutMs ?? 20_000);
      this.waiters.add(waiter);
    });
  }

  private async mergeV1(): Promise<void> {
    const migration = this.opts.migration;
    if (migration == null) return;
    this.setStatus({ kind: "migrating", detail: "Reading the old cloud copy" });
    const v1 = await withTimeout(migration.loadV1(), V1_TIMEOUT_MS, "Reading the old cloud copy");
    if (v1 == null) return;
    const local = this.host.getLocal();
    const merged = mergeStates(local, v1);
    if (!jsonEqual(merged, local)) this.host.adopt(merged);
  }

  private async writeFormatMarker(): Promise<void> {
    this.setStatus({ kind: "migrating", detail: "Switching over" });
    const since = new Map(this.delivered);
    await this.store.commit(
      [
        {
          collection: "meta",
          id: FORMAT_DOC_ID,
          op: "set",
          data: { version: FORMAT_VERSION, migratedAt: this.now(), v1Frozen: false },
        },
      ],
      new Map([[docKey("meta", FORMAT_DOC_ID), { exists: false }]]),
    );
    await this.waitForDelivery(new Set<ListenTarget>(["meta"]), since);
  }

  /** After migrating, make sure v1 is frozen (retried on later rounds if it fails). */
  private async freezeV1IfNeeded(): Promise<void> {
    const migration = this.opts.migration;
    const f = this.format();
    if (migration == null || f == null || f.v1Frozen === true) return;
    try {
      await withTimeout(migration.freezeV1(), V1_TIMEOUT_MS, "Freezing the old cloud copy");
      await this.store.commit(
        [{ collection: "meta", id: FORMAT_DOC_ID, op: "patch", fields: { v1Frozen: true } }],
        new Map([[docKey("meta", FORMAT_DOC_ID), this.expected("meta", FORMAT_DOC_ID)]]),
      );
    } catch {
      // Not worth failing sync over: until it's frozen, an outdated client may
      // still write the v1 document, which nothing reads any more.
    }
  }

  private heartbeatDue(): boolean {
    const hb = this.raw.get("meta")?.get(HEARTBEAT_DOC_ID);
    const at = isObject(hb) && typeof hb.at === "number" ? hb.at : -Infinity;
    return this.now() - at >= (this.opts.heartbeatMs ?? 3_600_000);
  }

  private async round(): Promise<void> {
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const remoteVersion = this.remoteSchemaVersion();
      if (remoteVersion > SCHEMA_VERSION) {
        this.setStatus({ kind: "outdated", remoteVersion });
        return;
      }
      const migrated = this.isMigrated();
      if (!migrated && !this.v1Merged) {
        await this.mergeV1();
        this.v1Merged = true;
      }

      const version = this.host.version();
      let local = this.host.getLocal();
      const view = this.cloudView(local);
      const merged = mergeStates(local, view);
      if (!jsonEqual(merged, local)) {
        this.host.adopt(merged);
        local = merged;
      }

      const writes = this.pending(local, view);
      if (writes.length === 0) {
        this.lastCommittedKey = null;
        this.staleInARow = 0;
        if (!migrated) {
          // Everything reads back: now, and only now, the cloud switches over.
          await this.writeFormatMarker();
          continue;
        }
        await this.freezeV1IfNeeded();
        if (this.heartbeatDue()) {
          await this.store.commit([
            { collection: "meta", id: HEARTBEAT_DOC_ID, op: "set", data: { at: this.now() } },
          ]);
        }
        this.settledVersion = version;
        this.setStatus({ kind: "inSync", at: this.now(), version });
        return;
      }

      const key = JSON.stringify(writes);
      if (key === this.lastCommittedKey) {
        this.halted = true;
        const w = writes[0];
        this.setStatus({
          kind: "halted",
          message: `Cloud documents don't read back as written (${writes.length} writes, e.g. ${w.collection}/${w.id}). Sync stopped to protect your data and quota.`,
        });
        return;
      }

      if (migrated && version === this.settledVersion) {
        const t = Date.now();
        this.unprompted = this.unprompted.filter((x) => t - x < UNPROMPTED_WINDOW_MS);
        this.unprompted.push(t);
        if (this.unprompted.length > UNPROMPTED_LIMIT) {
          this.halted = true;
          this.setStatus({
            kind: "halted",
            message: `Sync kept rewriting the cloud with no edits here (${this.unprompted.length} times in 10 minutes) — stopped to protect your quota.`,
          });
          return;
        }
      }
      this.setStatus(
        migrated
          ? { kind: "syncing", writes: writes.length }
          : { kind: "migrating", detail: `Uploading ${writes.length} items` },
      );
      const since = new Map(this.delivered);
      const newest = local.log.reduce((m, e) => Math.max(m, e.at), this.watermark.get());
      await this.commitAll(writes, !migrated || writes.length > BULK_THRESHOLD, newest);
      this.staleInARow = 0;

      const targets = new Set<ListenTarget>();
      for (const w of writes) if (w.collection !== "log") targets.add(w.collection);
      if (!(await this.waitForDelivery(targets, since))) {
        // The cloud hasn't echoed yet; its delivery will call request().
        this.lastCommittedKey = null;
        return;
      }
      this.lastCommittedKey = key;
    }
  }
}
