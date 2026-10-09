import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Bundled fonts (offline — no CDN dependency for a local-first app).
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/newsreader/400.css";
import "@fontsource/newsreader/500.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";

import "./theme.css";
import "./index.css";
import { App } from "./App";
import { interceptSave } from "cmd-s";
import { getLoaded, saveNow } from "./store/store";

const root = document.getElementById("root");
if (root == null) throw new Error("Root element #root not found");

const isViewer = import.meta.env.VITE_VIEWER === "1";

// ⌘S / Ctrl+S. The desktop store writes itself 200ms after every edit; ⌘S
// writes the current state right now, ahead of that timer, and says whether it
// landed — but never before the store has loaded successfully, when "the
// current state" is still the empty placeholder and writing it would erase the
// real one (saveNow refuses then; this stays quiet behind the error screen). The
// viewer has no local store: its edits (title, notes, plan date, project,
// completion, habit check-ins) go straight to the cloud, so there ⌘S only keeps
// the browser's "Save page" dialog away.
interceptSave(
  isViewer
    ? {}
    : {
        onSave: async () => {
          if (!getLoaded()) return;
          return (await saveNow()) ? "Saved" : "Not saved to disk — retrying";
        },
      },
);

if (isViewer) {
  // Web viewer build: auth-gated, light editing. The dynamic import keeps the
  // viewer's own UI out of the desktop build. It does NOT keep Firebase out —
  // App.tsx imports sync/desktopSync statically, so the SDK is in both bundles.
  // What makes that harmless is that the SDK is now built lazily and only
  // behind a credentials check (see src/firebase.ts); it used to be constructed
  // at import time, which turned a missing .env.local into a blank app.
  void import("./viewer/ViewerRoot").then(({ ViewerRoot }) => {
    createRoot(root).render(
      <StrictMode>
        <ViewerRoot />
      </StrictMode>
    );
  });
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
