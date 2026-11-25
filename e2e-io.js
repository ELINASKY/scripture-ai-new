const boot = require("./e2e-lib"); const { BrowserWindow } = require("electron");
boot(async ({ run, click, region, peak, srv, FF, fs, path, spawn, execFileSync, sleep, check }) => {
  const probe = (f) => { try { return execFileSync(FF, ["-hide_banner", "-i", f], { stdio: ["ignore", "pipe", "pipe"] }).toString(); } catch (e) { return String(e.stderr || ""); } };
  const set = (sel, v) => run(`(()=>{const e=document.querySelector('${sel}');e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return 0})()`);
  await click("#addInput"); await sleep(1200); await run(`(()=>{const a=document.querySelector('#audSel');a.selectedIndex=Math.min(1,a.options.length-1);return 0})()`); await click("#camAdd"); await sleep(2000);

  // item 12: recording folder and file type
  fs.rmSync("/tmp/sai-rec-test", { recursive: true, force: true });
  for (const [ext, vc, ac] of [["mp4", "h264", "aac"], ["mkv", "h264", "aac"], ["webm", "vp8", "opus"]]) {
    await click("#mSettings"); await click("#setTabs [data-st=rec]"); await set("#recDir", "/tmp/sai-rec-test"); await set("#recExt", ext); await click("#recSave");
    await click("#mRec"); await sleep(3800); await click("#mRec"); await sleep(3500);
    const f = await run(`(SAI_M.lastRec||{}).file||''`), info = f ? probe(f) : "";
    check(`recording saves a .${ext} file in the chosen folder`, f.startsWith("/tmp/sai-rec-test/") && f.endsWith("." + ext) && fs.existsSync(f), f.split("/").pop());
    check(`.${ext} file holds ${vc} video and ${ac} audio`, new RegExp("Video: " + vc).test(info) && new RegExp("Audio: " + ac).test(info));
    const dur = /Duration: 00:00:0?(\d+)/.exec(info); check(`.${ext} recording has a real length`, dur && +dur[1] >= 2, dur ? dur[0] : "no duration");
  }
  check("default recording folder option works when the folder box is empty", await (async () => { await click("#mSettings"); await click("#setTabs [data-st=rec]"); await set("#recDir", ""); await set("#recExt", "webm"); await click("#recSave"); await click("#mRec"); await sleep(2500); await click("#mRec"); await sleep(2000); const f = await run(`(SAI_M.lastRec||{}).file||''`); return f.startsWith("/tmp/sai-rec-default/") && fs.existsSync(f); })());

  // streaming through the new settings dialog
  try { fs.unlinkSync("/tmp/e2e-stream.flv"); } catch (e) {}
  const rx = spawn(FF, ["-hide_banner", "-loglevel", "error", "-listen", "1", "-f", "flv", "-i", "rtmp://127.0.0.1:19350/live/e2ekey", "-c", "copy", "-y", "/tmp/e2e-stream.flv"]); await sleep(1200);
  await click("#mStreamCfg");
  await run(`(()=>{const q=(f)=>document.querySelector('#dests [data-i="0"][data-f="'+f+'"]');const pl=q('plat');pl.value='Custom RTMP';pl.dispatchEvent(new Event('change',{bubbles:true}));const u=q('url');u.value='rtmp://127.0.0.1:19350/live';u.dispatchEvent(new Event('change',{bubbles:true}));const k=q('key');k.value='e2ekey';k.dispatchEvent(new Event('change',{bubbles:true}));const o=q('on');o.checked=true;o.dispatchEvent(new Event('change',{bubbles:true}));return 0})()`);
  await click("#strGo"); await sleep(7000); const live = await run(`document.querySelector('#sStream').textContent`);
  check("status bar shows the stream is LIVE", /LIVE/.test(live), live.slice(0, 60)); await click("#mStream"); await sleep(4000); rx.kill();
  const sinfo = probe("/tmp/e2e-stream.flv"); check("stream receiver got H.264 video and AAC audio", /Video: h264/.test(sinfo) && /Audio: aac/.test(sinfo));
  check("stream button resets after stopping", (await run(`document.querySelector('#mStream').textContent`)) === "Stream");

  // screen picker (desktop)
  const nScr = await run(`window.sai ? window.sai.sources().then(l=>l.length) : -1`); check("desktop app lists screens and windows", nScr >= 1, nScr + " found");
  if (nScr >= 1) { const n0 = await run(`SAI_M.src.length`); await run(`window.sai.sources().then(l=>{SAI_M.addDesktop(l[0].id,'Screen test',false)});0`); await sleep(2500); check("a screen can be captured as an input", (await run(`SAI_M.src.length`)) === n0 + 1 && (await run(`SAI_M.src[SAI_M.src.length-1].el.videoWidth`)) > 0); }

  // IP camera through a real RTSP server
  const mtxPath = "/tmp/mtx/mediamtx";
  if (fs.existsSync(mtxPath)) {
    const mtx = spawn(mtxPath, [], { cwd: "/tmp/mtx", stdio: "ignore" }); await sleep(1500);
    const pub = spawn(FF, ["-hide_banner", "-loglevel", "error", "-re", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=25", "-f", "lavfi", "-i", "sine=frequency=440", "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-c:a", "aac", "-f", "rtsp", "-rtsp_transport", "tcp", "rtsp://127.0.0.1:8554/live"], { stdio: "ignore" }); await sleep(2500);
    await click("#addInput"); await run(`document.querySelector('#addList [data-t=ip]').click();document.querySelector('#ipName').value='Front door';document.querySelector('#ipUrl').value='rtsp://127.0.0.1:8554/live';document.querySelector('#ipAdd').click();0`); await sleep(8000);
    check("IP camera shows a live picture", await run(`(()=>{const s=SAI_M.src.find(x=>x.camId);return !!s&&s.el.naturalWidth>0})()`));
    const ipk = await peak(`(SAI_M.src.find(x=>x.camId)||{}).peak`); check("IP camera sound reaches the audio mixer", ipk > 0.05, ipk.toFixed(2));
    await run(`SAI_M.src.filter(s=>s.camId).forEach(s=>document.querySelector('#srcList [data-a=rm][data-id="'+s.id+'"]').click());0`); await sleep(500);
    check("closing the IP camera input removes it", !(await run(`SAI_M.src.some(s=>s.camId)`))); pub.kill(); mtx.kill();
  } else console.log("SKIP IP camera test (no RTSP test server)");

  // phone camera over the secure link
  await click("#addInput"); await run(`document.querySelector('#addList [data-t=ph]').click();document.querySelector('#phMake').click();0`); await sleep(1500);
  const url = await run(`SAI_M.phone && SAI_M.phone.localUrl`); check("phone link and QR code are created", !!url && (await run(`document.querySelector('#phQr').src.includes('/qr.svg')`)));
  const phone = new BrowserWindow({ show: true, width: 500, height: 700 }); await phone.loadURL(url); await phone.webContents.executeJavaScript(`document.getElementById('go').click()`); await sleep(9000);
  check("phone appears as an input with live video", await run(`(()=>{const s=SAI_M.src.find(x=>x.kind==='phone');return !!s&&s.el.videoWidth>0})()`));
  const ppk = await peak(`(SAI_M.src.find(x=>x.kind==='phone')||{}).peak`); check("phone sound reaches the audio mixer", ppk > 0.05, ppk.toFixed(2)); phone.destroy();

  // PowerPoint through Microsoft PowerPoint: not available on this (Linux) test machine, so the app must fall back safely
  const r = await run(`fetch('/pptx/export',{method:'POST',headers:{'X-SAI':'1'},body:new Uint8Array([1,2,3])}).then(async x=>x.status+' '+(await x.json()).error)`);
  check("PowerPoint export reports clearly when PowerPoint is unavailable", /^400 .*Windows/.test(r), r);
  const dk = await run(`SAI_M.src.filter(s=>s.kind==='deck').length`); await run(`SAI_M.importPptx(__file('${fs.readFileSync("/tmp/e2e.pptx").toString("base64")}','x.pptx','application/octet-stream'),true);0`); await sleep(3500);
  check("falls back to text-and-picture import automatically", (await run(`SAI_M.src.filter(s=>s.kind==='deck').length`)) === dk + 1);
});
