// @vitest-environment node
import { describe, expect, it } from "vitest";
import { viewerCsp } from "../vite.config";

// The web viewer runs on mred-randomprojects.github.io, an origin every app of
// the account shares (and their Firebase sessions). Its built page has no
// inline script, so its CSP allows none: a javascript: URL or an injected
// inline script can't run there. Checked in a real browser (headless Chrome)
// on 2026-10-20: the page loads and sign-in opens its popup with no violation,
// and a javascript: link no longer runs.

const directive = (csp: string, name: string) =>
  csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `)) ?? "";

describe("the web viewer's CSP", () => {
  it("allows no inline script in the built page", () => {
    const csp = viewerCsp("execute-todo-1d3bc.firebaseapp.com", false);
    expect(directive(csp, "script-src")).not.toContain("'unsafe-inline'");
    expect(directive(csp, "script-src")).not.toContain("'unsafe-eval'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
  });

  it("keeps what Google sign-in needs", () => {
    const csp = viewerCsp("execute-todo-1d3bc.firebaseapp.com", false);
    expect(directive(csp, "script-src")).toContain("https://apis.google.com");
    expect(directive(csp, "frame-src")).toContain("https://execute-todo-1d3bc.firebaseapp.com");
    expect(directive(csp, "connect-src")).toContain("https://firestore.googleapis.com");
  });

  it("lets the dev server run React's inline fast-refresh preamble", () => {
    expect(directive(viewerCsp("x.firebaseapp.com", true), "script-src")).toContain("'unsafe-inline'");
  });
});
