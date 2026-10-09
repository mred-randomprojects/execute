// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isAppNavigation, isExternalUrlAllowed } = require("./navigation.cjs");

describe("isExternalUrlAllowed", () => {
  it("lets web and mail links through to the OS", () => {
    expect(isExternalUrlAllowed("https://example.com/a?b=c")).toBe(true);
    expect(isExternalUrlAllowed("http://localhost:3000/")).toBe(true);
    expect(isExternalUrlAllowed("mailto:someone@example.com")).toBe(true);
    expect(isExternalUrlAllowed("HTTPS://EXAMPLE.COM")).toBe(true);
  });

  it("drops every other scheme, and anything that isn't a URL", () => {
    expect(isExternalUrlAllowed("file:///Applications/Calculator.app")).toBe(false);
    expect(isExternalUrlAllowed("javascript:alert(1)")).toBe(false);
    expect(isExternalUrlAllowed("vscode://file/etc/passwd")).toBe(false);
    expect(isExternalUrlAllowed("smb://server/share")).toBe(false);
    expect(isExternalUrlAllowed("not a url")).toBe(false);
    expect(isExternalUrlAllowed("")).toBe(false);
  });
});

describe("isAppNavigation", () => {
  const appUrl = "file:///Applications/Execute.app/Contents/Resources/app.asar/dist/index.html";

  it("in a packaged build, allows only the app's own index.html", () => {
    expect(isAppNavigation(appUrl, appUrl, null)).toBe(true);
    expect(isAppNavigation(`${appUrl}#/today`, appUrl, null)).toBe(true);
    expect(isAppNavigation("https://example.com/", appUrl, null)).toBe(false);
    expect(isAppNavigation("file:///etc/passwd", appUrl, null)).toBe(false);
    expect(isAppNavigation("file:///Applications/Execute.app/Contents/Resources/app.asar/dist/other.html", appUrl, null)).toBe(false);
    expect(isAppNavigation("http://localhost:5173/", appUrl, null)).toBe(false);
    expect(isAppNavigation("garbage", appUrl, null)).toBe(false);
  });

  it("in dev, allows the Vite server's origin and nothing else", () => {
    const devUrl = "http://localhost:5173";
    expect(isAppNavigation("http://localhost:5173/", appUrl, devUrl)).toBe(true);
    expect(isAppNavigation("http://localhost:5173/src/main.tsx", appUrl, devUrl)).toBe(true);
    expect(isAppNavigation("http://localhost:5174/", appUrl, devUrl)).toBe(false);
    expect(isAppNavigation("https://example.com/", appUrl, devUrl)).toBe(false);
  });
});
