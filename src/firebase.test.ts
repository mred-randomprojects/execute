import { afterEach, describe, expect, it, vi } from "vitest";

// The regression these lock in: cloud sync is OPTIONAL, but the Firebase SDK
// used to be constructed at module scope, so a checkout without .env.local threw
// `auth/invalid-api-key` *while the module was evaluating*. That is before React
// renders and before any error boundary exists, so the entire local-first app
// was a blank page because an optional feature had no credentials.
//
// Every case here runs through a fresh module registry, because `firebaseConfig`
// reads import.meta.env once at import time — which is precisely the timing that
// caused the bug.

async function withEnv<T>(
  env: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  vi.resetModules();
  return fn();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const NO_CONFIG = {
  VITE_FIREBASE_API_KEY: "",
  VITE_FIREBASE_PROJECT_ID: "",
  VITE_FIREBASE_APP_ID: "",
};

const CONFIG = {
  VITE_FIREBASE_API_KEY: "test-api-key",
  VITE_FIREBASE_PROJECT_ID: "test-project",
  VITE_FIREBASE_APP_ID: "1:2:web:3",
};

describe("firebase module, with no credentials", () => {
  it("imports without throwing", async () => {
    await withEnv(NO_CONFIG, async () => {
      await expect(import("./firebase")).resolves.toBeDefined();
    });
  });

  it("reports itself unconfigured", async () => {
    await withEnv(NO_CONFIG, async () => {
      const { firebaseConfigured } = await import("./firebase");
      expect(firebaseConfigured()).toBe(false);
    });
  });

  it("names the missing config if something asks for the SDK anyway", async () => {
    await withEnv(NO_CONFIG, async () => {
      const { firebaseAuth } = await import("./firebase");
      // Not the SDK's `auth/invalid-api-key`, which says nothing about which of
      // six env vars is missing or where they are meant to come from.
      expect(() => firebaseAuth()).toThrow(/\.env\.local/);
    });
  });

  it("lets the whole desktop sync module load — the chain App.tsx imports", async () => {
    await withEnv(NO_CONFIG, async () => {
      const sync = await import("./sync/desktopSync");
      // …and reports sync off rather than exploding, so the app runs local-first.
      expect(sync.syncAvailable()).toBe(false);
      expect(sync.getStatus()).toEqual({ kind: "off" });
      expect(() => sync.initAutoSync()()).not.toThrow();
    });
  });

  it("blank-but-present values count as absent, not as credentials", async () => {
    await withEnv(
      { ...NO_CONFIG, VITE_FIREBASE_API_KEY: "   " },
      async () => {
        const { firebaseConfigured } = await import("./firebase");
        expect(firebaseConfigured()).toBe(false);
      },
    );
  });
});

describe("firebase module, with credentials", () => {
  it("reports itself configured", async () => {
    await withEnv(CONFIG, async () => {
      const { firebaseConfigured } = await import("./firebase");
      expect(firebaseConfigured()).toBe(true);
    });
  });
});
