import type { DocWrite } from "../docs";
import type { DocStore, ListenTarget } from "./port";
import { MAX_BATCH } from "./port";

/**
 * An in-memory DocStore with Firestore's relevant behaviour: listeners fire at
 * once and after every commit (like Firestore's latency-compensated snapshots),
 * batches are atomic, over-size batches and patches of missing documents fail.
 */
export class MemoryStore implements DocStore {
  readonly data = new Map<ListenTarget, Map<string, object>>();
  commits = 0;
  writes = 0;
  /** Make the next commit reject with this, once. */
  failNext: Error | null = null;
  private listeners = new Map<ListenTarget, Set<(docs: ReadonlyMap<string, unknown>) => void>>();

  private coll(target: ListenTarget): Map<string, object> {
    let c = this.data.get(target);
    if (c == null) {
      c = new Map();
      this.data.set(target, c);
    }
    return c;
  }

  listen(target: ListenTarget, onDocs: (docs: ReadonlyMap<string, unknown>) => void): () => void {
    const set = this.listeners.get(target) ?? new Set();
    set.add(onDocs);
    this.listeners.set(target, set);
    onDocs(new Map(this.coll(target)));
    return () => {
      set.delete(onDocs);
    };
  }

  async commit(writes: readonly DocWrite[]): Promise<void> {
    if (writes.length > MAX_BATCH) throw new Error(`batch of ${writes.length} > ${MAX_BATCH}`);
    if (this.failNext != null) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    // Validate first: the batch applies whole or not at all.
    for (const w of writes) {
      if (w.op === "patch" && !this.coll(w.collection).has(w.id)) {
        throw new Error(`NOT_FOUND: ${w.collection}/${w.id}`);
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
    for (const t of touched) {
      for (const l of this.listeners.get(t) ?? []) l(new Map(this.coll(t)));
    }
  }
}
