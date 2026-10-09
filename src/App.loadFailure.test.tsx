import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { AppState } from "./types";

// A failed load of the local store, end to end through <App/>. Before this was
// fixed, the app sat on "Loading…" until its 60 s clock tick re-rendered it, and
// that same render ran the open-day effect, which saved the empty placeholder
// over the real file 200 ms later — while the screen said the data on disk was
// untouched. Signed in, cloud sync also started on top of the placeholder.

// Cloud sync, made available and signed in, with the cloud swapped for an
// in-memory one so a test can see whether the engine ever started.
vi.hoisted(() => {
  vi.stubEnv("VITE_GOOGLE_DESKTOP_CLIENT_ID", "test-client-id");
  vi.stubEnv("VITE_GOOGLE_DESKTOP_CLIENT_SECRET", "test-client-secret");
});
const fakeAuth = { currentUser: { uid: "test-uid", email: "test@example.com" } };
vi.mock("./firebase", () => ({
  firebaseConfigured: () => true,
  firebaseAuth: () => fakeAuth,
  firebaseDb: () => {
    throw new Error("firebaseDb is not used: the doc store is mocked");
  },
}));
vi.mock("firebase/auth", () => ({
  GoogleAuthProvider: { credential: () => ({}) },
  signInWithCredential: () => Promise.resolve(),
  onAuthStateChanged: (_auth: unknown, cb: (user: unknown) => void) => {
    queueMicrotask(() => cb(fakeAuth.currentUser));
    return () => {};
  },
}));
const docStores = vi.hoisted(() => ({ created: 0 }));
vi.mock("./sync/v2/firestoreStore", async () => {
  const { MemoryStore } = await import("./sync/v2/memoryStore");
  return {
    firestoreDocStore: () => {
      docStores.created += 1;
      return new MemoryStore();
    },
  };
});

// Imported after the mocks above are registered (vi.mock is hoisted anyway).
import { App } from "./App";
import { getLoaded, initStore } from "./store/store";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  cleanup();
  delete window.execute;
  localStorage.clear();
});
afterAll(() => {
  vi.unstubAllEnvs();
});

/** The desktop bridge with a load that always fails; returns every save it is asked for. */
function failingBridge(opts: { sync: boolean }): AppState[] {
  const saves: AppState[] = [];
  window.execute = {
    isElectron: true,
    loadStore: () => Promise.reject(new Error("disk unplugged")),
    saveStore: (data) => {
      saves.push(data);
      return Promise.resolve(true);
    },
    ...(opts.sync ? { signInWithGoogle: () => Promise.resolve({ idToken: "unused" }) } : {}),
  };
  return saves;
}

describe("a failed load of the local store", () => {
  it("shows the error screen as soon as the load fails, not on the next minute tick", async () => {
    failingBridge({ sync: false });
    render(<App />);
    // Three attempts with two 150 ms pauses: well under a second.
    expect(await screen.findByText("Couldn't load your tasks", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("never writes to disk, whatever renders after it", async () => {
    const saves = failingBridge({ sync: false });
    await initStore();
    const { rerender } = render(<App />);
    await screen.findByText("Couldn't load your tasks", {}, { timeout: 3000 });
    rerender(<App />); // every effect gets another chance to fire
    await sleep(1000); // App's own load attempt finishes, and the 200 ms debounce passes
    expect(getLoaded()).toBe(false);
    expect(saves).toHaveLength(0);
  });

  it("never starts cloud sync", async () => {
    const saves = failingBridge({ sync: true });
    const before = docStores.created;
    await initStore();
    render(<App />);
    await screen.findByText("Couldn't load your tasks", {}, { timeout: 3000 });
    await sleep(1000);
    expect(docStores.created).toBe(before);
    expect(saves).toHaveLength(0);
  });

  // The control for the test above: with a load that succeeds, the same mocks do
  // start the engine, so "never started" is not just the mocks never wiring up.
  it("starts cloud sync once the load succeeds", async () => {
    window.execute = {
      isElectron: true,
      loadStore: () => Promise.resolve({}),
      saveStore: () => Promise.resolve(true),
      signInWithGoogle: () => Promise.resolve({ idToken: "unused" }),
    };
    const before = docStores.created;
    await initStore();
    render(<App />);
    await screen.findByPlaceholderText("Add a task for today…");
    await waitFor(() => expect(docStores.created).toBeGreaterThan(before));
  });
});
