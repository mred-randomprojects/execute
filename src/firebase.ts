import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  type Firestore,
} from "firebase/firestore";

// Config is public by design (it identifies the project, it is not a secret) —
// access is enforced by the Firestore security rules, not by hiding these.
// Values come from .env.local locally and GitHub Actions secrets in deploy.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/**
 * Whether this build carries Firebase credentials at all.
 *
 * Cloud sync is OPTIONAL on the desktop (see .env.example) — the local-first
 * core has never needed it. But the SDK used to be constructed at module scope,
 * and `getAuth` throws
 * `auth/invalid-api-key` on an empty config. That throw lands while this module
 * is still *evaluating*, which is before React renders and before any error
 * boundary can exist — so a checkout without .env.local (or a deploy with one
 * rotated GitHub secret) was a silent blank page, with an optional feature
 * taking down the core that doesn't depend on it.
 *
 * Hence: nothing is constructed until someone asks, and the two entry points
 * that could ask — {@link import("./sync/desktopSync").syncAvailable} on the
 * desktop, the viewer's root gate on the web — check this first.
 */
export function firebaseConfigured(): boolean {
  const required = [
    firebaseConfig.apiKey,
    firebaseConfig.projectId,
    firebaseConfig.appId,
  ];
  return required.every((v) => typeof v === "string" && v.trim() !== "");
}

interface Services {
  auth: Auth;
  db: Firestore;
}

// Built once, on first use. Never at import time — see firebaseConfigured.
// The app handle is cached separately from the services it produces: if
// `getAuth` or `initializeFirestore` ever throws, `services` stays null and the
// next call retries — and a second `initializeApp` would fail with "app named
// '[DEFAULT]' already exists", hiding whatever actually went wrong.
let app: FirebaseApp | null = null;
let services: Services | null = null;

function init(): Services {
  if (services != null) return services;
  if (!firebaseConfigured()) {
    // Reached only if a caller skipped its `firebaseConfigured()` gate. A named
    // error beats the SDK's `auth/invalid-api-key`, which says nothing about
    // which of six env vars is missing or where they come from.
    throw new Error(
      "Cloud sync isn't configured: set VITE_FIREBASE_API_KEY, " +
        "VITE_FIREBASE_PROJECT_ID and VITE_FIREBASE_APP_ID in .env.local (see .env.example).",
    );
  }
  app ??= initializeApp(firebaseConfig);
  // Auth before Firestore, as when this ran at module scope.
  services = {
    auth: getAuth(app),
    // initializeFirestore (not getFirestore) so we can tune the transport + cache.
    db: initializeFirestore(app, {
      // ROOT CAUSE of the "stuck on Loading your tasks…" hang: Firestore's default
      // transport is a streaming WebChannel, which some mobile carriers / 5G NATs /
      // proxies silently break — the listen stream never establishes, so onSnapshot
      // never delivers a first snapshot and the app hangs forever with no error.
      // Auto-detecting long-polling falls back to plain HTTP polling on exactly
      // those networks. (Firebase's own recommended fix for this class of hang.)
      experimentalAutoDetectLongPolling: true,
      // Persist the last-synced snapshot in IndexedDB so repeat opens paint from
      // cache instantly while the network refresh happens in the background — the
      // "open on my phone, glance, tick something off" path is now near-instant.
      localCache: persistentLocalCache({
        tabManager: persistentSingleTabManager(undefined),
      }),
    }),
  };
  return services;
}

/** The Auth instance, constructing the SDK on first call. Throws if unconfigured. */
export function firebaseAuth(): Auth {
  return init().auth;
}

/** The Firestore instance, constructing the SDK on first call. Throws if unconfigured. */
export function firebaseDb(): Firestore {
  return init().db;
}
