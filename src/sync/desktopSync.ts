import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
} from "firebase/auth";
import { auth } from "../firebase";
import { adoptRemote, getReady, getState, setCloudSync, subscribeReady } from "../store/store";
import { mergeAndSave, subscribeAppState } from "../viewer/cloud";
import { jsonEqual, mergeStates } from "./merge";

const clientId = import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID;
const clientSecret = import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_SECRET;

const PUSH_DEBOUNCE_MS = 1500;

export type SyncStatus =
  | { kind: "off" } // not the desktop app, or no OAuth client configured
  | { kind: "signedOut" }
  | { kind: "idle"; email: string | null }
  | { kind: "syncing"; email: string | null }
  | { kind: "error"; email: string | null; message: string };

// ── Observable status (for the sidebar control) ──────────────────────
let status: SyncStatus = { kind: "off" };
const listeners = new Set<() => void>();
function setStatus(s: SyncStatus) {
  status = s;
  for (const l of listeners) l();
}
export function getStatus(): SyncStatus {
  return status;
}
export function subscribeStatus(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function b() {
  return typeof window !== "undefined" ? window.execute : undefined;
}

/** Sync exists only in the desktop app with a configured OAuth client. */
export function syncAvailable(): boolean {
  const bridge = b();
  return (
    bridge?.isElectron === true &&
    typeof bridge.signInWithGoogle === "function" &&
    Boolean(clientId) &&
    Boolean(clientSecret)
  );
}

// ── The push loop ────────────────────────────────────────────────────
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pushing = false;
let dirtyDuringPush = false;

async function doPush() {
  const user = auth.currentUser;
  // Never push before the store has loaded (would clobber cloud with empty
  // state) and never trigger interactive sign-in from an automatic push.
  if (user == null || !getReady()) return;
  if (pushing) {
    dirtyDuringPush = true;
    return;
  }
  pushing = true;
  setStatus({ kind: "syncing", email: user.email });
  try {
    await mergeAndSave(user.uid, getState());
    setStatus({ kind: "idle", email: user.email });
  } catch (e: unknown) {
    setStatus({
      kind: "error",
      email: user.email,
      message: e instanceof Error ? e.message : "Sync failed",
    });
  } finally {
    pushing = false;
    // A change landed mid-flight → coalesce it into one more push.
    if (dirtyDuringPush) {
      dirtyDuringPush = false;
      schedulePush();
    }
  }
}

function schedulePush() {
  if (auth.currentUser == null) return; // signed out → stay quiet, never popup
  if (pushTimer != null) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void doPush(), PUSH_DEBOUNCE_MS);
}

// ── The pull loop ────────────────────────────────────────────────────
// The other half of two-way sync: a live subscription to the cloud doc that
// merges every remote change (a website edit, another device) into the local
// store in near-real-time. Without this the desktop was push-only — it never
// saw edits made anywhere else.
let unsubDoc: (() => void) | null = null;
let subscribedUid: string | null = null;

function stopPull() {
  if (unsubDoc != null) unsubDoc();
  unsubDoc = null;
  subscribedUid = null;
}

function startPull(uid: string) {
  if (subscribedUid === uid && unsubDoc != null) return; // already live for this user
  stopPull();
  subscribedUid = uid;
  unsubDoc = subscribeAppState(
    uid,
    (remote) => {
      // Nothing seeded yet, or the store hasn't loaded — never merge into the
      // empty pre-load state (initStore would then clobber it from disk).
      if (remote == null || !getReady()) return;
      const local = getState();
      // Merge with the CURRENT local state (never a blind overwrite), so a local
      // edit made mid-sync — or a local-only task not yet in the cloud — survives.
      const merged = mergeStates(local, remote);
      // Adopt only a real change: an echo of our own write merges to the same
      // state, so this no-ops (no re-render, no loop).
      if (!jsonEqual(merged, local)) adoptRemote(merged);
      // If the merge carries anything the cloud lacks (offline/local-only edits),
      // push once to converge the cloud too. Guarded, so a settled state never
      // schedules an endless push↔pull.
      if (!jsonEqual(merged, remote)) schedulePush();
    },
    (e: unknown) => {
      setStatus({
        kind: "error",
        email: auth.currentUser?.email ?? null,
        message: e instanceof Error ? e.message : "Sync read failed",
      });
    },
  );
}

/** Start pulling when signed in AND the store has loaded; stop otherwise. */
function reconcilePull() {
  const user = auth.currentUser;
  if (user == null || !getReady()) {
    stopPull();
    return;
  }
  startPull(user.uid);
}

/**
 * Wire auto-sync once, at app startup. Registers the store persist hook (so
 * every change schedules a push) and watches auth state (a restored session
 * pushes once, catching anything edited before auth rehydrated). Returns a
 * cleanup for React StrictMode's double-mount. No-op unless sync is available.
 */
export function initAutoSync(): () => void {
  if (!syncAvailable()) {
    setStatus({ kind: "off" });
    return () => {};
  }
  setStatus(auth.currentUser != null ? { kind: "idle", email: auth.currentUser.email } : { kind: "signedOut" });

  const unsubAuth = onAuthStateChanged(auth, (user) => {
    if (user != null) {
      setStatus({ kind: "idle", email: user.email });
      if (getReady()) void doPush(); // catch-up push on restored session
    } else {
      setStatus({ kind: "signedOut" });
    }
    reconcilePull(); // (re)subscribe on sign-in, tear down on sign-out
  });
  // Also (re)subscribe the moment the store finishes loading — auth may restore
  // before the local load completes, and the pull must wait for readiness.
  const unsubReady = subscribeReady(reconcilePull);
  setCloudSync(() => schedulePush());

  return () => {
    unsubAuth();
    unsubReady();
    stopPull();
    setCloudSync(null);
    if (pushTimer != null) clearTimeout(pushTimer);
  };
}

/** Interactive first sign-in (the only place a browser popup is triggered). */
export async function signIn(): Promise<void> {
  const bridge = b();
  if (bridge?.signInWithGoogle == null) throw new Error("Desktop sign-in is unavailable here.");
  if (!clientId || !clientSecret) {
    throw new Error("Missing VITE_GOOGLE_DESKTOP_CLIENT_ID / VITE_GOOGLE_DESKTOP_CLIENT_SECRET.");
  }
  const { idToken } = await bridge.signInWithGoogle(clientId, clientSecret);
  await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
  // onAuthStateChanged fires → status idle → catch-up push.
}

/** Manual nudge (retry after an error / force a push). */
export function syncNow(): void {
  if (auth.currentUser == null) {
    void signIn();
    return;
  }
  void doPush();
}
