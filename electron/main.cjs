const fs = require("node:fs");
const path = require("node:path");
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

function registerIpc() {
  ipcMain.handle("store:load", () => readStore());
  ipcMain.handle("store:save", (_event, data) => {
    writeStore(data);
    return true;
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
