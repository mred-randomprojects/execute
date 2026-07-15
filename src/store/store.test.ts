import { describe, it, expect, afterEach } from "vitest";
import { getLoadError, getReady, getState, initStore } from "./store";

// These lock in the fix for the "stuck forever on the loading screen" hang:
// initStore must ALWAYS reach ready, even when the local load fails, and it must
// ride out a transient failure with a retry.

afterEach(() => {
  delete window.execute;
  localStorage.clear();
});

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
    expect(getState().tasks.some((t) => t.id === "x")).toBe(true);
  });
});
