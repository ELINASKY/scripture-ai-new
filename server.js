// Tiny local web server (127.0.0.1 only). Serves the app and relays "what is on screen" to any output window,
// including vMix / OBS Browser Sources, which cannot share the browser's own messaging.
const { Stt } = require("./stt");
const { Ndi } = require("./ndi");
const http = require("http"), https = require("https"), os = require("os"), crypto = require("crypto"), fs = require("fs"), path = require("path"), { spawn } = require("child_process");

function lanAddress() {
  const all = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
  return all.find((a) => /^192\.168\./.test(a)) || all.find((a) => /^10\./.test(a)) || all.find((a) => /^172\.(1[6-9]|2\d|3[01])\./.test(a)) || all[0] || "127.0.0.1";
}
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };

function start(root, preferredPort = 8765, opts = {}) {
  let last = null; const clients = new Set();
  // ---- streaming: the page sends WebM chunks, FFmpeg re-encodes to H.264/AAC and pushes to every destination ----
  let ff = null, info = { running: false, t0: 0, last: "", error: "" }, urls = [];
  const mask = (line) => urls.reduce((l, u) => l.split(u).join("[stream]"), line);
  function ffStart(cfg) {
    if (!opts.ffmpegPath) throw new Error("FFmpeg is not available in this version.");
    const dest = (cfg.urls || []).filter((u) => /^rtmps?:\/\/[^\s|\[\]]+$/.test(u));
    if (!dest.length) throw new Error("No valid rtmp:// or rtmps:// destination.");
    const fps = Math.min(60, Math.max(10, +cfg.fps || 30)), k = Math.min(20000, Math.max(500, +cfg.kbps || 3000));
    ffStop(); urls = dest;
    const tee = dest.map((u) => `[f=flv:flvflags=no_duration_filesize:onfail=ignore]${u}`).join("|");
    const args = ["-hide_banner", "-loglevel", "info", "-stats_period", "1", "-fflags", "+genpts", "-f", "webm", "-i", "pipe:0",
      "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-pix_fmt", "yuv420p",
      "-r", String(fps), "-g", String(fps * 2), "-b:v", k + "k", "-maxrate", k + "k", "-bufsize", k * 2 + "k",
      "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2", "-f", "tee", tee];
    info = { running: true, t0: Date.now(), last: "starting…", error: "" };
    const p = (ff = spawn(opts.ffmpegPath, args, { stdio: ["pipe", "ignore", "pipe"], windowsHide: true }));
    p.stderr.on("data", (d) => {
      for (const raw of String(d).split(/[\r\n]+/)) {
        const line = mask(raw.trim()); if (!line) continue;
        if (/^(frame|size)=/.test(line) || /time=\d/.test(line)) info.last = line;
        else if (!/onfail|^(Input|Output|Stream mapping|Press)/.test(line) && /error|fail|refused|denied|invalid|unable|could not|timed out/i.test(line)) info.error = line;
      }
    });
    p.stdin.on("error", () => {});
    p.on("error", (e) => { info.running = false; info.error = "Could not start FFmpeg: " + e.message; });
    p.on("close", (code) => { if (ff === p) { info.running = false; if (code && !info.error) info.error = "FFmpeg stopped (code " + code + ")."; ff = null; } });
  }
  function ffStop() { const p = ff; if (!p) return; ff = null; info.running = false; try { p.stdin.end(); } catch (e) {} setTimeout(() => { try { p.kill(); } catch (e) {} }, 3000); }
  // ---- IP cameras: FFmpeg pulls the RTSP picture and turns it into a motion-JPEG feed the page can show ----
  const cams = new Map();
  const camMask = (c, t) => t.split(c.url).join("[camera]");
  function camRun(c) {
    const args = ["-hide_banner", "-loglevel", "error", "-fflags", "nobuffer", "-flags", "low_delay", "-analyzeduration", "1000000", "-probesize", "1000000", "-rtsp_transport", "tcp", "-i", c.url, "-map", "0:v:0", "-vf", "scale='min(1280,iw)':-2", "-r", "25", "-q:v", "5", "-f", "mpjpeg", "pipe:1", "-map", "0:a:0?", "-ac", "2", "-ar", "48000", "-f", "s16le", "pipe:3"];
    const p = (c.proc = spawn(opts.ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe", "pipe"], windowsHide: true }));
    p.stdout.on("data", (d) => { c.error = ""; for (const r of c.clients) r.write(d); }); p.stdio[3].on("data", (d) => { for (const r of c.pcm) r.write(d); });
    p.stderr.on("data", (d) => { const l = camMask(c, String(d).trim().split(/[\r\n]+/).pop() || ""); if (l) c.error = l.slice(0, 160); });
    p.on("error", (e) => (c.error = "Could not start FFmpeg: " + e.message));
    p.on("close", () => { if (!c.stopped) c.timer = setTimeout(() => camRun(c), 3000); }); // reconnect if the camera drops out
  }
  function camStop(id) { const c = cams.get(id); if (!c) return; c.stopped = true; clearTimeout(c.timer); try { c.proc && c.proc.kill(); } catch (e) {} for (const r of [...c.clients, ...c.pcm]) r.end(); cams.delete(id); }
  const camStopAll = () => [...cams.keys()].forEach(camStop);
  // ---- phone cameras: the page and the phone swap WebRTC connection details through a small relay ----
  const rooms = new Map(); let phoneSrv = null, httpsPort = 0, phoneErr = "", lanIp = lanAddress();
  const wake = (r, role) => { for (const w of r.w[role].splice(0)) { clearTimeout(w.t); w.send(); } };
  function rtcRoute(req, res, u, role) {
    const r = rooms.get(u.searchParams.get("room") || ""), other = role === "desk" ? "phone" : "desk";
    if (!r) { res.writeHead(404); return res.end(); }
    if (u.pathname === "/rtc/send" && req.method === "POST") {
      let b = ""; req.on("data", (d) => { b += d; if (b.length > 300000) req.destroy(); });
      req.on("end", () => { r.q[other].push({ i: ++r.n[other], data: b }); wake(r, other); res.writeHead(204); res.end(); }); return;
    }
    if (u.pathname === "/rtc/recv") {
      const after = +u.searchParams.get("after") || 0;
      const send = () => { res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(r.q[role].filter((x) => x.i > after))); };
      if (r.q[role].some((x) => x.i > after)) return send();
      const w = { send, t: setTimeout(() => { r.w[role] = r.w[role].filter((x) => x !== w); send(); }, 20000) };
      r.w[role].push(w); req.on("close", () => { clearTimeout(w.t); r.w[role] = r.w[role].filter((x) => x !== w); }); return;
    }
    res.writeHead(404); res.end();
  }
  function phoneHandler(req, res) {
    const u = new URL(req.url, "https://x");
    if (u.pathname === "/phone.html") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); return fs.createReadStream(path.join(root, "phone.html")).pipe(res); }
    if (u.pathname === "/rtc/send" || u.pathname === "/rtc/recv") return rtcRoute(req, res, u, "phone");
    res.writeHead(404); res.end();
  }
  async function startPhone() {
    if (opts.phone === false) return;
    try {
      const f = opts.dataDir && path.join(opts.dataDir, "sai-cert.json"); let cert;
      try { const c = JSON.parse(fs.readFileSync(f, "utf8")); if (c.lan === lanIp && Date.now() - c.t < 300 * 864e5) cert = c; } catch (e) {}
      if (!cert) {
        const pems = await Promise.resolve(require("selfsigned").generate([{ name: "commonName", value: "Scripture AI" }], { days: 365, keySize: 2048, algorithm: "sha256", extensions: [{ name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }, { type: 7, ip: "127.0.0.1" }, { type: 7, ip: lanIp }] }] }));
        cert = { private: pems.private, cert: pems.cert, lan: lanIp, t: Date.now() }; try { if (f) fs.writeFileSync(f, JSON.stringify(cert)); } catch (e) {}
      }
      const s = https.createServer({ key: cert.private, cert: cert.cert }, phoneHandler);
      await new Promise((ok) => { s.once("error", () => s.listen(0, "0.0.0.0", ok)); s.listen(8766, "0.0.0.0", ok); });
      phoneSrv = s; httpsPort = s.address().port;
    } catch (e) { phoneErr = String(e.message || e); }
  }
  // ---- offline speech recognition (the page sends microphone audio, the app sends back words as they are spoken) ----
  const stt = opts.modelDir ? new Stt(opts.modelDir) : null;
  const ndi = opts.ffmpegPath ? new Ndi(opts.ffmpegPath) : null;
  const fileToken = crypto.randomBytes(12).toString("hex");
  const MIME2 = { ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".flac": "audio/flac", ".pptx": "application/octet-stream" };
  // ---- recording to a chosen folder: MP4 / MKV are made by FFmpeg, WebM is written as it arrives ----
  let rec = null;
  async function recStop() { const r = rec; if (!r) return null; rec = null; r.running = false; await r.end(); return r; }
  async function recStart(cfg) {
    const ext = ["mp4", "mkv", "webm"].includes(cfg.ext) ? cfg.ext : "mp4";
    const dir = String(cfg.dir || "").trim() || opts.recDir; if (!dir) throw new Error("No folder to save to.");
    if (!path.isAbsolute(dir)) throw new Error("Please choose a full folder path (for example C:\\Recordings).");
    fs.mkdirSync(dir, { recursive: true }); if (!fs.statSync(dir).isDirectory()) throw new Error("That is not a folder.");
    const d = new Date(), z = (n) => String(n).padStart(2, "0"), stamp = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`;
    let file = path.join(dir, `service-${stamp}.${ext}`), n = 1; while (fs.existsSync(file)) file = path.join(dir, `service-${stamp}-${++n}.${ext}`);
    await recStop(); const r = { file, error: "", running: true, ext };
    if (ext === "webm") {
      // written to a .part file first; FFmpeg then copies it into a proper WebM that has a duration and can be seeked
      const part = file + ".part"; r.ws = fs.createWriteStream(part); r.write = (b) => r.ws.write(b); r.drain = (f) => r.ws.once("drain", f);
      r.end = async () => {
        await new Promise((ok) => r.ws.end(ok)); let fixed = false;
        if (opts.ffmpegPath) fixed = await new Promise((ok) => { const p = spawn(opts.ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-i", part, "-c", "copy", "-f", "webm", file], { stdio: "ignore", windowsHide: true }); p.on("error", () => ok(false)); p.on("close", (c) => ok(c === 0)); });
        try { if (fixed) fs.unlinkSync(part); else fs.renameSync(part, file); } catch (e) {}
      };
    }
    else {
      if (!opts.ffmpegPath) throw new Error("FFmpeg is not available in this version."); const k = Math.min(30000, Math.max(1000, +cfg.kbps || 8000));
      const args = ["-hide_banner", "-loglevel", "error", "-fflags", "+genpts", "-f", "webm", "-i", "pipe:0", "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-b:v", k + "k", "-maxrate", Math.round(k * 1.5) + "k", "-bufsize", k * 2 + "k", "-r", "30", "-g", "60", "-c:a", "aac", "-b:a", "160k", "-ar", "48000"]
        .concat(ext === "mp4" ? ["-movflags", "+frag_keyframe+empty_moov+default_base_moof", "-f", "mp4"] : ["-f", "matroska"], [file]);
      const p = (r.proc = spawn(opts.ffmpegPath, args, { stdio: ["pipe", "ignore", "pipe"], windowsHide: true }));
      p.stderr.on("data", (c) => { const l = String(c).trim().split(/[\r\n]+/).pop(); if (l) r.error = l.slice(0, 160); }); p.stdin.on("error", () => {}); p.on("error", (e) => (r.error = "Could not start FFmpeg: " + e.message));
      r.closed = new Promise((ok) => p.on("close", ok)); r.write = (b) => p.stdin.write(b); r.drain = (f) => p.stdin.once("drain", f);
      r.end = () => { try { p.stdin.end(); } catch (e) {} return Promise.race([r.closed, new Promise((ok) => setTimeout(ok, 20000))]); };
    }
    rec = r; return r;
  }
  // ---- PowerPoint: Microsoft PowerPoint (if installed, Windows only) exports every slide as a picture ----
  const PS = "$ErrorActionPreference='Stop'\n$ppt=New-Object -ComObject PowerPoint.Application\ntry{$pres=$ppt.Presentations.Open($env:SAI_PPT,-1,0,0);$pres.Export($env:SAI_OUT,'PNG',1280,720);$pres.Close()}finally{$ppt.Quit()}\n";
  const pptRoot = path.join(os.tmpdir(), "sai-ppt");
  const hostOk = (req) => /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || "");
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/localfile" && req.method === "GET") { // lets the page play files from the computer (the page gets a private key from /app/info)
      if (!hostOk(req) || u.searchParams.get("t") !== fileToken) { res.writeHead(403); return res.end(); }
      const p = u.searchParams.get("p") || "", ext = path.extname(p).toLowerCase(); let st; try { st = fs.statSync(p); } catch (e) { res.writeHead(404); return res.end(); }
      if (!path.isAbsolute(p) || !MIME2[ext] || !st.isFile()) { res.writeHead(404); return res.end(); }
      const rg = /bytes=(\d*)-(\d*)/.exec(req.headers.range || ""); let a = 0, b = st.size - 1, code = 200;
      if (rg) { a = rg[1] ? +rg[1] : Math.max(0, st.size - +rg[2]); b = rg[1] && rg[2] ? Math.min(+rg[2], st.size - 1) : st.size - 1; code = 206; }
      const h = { "Content-Type": MIME2[ext], "Accept-Ranges": "bytes", "Content-Length": b - a + 1, "Cache-Control": "no-store" }; if (code === 206) h["Content-Range"] = `bytes ${a}-${b}/${st.size}`;
      res.writeHead(code, h); return fs.createReadStream(p, { start: a, end: b }).pipe(res);
    }
    if (/^\/(rec|pptx|stt|app|project)\//.test(u.pathname)) {
      if (!hostOk(req) || (req.method === "POST" && req.headers["x-sai"] !== "1")) { res.writeHead(403); return res.end(); }
      const json = (code, o) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
      if (req.method === "GET" && u.pathname === "/app/info") return json(200, { token: fileToken, platform: process.platform });
      if (u.pathname === "/project/write" || u.pathname === "/project/read") {
        let b = ""; req.on("data", (d) => (b += d));
        return req.on("end", () => { try { const j = JSON.parse(b || "{}"), f = String(j.path || ""); if (!path.isAbsolute(f) || path.extname(f).toLowerCase() !== ".sai") return json(400, { error: "Project files end in .sai" });
          if (u.pathname.endsWith("write")) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof j.json === "string" ? j.json : JSON.stringify(j.json)); return json(200, { ok: true }); }
          res.writeHead(200, { "Content-Type": "application/json" }); res.end(fs.readFileSync(f, "utf8")); } catch (e) { json(400, { error: String(e.message || e).slice(0, 160) }); } });
      }
      if (u.pathname.startsWith("/stt/")) {
        if (!stt) { req.resume(); return json(404, { error: "Speech recognition is not part of this version." }); }
        if (req.method === "GET" && u.pathname === "/stt/status") return json(200, { available: stt.available(), ready: !!stt.rec, running: stt.on, error: stt.error });
        if (req.method === "POST" && u.pathname === "/stt/start") { req.resume(); try { stt.start(); return json(200, { ok: true }); } catch (e) { stt.error = String(e.message || e); return json(500, { error: stt.error }); } }
        if (req.method === "POST" && u.pathname === "/stt/audio") { const parts = []; req.on("data", (d) => parts.push(d)); return req.on("end", () => { try { stt.accept(Buffer.concat(parts)); } catch (e) { stt.error = String(e.message || e); } res.writeHead(204); res.end(); }); }
        if (req.method === "POST" && u.pathname === "/stt/stop") { req.resume(); stt.stop(); return json(200, { ok: true }); }
        if (req.method === "GET" && u.pathname === "/stt/events") {
          res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" }); res.flushHeaders();
          const l = (o) => res.write("data: " + JSON.stringify(o) + "\n\n"); stt.listeners.add(l); req.on("close", () => stt.listeners.delete(l)); return;
        }
        return json(404, {});
      }
      if (req.method === "POST" && u.pathname === "/rec/start") { let b = ""; req.on("data", (d) => (b += d)); return req.on("end", async () => { try { const r = await recStart(JSON.parse(b || "{}")); json(200, { ok: true, file: r.file }); } catch (e) { json(400, { error: e.message }); } }); }
      if (req.method === "POST" && u.pathname === "/rec/chunk") { const r = rec; if (!r) { req.resume(); res.writeHead(409); return res.end(); } req.on("data", (d) => { if (!r.write(d)) { req.pause(); r.drain(() => req.resume()); } }); return req.on("end", () => { res.writeHead(204); res.end(); }); }
      if (req.method === "POST" && u.pathname === "/rec/stop") return recStop().then((r) => { let bytes = 0; try { bytes = r ? fs.statSync(r.file).size : 0; } catch (e) {} json(200, { file: r && r.file, bytes, error: r && r.error }); });
      if (req.method === "GET" && u.pathname === "/rec/status") return json(200, { running: !!rec, file: rec && rec.file, error: rec && rec.error });
      if (req.method === "POST" && u.pathname === "/pptx/export") {
        if (process.platform !== "win32") { req.resume(); return json(400, { error: "Using Microsoft PowerPoint works on Windows only." }); }
        const parts = []; let size = 0; req.on("data", (d) => { size += d.length; if (size < 400e6) parts.push(d); });
        return req.on("end", () => {
          const id = crypto.randomBytes(6).toString("hex"), dir = path.join(pptRoot, id), out = path.join(dir, "out"); fs.mkdirSync(out, { recursive: true });
          const file = path.join(dir, "in.pptx"), script = path.join(dir, "export.ps1"); fs.writeFileSync(file, Buffer.concat(parts)); fs.writeFileSync(script, PS);
          const p = spawn("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script], { env: Object.assign({}, process.env, { SAI_PPT: file, SAI_OUT: out }), windowsHide: true });
          let err = ""; p.stderr.on("data", (d) => (err += d)); const t = setTimeout(() => p.kill(), 180000);
          p.on("close", () => { clearTimeout(t); const files = fs.existsSync(out) ? fs.readdirSync(out).filter((f) => /^Slide\d+\.PNG$/i.test(f)).sort((a, b) => parseInt(a.replace(/\D/g, "")) - parseInt(b.replace(/\D/g, ""))) : []; if (!files.length) json(500, { error: /Class not registered|80040154/i.test(err) ? "Microsoft PowerPoint is not installed" : (err.trim().split(/\r?\n/)[0] || "export failed").slice(0, 140) }); else json(200, { id, files }); });
          p.on("error", () => json(500, { error: "PowerShell could not be started" }));
        });
      }
      const m = /^\/pptx\/([a-f0-9]{12})\/(Slide\d+\.PNG)$/i.exec(u.pathname);
      if (req.method === "GET" && m) { const f = path.join(pptRoot, m[1], "out", m[2]); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" }); return fs.createReadStream(f).pipe(res); }
      res.writeHead(404); return res.end();
    }
    if (/^\/(ipcam|rtc|qr|ndi)/.test(u.pathname)) {
      if (!hostOk(req) || (req.method === "POST" && req.headers["x-sai"] !== "1")) { res.writeHead(403); return res.end(); }
      const json = (code, o) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
      const body = (cb) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { try { cb(JSON.parse(b || "{}")); } catch (e) { json(400, { error: "Bad request" }); } }); };
      const pm = /^\/ipcam\/([\w-]{1,32})\.pcm$/.exec(u.pathname);
      if (req.method === "GET" && pm) { const c = cams.get(pm[1]); if (!c) { res.writeHead(404); return res.end(); } res.writeHead(200, { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" }); res.flushHeaders(); c.pcm.add(res); req.on("close", () => c.pcm.delete(res)); return; }
      if (u.pathname.startsWith("/ndi/")) {
        if (!ndi) { req.resume(); return json(404, { error: "NDI is not part of this version." }); }
        const kind = u.searchParams.get("kind") === "presentation" ? "presentation" : "program", fail = (e) => json(400, { error: String((e && e.message) || e).slice(0, 200) });
        if (req.method === "GET" && u.pathname === "/ndi/status") return json(200, ndi.status());
        if (req.method === "GET" && u.pathname === "/ndi/sources") return ndi.sources(u.searchParams.has("extra") ? u.searchParams.get("extra") : undefined).then((l) => json(200, { sources: l })).catch(fail);
        if (req.method === "POST" && u.pathname === "/ndi/recv/start") return body((j) => ndi.recvStart(String(j.id || ""), String(j.name || "")).then(() => json(200, { ok: true })).catch(fail));
        if (req.method === "POST" && u.pathname === "/ndi/recv/stop") return body((j) => { ndi.recvStop(String(j.id || "")); json(200, { ok: true }); });
        if (req.method === "POST" && u.pathname === "/ndi/send/start") return body((j) => ndi.sendStart(kind, j.name).then(() => json(200, { ok: true })).catch(fail));
        if (req.method === "POST" && u.pathname === "/ndi/send/stop") return body(() => { ndi.sendStop(kind); json(200, { ok: true }); });
        if (req.method === "POST" && (u.pathname === "/ndi/send/video" || u.pathname === "/ndi/send/audio")) {
          const parts = []; req.on("data", (d) => parts.push(d));
          return req.on("end", async () => { try { const b = Buffer.concat(parts), n = (k) => +u.searchParams.get(k) || 0;
            if (u.pathname.endsWith("video")) { const w = n("w"), h = n("h"); if (b.length < w * h * 4) { res.writeHead(400); return res.end(); } await ndi.sendVideo(kind, w, h, n("fps") || 30, b); } else await ndi.sendAudio(kind, n("sr") || 48000, n("ch") || 2, n("samples"), b);
            res.writeHead(204); res.end(); } catch (e) { res.writeHead(409); res.end(); } });
        }
        const nm = /^\/ndi\/([\w-]{1,32})\.(mjpeg|pcm)$/.exec(u.pathname);
        if (req.method === "GET" && nm) { const st = ndi.recv.get(nm[1]); if (!st) { res.writeHead(404); return res.end(); } const set = nm[2] === "pcm" ? st.pcm : st.jpeg;
          res.writeHead(200, { "Content-Type": nm[2] === "pcm" ? "application/octet-stream" : "multipart/x-mixed-replace;boundary=ffmpeg", "Cache-Control": "no-store" }); res.flushHeaders(); set.add(res); req.on("close", () => set.delete(res)); return; }
        return json(404, {});
      }
      if (req.method === "POST" && u.pathname === "/ipcam/start") return body((j) => {
        if (!opts.ffmpegPath) return json(400, { error: "FFmpeg is not available in this version." });
        if (!/^[\w-]{1,32}$/.test(j.id || "") || !/^rtsps?:\/\/[^\s]+$/.test(j.url || "")) return json(400, { error: "Use an address that starts with rtsp://" });
        camStop(j.id); const c = { url: j.url, clients: new Set(), pcm: new Set(), error: "", stopped: false, proc: null, timer: null }; cams.set(j.id, c); camRun(c); json(200, { ok: true });
      });
      if (req.method === "POST" && u.pathname === "/ipcam/stop") return body((j) => { camStop(j.id); json(200, { ok: true }); });
      if (req.method === "GET" && u.pathname === "/ipcam/status") return json(200, Object.fromEntries([...cams].map(([id, c]) => [id, c.error])));
      const m = /^\/ipcam\/([\w-]{1,32})\.mjpeg$/.exec(u.pathname);
      if (req.method === "GET" && m) {
        const c = cams.get(m[1]); if (!c) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { "Content-Type": "multipart/x-mixed-replace;boundary=ffmpeg", "Cache-Control": "no-store", Connection: "close" });
        res.flushHeaders(); c.clients.add(res); req.on("close", () => c.clients.delete(res)); return;
      }
      if (req.method === "POST" && u.pathname === "/rtc/room") {
        for (const [k, r] of rooms) if (Date.now() - r.t > 6 * 3600e3) rooms.delete(k);
        const code = crypto.randomBytes(5).toString("hex");
        rooms.set(code, { t: Date.now(), q: { desk: [], phone: [] }, n: { desk: 0, phone: 0 }, w: { desk: [], phone: [] } });
        return json(200, { code, ok: httpsPort > 0, error: phoneErr, url: `https://${lanIp}:${httpsPort}/phone.html?room=${code}`, localUrl: `https://127.0.0.1:${httpsPort}/phone.html?room=${code}` });
      }
      if (u.pathname === "/rtc/send" || u.pathname === "/rtc/recv") return rtcRoute(req, res, u, "desk");
      if (req.method === "GET" && u.pathname === "/qr.svg") { return require("qrcode").toString(u.searchParams.get("text") || "", { type: "svg", margin: 1, width: 220 }).then((svg) => { res.writeHead(200, { "Content-Type": "image/svg+xml" }); res.end(svg); }); }
      res.writeHead(404); return res.end();
    }
    if (u.pathname.startsWith("/stream/")) {
      // only this app's own page may control streaming: custom header blocks other websites, host check blocks DNS rebinding
      if (!hostOk(req) || (req.method === "POST" && req.headers["x-sai"] !== "1")) { res.writeHead(403); return res.end(); }
      if (req.method === "GET" && u.pathname === "/stream/status") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ available: !!opts.ffmpegPath, running: info.running, seconds: info.running ? Math.floor((Date.now() - info.t0) / 1000) : 0, last: info.last, error: info.error }));
      }
      if (req.method === "POST" && u.pathname === "/stream/start") {
        let b = ""; req.on("data", (d) => (b += d));
        req.on("end", () => { try { ffStart(JSON.parse(b)); res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"ok":true}'); } catch (e) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: e.message })); } });
        return;
      }
      if (req.method === "POST" && u.pathname === "/stream/chunk") {
        const p = ff; if (!p || !info.running) { req.resume(); res.writeHead(409); return res.end(); }
        req.on("data", (d) => { if (!p.stdin.write(d)) { req.pause(); p.stdin.once("drain", () => req.resume()); } });
        req.on("end", () => { res.writeHead(204); res.end(); }); return;
      }
      if (req.method === "POST" && u.pathname === "/stream/stop") { ffStop(); res.writeHead(204); return res.end(); }
      res.writeHead(404); return res.end();
    }
    if (req.method === "POST" && u.pathname === "/state") {
      let b = ""; req.on("data", (d) => (b += d));
      req.on("end", () => { last = b; for (const c of clients) c.write("data: " + b + "\n\n"); res.writeHead(204); res.end(); });
      return;
    }
    if (u.pathname === "/state-stream") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      if (last) res.write("data: " + last + "\n\n");
      clients.add(res); req.on("close", () => clients.delete(res)); return;
    }
    let p = decodeURIComponent(u.pathname); if (p === "/") p = "/index.html";
    const f = path.normalize(path.join(root, p));
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-cache" });
    fs.createReadStream(f).pipe(res);
  });
  srv.on("close", () => { ffStop(); recStop(); if (stt) stt.stop(); if (ndi) ndi.stopAll(); camStopAll(); if (phoneSrv) phoneSrv.close(); });
  return new Promise((resolve) => {
    srv.once("error", () => srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port })));
    srv.listen(preferredPort, "127.0.0.1", () => resolve({ srv, port: srv.address().port }));
  }).then(async (r) => { await startPhone(); return Object.assign(r, { get httpsPort() { return httpsPort; }, lanIp }); });
}
module.exports = { start };
