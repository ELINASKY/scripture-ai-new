// Lets the page list the screens and windows that can be captured, and pick a folder (desktop app only).
module.exports = function register(ipcMain, desktopCapturer, dialog, BrowserWindow) {
  ipcMain.handle("sai:sources", async () =>
    (await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 } }))
      .map((s) => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL() })));
  const flt = [{ name: "Scripture AI project", extensions: ["sai"] }];
  ipcMain.handle("sai:saveProject", async (e, name) => { const r = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow(), { title: "Save project", defaultPath: String(name || "Untitled project.sai"), filters: flt }); return r.canceled ? null : r.filePath; });
  ipcMain.handle("sai:openProject", async () => { const r = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), { title: "Open project", properties: ["openFile"], filters: flt }); return r.canceled ? null : r.filePaths[0]; });
  ipcMain.handle("sai:pickFolder", async () => {
    if (!dialog) return null;
    const r = await dialog.showOpenDialog(BrowserWindow ? BrowserWindow.getFocusedWindow() : undefined, { properties: ["openDirectory", "createDirectory"], title: "Choose where recordings are saved" });
    return r.canceled ? null : r.filePaths[0];
  });
};
