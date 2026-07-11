import { doc, getDoc, onSnapshot, runTransaction, setDoc, type Unsubscribe } from "firebase/firestore";
import { db } from "../firebase";
import type { AppState } from "../types";
import { coerceState } from "../store/persistence";
import { mergeStates } from "../sync/merge";

function appDataRef(uid: string) {
  return doc(db, "users", uid, "data", "appData");
}

/**
 * Read the one cloud document for this user and coerce it back into AppState —
 * the exact same defensive coercion the local store uses on load, so the viewer
 * never trusts the raw blob. Returns null when the document doesn't exist yet
 * (nothing seeded).
 */
export async function loadAppState(uid: string): Promise<AppState | null> {
  const snap = await getDoc(appDataRef(uid));
  if (!snap.exists()) return null;
  return coerceState(snap.data());
}

/**
 * Live subscription to the cloud document. Fires immediately with the current
 * value (from cache, then server) and again on every change — so the viewer
 * reflects desktop edits in near-real-time and its own writes converge. `null`
 * means the document doesn't exist yet. Returns the unsubscribe fn.
 */
export function subscribeAppState(
  uid: string,
  onData: (state: AppState | null) => void,
  onError: (e: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    appDataRef(uid),
    (snap) => onData(snap.exists() ? coerceState(snap.data()) : null),
    onError,
  );
}

/**
 * One-time seed: write a whole AppState up to the cloud. Used only by the seed
 * flow (?seed), authorized purely by the signed-in owner's identity — the
 * Firestore rules reject any other writer. coerceState upstream guarantees no
 * `undefined` (Firestore rejects those); we add an updatedAt stamp for info.
 */
export async function saveAppState(uid: string, state: AppState): Promise<void> {
  await setDoc(appDataRef(uid), { ...state, updatedAt: Date.now() });
}

/**
 * Two-way-safe push: inside a transaction, read the current cloud doc, merge the
 * local state into it (per-task LWW — see src/sync/merge), and write the result.
 * With a single writer this is equivalent to an overwrite; once a second device
 * can write, it's what stops the two from clobbering each other. Returns the
 * merged state so the caller can adopt it locally (keeping local ≡ cloud).
 */
export async function mergeAndSave(uid: string, local: AppState): Promise<AppState> {
  const ref = appDataRef(uid);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const merged = snap.exists() ? mergeStates(local, coerceState(snap.data())) : local;
    tx.set(ref, { ...merged, updatedAt: Date.now() });
    return merged;
  });
}
