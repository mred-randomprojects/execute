import {
  FieldPath,
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  where,
  writeBatch,
  type DocumentReference,
  type Query,
  type QuerySnapshot,
  type Transaction,
  type WriteBatch,
} from "firebase/firestore";
import { firebaseDb } from "../../firebase";
import type { DocWrite } from "../docs";
import { jsonEqual } from "../merge";
import { MAX_BATCH, StaleViewError, type DocStore, type ListenTarget } from "./port";

/** A commit that hasn't settled by now is abandoned (it may still land; that's safe). */
const COMMIT_TIMEOUT_MS = 30_000;
/**
 * If the live stream hasn't delivered a server answer by now, also ask once
 * over plain HTTP. Some mobile networks silently break Firestore's streaming
 * channel (see firebase.ts); the one-shot read still works there, so the phone
 * never hangs on "Loading…".
 */
const ONE_SHOT_AFTER_MS = 3_000;

function withTimeout<T>(p: Promise<T>): Promise<T> {
  // A late rejection of an abandoned commit must not surface as unhandled.
  p.catch(() => {});
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("The cloud didn't answer — will retry.")), COMMIT_TIMEOUT_MS);
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

function toMap(snap: QuerySnapshot): Map<string, unknown> {
  const m = new Map<string, unknown>();
  snap.forEach((d) => {
    m.set(d.id, d.data());
  });
  return m;
}

/** The three write calls we use, shared by batches and transactions. */
interface Writer {
  set(ref: DocumentReference, data: object): void;
  update(ref: DocumentReference, field: FieldPath, value: unknown, ...more: unknown[]): void;
  delete(ref: DocumentReference): void;
}

function batchWriter(b: WriteBatch): Writer {
  return {
    set: (r, d) => void b.set(r, d),
    update: (r, f, v, ...more) => void b.update(r, f, v, ...more),
    delete: (r) => void b.delete(r),
  };
}

function txWriter(tx: Transaction): Writer {
  return {
    set: (r, d) => void tx.set(r, d),
    update: (r, f, v, ...more) => void tx.update(r, f, v, ...more),
    delete: (r) => void tx.delete(r),
  };
}

function apply(target: Writer, ref: DocumentReference, w: DocWrite): void {
  if (w.op === "delete") {
    target.delete(ref);
    return;
  }
  if (w.op === "set") {
    target.set(ref, w.data);
    return;
  }
  // Field-by-field form: typed as unknown values, and FieldPath keeps a key
  // from ever being read as a dotted path into a nested map. `update`, not a
  // merging `set`: patching a document deleted meanwhile must fail, not
  // resurrect half a task.
  const [first, ...rest] = Object.entries(w.fields);
  if (first == null) return;
  target.update(ref, new FieldPath(first[0]), first[1], ...rest.flatMap(([k, v]) => [new FieldPath(k), v]));
}

/**
 * The sync v2 collections under users/{uid}/ — tasks, projects, recurrences,
 * tombstones, log, days, meta — as a DocStore. (The v1 document lives beside
 * them at users/{uid}/data/appData.)
 */
export function firestoreDocStore(uid: string): DocStore {
  const db = firebaseDb();
  const ref = (c: string, id: string) => doc(db, "users", uid, c, id);

  return {
    listen(target: ListenTarget, onDocs, onError, filter) {
      const base = collection(db, "users", uid, target);
      const q: Query = filter == null ? base : query(base, where(filter.field, filter.op, filter.value));
      // Deliver nothing until the SERVER has answered once: on a cold cache,
      // Firestore can first report a collection empty "from cache", which
      // would read as "nothing uploaded yet". Metadata changes are included so
      // the server's confirmation arrives even when it matches the cache.
      let confirmed = false;
      let closed = false;
      const unsub = onSnapshot(
        q,
        { includeMetadataChanges: true },
        (snap) => {
          if (!snap.metadata.fromCache) confirmed = true;
          if (confirmed && !closed) onDocs(toMap(snap));
        },
        (e) => {
          if (!closed) onError(e);
        },
      );
      const oneShot = setTimeout(() => {
        if (confirmed || closed) return;
        getDocs(q)
          .then((snap) => {
            if (confirmed || closed || snap.metadata.fromCache) return;
            confirmed = true;
            onDocs(toMap(snap));
          })
          .catch(() => {
            /* the live listener reports its own errors */
          });
      }, ONE_SHOT_AFTER_MS);
      return () => {
        closed = true;
        clearTimeout(oneShot);
        unsub();
      };
    },

    async commit(writes: readonly DocWrite[], expect) {
      if (writes.length > MAX_BATCH) throw new Error(`batch of ${writes.length} > ${MAX_BATCH}`);
      if (expect == null || expect.size === 0) {
        const batch = writeBatch(db);
        const writer = batchWriter(batch);
        for (const w of writes) apply(writer, ref(w.collection, w.id), w);
        await withTimeout(batch.commit());
        return;
      }
      // Guarded: a transaction reads every expected document from the server,
      // and writes only if each is still exactly what this device merged
      // against. Transactions fail rather than queue when offline, so nothing
      // stale can be replayed later.
      await withTimeout(
        runTransaction(
          db,
          async (tx) => {
            const checks = await Promise.all(
              [...expect].map(async ([key, exp]) => {
                const slash = key.indexOf("/");
                const snap = await tx.get(ref(key.slice(0, slash), key.slice(slash + 1)));
                const ok = exp.exists ? snap.exists() && jsonEqual(snap.data(), exp.data) : !snap.exists();
                return { key, ok };
              }),
            );
            const stale = checks.find((c) => !c.ok);
            if (stale != null) throw new StaleViewError(stale.key);
            const writer = txWriter(tx);
            for (const w of writes) apply(writer, ref(w.collection, w.id), w);
          },
          { maxAttempts: 3 },
        ),
      );
    },
  };
}
