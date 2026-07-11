import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Electron loads the built renderer from disk via file://, so assets must be
// referenced relatively (base: "./"). The web viewer (VITE_VIEWER=1) instead
// deploys to GitHub Pages as a project site under /execute/, so its assets need
// that absolute base. The dev server runs on a fixed port so the Electron shell
// can reliably attach to it (see electron/main.cjs).
const isViewer = process.env.VITE_VIEWER === "1";

export default defineConfig({
  base: isViewer ? "/execute/" : "./",
  plugins: [react()],
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
});
