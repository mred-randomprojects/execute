import { describe, it, expect, afterEach, vi } from "vitest";
import {
  adoptRemote,
  canUndo,
  createProject,
  flushPendingSave,
  getLoadError,
  getLoaded,
  getReady,
  getSaveError,
  getState,
  initStore,
  markOpened,
  setTheme,
} from "./store";
import { emptyState } from "../types";
import type { AppState } from "../types";

// These lock in the fix for the "stuck forever on the loading screen" hang:
// initStore must ALWAYS reach ready, even when the local load fails, and it must
// ride out a transient failure with a retry.

afterEach(() => {
  delete window.execute;
  localStorage.clear();
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A desktop bridge whose load always fails, recording every save it is asked for. */
function failingBridge(): AppState[] {
  const saves: AppState[] = [];
  window.execute = {
    isElectron: true,
    loadStore: () => Promise.reject(new Error("disk unplugged")),
    saveStore: (data) => {
      saves.push(data);
      return Promise.resolve(true);
    },
  };
  return saves;
}

describe("initStore resilience", () => {
  it("readies the app and surfaces an error when the load keeps failing (never hangs)", async () => {
    window.execute = {
      isElectron: true,
      loadStore: () => Promise.reject(new Error("disk unplugged")),
      saveStore: () => Promise.resolve(true),
    };
    await initStore();
    expect(getReady()).toBe(true); // the loading gate always clears
    expect(getLoadError()).toBe("disk unplugged");
    expect(getLoaded()).toBe(false); // ...but nothing may treat the placeholder as loaded
  });

  it("does not hang when the load never resolves — it times out and readies", async () => {
    window.execute = {
      isElectron: true,
      loadStore: () => new Promise<unknown>(() => {}), // never settles
      saveStore: () => Promise.resolve(true),
    };
    await initStore(30); // short per-attempt timeout for the test
    expect(getReady()).toBe(true);
    expect(getLoadError()).toBe("Loading your tasks timed out.");
    expect(getLoaded()).toBe(false);
  });

  it("retries a transient failure, loads the data, and clears the error", async () => {
    let calls = 0;
    window.execute = {
      isElectron: true,
      loadStore: () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error("cold-start blip"))
          : Promise.resolve({ tasks: [{ id: "x", text: "recovered" }] });
      },
      saveStore: () => Promise.resolve(true),
    };
    await initStore();
    expect(getReady()).toBe(true);
    expect(getLoadError()).toBeNull();
    expect(getLoaded()).toBe(true);
    expect(getState().tasks.some((t) => t.id === "x")).toBe(true);
  });
});

// A failed load leaves the empty placeholder in memory. Writing it would replace
// the real file on disk with an empty store, so after a failed load nothing may
// reach saveStore — not an edit, not a merge adopted from the cloud.
describe("a failed load never overwrites the store on disk", () => {
  it("drops the debounced save of an edit made after the failure", async () => {
    const saves = failingBridge();
    await initStore();
    markOpened("2026-10-09"); // what App's open-day effect does as soon as it renders
    await sleep(400); // past the 200 ms save debounce
    expect(saves).toHaveLength(0);
  });

  it("does not adopt (or save) a cloud merge", async () => {
    const saves = failingBridge();
    await initStore();
    const before = getState();
    adoptRemote({ ...emptyState(), lastOpenedDate: "2026-10-09" });
    await sleep(50);
    expect(saves).toHaveLength(0);
    expect(getState()).toBe(before);
  });

  it("shows a corrupt file as a load error naming the kept copy, without retrying or saving", async () => {
    let loads = 0;
    const saves: AppState[] = [];
    window.execute = {
      isElectron: true,
      // What electron/main.cjs hands back for a store file that isn't valid JSON.
      loadStore: () => {
        loads += 1;
        return Promise.resolve({ corrupt: true, backup: "/data/execute-store.json.corrupt-1700000000000" });
      },
      saveStore: (data) => {
        saves.push(data);
        return Promise.resolve(true);
      },
    };
    await initStore();
    expect(loads).toBe(1); // a corrupt file is not a blip: no retries
    expect(getLoaded()).toBe(false);
    expect(getLoadError()).toContain("/data/execute-store.json.corrupt-1700000000000");
    markOpened("2026-10-09");
    await sleep(400);
    expect(saves).toHaveLength(0);
  });

  it("forgets undo steps recorded against the placeholder once the real store loads", async () => {
    failingBridge();
    await initStore();
    createProject("typed while the error screen was up");
    expect(canUndo()).toBe(true);

    window.execute = {
      isElectron: true,
      loadStore: () => Promise.resolve({ tasks: [{ id: "real", text: "real task" }] }),
      saveStore: () => Promise.resolve(true),
    };
    await initStore();
    expect(getLoaded()).toBe(true);
    // Undoing that step would restore the empty placeholder over the loaded store.
    expect(canUndo()).toBe(false);
    expect(getState().tasks.some((t) => t.id === "real")).toBe(true);
    await sleep(400);
  });
});

