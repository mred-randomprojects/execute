import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
} from "firebase/auth";
import { firebaseAuth, firebaseConfigured } from "../firebase";
import { adoptRemote, getReady, getState, setCloudSync, subscribeReady } from "../store/store";
import { mergeAndSave, subscribeAppState } from "../viewer/cloud";
import { jsonEqual, mergeStates } from "./merge";
import { CloudDocTooLargeError, OutdatedClientError, toCloud } from "./cloudDoc";
import { ShadowSync, type ShadowStatus, type Watermark } from "./v2/shadow";
import { firestoreDocStore } from "./v2/firestoreStore";

const clientId = import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID;
const clientSecret = import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_SECRET;

const PUSH_DEBOUNCE_MS = 1500;
/**
 * A push that hasn't settled by now is abandoned. Firestore's transaction RPCs
 * have no timeout of their own, and a request caught by a sleep or a network
 * change can simply never settle — which used to leave `pushing` stuck true, so
 * every later push quietly bowed out behind it. (That is how the desktop went
 * nine days without writing, in September 2026, while showing nothing wrong.)
 * The abandoned transaction may still land later; that's harmless — it's a merge.
 */
const PUSH_TIMEOUT_MS = 30_000;
/** Retry delays after consecutive failures; the last one repeats. */
const RETRY_BACKOFF_MS = [5_000, 15_000, 60_000, 5 * 60_000];
/** How often to re-check for unsynced changes (a missed wake/online event). */
const HEARTBEAT_MS = 60_000;

export type SyncStatus =
  | { kind: "off" } // not the desktop app, or no OAuth client configured
  | { kind: "signedOut" }
  | { kind: "idle"; email: string | null; lastSyncedAt: number | null; pending: boolean }
  | { kind: "syncing"; email: string | null; lastSyncedAt: number | null }
  | {
      kind: "error";
      email: string | null;
      message: string;
      lastSyncedAt: number | null;
      /** When the next automatic retry fires, or null if it won't retry by itself. */
      retryAt: number | null;
    };

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

/**
 * Sync exists only in the desktop app with a configured OAuth client *and*
 * Firebase credentials. This is the gate: every `firebaseAuth()` call below is
 * downstream of it, so a build without .env.local never constructs the SDK —
 * it just runs local-first with the Sync control hidden (see src/firebase.ts).
 */
export function syncAvailable(): boolean {
  const bridge = b();
  return (
    bridge?.isElectron === true &&
    typeof bridge.signInWithGoogle === "function" &&
    firebaseConfigured() &&
    Boolean(clientId) &&
    Boolean(clientSecret)
  );
}

// ── Shadow mode (sync v2, Phase 2) ───────────────────────────────────
// The per-item v2 documents are kept equal to local beside the v1 document,
// which stays the source of truth. See src/sync/v2/shadow.ts.
let shadow: ShadowSync | null = null;
let shadowUid: string | null = null;
let shadowStatus: ShadowStatus = { kind: "off" };

export function getShadowStatus(): ShadowStatus {
  return shadowStatus;
}

/** The log watermark, per device and per account, in this machine's storage. */
function logWatermark(uid: string): Watermark {
  const key = `execute.v2.logWatermark.${uid}`;
  return {
    get: () => {
      try {
        return Number(localStorage.getItem(key) ?? "0") || 0;
      } catch {
        return 0;
      }
    },
    set: (at) => {
      try {
        localStorage.setItem(key, String(at));
      } catch {
        /* next run re-sends a few log lines; harmless — they're keyed by id */
      }
    },
  };
}

function startShadow(uid: string) {
  if (shadowUid === uid && shadow != null) return;
  stopShadow();
  shadowUid = uid;
  shadow = new ShadowSync(firestoreDocStore(uid), logWatermark(uid), (s) => {
    shadowStatus = s;
    for (const l of listeners) l();
  });
  shadow.start();
  if (getReady()) void shadow.sync(getState());
}

function stopShadow() {
  shadow?.stop();
  shadow = null;
  shadowUid = null;
}

function syncShadow() {
  if (shadow != null && getReady()) void shadow.sync(getState());
}

// ── The push loop ────────────────────────────────────────────────────
//
// Local changes are counted, not flagged: `localVersion` ticks on every save,
// and a push that succeeds marks everything up to the version it *started*
// with as synced. So a change made while a push is in flight is still pending
// afterwards, and "unsynced changes" is exact rather than a guess.
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let pushing = false;
let dirtyDuringPush = false;
let localVersion = 0;
let syncedVersion = 0;
let lastSyncedAt: number | null = null;
let failures = 0;

function pending(): boolean {
  return localVersion > syncedVersion;
}

function idleStatus(email: string | null): SyncStatus {
  return { kind: "idle", email, lastSyncedAt, pending: pending() };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error("The cloud didn't answer — will retry.")),
      ms,
    );
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

function clearRetry() {
  if (retryTimer != null) clearTimeout(retryTimer);
  retryTimer = null;
}

