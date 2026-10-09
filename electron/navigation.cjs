// What the app window may open or navigate to. Kept apart from main.cjs so it
// can be tested without Electron (see navigation.test.mjs).

/** Schemes a link may hand to the OS (the browser, the mail app). */
const EXTERNAL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/**
 * Whether `url` (a link the page tried to open in a new window) may go to
 * shell.openExternal. Anything else — file:, custom app schemes, javascript: —
 * is dropped: openExternal would hand it to whatever app claims the scheme.
 */
function isExternalUrlAllowed(url) {
  try {
    return EXTERNAL_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Whether the window may navigate from the app to `url`: only to the app
 * itself — the built index.html it was loaded from (`appUrl`), or in dev the
 * Vite server's origin (`devUrl`, null in a packaged build). Links never
 * navigate the window: they open in the browser through the window-open handler.
 */
function isAppNavigation(url, appUrl, devUrl) {
  let target;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  if (devUrl != null) return target.origin === new URL(devUrl).origin;
  const app = new URL(appUrl);
  return target.protocol === app.protocol && target.pathname === app.pathname;
}

module.exports = { isAppNavigation, isExternalUrlAllowed };
