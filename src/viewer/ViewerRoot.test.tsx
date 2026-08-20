import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// The desktop degrades to "sync off" without credentials; the viewer can't —
// it IS the cloud. So it has to say so, above AuthProvider, whose effect would
// otherwise construct the SDK and throw. A deploy missing one GitHub secret
// used to land here as a blank page.

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the web viewer without Firebase credentials", () => {
  it("explains itself instead of rendering a blank page", async () => {
    vi.stubEnv("VITE_FIREBASE_API_KEY", "");
    vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "");
    vi.stubEnv("VITE_FIREBASE_APP_ID", "");
    vi.resetModules();

    const { ViewerRoot } = await import("./ViewerRoot");
    render(<ViewerRoot />);

    expect(screen.getByText("Not configured")).toBeTruthy();
    expect(screen.getByText(/VITE_FIREBASE_/)).toBeTruthy();
  });
});
