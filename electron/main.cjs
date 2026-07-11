const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { app, BrowserWindow, ipcMain, shell } = require("electron");

if (require("electron-squirrel-startup")) {
  app.quit();
}

// In dev we attach to the Vite dev server; in prod we load the built bundle.
const isDev = process.env.ELECTRON_DEV === "1";
const DEV_URL = "http://localhost:5173";

// Single JSON document, local-first, in the OS app-data dir. Written atomically
// (temp file + rename) so a crash mid-write can never corrupt the store.
const STORE_FILE = path.join(app.getPath("userData"), "execute-store.json");

let mainWindow;

function readStore() {
  try {
    const raw = fs.readFileSync(STORE_FILE, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error != null && error.code === "ENOENT") return null;
    // Corrupt/unreadable file: keep a backup, start fresh rather than crash.
    try {
      fs.copyFileSync(STORE_FILE, `${STORE_FILE}.corrupt-${Date.now()}`);
    } catch {
      /* best effort */
    }
    return null;
  }
}

function writeStore(data) {
  const json = JSON.stringify(data);
  const tmp = `${STORE_FILE}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  fs.writeFileSync(tmp, json, "utf8");
  fs.renameSync(tmp, STORE_FILE);
}

function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Loopback (RFC 8252) Google OAuth for the desktop app. The renderer can't use
// signInWithPopup (file:// origin, popups denied), so we do the flow here: open
// the *system browser* to Google's consent, catch the redirect on a throwaway
// localhost port, and exchange the code (PKCE) for an id_token. The renderer
// feeds that to Firebase signInWithCredential. Google's UI never touches the app
// window, so there's no CSP/popup fight — only a token comes back.
function googleOAuth(clientId, clientSecret) {
  return new Promise((resolve, reject) => {
    const verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
    const stateParam = base64url(crypto.randomBytes(16));
    let redirectUri = "";
    let settled = false;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        server.close();
      } catch {
        /* already closing */
      }
      fn(arg);
    };

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, redirectUri || "http://127.0.0.1");
      if (url.pathname !== "/") {
        res.statusCode = 404;
        res.end();
        return;
      }
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const err = url.searchParams.get("error");
      res.setHeader("Content-Type", "text/html");
      res.end(
        "<!doctype html><meta charset=utf8><body style=\"font-family:-apple-system,sans-serif;padding:3rem;text-align:center;color:#14161c\"><h2>Signed in to Execute</h2><p>You can close this tab and return to the app.</p></body>",
      );
      if (err != null) return finish(reject, new Error(err));
      if (returnedState !== stateParam) return finish(reject, new Error("OAuth state mismatch"));
      if (code == null) return finish(reject, new Error("No authorization code returned"));
      try {
        const body = new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          code_verifier: verifier,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        });
        const r = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        });
        const json = await r.json();
        if (!r.ok) {
          return finish(reject, new Error(json.error_description || json.error || "Token exchange failed"));
        }
        if (json.id_token == null) return finish(reject, new Error("No id_token in token response"));
        finish(resolve, { idToken: json.id_token });
      } catch (e) {
        finish(reject, e instanceof Error ? e : new Error("Token exchange failed"));
      }
    });

    const timer = setTimeout(() => finish(reject, new Error("Sign-in timed out")), 300000);
    server.on("error", (e) => finish(reject, e));
    server.listen(0, "127.0.0.1", () => {
      redirectUri = `http://127.0.0.1:${server.address().port}`;
      const authUrl =
        "https://accounts.google.com/o/oauth2/v2/auth?" +
        new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: "openid email profile",
          code_challenge: challenge,
          code_challenge_method: "S256",
          state: stateParam,
          prompt: "select_account",
        }).toString();
      shell.openExternal(authUrl);
    });
  });
}

function registerIpc() {
  ipcMain.handle("store:load", () => readStore());
  ipcMain.handle("store:save", (_event, data) => {
    writeStore(data);
    return true;
  });
  ipcMain.handle("auth:google", (_event, { clientId, clientSecret }) => {
    if (!clientId || !clientSecret) throw new Error("Missing Google OAuth client config");
    return googleOAuth(clientId, clientSecret);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 880,
    minHeight: 600,
    show: false,
    backgroundColor: "#f1f1ef",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });

  // External links open in the user's browser, never inside the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow == null) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    // In dev the app runs unpackaged, so set the dock icon manually (packaged
    // builds get it from the .app bundle / Info.plist).
    if (isDev && process.platform === "darwin" && app.dock != null) {
      try {
        app.dock.setIcon(path.join(__dirname, "..", "build", "icon.png"));
      } catch {
        /* non-fatal */
      }
    }
    registerIpc();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
