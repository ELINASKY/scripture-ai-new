const boot = require("./e2e-lib");
boot(async ({ win, run, click, region, peak, sleep, check }) => {
  const G = await import("grandi"), grandi = G.default, { FourCC, ColorFormat, FrameType } = G;
  const set = (sel, v) => run(`(()=>{const e=document.querySelector('${sel}');e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));return 0})()`);
  const key = (sel, k) => run(`document.querySelector('${sel}').dispatchEvent(new KeyboardEvent('keydown',{key:'${k}',bubbles:true,cancelable:true}));0`);
  const slider = (sel, v) => run(`(()=>{const e=document.querySelector('${sel}');e.value=${v};e.dispatchEvent(new Event('input',{bubbles:true}));return 0})()`);
  const grab = async (rx, n = 25) => { for (let i = 0; i < n; i++) { const f = await rx.video(2000); if (f.type === "video") return f; } return null; };
  const findSrc = async (re) => { const f = await grandi.find({ showLocalSources: true, extraIps: "127.0.0.1" }); let s; for (let i = 0; i < 10 && !s; i++) { await f.wait(800); s = f.sources().find((x) => re.test(x.name)); } return s; };

  // ---- NDI in: another program sends into the app
  const W = 640, H = 360, ext = await grandi.send({ name: "E2E Outside Camera", clockVideo: true }), fr = Buffer.alloc(W * H * 4); for (let i = 0; i < fr.length; i += 4) { fr[i] = 40; fr[i + 1] = 40; fr[i + 2] = 220; fr[i + 3] = 255; }
  const au = Buffer.alloc(1920 * 4); for (let i = 0; i < 1920; i++) au.writeFloatLE(Math.sin(i / 8) * 0.6, i * 4);
  const tm = setInterval(() => { ext.video({ xres: W, yres: H, frameRateN: 25000, frameRateD: 1000, pictureAspectRatio: 16 / 9, fourCC: FourCC.BGRA, frameFormatType: FrameType.Progressive, lineStrideBytes: W * 4, data: fr }).catch(() => {}); ext.audio({ sampleRate: 48000, channels: 1, samples: 1920, channelStrideBytes: 7680, fourCC: FourCC.FLTp, data: au }).catch(() => {}); }, 40);
  await run(`localStorage.setItem('sai-ndi', JSON.stringify({pgm:{on:false,name:'Scripture AI Program'},pre:{on:false,name:'Scripture AI Presentation',bg:false},fps:25,extra:'127.0.0.1'}));0`); await win.webContents.reload(); for (let i = 0; i < 60 && (await run(`document.querySelector('#loading').style.display`)) !== "none"; i++) await sleep(300);
  await click("#addInput"); await run(`document.querySelector('#addList [data-t=ndi]').click();0`); await sleep(5000);
  check("Add Input › NDI lists the NDI sources on the network", (await run(`[...document.querySelector('#ndiSel').options].map(o=>o.value)`)).some((o) => /E2E Outside Camera/.test(o)));
  await run(`(()=>{const s=document.querySelector('#ndiSel');s.value=[...s.options].find(o=>/E2E Outside/.test(o.value)).value;document.querySelector('#ndiAdd').click();return 0})()`); await sleep(5000);
  const px = await run(`(()=>{const s=SAI_M.src.find(x=>x.kind==='ndi');if(!s||!s.el.naturalWidth)return null;const c=document.createElement('canvas');c.width=64;c.height=36;const x=c.getContext('2d');x.drawImage(s.el,0,0,64,36);const d=x.getImageData(32,18,1,1).data;return [d[0],d[1],d[2]]})()`);
  check("an NDI source becomes a live input with the right colours", !!px && px[0] > 150 && px[1] < 100, px ? px.join(",") : "no picture");
  const np = await peak(`(SAI_M.src.find(x=>x.kind==='ndi')||{}).peak`); check("NDI sound reaches the audio mixer", np > 0.05, np.toFixed(2));
  await run(`SAI_M.src.filter(s=>s.kind==='ndi').forEach(s=>document.querySelector('#srcList [data-a=rm][data-id="'+s.id+'"]').click());0`);

  // ---- NDI out: Program and Presentation
  await click("#addInput"); await sleep(1000); await run(`(()=>{document.querySelector('#audSel').selectedIndex=1;return 0})()`); await click("#camAdd"); await sleep(2000);
  await click("#mSettings"); await click("#setTabs [data-st=ndi]"); await sleep(500);
  await run(`(()=>{const c=(i,v)=>{document.querySelector(i).checked=v};c('#ndiPgmOn',true);c('#ndiPreOn',true);c('#ndiPreBg',false);document.querySelector('#ndiPgmName').value='E2E App Program';document.querySelector('#ndiPreName').value='E2E App Presentation';document.querySelector('#ndiSave').click();return 0})()`); await sleep(1500); await run(`document.querySelectorAll('#setModal [data-close]')[0].click();0`);
  const rxA = await grandi.receive({ source: await findSrc(/E2E App Program/), colorFormat: ColorFormat.RGBX_RGBA, bandwidth: 100 }), vA = await grab(rxA);
  const lum = vA ? (() => { let s = 0, n = 0; for (let i = 0; i < vA.data.length; i += 4000) { s += vA.data[i] + vA.data[i + 1] + vA.data[i + 2]; n++; } return Math.round(s / n / 3); })() : -1;
  check("NDI Program output reaches another program (1280×720, with picture)", !!vA && vA.xres === 1280 && vA.yres === 720 && lum > 8, vA ? `${vA.xres}x${vA.yres}, brightness ${lum}` : "none");
  let aA = null; for (let i = 0; i < 40 && !aA; i++) { const f = await rxA.audio({ audioFormat: 1 }, 1000); if (f.type === "audio" && f.samples) { const d = new Float32Array(f.data.buffer, f.data.byteOffset, Math.floor(f.data.length / 4)); let m = 0; for (const v of d) m = Math.max(m, Math.abs(v)); if (m > 0.05) aA = m; } }
  check("NDI Program output carries the mixed sound", !!aA, aA ? "peak " + aA.toFixed(2) : "silent");
  await run(`(()=>{document.querySelector('#sim').value='turn to John chapter three verse sixteen';document.querySelector('#simBtn').click();return 0})()`); await sleep(1200);
  const rxB = await grandi.receive({ source: await findSrc(/E2E App Presentation/), colorFormat: ColorFormat.RGBX_RGBA, bandwidth: 100 }); let vB = null, txt = 0;
  for (let i = 0; i < 40; i++) { const f = await grab(rxB, 5); if (f) { vB = f; txt = 0; for (let j = 3; j < f.data.length; j += 4) if (f.data[j] > 20) txt++; if (txt > 500) break; } }
  check("NDI Presentation output has the verse text on a transparent background", !!vB && vB.data[3] === 0 && txt > 500, vB ? `corner alpha ${vB.data[3]}, text pixels ${txt}` : "none");
  await run(`document.querySelector('#pbgGrid .bgt[data-name="Royal blue"]').click();0`); await sleep(600);
  check("sample backgrounds can be chosen", (await run(`document.querySelector('#pbgGrid .bgt.on').dataset.name`)) === "Royal blue" && (await run(`document.querySelector('#preview').style.background`)).includes("url("));
  check("a full-screen verse on a background covers the video on the mixer output", await run(`(()=>{const d=document.querySelector('#pgmCanvas').getContext('2d').getImageData(20,20,1,1).data;return d[2]>d[1]&&d[2]>40})()`));
  await click("#mSettings"); await click("#setTabs [data-st=ndi]"); await run(`document.querySelector('#ndiPreBg').checked=true;document.querySelector('#ndiSave').click();0`); await sleep(1500); await run(`document.querySelectorAll('#setModal [data-close]')[0].click();0`);
  let opaque = null; for (let i = 0; i < 30; i++) { const f = await grab(rxB, 5); if (f && f.data[3] === 255) { opaque = f; break; } } check("with “Include the chosen background” the NDI Presentation is opaque", !!opaque);
  await run(`document.querySelector('#pbgGrid .bgt[data-mode=none]').click();0`); clearInterval(tm); ext.destroy();

  // ---- type-ahead book search
  await set("#go", "joh"); check("typing letters lists matching books", (await run(`[...document.querySelectorAll('#goSug .sg b')].map(b=>b.textContent)`)).includes("John"));
  await set("#go", "jo"); const sg = await run(`[...document.querySelectorAll('#goSug .sg b')].map(b=>b.textContent)`); check("“jo” offers Job, Joel, John, Jonah and Joshua", ["Job", "Joel", "John", "Jonah", "Joshua"].every((b) => sg.includes(b)));
  await set("#go", "joh"); await key("#go", "Tab"); check("Tab selects the book and moves on to the chapter", (await run(`document.querySelector('#go').value`)) === "John ");
  await set("#go", "John 3:16"); check("the verse text previews while typing", (await run(`document.querySelector('#goPrev').textContent`)).includes("so loved")); await key("#go", "Enter"); await sleep(400);
  check("Enter puts the typed verse on screen", (await run(`document.querySelector('#preview').textContent`)).includes("loved the world"));
  await set("#go", "ps 23"); await key("#go", "Enter"); await sleep(300); check("abbreviations work (“ps 23” = Psalm 23)", (await run(`document.querySelector('#preview').textContent`)).includes("shepherd"));
  await set("#go", "jn316"); await key("#go", "Enter"); await sleep(300); check("squeezed typing works (“jn316” = John 3:16)", (await run(`document.querySelector('#preview').textContent`)).includes("loved the world"));

  // ---- microphones, audio output, editor preview
  await click("#addInput"); await run(`document.querySelector('#addList [data-t=mic]').click();0`); await sleep(1500);
  const devs = await run(`[...document.querySelector('#micSel').options].map(o=>o.value)`); check("Add Input has a Microphone page listing the audio devices", devs.length >= 2);
  await run(`(()=>{document.querySelector('#micSel').value='${devs[devs.length - 2]}';document.querySelector('#micName').value='Pastor mic';document.querySelector('#micAdd').click();return 0})()`); await sleep(1800);
  check("a microphone becomes its own mixer channel that meters sound", (await run(`SAI_M.src.some(s=>s.kind==='mic')`)) && (await peak(`(SAI_M.src.find(s=>s.kind==='mic')||{}).peak`)) > 0.05);
  const mid = await run(`SAI_M.src.find(s=>s.kind==='mic').id`); await run(`SAI_M.openEditor(SAI_M.src.find(s=>s.id===${mid}));0`); await click("#inTabs [data-et=aud]"); await sleep(1200);
  await run(`(()=>{const s=document.querySelector('#inAudDev');s.value='${devs[devs.length - 1]}';s.dispatchEvent(new Event('change',{bubbles:true}));return 0})()`); await sleep(2500);
  check("the editor can switch which device a microphone uses", (await run(`SAI_M.src.find(s=>s.id===${mid}).devId`)) === devs[devs.length - 1] && (await peak(`(SAI_M.src.find(s=>s.id===${mid})||{}).peak`)) > 0.05);
  await run(`document.querySelectorAll('#inModal [data-close]')[0].click();0`);
  await run(`document.querySelector('#monOn').click();0`); await sleep(500); check("the Monitor switch turns on and is remembered", await run(`SAI_M.mon.on && JSON.parse(localStorage.getItem('sai-mon')).on && typeof SAI_M.ac.setSinkId==='function'`)); await run(`document.querySelector('#monOn').click();0`);
  await run(`document.querySelector('#strips [data-a=spfl][data-id="${mid}"]').click();0`); await sleep(400);
  const pf = await peak(`(()=>{const a=window.__pfa||(window.__pfa=(()=>{const n=SAI_M.ac.createAnalyser();n.fftSize=4096;SAI_M.pflBus.connect(n);return n})());const b=new Uint8Array(4096);a.getByteTimeDomainData(b);let m=0;for(const v of b)m=Math.max(m,Math.abs(v-128)/128);return m})()`);
  check("🎧 sends a single channel to the headphone output", pf > 0.05, pf.toFixed(2));
  const camId = await run(`SAI_M.src.find(s=>s.kind==='cam').id`); await run(`SAI_M.openEditor(SAI_M.src.find(s=>s.id===${camId}));0`); await sleep(500); const orig = await region(0.1, 0.1, 0.9, 0.9, "#inPrev");
  check("the editor shows a live preview of the input", orig > 10, "brightness " + orig);
  await click("#inTabs [data-et=pic]"); await slider("#inPicBox [data-k=bri]", 0); await sleep(300); check("moving the brightness slider changes the preview as you drag", (await region(0.1, 0.1, 0.9, 0.9, "#inPrev")) < 4);
  await run(`document.querySelector('#inCmp').click();0`); await sleep(300); const l = await region(0.05, 0.2, 0.45, 0.9, "#inPrev"), r = await region(0.55, 0.2, 0.95, 0.9, "#inPrev"); check("Compare shows the original on the left and your changes on the right", l > 10 && r < 4, `left ${l} | right ${r}`);
  await run(`document.querySelector('#inCmp').click();0`); await click("#inPicReset"); await click("#inTabs [data-et=pic]"); await slider("#inPicBox [data-k=hue]", 120); await sleep(300);
  const rgb = await run(`(()=>{const c=document.querySelector('#inPrev'),d=c.getContext('2d').getImageData(Math.floor(c.width*0.15),Math.floor(c.height*0.5),1,1).data;return [d[0],d[1],d[2]]})()`); check("the Hue control shifts colours in the preview", rgb[2] > rgb[1], rgb.join(","));
});
