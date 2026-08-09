const { contextBridge, ipcRenderer } = require("electron");

// The only bridge between renderer and disk. The renderer never touches the
// filesystem directly; it loads/saves a single JSON document through here.
contextBridge.exposeInMainWorld("execute", {
  isElectron: true,
  loadStore: () => ipcRenderer.invoke("store:load"),
  saveStore: (data) => ipcRenderer.invoke("store:save", data),
  // Optional cloud-sync sign-in: runs the loopback Google OAuth in the main
  // process and resolves with a Google id_token for Firebase signInWithCredential.
  signInWithGoogle: (clientId, clientSecret) =>
    ipcRenderer.invoke("auth:google", { clientId, clientSecret }),
  // Calendar integration: is a service-account key present, and create an event
  // silently. The key never crosses this bridge — only these calls do.
  calendarStatus: () => ipcRenderer.invoke("calendar:status"),
  createCalendarEvent: (input) => ipcRenderer.invoke("calendar:createEvent", input),
  // Presence: the renderer owns the counting, the main process owns the menu bar,
  // the dock badge, the login item and the two daily nudges. This pushes a
  // snapshot down whenever what's-left-today (or a setting) changes.
  updatePresence: (snapshot) => ipcRenderer.invoke("presence:update", snapshot),
  // The global capture shortcut fires in the main process; this is how it reaches
  // the capture bar. Returns an unsubscribe so React effects can clean up.
  onFocusCapture: (fn) => {
    const handler = () => fn();
    ipcRenderer.on("capture:focus", handler);
    return () => ipcRenderer.removeListener("capture:focus", handler);
  },
  // Clicking the evening nudge opens the shutdown ritual itself, not just the app.
  onOpenShutdown: (fn) => {
    const handler = () => fn();
    ipcRenderer.on("shutdown:open", handler);
    return () => ipcRenderer.removeListener("shutdown:open", handler);
  },
});
