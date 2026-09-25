import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
} from "firebase/auth";
import { firebaseAuth, firebaseConfigured } from "../firebase";
import { adoptRemote, getReady, getState, setCloudSync, subscribeReady } from "../store/store";
import type { Task } from "../types";
import { DocSync, type EngineStatus, type Watermark } from "./v2/engine";
import { firestoreDocStore } from "./v2/firestoreStore";

// ─── Desktop cloud sync (sync v2) ────────────────────────────────────
//
// Wiring only: sign-in, the local-change hook, wake/online/focus kicks, and the
// status the sidebar shows. The sync itself — per-item documents, merge,
// guarded writes — is the engine in ./v2/engine.

const clientId = import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID;
const clientSecret = import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_SECRET;

/** Local edits are pushed after this long without another one. */
const LOCAL_DEBOUNCE_MS = 1500;
/** How often to re-check for unsynced changes (a missed wake/online event). */
const HEARTBEAT_MS = 60_000;

export type SyncStatus =
  | { kind: "off" } // not the desktop app, or no OAuth client configured
  | { kind: "signedOut" }
  | { kind: "idle"; email: string | null; lastSyncedAt: number | null; pending: boolean }
  | { kind: "syncing"; email: string | null; lastSyncedAt: number | null; detail: string | null }
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
  reportSoon();
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

// ── Local changes ────────────────────────────────────────────────────
// Counted, not flagged: `localVersion` ticks on every save, and the engine
// reports which version a round covered — so "unsynced changes" is exact.
let localVersion = 0;
let syncedVersion = 0;
let lastSyncedAt: number | null = null;

function pending(): boolean {
  return localVersion > syncedVersion;
}

function email(): string | null {
  return firebaseAuth().currentUser?.email ?? null;
}

// ── The engine ───────────────────────────────────────────────────────
let engine: DocSync | null = null;
let engineUid: string | null = null;

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

function onEngineStatus(s: EngineStatus): void {
  const e = email();
  switch (s.kind) {
    case "stopped":
      return;
    case "inSync":
      syncedVersion = Math.max(syncedVersion, s.version);
      lastSyncedAt = s.at;
      setStatus({ kind: "idle", email: e, lastSyncedAt, pending: pending() });
      return;
    case "starting":
      setStatus({ kind: "syncing", email: e, lastSyncedAt, detail: "Connecting…" });
      return;
    case "migrating":
      setStatus({
        kind: "syncing",
        email: e,
        lastSyncedAt,
        detail: `Moving your data to the new sync format — ${s.detail.toLowerCase()}…`,
      });
      return;
    case "syncing":
      setStatus({ kind: "syncing", email: e, lastSyncedAt, detail: null });
      return;
    case "waiting":
      setStatus({ kind: "syncing", email: e, lastSyncedAt, detail: "Merging a change from another device…" });
      return;
    case "error":
      setStatus({ kind: "error", email: e, message: s.message, lastSyncedAt, retryAt: s.retryAt });
      return;
    case "halted":
      setStatus({ kind: "error", email: e, message: s.message, lastSyncedAt, retryAt: null });
      return;
    case "outdated":
      setStatus({
        kind: "error",
        email: e,
        message: `The cloud was saved by a newer version of Execute (data v${s.remoteVersion}). Update this app — it won't write until then.`,
        lastSyncedAt,
        retryAt: null,
      });
      return;
  }
}

function startEngine(uid: string): void {
  if (engineUid === uid && engine != null) return;
  stopEngine();
  engineUid = uid;
  engine = new DocSync(
    firestoreDocStore(uid),
    { ready: getReady, getLocal: getState, version: () => localVersion, adopt: adoptRemote },
    logWatermark(uid),
    // No migration hooks any more: the move off the v1 single document ran on
    // 2026-09-25 (meta/format records it, and v1 is frozen as a backup). On a
    // cloud without meta/format the engine simply uploads the local state.
    { onStatus: onEngineStatus },
  );
  engine.start();
}

