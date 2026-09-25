import type { Collection, DocWrite } from "../docs";

// The only surface sync v2 needs from a document database. Firestore implements
// it (./firestoreStore); tests use an in-memory fake (./memoryStore). Keeping
// the sync logic behind this seam is what lets it be tested without a network.

export type ListenTarget = Collection | "meta";

export interface DocStore {
  /**
   * Every document in a collection, now and after each change. The map is the
   * whole collection each time (id → data), never a delta.
   */
  listen(
    target: ListenTarget,
    onDocs: (docs: ReadonlyMap<string, unknown>) => void,
    onError: (e: unknown) => void,
  ): () => void;
  /** Apply writes atomically. Callers keep each call within MAX_BATCH. */
  commit(writes: readonly DocWrite[]): Promise<void>;
}

/** Firestore's limit on writes in one batch. */
export const MAX_BATCH = 500;
