import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

// Signing out of the web viewer has to take the data with it. Firebase's
// signOut drops the session but leaves Firestore's offline copy of the tasks in
// IndexedDB, on the origin the viewer shares with every other app of the
// account; the viewer clears that cache too, then reloads.

const calls: string[] = [];

vi.mock("firebase/auth", () => ({
  GoogleAuthProvider: class {},
  onAuthStateChanged: (_auth: unknown, cb: (u: null) => void) => {
    cb(null);
    return () => {};
  },
  signInWithPopup: vi.fn(),
  signOut: vi.fn(async () => {
    calls.push("signOut");
  }),
}));

vi.mock("./firebase", () => ({
  firebaseAuth: () => ({}),
  clearCloudCache: vi.fn(async () => {
    calls.push("clearCloudCache");
  }),
}));

afterEach(() => {
  cleanup();
  calls.length = 0;
});

describe("signing out of the web viewer", () => {
  it("signs out, clears the offline copy of the data, then reloads", async () => {
    const { AuthProvider, useAuth } = await import("./auth");
    let signOut: (() => Promise<void>) | null = null;
    function Probe() {
      signOut = useAuth().signOut;
      return null;
    }
    render(
      <AuthProvider afterSignOut={() => calls.push("reload")}>
        <Probe />
      </AuthProvider>,
    );
    await act(async () => {
      await signOut?.();
    });
    expect(calls).toEqual(["signOut", "clearCloudCache", "reload"]);
  });

  it("still reloads when the cache can't be cleared", async () => {
    const firebase = await import("./firebase");
    vi.mocked(firebase.clearCloudCache).mockRejectedValueOnce(new Error("another tab holds it"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { AuthProvider, useAuth } = await import("./auth");
    let signOut: (() => Promise<void>) | null = null;
    function Probe() {
      signOut = useAuth().signOut;
      return null;
    }
    render(
      <AuthProvider afterSignOut={() => calls.push("reload")}>
        <Probe />
      </AuthProvider>,
    );
    await act(async () => {
      await signOut?.();
    });
    expect(calls).toEqual(["signOut", "reload"]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
