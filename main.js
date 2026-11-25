const { app, BrowserWindow, Menu, dialog, clipboard, session, desktopCapturer, ipcMain } = require("electron");
require("./ipc")(ipcMain, desktopCapturer, require("electron").dialog, require("electron").BrowserWindow);
const path = require("path");
const { start } = require("./server");
function ffmpegPath() { try { return require("ffmpeg-static").replace("app.asar", "app.asar.unpacked"); } catch (e) { return null; } }

if (!app.requestSingleInstanceLock()) app.quit();
let port = 0, win = null;
const outputUrl = () => `http://127.0.0.1:${port}/index.html#output`;

function menu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "File", submenu: [{ role: "quit", label: "Exit" }] },
    { label: "Output", submenu: [
      { label: "Copy vMix / OBS Browser Source link", click: () => { clipboard.writeText(outputUrl()); dialog.showMessageBox(win, { message: "Link copied", detail: outputUrl() + "\n\nIn vMix or OBS add a Web Browser input and paste this link. Set width 1920, height 1080." }); } },
      { label: "Full screen (F11)", role: "togglefullscreen" },
    ] },
    { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }] },
  ]));
}

app.whenReady().then(async () => {
  ({ port } = await start(path.join(__dirname, "app"), 8765, { ffmpegPath: ffmpegPath(), dataDir: app.getPath("userData"), recDir: path.join(app.getPath("videos"), "Scripture AI"), modelDir: app.isPackaged ? path.join(process.resourcesPath, "models") : path.join(__dirname, "models") }));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => ["media", "audioCapture", "videoCapture", "fullscreen"].includes(perm));
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(["media", "audioCapture", "fullscreen"].includes(perm)));
  // screen capture without a picker for now: shares the main screen
  session.defaultSession.setDisplayMediaRequestHandler((req, cb) => desktopCapturer.getSources({ types: ["screen"] }).then((s) => cb({ video: s[0] })).catch(() => cb({})));
  menu();
  win = new BrowserWindow({ width: 1360, height: 860, backgroundColor: "#0f1218", title: "Scripture AI", webPreferences: { backgroundThrottling: false, preload: path.join(__dirname, "preload.js") }, icon: path.join(__dirname, "build", "icon.png") });
  win.webContents.setWindowOpenHandler(() => ({ action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: "#000000", title: "Scripture AI Output" } }));
  win.loadURL(`http://127.0.0.1:${port}/index.html`);
});
app.on("window-all-closed", () => app.quit());
