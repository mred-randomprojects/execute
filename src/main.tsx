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

const root = document.getElementById("root");
if (root == null) throw new Error("Root element #root not found");

if (import.meta.env.VITE_VIEWER === "1") {
  // Web viewer build: auth-gated, read-only. The dynamic import keeps the
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
