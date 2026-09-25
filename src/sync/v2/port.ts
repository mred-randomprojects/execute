import type { Collection, DocWrite } from "../docs";

// The only surface sync v2 needs from a document database. Firestore implements
// it (./firestoreStore); tests use an in-memory fake (./memoryStore). Keeping
// the sync logic behind this seam is what lets it be tested without a network.

export type ListenTarget = Collection | "meta";

/** A single-field condition, enough for the phone's "open or recent" query. */
export interface Filter {
  field: string;
  op: "==" | ">=";
  value: string | number | boolean | null;
}

/** What a guarded write expects a document to be when it lands. */
export type Expected = { exists: false } | { exists: true; data: unknown };

export interface DocStore {
  /**
   * Every document in a collection (matching `filter`, if given), now and after
   * each change. The map is the whole result each time (id → data), never a
   * delta, and nothing is delivered until the server has confirmed it once.
   */
  listen(
    target: ListenTarget,
    onDocs: (docs: ReadonlyMap<string, unknown>) => void,
    onError: (e: unknown) => void,
    filter?: Filter,
  ): () => void;
  /**
   * Apply writes atomically. With `expect` (keyed `collection/id`), each listed
   * document must still be exactly as expected — else nothing is written and it
   * rejects with StaleViewError. Callers keep each call within MAX_BATCH.
   */
  commit(writes: readonly DocWrite[], expect?: ReadonlyMap<string, Expected>): Promise<void>;
}

/** Firestore's limit on writes in one batch or transaction. */
export const MAX_BATCH = 500;

export const docKey = (collection: string, id: string): string => `${collection}/${id}`;

/**
 * A guarded write found a document changed since this device last saw it.
 * Not a failure: the listener is about to deliver the change, and the next
 * round merges it before writing again.
 */
export class StaleViewError extends Error {
  constructor(readonly key: string) {
    super(`${key} changed in the cloud since it was read`);
    this.name = "StaleViewError";
  }
}
