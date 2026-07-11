/// <reference types="vite/client" />

// Typed env so we never reach for `any`. VITE_VIEWER flips the browser build
// into the read-only, auth-gated web viewer; the VITE_FIREBASE_* values come
// from .env.local (dev) or GitHub Actions secrets (deploy).
interface ImportMetaEnv {
  readonly VITE_VIEWER?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  // Google "Desktop app" OAuth client — powers the Electron loopback sign-in
  // for cloud sync. Absent → the desktop Sync control stays hidden.
  readonly VITE_GOOGLE_DESKTOP_CLIENT_ID?: string;
  readonly VITE_GOOGLE_DESKTOP_CLIENT_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
