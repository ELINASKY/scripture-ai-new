// Shared set-up for the real-browser tests (real Chromium + simulated cameras). Not part of the shipped app.
const { app, BrowserWindow, ipcMain, desktopCapturer, dialog } = require("electron"); const path = require("path"); const fs = require("fs"); const { spawn, execFileSync } = require("child_process"); const FF = require("ffmpeg-static");
for (const f of ["use-fake-device-for-media-stream", "use-fake-ui-for-media-stream", "no-sandbox", "disable-gpu", "ignore-certificate-errors"]) app.commandLine.appendSwitch(f);
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
if (process.env.FAKE_AUDIO) app.commandLine.appendSwitch("use-file-for-fake-audio-capture", process.env.FAKE_AUDIO);
require("./ipc")(ipcMain, desktopCapturer, dialog, BrowserWindow);
const { start } = require("./server");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let fails = 0, passes = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "PASS " : "FAIL ") + name + (extra !== "" ? "  (" + extra + ")" : "")); ok ? passes++ : fails++; };
module.exports = function boot(main) {
  app.whenReady().then(async () => {
    const srv = await start(path.join(__dirname, "app"), 0, { ffmpegPath: FF, dataDir: "/tmp", recDir: "/tmp/sai-rec-default", modelDir: path.join(__dirname, "models") });
    const win = new BrowserWindow({ show: true, width: 1366, height: 768, webPreferences: { backgroundThrottling: false, preload: path.join(__dirname, "preload.js") } });
    win.webContents.session.on("will-download", (e, item) => item.setSavePath("/tmp/e2e-download.webm"));
    win.webContents.on("console-message", (e, l, m) => { if (l >= 3) console.log("  [page error]", m.slice(0, 160)); });
    await win.loadURL(`http://127.0.0.1:${srv.port}/index.html?e2e=1`);
    const run = (js) => win.webContents.executeJavaScript(js, true), click = (sel) => run(`document.querySelector('${sel}').click()`);
    for (let i = 0; i < 80 && (await run(`document.querySelector('#loading').style.display`)) !== "none"; i++) await sleep(250);
    await run(`window.confirm = () => true; window.prompt = (m, d) => d || ""; window.__png = async (color, name, w = 320, h = 180) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h); return await new Promise((r) => c.toBlob((b) => r(new File([b], name, { type: 'image/png' })))); };
      window.__file = (b64, name, type) => { const bin = atob(b64), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new File([a], name, { type }); }; 0`);
    const region = (x0, y0, x1, y1, sel = "#pgmCanvas") => run(`(()=>{const c=document.querySelector('${sel}'),w=c.width,h=c.height;const d=c.getContext('2d').getImageData(Math.floor(w*${x0}),Math.floor(h*${y0}),Math.max(1,Math.floor(w*(${x1}-${x0}))),Math.max(1,Math.floor(h*(${y1}-${y0})))).data;let s=0,n=0;for(let i=0;i<d.length;i+=4){s+=d[i]+d[i+1]+d[i+2];n++}return Math.round(s/n/3)})()`);
    const peak = async (expr, ms = 2800) => { let m = 0; for (let t = 0; t < ms; t += 120) { m = Math.max(m, (await run(expr)) || 0); await sleep(120); } return m; };
    await main({ win, run, click, region, peak, srv, FF, fs, path, spawn, execFileSync, sleep, check });
    console.log(`\n${passes} passed, ${fails} failed`); console.log(fails ? "FAILED" : "ALL PASSED"); app.exit(fails ? 1 : 0);
  });
};