// A save that fails (disk full, permissions) used to be an unhandled rejection:
// the app looked fine while edits lived only in memory. Now the failure is kept
// for the banner, retried with backoff, and cleared once a save lands.
describe("failed disk saves", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A loaded store whose first `failures` saves fail. Returns every state it was asked to save. */
  async function storeWithFlakyDisk(failures: number): Promise<AppState[]> {
    const calls: AppState[] = [];
    let left = failures;
    window.execute = {
      isElectron: true,
      loadStore: () => Promise.resolve({}),
      saveStore: (data) => {
        calls.push(data);
        if (left > 0) {
          left -= 1;
          return Promise.reject(new Error("ENOSPC: no space left on device"));
        }
        return Promise.resolve(true);
      },
    };
    await initStore();
    vi.useFakeTimers();
    return calls;
  }

  it("keeps the error up and retries with backoff until a save lands", async () => {
    const calls = await storeWithFlakyDisk(3);
    setTheme("carbon");
    await vi.advanceTimersByTimeAsync(200); // the save debounce
    expect(calls).toHaveLength(1);
    expect(getSaveError()).toContain("ENOSPC");

    await vi.advanceTimersByTimeAsync(1000); // first retry after 1 s
    expect(calls).toHaveLength(2);
    expect(getSaveError()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1999); // then 2 s
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(4000); // then 4 s, and this one lands
    expect(calls).toHaveLength(4);
    expect(getSaveError()).toBeNull();
    expect(calls[3]?.theme).toBe("carbon");

    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toHaveLength(4); // nothing left to retry
  });

  it("clears the error as soon as a later edit's save lands", async () => {
    const calls = await storeWithFlakyDisk(1);
    setTheme("carbon");
    await vi.advanceTimersByTimeAsync(200);
    expect(getSaveError()).not.toBeNull();

    setTheme("ivory");
    await vi.advanceTimersByTimeAsync(200);
    expect(getSaveError()).toBeNull();
    expect(calls.at(-1)?.theme).toBe("ivory");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toHaveLength(2); // that save covered the pending retry
  });
});

// Quitting (or closing the window) inside the 200 ms debounce used to drop the
// last edit. The window's pagehide/beforeunload flushes it, synchronously,
// because a closing window can't wait for an async reply.
describe("flushPendingSave", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function bridgeWithSyncSave(load: () => Promise<unknown>) {
    const sync: AppState[] = [];
    const async: AppState[] = [];
    window.execute = {
      isElectron: true,
      loadStore: load,
      saveStore: (data) => {
        async.push(data);
        return Promise.resolve(true);
      },
      saveStoreSync: (data) => {
        sync.push(data);
        return true;
      },
    };
    return { sync, async };
  }

  it("writes a save still waiting on its debounce before returning", async () => {
    const saves = bridgeWithSyncSave(() => Promise.resolve({}));
    await initStore();
    vi.useFakeTimers();
    setTheme("bordeaux");
    flushPendingSave();
    expect(saves.sync).toHaveLength(1);
    expect(saves.sync[0]?.theme).toBe("bordeaux");
    await vi.advanceTimersByTimeAsync(1000);
    expect(saves.async).toHaveLength(0); // the debounced save was folded into it
  });

  it("does nothing when no save is pending", async () => {
    const saves = bridgeWithSyncSave(() => Promise.resolve({}));
    await initStore();
    flushPendingSave();
    expect(saves.sync).toHaveLength(0);
  });

  it("never writes after a failed load", async () => {
    const saves = bridgeWithSyncSave(() => Promise.reject(new Error("disk unplugged")));
    await initStore();
    markOpened("2026-10-09");
    flushPendingSave();
    await sleep(400);
    expect(saves.sync).toHaveLength(0);
    expect(saves.async).toHaveLength(0);
  });
});
