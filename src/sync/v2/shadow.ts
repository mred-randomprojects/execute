import type { AppState } from "../../types";
import {
  asRaw,
  diffDocs,
  fromDocs,
  toDocs,
  type CloudDocs,
  type DocWrite,
  type RawDocs,
} from "../docs";
import { jsonEqual } from "../merge";
import { MAX_BATCH, type DocStore, type ListenTarget } from "./port";

// ─── Shadow mode: write the v2 documents beside the v1 document ──────
//
// Phase 2 of the per-task-documents plan. The single v1 document stays the
// source of truth; after each successful v1 push the desktop hands its state
// here, and this keeps the per-item documents equal to it:
//
//   1. listen to the v2 collections (not the log — see below),
//   2. read them back into a state (`fromDocs`) — the cloud's view,
//   3. diff that against the local state and commit the difference as patches.
//
// Step 3 doubles as the read-back check: when the documents faithfully hold the
// local state, the diff is empty. A diff that comes back identical right after
// being committed means the format doesn't round-trip — a bug — so shadow sync
// halts instead of writing the same thing forever against the daily quota.
//
// The log is write-only here: nothing but this desktop writes log lines, and
// listening to 2k+ of them would cost that many reads on every reconnect. New
// lines go up past a watermark kept on this device.

/** What the sidebar shows about the shadow copy. */
export type ShadowStatus =
  | { kind: "off" }
  | { kind: "starting" }
  | { kind: "syncing"; writes: number }
  | { kind: "inSync"; at: number }
  | { kind: "error"; message: string }
  | { kind: "halted"; message: string };

/** Where the log watermark lives: per device, never synced. */
export interface Watermark {
  get(): number;
  set(at: number): void;
}

const LISTENED: readonly ListenTarget[] = [
  "tasks",
  "projects",
  "recurrences",
  "tombstones",
  "days",
  "meta",
];

function withoutLog(docs: CloudDocs): CloudDocs {
  return { ...docs, log: new Map() };
}

/**
 * The documents of a state, canonicalized the way a reader would see them:
 * through `fromDocs` once, so read-side normalisation (tombstone expiry,
 * sorting, coercion) applies to both sides of the diff equally and can't show
 * up as a difference that no write could ever fix.
 */
function canonicalDocs(state: AppState): CloudDocs {
  return toDocs(fromDocs(asRaw(toDocs(state)), state));
}

export class ShadowSync {
  private raw = new Map<ListenTarget, ReadonlyMap<string, unknown>>();
  private unsubs: (() => void)[] = [];
  private latest: AppState | null = null;
  private running = false;
  private again = false;
  private lastCommitted: string | null = null;
  /** Bumped on every listener delivery, so a re-check knows if the cloud answered. */
  private epoch = 0;
  private committedAtEpoch = -1;
  private halted = false;
  private status: ShadowStatus = { kind: "off" };

  constructor(
    private readonly store: DocStore,
    private readonly watermark: Watermark,
    private readonly onStatus: (s: ShadowStatus) => void = () => {},
  ) {}

  getStatus(): ShadowStatus {
    return this.status;
  }

  private setStatus(s: ShadowStatus): void {
    this.status = s;
    this.onStatus(s);
  }

  start(): void {
    if (this.unsubs.length > 0) return;
    this.setStatus({ kind: "starting" });
    for (const target of LISTENED) {
      this.unsubs.push(
        this.store.listen(
          target,
          (docs) => {
            const first = !this.raw.has(target);
            this.raw.set(target, docs);
            this.epoch++;
            // Everything has arrived for the first time: catch up. Or the cloud
            // just answered a commit: confirm it read back.
            const confirming = this.lastCommitted != null && !this.running;
            if (((first && this.ready()) || confirming) && this.latest != null) {
              void this.sync(this.latest);
            }
          },
          (e) => this.setStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) }),
        ),
      );
    }
  }

  stop(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.raw.clear();
    this.setStatus({ kind: "off" });
  }

  private ready(): boolean {
    return LISTENED.every((t) => this.raw.has(t));
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
      meta: get("meta").get("state") ?? null,
    };
    return fromDocs(raw, local);
  }

  /** The writes that would bring the documents in line with `local` right now. */
  pending(local: AppState): DocWrite[] {
    const prev = withoutLog(toDocs(this.cloudView(local)));
    const next = withoutLog(canonicalDocs(local));
    const writes = diffDocs(prev, next);
    const mark = this.watermark.get();
    for (const e of local.log) {
      if (e.at > mark) writes.push({ collection: "log", id: e.id, op: "set", data: e });
    }
    return writes;
  }

  /**
   * Bring the documents in line with `local`. Safe to call on every change:
   * calls coalesce, and only one runs at a time.
   */
  async sync(local: AppState): Promise<void> {
    this.latest = local;
    if (this.halted || !this.ready()) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      const writes = this.pending(local);
      if (writes.length === 0) {
        this.lastCommitted = null;
        this.setStatus({ kind: "inSync", at: Date.now() });
        return;
      }
      const key = JSON.stringify(writes);
      if (key === this.lastCommitted) {
        // Nothing heard since the commit: wait for the listeners, which call
        // back in here when they deliver.
        if (this.epoch === this.committedAtEpoch) return;
        this.halted = true;
        const sample = writes[0];
        this.setStatus({
          kind: "halted",
          message: `v2 documents don't read back as written (${writes.length} writes, e.g. ${sample.collection}/${sample.id}). Stopped to protect the quota.`,
        });
        return;
      }
      this.setStatus({ kind: "syncing", writes: writes.length });
      const before = this.epoch;
      for (let i = 0; i < writes.length; i += MAX_BATCH) {
        await this.store.commit(writes.slice(i, i + MAX_BATCH));
      }
      this.lastCommitted = key;
      this.committedAtEpoch = before;
      const newest = local.log.reduce((m, e) => Math.max(m, e.at), this.watermark.get());
      this.watermark.set(newest);
      // Re-check against what the listeners now hold: either in sync, or the
      // same writes again — which the key above turns into a halt.
      this.again = true;
    } catch (e: unknown) {
      this.setStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      this.running = false;
      if (this.again && !this.halted && this.status.kind !== "error") {
        this.again = false;
        const next = this.latest;
        if (next != null) await this.sync(next);
      } else {
        this.again = false;
      }
    }
  }

  /** For tests and diagnostics: does the cloud view equal `local` (minus the log)? */
  matches(local: AppState): boolean {
    return jsonEqual(withoutLog(toDocs(this.cloudView(local))), withoutLog(canonicalDocs(local)));
  }
}
