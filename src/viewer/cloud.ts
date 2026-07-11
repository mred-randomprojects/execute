import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { AppState } from "../types";
import { coerceState } from "../store/persistence";

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
 * One-time seed: write a whole AppState up to the cloud. Used only by the seed
 * flow (?seed), authorized purely by the signed-in owner's identity — the
 * Firestore rules reject any other writer. coerceState upstream guarantees no
 * `undefined` (Firestore rejects those); we add an updatedAt stamp for info.
 */
export async function saveAppState(uid: string, state: AppState): Promise<void> {
  await setDoc(appDataRef(uid), { ...state, updatedAt: Date.now() });
}