function stopEngine(): void {
  engine?.stop();
  engine = null;
  engineUid = null;
}

/** Run the engine when signed in AND the store has loaded; stop it otherwise. */
function reconcileEngine(): void {
  const user = firebaseAuth().currentUser;
  if (user == null || !getReady()) {
    stopEngine();
    return;
  }
  startEngine(user.uid);
  engine?.request();
}

/** A local save happened: there's something the cloud doesn't have yet. */
function onLocalChange(): void {
  localVersion += 1;
  if (status.kind === "idle") setStatus({ ...status, pending: true });
  engine?.request(LOCAL_DEBOUNCE_MS);
}

/**
 * Sync now if there's anything outstanding — after a sleep or an outage (the
 * network coming back, the window regaining focus) and on a slow heartbeat, so
 * a missed event can't leave changes stranded.
 */
function kick(): void {
  if (engine == null) return;
  if (pending() || status.kind === "error") engine.kick();
}

// ── Diagnostics ──────────────────────────────────────────────────────
// sync-status.json in the app-data folder: what sync is doing, as counts and
// states (never task text). Written at most once a second.
let reportTimer: ReturnType<typeof setTimeout> | null = null;

function countTasks(tasks: Task[]): number {
  let n = 0;
  for (const t of tasks) n += 1 + countTasks(t.children);
  return n;
}

function reportSoon(): void {
  const bridge = b();
  if (bridge?.reportSyncStatus == null || reportTimer != null) return;
  reportTimer = setTimeout(() => {
    reportTimer = null;
    let local: Record<string, number> | null = null;
    try {
      const s = getState();
      local = {
        tasks: countTasks(s.tasks),
        trash: s.trash.length,
        tombstones: s.tombstones.length,
        projects: s.projects.length,
        recurrences: s.recurrences.length,
        log: s.log.length,
        days: s.days.length,
      };
    } catch {
      /* the store may not be ready yet */
    }
    void bridge.reportSyncStatus?.({
      at: new Date().toISOString(),
      status,
      engine: engine?.getStatus() ?? null,
      cloudCounts: engine?.counts() ?? null,
      format: engine?.format() ?? null,
      local,
      localVersion,
      syncedVersion,
    });
  }, 1000);
}

/**
 * Wire auto-sync once, at app startup. Registers the store persist hook (so
 * every change schedules a sync) and watches auth state. Returns a cleanup for
 * React StrictMode's double-mount. No-op unless sync is available.
 */
export function initAutoSync(): () => void {
  if (!syncAvailable()) {
    setStatus({ kind: "off" });
    return () => {};
  }
  const auth = firebaseAuth();
  const restored = auth.currentUser;
  setStatus(
    restored != null
      ? { kind: "syncing", email: restored.email, lastSyncedAt, detail: "Connecting…" }
      : { kind: "signedOut" },
  );

  const unsubAuth = onAuthStateChanged(auth, (user) => {
    if (user == null) setStatus({ kind: "signedOut" });
    reconcileEngine(); // (re)start on sign-in, stop on sign-out
  });
  // Auth may restore before the local load completes; start when both are in.
  const unsubReady = subscribeReady(reconcileEngine);
  setCloudSync(onLocalChange);

  const onVisible = () => {
    if (document.visibilityState === "visible") kick();
  };
  window.addEventListener("online", kick);
  window.addEventListener("focus", kick);
  document.addEventListener("visibilitychange", onVisible);
  const heartbeat = setInterval(kick, HEARTBEAT_MS);

  return () => {
    unsubAuth();
    unsubReady();
    stopEngine();
    setCloudSync(null);
    window.removeEventListener("online", kick);
    window.removeEventListener("focus", kick);
    document.removeEventListener("visibilitychange", onVisible);
    clearInterval(heartbeat);
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
  // onAuthStateChanged fires → the engine starts.
}

/** Manual nudge (retry after an error / force a round). */
export function syncNow(): void {
  if (firebaseAuth().currentUser == null) {
    void signIn();
    return;
  }
  engine?.kick();
}
