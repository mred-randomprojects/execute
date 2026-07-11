import { defineConfig } from "vitest/config";
import { loadEnv, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";

// The Electron renderer ships a deliberately strict, localhost-only CSP in
// index.html (script-src 'self', connect only to the dev HMR socket). That is
// correct for a local-first app that loads no remote content — but the web
// viewer (VITE_VIEWER=1) MUST talk to Google for Firebase Auth + Firestore, so
// for that build only we swap the CSP meta tag for one that permits exactly the
// Google/Firebase origins the SDK needs (and nothing broader).
function viewerCsp(authDomain: string, isDev: boolean): string {
  const connect = [
    "'self'",
    "https://identitytoolkit.googleapis.com",
    "https://securetoken.googleapis.com",
    "https://firestore.googleapis.com",
    "https://www.googleapis.com",
    `https://${authDomain}`,
    // dev only: Vite HMR websocket + xhr
    ...(isDev ? ["ws://localhost:5173", "http://localhost:5173"] : []),
  ].join(" ");

  return [
    "default-src 'self'",
    // apis.google.com/js/api.js is the gapi loader signInWithPopup pulls in.
    "script-src 'self' 'unsafe-inline' https://apis.google.com https://www.gstatic.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://*.googleusercontent.com",
    "font-src 'self' data:",
    // the gapi iframe, Google's login page, and Firebase's auth handler page.
    `frame-src 'self' https://apis.google.com https://accounts.google.com https://${authDomain}`,
    `connect-src ${connect}`,
  ].join("; ");
}

function viewerCspPlugin(csp: string): PluginOption {
  return {
    name: "viewer-csp",
    transformIndexHtml(html) {
      return html.replace(
        /<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?content="[^"]*"\s*\/>/,
        `<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );
    },
  };
}

// Electron loads the built renderer from disk via file://, so assets must be
// referenced relatively (base: "./"). The web viewer instead deploys to GitHub
// Pages as a project site under /execute/, so its assets need that absolute
// base. The dev server runs on a fixed port so the Electron shell can reliably
// attach to it (see electron/main.cjs).
export default defineConfig(({ command, mode }) => {
  const isViewer = process.env.VITE_VIEWER === "1";
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const authDomain =
    env.VITE_FIREBASE_AUTH_DOMAIN || "execute-todo-1d3bc.firebaseapp.com";

  return {
    base: isViewer ? "/execute/" : "./",
    plugins: [
      react(),
      ...(isViewer ? [viewerCspPlugin(viewerCsp(authDomain, command === "serve"))] : []),
    ],
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
    server: {
      port: 5173,
      strictPort: true,
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test-setup.ts"],
    },
  };
});
