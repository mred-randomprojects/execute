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
});
