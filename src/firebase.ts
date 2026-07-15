import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
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

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

// initializeFirestore (not getFirestore) so we can tune the transport + cache.
export const db = initializeFirestore(app, {
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
});
