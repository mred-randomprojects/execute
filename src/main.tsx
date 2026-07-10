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
  // Web viewer build: auth-gated, read-only. The dynamic import keeps Firebase
  // (and any sign-in code) out of the Electron and `pnpm dev` bundles entirely.
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
