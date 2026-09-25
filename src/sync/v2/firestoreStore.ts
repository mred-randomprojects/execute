import { FieldPath, collection, doc, onSnapshot, writeBatch } from "firebase/firestore";
import { firebaseDb } from "../../firebase";
import type { DocWrite } from "../docs";
import type { DocStore, ListenTarget } from "./port";
import { MAX_BATCH } from "./port";

/** A commit that hasn't settled by now is abandoned (see PUSH_TIMEOUT_MS in desktopSync). */
const COMMIT_TIMEOUT_MS = 30_000;

/**
 * The v2 collections under users/{uid}/ — tasks, projects, recurrences,
 * tombstones, log, days, meta — as a DocStore. (The v1 document lives beside
 * them at users/{uid}/data/appData.)
 */
export function firestoreDocStore(uid: string): DocStore {
  const db = firebaseDb();
  return {
    listen(target: ListenTarget, onDocs, onError) {
      // Deliver nothing until the SERVER has answered once. On a fresh cache,
      // Firestore can first report a collection empty "from cache"; taken at
      // face value that reads as "nothing uploaded yet" and triggers a full
      // re-seed. Metadata changes are included so the server's confirmation
      // arrives even when it matches the cache exactly.
      let confirmed = false;
      return onSnapshot(
        collection(db, "users", uid, target),
        { includeMetadataChanges: true },
        (snap) => {
          if (!snap.metadata.fromCache) confirmed = true;
          if (!confirmed) return;
          const docs = new Map<string, unknown>();
          for (const d of snap.docs) docs.set(d.id, d.data());
          onDocs(docs);
        },
        onError,
      );
    },

    async commit(writes: readonly DocWrite[]) {
      if (writes.length > MAX_BATCH) throw new Error(`batch of ${writes.length} > ${MAX_BATCH}`);
      const batch = writeBatch(db);
      for (const w of writes) {
        const ref = doc(db, "users", uid, w.collection, w.id);
        if (w.op === "delete") batch.delete(ref);
        else if (w.op === "set") batch.set(ref, w.data);
        // `update`, not a merging `set`: patching a document that was deleted
        // meanwhile must fail (and be re-diffed), not resurrect half a task.
        else {
          // Field-by-field form: typed as unknown values, and FieldPath keeps a
          // key from ever being read as a dotted path into a nested map.
          const [first, ...rest] = Object.entries(w.fields);
          if (first == null) continue;
          batch.update(
            ref,
            new FieldPath(first[0]),
            first[1],
            ...rest.flatMap(([k, v]) => [new FieldPath(k), v]),
          );
        }
      }
      let timer: ReturnType<typeof setTimeout> | null = null;
      try {
        await Promise.race([
          batch.commit(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("The cloud didn't answer — will retry.")), COMMIT_TIMEOUT_MS);
          }),
        ]);
      } finally {
        if (timer != null) clearTimeout(timer);
      }
    },
  };
}
