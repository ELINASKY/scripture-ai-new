const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld("sai", {
  sources: () => ipcRenderer.invoke("sai:sources"), pickFolder: () => ipcRenderer.invoke("sai:pickFolder"),
  saveProject: (name) => ipcRenderer.invoke("sai:saveProject", name), openProject: () => ipcRenderer.invoke("sai:openProject"),
  pathOf: (file) => { try { return webUtils.getPathForFile(file) || ""; } catch (e) { return ""; } },
});
