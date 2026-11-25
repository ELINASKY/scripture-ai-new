// NDI in and out (NDI 6 runtime is bundled with the "grandi" package).
// NDI® is a registered trademark of Vizrt NDI AB. https://ndi.video
const { spawn } = require("child_process"), { pathToFileURL } = require("url");
class Ndi {
  constructor(ffmpegPath) { this.ff = ffmpegPath; this.g = null; this.G = null; this.finder = null; this.extra = ""; this.error = ""; this.recv = new Map(); this.snd = {}; }
  async load() {
    if (this.g) return this.g;
    try { const p = require.resolve("grandi").replace("app.asar", "app.asar.unpacked"); const m = await import(pathToFileURL(p).href); this.G = m; this.g = m.default || m; if (this.g.initialize) this.g.initialize(); }
    catch (e) { this.error = "NDI could not be loaded: " + String(e.message || e).slice(0, 200); throw new Error(this.error); }
    return this.g;
  }
  async sources(extra) {
    const g = await this.load();
    if (extra !== undefined && extra !== this.extra && this.finder) { try { this.finder.destroy(); } catch (e) {} this.finder = null; }
    if (extra !== undefined) this.extra = extra;
    if (!this.finder) this.finder = await g.find({ showLocalSources: true, extraIps: this.extra || undefined });
    await this.finder.wait(300);
    return this.finder.sources().map((s) => ({ name: s.name, url: s.urlAddress || "" }));
  }
  async recvStart(id, name) {
    const g = await this.load(); await this.sources(); const src = this.finder.sources().find((s) => s.name === name); if (!src) throw new Error("That NDI source is no longer visible on the network.");
    this.recvStop(id);
    const rx = await g.receive({ source: src, colorFormat: this.G.ColorFormat.BGRX_BGRA, bandwidth: this.G.Bandwidth.Highest, name: "Scripture AI" });
    const st = { rx, run: true, jpeg: new Set(), pcm: new Set(), proc: null, w: 0, h: 0, err: "", frames: 0, busy: false }; this.recv.set(id, st);
    const startFf = (w, h) => {
      if (st.proc) { try { st.proc.stdin.end(); st.proc.kill(); } catch (e) {} }
      st.w = w; st.h = h;
      const p = (st.proc = spawn(this.ff, ["-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgra", "-video_size", `${w}x${h}`, "-framerate", "30", "-i", "pipe:0", "-vf", "scale='min(1280,iw)':-2:flags=fast_bilinear", "-q:v", "5", "-f", "mpjpeg", "pipe:1"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }));
      p.stdout.on("data", (d) => { for (const r of st.jpeg) r.write(d); }); p.stderr.on("data", (d) => (st.err = String(d).trim().slice(-160))); p.stdin.on("error", () => {}); p.on("error", (e) => (st.err = e.message)); p.stdin.on("drain", () => (st.busy = false));
    };
    (async () => { while (st.run) { try { const f = await rx.video(1000); if (f.type !== "video") continue; if (f.xres !== st.w || f.yres !== st.h || !st.proc) startFf(f.xres, f.yres); st.frames++; if (!st.busy && st.proc && !st.proc.stdin.destroyed) { st.busy = !st.proc.stdin.write(f.data); } } catch (e) { if (st.run) { st.err = String(e.message || e); await new Promise((r) => setTimeout(r, 500)); } } } })();
    (async () => { while (st.run) { try { const a = await rx.audio({ audioFormat: this.G.AudioFormat.Int16Interleaved }, 1000); if (a.type !== "audio" || !a.samples || !st.pcm.size) continue; const out = to48kStereo(a); for (const r of st.pcm) r.write(out); } catch (e) { if (st.run) await new Promise((r) => setTimeout(r, 300)); } } })();
    return st;
  }
  recvStop(id) { const st = this.recv.get(id); if (!st) return; st.run = false; try { st.rx.destroy(); } catch (e) {} try { st.proc && (st.proc.stdin.end(), st.proc.kill()); } catch (e) {} for (const r of [...st.jpeg, ...st.pcm]) { try { r.end(); } catch (e) {} } this.recv.delete(id); }
  async sendStart(kind, name) {
    const g = await this.load(); this.sendStop(kind); const clean = String(name || "Scripture AI").slice(0, 60);
    this.snd[kind] = { s: await g.send({ name: clean, clockVideo: true, clockAudio: false }), name: clean, frames: 0, busy: false };
  }
  async sendVideo(kind, w, h, fps, buf) {
    const o = this.snd[kind]; if (!o || o.busy) return false; o.busy = true;
    try { await o.s.video({ xres: w, yres: h, frameRateN: Math.round(fps * 1000), frameRateD: 1000, pictureAspectRatio: w / h, fourCC: this.G.FourCC.RGBA, frameFormatType: this.G.FrameType.Progressive, lineStrideBytes: w * 4, data: buf }); o.frames++; } finally { o.busy = false; }
    return true;
  }
  async sendAudio(kind, sr, ch, samples, buf) { const o = this.snd[kind]; if (!o) return; await o.s.audio({ sampleRate: sr, channels: ch, samples, channelStrideBytes: samples * 4, fourCC: this.G.FourCC.FLTp, data: buf }); }
  sendStop(kind) { const o = this.snd[kind]; if (!o) return; try { o.s.destroy(); } catch (e) {} delete this.snd[kind]; }
  status() { const s = {}; for (const k in this.snd) { let c = 0; try { c = this.snd[k].s.connections(); } catch (e) {} s[k] = { name: this.snd[k].name, connections: c, frames: this.snd[k].frames }; } return { error: this.error, send: s, recv: [...this.recv].map(([id, r]) => ({ id, w: r.w, h: r.h, frames: r.frames, err: r.err })) }; }
  stopAll() { for (const id of [...this.recv.keys()]) this.recvStop(id); for (const k of Object.keys(this.snd)) this.sendStop(k); try { this.finder && this.finder.destroy(); } catch (e) {} }
}
// NDI audio frames (any rate, any channel count) -> 48 kHz stereo 16-bit
function to48kStereo(a) {
  const n = a.samples, ch = a.channels, src = new Int16Array(a.data.buffer, a.data.byteOffset, Math.floor(a.data.length / 2)), ratio = 48000 / a.sampleRate, m = Math.max(1, Math.round(n * ratio)), out = new Int16Array(m * 2);
  for (let i = 0; i < m; i++) { const j = Math.min(n - 1, Math.floor(i / ratio)); out[i * 2] = src[j * ch]; out[i * 2 + 1] = src[j * ch + (ch > 1 ? 1 : 0)]; }
  return Buffer.from(out.buffer);
}
module.exports = { Ndi };
