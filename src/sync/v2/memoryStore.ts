import type { DocWrite } from "../docs";
import { jsonEqual } from "../merge";
import {
  MAX_BATCH,
  StaleViewError,
  docKey,
  type DocStore,
  type Expected,
  type Filter,
  type ListenTarget,
} from "./port";

interface Listener {
  target: ListenTarget;
  filter: Filter | undefined;
  onDocs: (docs: ReadonlyMap<string, unknown>) => void;
}

function matches(data: object, filter: Filter | undefined): boolean {
  if (filter == null) return true;
  const value: unknown = (data as Record<string, unknown>)[filter.field];
  if (filter.op === "==") return value === filter.value;
  return (
    typeof value === typeof filter.value &&
    value !== null &&
    filter.value !== null &&
    (value as number | string) >= (filter.value as number | string)
  );
}

/**
 * An in-memory DocStore with Firestore's relevant behaviour: listeners get the
 * whole (filtered) collection at once and after every commit, batches are
 * atomic, over-size batches and patches of missing documents fail, and guarded
 * commits check every expectation before writing anything.
 *
 * `hold()` stops deliveries (queuing them) until `release()`, to simulate a
 * device whose view lags behind the cloud.
 */
export class MemoryStore implements DocStore {
  readonly data = new Map<ListenTarget, Map<string, object>>();
  commits = 0;
  writes = 0;
  /** Guarded commits refused because a document had changed. */
  refused = 0;
  /** Make the next commit reject with this, once. */
  failNext: Error | null = null;
  /** Make the next GUARDED commit (one with expectations) reject with this, once. */
  failNextGuarded: Error | null = null;
  private listeners = new Set<Listener>();
  private held = false;
  private queued = new Set<Listener>();

  private coll(target: ListenTarget): Map<string, object> {
    let c = this.data.get(target);
    if (c == null) {
      c = new Map();
      this.data.set(target, c);
    }
    return c;
  }

  private snapshot(l: Listener): Map<string, unknown> {
    const out = new Map<string, unknown>();
    for (const [id, d] of this.coll(l.target)) if (matches(d, l.filter)) out.set(id, structuredClone(d));
    return out;
  }

  private deliver(l: Listener): void {
    if (!this.listeners.has(l)) return;
    if (this.held) {
      this.queued.add(l);
      return;
    }
    l.onDocs(this.snapshot(l));
  }

  hold(): void {
    this.held = true;
  }

  release(): void {
    this.held = false;
    const pending = [...this.queued];
    this.queued.clear();
    for (const l of pending) this.deliver(l);
  }

  listen(
    target: ListenTarget,
    onDocs: (docs: ReadonlyMap<string, unknown>) => void,
    _onError: (e: unknown) => void,
    filter?: Filter,
  ): () => void {
    const l: Listener = { target, filter, onDocs };
    this.listeners.add(l);
    this.deliver(l);
    return () => {
      this.listeners.delete(l);
      this.queued.delete(l);
    };
  }

  /** What a guarded commit would read for `collection/id` right now. */
  read(collection: ListenTarget, id: string): object | undefined {
    const d = this.coll(collection).get(id);
    return d == null ? undefined : structuredClone(d);
  }

  async commit(writes: readonly DocWrite[], expect?: ReadonlyMap<string, Expected>): Promise<void> {
    if (writes.length > MAX_BATCH) throw new Error(`batch of ${writes.length} > ${MAX_BATCH}`);
    if (this.failNext != null) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    if (this.failNextGuarded != null && expect != null && expect.size > 0) {
      const e = this.failNextGuarded;
      this.failNextGuarded = null;
      throw e;
    }
    // Validate everything first: the commit applies whole or not at all.
    for (const [key, exp] of expect ?? []) {
      const slash = key.indexOf("/");
      const current = this.coll(key.slice(0, slash) as ListenTarget).get(key.slice(slash + 1));
      const ok = exp.exists ? current != null && jsonEqual(current, exp.data) : current == null;
      if (!ok) {
        this.refused++;
        throw new StaleViewError(key);
      }
    }
    for (const w of writes) {
      if (w.op === "patch" && !this.coll(w.collection).has(w.id)) {
        throw new Error(`NOT_FOUND: ${docKey(w.collection, w.id)}`);
      }
    }
    const touched = new Set<ListenTarget>();
    for (const w of writes) {
      const c = this.coll(w.collection);
      if (w.op === "delete") c.delete(w.id);
      else if (w.op === "set") c.set(w.id, structuredClone(w.data));
      else c.set(w.id, { ...c.get(w.id), ...structuredClone(w.fields) });
      touched.add(w.collection);
    }
    this.commits++;
    this.writes += writes.length;
    for (const l of this.listeners) if (touched.has(l.target)) this.deliver(l);
  }
}
