const { contextBridge, ipcRenderer } = require("electron");

// The only bridge between renderer and disk. The renderer never touches the
// filesystem directly; it loads/saves a single JSON document through here.
contextBridge.exposeInMainWorld("execute", {
  isElectron: true,
  loadStore: () => ipcRenderer.invoke("store:load"),
  saveStore: (data) => ipcRenderer.invoke("store:save", data),
});
