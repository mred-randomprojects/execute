import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
} from "firebase/auth";
import { auth } from "../firebase";
import { getReady, getState, setCloudSync } from "../store/store";
import { mergeAndSave } from "../viewer/cloud";

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
  });
  setCloudSync(() => schedulePush());

  return () => {
    unsubAuth();
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