async function doPush() {
  const user = firebaseAuth().currentUser;
  // Never push before the store has loaded (would clobber cloud with empty
  // state) and never trigger interactive sign-in from an automatic push.
  if (user == null || !getReady()) return;
  if (pushing) {
    dirtyDuringPush = true;
    return;
  }
  clearRetry();
  pushing = true;
  const version = localVersion;
  setStatus({ kind: "syncing", email: user.email, lastSyncedAt });
  try {
    await withTimeout(mergeAndSave(user.uid, getState()), PUSH_TIMEOUT_MS);
    syncedVersion = Math.max(syncedVersion, version);
    lastSyncedAt = Date.now();
    failures = 0;
    setStatus(idleStatus(user.email));
    syncShadow();
  } catch (e: unknown) {
    failures += 1;
    // Retrying can't fix these two — the user has to act. Everything else
    // (offline, a timeout, contention) is worth another go, backing off.
    const hopeless = e instanceof OutdatedClientError || e instanceof CloudDocTooLargeError;
    const delay = RETRY_BACKOFF_MS[Math.min(failures, RETRY_BACKOFF_MS.length) - 1];
    if (!hopeless) retryTimer = setTimeout(() => void doPush(), delay);
    setStatus({
      kind: "error",
      email: user.email,
      message: e instanceof Error ? e.message : "Sync failed",
      lastSyncedAt,
      retryAt: hopeless ? null : Date.now() + delay,
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
  if (firebaseAuth().currentUser == null) return; // signed out → stay quiet, never popup
  if (pushTimer != null) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void doPush(), PUSH_DEBOUNCE_MS);
}

/** A local save happened: there's something the cloud doesn't have yet. */
function onLocalChange() {
  localVersion += 1;
  if (status.kind === "idle") setStatus(idleStatus(status.email));
  schedulePush();
}

/**
 * Push now if there's anything outstanding. Called on the events that follow a
 * sleep or an outage — the network coming back, the window regaining focus —
 * and on a slow heartbeat, so a missed event can't leave changes stranded.
 */
function kick(respectBackoff: boolean) {
  if (firebaseAuth().currentUser == null || pushing) return;
  if (status.kind === "error") {
    // A hopeless error waits for the user; a backing-off one waits its turn,
    // unless something just changed that makes an early try worthwhile.
    if (status.retryAt == null) return;
    if (respectBackoff && status.retryAt > Date.now()) return;
    void doPush();
    return;
  }
  if (pending()) void doPush();
}
const kickNow = () => kick(false);

// ── The pull loop ────────────────────────────────────────────────────
// The other half of two-way sync: a live subscription to the cloud doc that
// merges every remote change (a website edit, another device) into the local
// store in near-real-time. Without this the desktop was push-only — it never
// saw edits made anywhere else.
let unsubDoc: (() => void) | null = null;
let subscribedUid: string | null = null;

function stopPull() {
  stopShadow();
  if (unsubDoc != null) unsubDoc();
  unsubDoc = null;
  subscribedUid = null;
}

function startPull(uid: string) {
  if (subscribedUid === uid && unsubDoc != null) return; // already live for this user
  stopPull();
  subscribedUid = uid;
  startShadow(uid);
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
      // Compared through the cloud projection: the cloud deliberately carries
      // less than the device (see toCloud), and comparing the full state would
      // read that difference as "the cloud is behind" and push forever.
      if (!jsonEqual(toCloud(merged), remote)) schedulePush();
      else if (pending() && !pushing) {
        // The cloud already holds everything local has (another device, or an
        // earlier push that timed out on our side but landed): nothing to send.
        syncedVersion = localVersion;
        if (status.kind === "idle") setStatus(idleStatus(status.email));
      }
      // A change from elsewhere (the phone) needs no v1 push, but the v2 copy
      // still has to hear about it.
      syncShadow();
    },
    (e: unknown) => {
      setStatus({
        kind: "error",
        email: firebaseAuth().currentUser?.email ?? null,
        message: e instanceof Error ? e.message : "Sync read failed",
        lastSyncedAt,
        retryAt: null,
      });
    },
  );
}

/** Start pulling when signed in AND the store has loaded; stop otherwise. */
function reconcilePull() {
  const user = firebaseAuth().currentUser;
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
  const auth = firebaseAuth();
  const restored = auth.currentUser;
  setStatus(restored != null ? idleStatus(restored.email) : { kind: "signedOut" });

  const unsubAuth = onAuthStateChanged(auth, (user) => {
    if (user != null) {
      setStatus(idleStatus(user.email));
      if (getReady()) void doPush(); // catch-up push on restored session
    } else {
      setStatus({ kind: "signedOut" });
    }
    reconcilePull(); // (re)subscribe on sign-in, tear down on sign-out
  });
  // Also (re)subscribe the moment the store finishes loading — auth may restore
  // before the local load completes, and the pull must wait for readiness.
  const unsubReady = subscribeReady(reconcilePull);
  setCloudSync(onLocalChange);

  const onVisible = () => {
    if (document.visibilityState === "visible") kickNow();
  };
  window.addEventListener("online", kickNow);
  window.addEventListener("focus", kickNow);
  document.addEventListener("visibilitychange", onVisible);
  const heartbeat = setInterval(() => kick(true), HEARTBEAT_MS);

  return () => {
    unsubAuth();
    unsubReady();
    stopPull();
    setCloudSync(null);
    window.removeEventListener("online", kickNow);
    window.removeEventListener("focus", kickNow);
    document.removeEventListener("visibilitychange", onVisible);
    clearInterval(heartbeat);
    clearRetry();
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
  await signInWithCredential(firebaseAuth(), GoogleAuthProvider.credential(idToken));
  // onAuthStateChanged fires → status idle → catch-up push.
}

/** Manual nudge (retry after an error / force a push). */
export function syncNow(): void {
  if (firebaseAuth().currentUser == null) {
    void signIn();
    return;
  }
  void doPush();
}
