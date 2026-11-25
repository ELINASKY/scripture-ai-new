const boot = require("./e2e-lib");
boot(async ({ run, click, region, peak, fs, sleep, check }) => {
  const b64 = (p) => fs.readFileSync(p).toString("base64"), bright = () => region(0, 0, 1, 1);
  const kinds = () => run(`SAI_M.src.map(s=>s.kind).join(',')`);

  // layout: everything on one screen
  check("one workspace: monitors, tiles, dock and audio mixer are all visible", await run(`['#pgmCanvas','#preCanvas','#srcList','.dtabs','#strips'].every(s=>{const r=document.querySelector(s).getBoundingClientRect();return r.width>50&&r.height>20})`));
  check("the page does not scroll (fits a 1366×768 screen)", await run(`document.documentElement.scrollHeight <= innerHeight + 2`));
  check("five Bible translations load", await (async () => { for (let i = 0; i < 40 && (await run(`document.querySelector('#ver').options.length`)) < 4; i++) await sleep(400); return (await run(`[...document.querySelector('#ver').options].map(o=>o.value).sort().join()`)) === "apee,asv,bbe,kjv,web"; })());

  // item 1: device dropdowns fill themselves
  await click("#addInput"); await sleep(1500);
  check("camera list fills automatically (no Find button needed)", (await run(`document.querySelector('#camSel').options.length`)) >= 1, await run(`document.querySelector('#camMsg').textContent.slice(0,60)`));
  await click("#camAdd"); await sleep(1500); await click("#addInput"); await sleep(1000); await click("#camAdd"); await sleep(1500);
  check("two cameras added", (await run(`SAI_M.src.length`)) === 2 && (await bright()) > 5);

  // transitions: cut, fade, wipe, slide, zoom
  await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'2',code:'Digit2',bubbles:true}))`);
  check("default shortcut: key 2 chooses input 2 for preview", (await run(`SAI_M.pre.id`)) === 2);
  await click("#mCut"); check("cut", (await run(`SAI_M.pgm.id+','+SAI_M.pre.id`)) === "2,1");
  for (const [btn, type, want] of [["#mFade", "fade", "1,2"], ["#mWipe", "wipe", "2,1"], ["#mSlide", "slide", "1,2"], ["#mZoom", "zoom", "2,1"]]) {
    await click(btn); await sleep(200); const during = await run(`SAI_M.fade && SAI_M.fade.type`); await sleep(900);
    check(`${type} transition runs and completes`, during === type && (await run(`!SAI_M.fade && SAI_M.pgm.id+','+SAI_M.pre.id`)) === want);
  }
  await click("#mFtb"); await sleep(800); check("fade to black", (await bright()) < 8); await click("#mFtb"); await sleep(800);

  // item 10: input editor
  await run(`document.querySelector('.tile.pgm .tv').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
  check("double-click opens the input editor", !(await run(`document.querySelector('#inModal').hidden`)));
  const setSlider = (sel, v) => run(`(()=>{const e=document.querySelector('${sel}');e.value=${v};e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  const base = await bright(); await click("#inTabs [data-et=pic]"); await setSlider("#inPicBox [data-k=bri]", 0); await sleep(300);
  check("editor: brightness 0 darkens the output", (await bright()) < 4, `${base} -> ${await bright()}`);
  await click("#inPicReset"); await sleep(300); check("editor: reset restores the picture", Math.abs((await bright()) - base) < 6);
  await click("#inTabs [data-et=pic]"); await setSlider("#inPicBox [data-k=cl]", 40); await setSlider("#inPicBox [data-k=cr]", 40); await sleep(300);
  const cropped = await run(`SAI_M.pgm.tx.cl + ',' + SAI_M.pgm.tx.cr`); check("editor: crop values are applied", cropped === "40,40"); await click("#inPicReset");
  await run(`document.querySelector('#inFlip').click()`); check("editor: mirror switches on", await run(`SAI_M.pgm.tx.flip`)); await run(`document.querySelector('#inFlip').click()`);
  const keyHex = await run(`(()=>{const v=SAI_M.pgm.el,c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);const d=c.getContext('2d').getImageData(Math.floor(c.width*0.1),Math.floor(c.height*0.5),1,1).data;return '#'+[...d].slice(0,3).map(x=>x.toString(16).padStart(2,'0')).join('')})()`);
  await click("#inTabs [data-et=key]"); await run(`(()=>{const c=document.querySelector('#inKeyColor');c.value='${keyHex}';c.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#inKeyOn').click()})()`); await sleep(500);
  check("editor: chroma key removes the background colour", (await bright()) < base * 0.7, `${base} -> ${await bright()}`);
  await run(`document.querySelector('#inKeyOn').click()`); await run(`document.querySelectorAll('#inModal [data-close]')[0].click()`);

  // items 8 + 9: images and videos are separate inputs; drag and drop
  const n0 = await run(`SAI_M.src.length`);
  await run(`(async()=>{SAI_M.handleFiles([await __png('#ff8800','logo-orange.png'), __file('${b64("/tmp/e2e-clip.webm")}','clip.webm','video/webm')])})()`); await sleep(2500);
  check("image and video become separate input types", (await kinds()).endsWith("img,vid") || (await kinds()).endsWith("vid,img"), await kinds());
  await run(`(async()=>{const dt=new DataTransfer();dt.items.add(await __png('#00aaff','dropped.png'));dt.items.add(__file('${b64("/tmp/e2e-clip.webm")}','dropped.webm','video/webm'));window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}))})()`); await sleep(3000);
  check("dragging files onto the window adds them as inputs", (await run(`SAI_M.src.length`)) === n0 + 4, (await run(`SAI_M.src.length`)) + " inputs");

  // item 2: audio mixer with effects
  await click("#addInput"); await sleep(1000); await run(`(()=>{const a=document.querySelector('#audSel');a.selectedIndex=Math.min(1,a.options.length-1)})()`); await click("#camAdd"); await sleep(2000);
  const aid = await run(`SAI_M.src.find(s=>s.kind==='cam'&&s.hasAudio).id`), apk = `(SAI_M.src.find(s=>s.id===${aid})||{}).peak`;
  check("audio mixer shows a strip for every input with sound, plus Master", (await run(`document.querySelectorAll('#strips .strip').length`)) === (await run(`SAI_M.src.filter(s=>s.hasAudio).length`)) + 1);
  const p0 = await peak(apk); check("channel meter sees the sound", p0 > 0.05, p0.toFixed(2));
  const fader = (id, v) => run(`(()=>{const e=document.querySelector('#strips input.fader[data-id="${id}"]');e.value=${v};e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await fader(aid, 0); await sleep(2800); const p1 = await peak(apk, 1200); check("channel fader at zero silences the channel", p1 < 0.02, p1.toFixed(3)); await fader(aid, 80); await sleep(400);
  await run(`SAI_M.openFx(${aid})`); await sleep(500);
  const fx = (sec, k, v) => run(`(()=>{const e=document.querySelector('#fxBody [data-fx="${sec}"][data-k="${k}"]');${v === true ? "e.checked=true" : "e.value=" + v};e.dispatchEvent(new Event(e.type==='checkbox'?'change':'input',{bubbles:true}))})()`);
  await fx("lim", "ceil", -24); await fx("lim", "on", true); await sleep(900); const pl = await peak(apk, 2400);
  check("limiter holds the level under its ceiling", pl < 0.14 && pl < p0 * 0.6, `${p0.toFixed(2)} -> ${pl.toFixed(2)}`); await click("#fxReset"); await sleep(600);
  const gp = (ms = 700) => run(`(async()=>{const an=window.__gt.an,b=new Uint8Array(512);let m=0;const t0=performance.now();while(performance.now()-t0<${ms}){an.getByteTimeDomainData(b);for(const v of b)m=Math.max(m,Math.abs(v-128)/128);await new Promise(r=>setTimeout(r,20))}return m})()`);
  await run(`(async()=>{await SAI_M.ready;const ac=SAI_M.ac,st=SAI_M.makeStrip(),o=ac.createOscillator(),g=ac.createGain();o.frequency.value=440;g.gain.value=0.05;o.connect(g);g.connect(st.in);const an=ac.createAnalyser();an.fftSize=512;st.out.connect(an);o.start();window.__gt={st,an,o};return 0})()`); await sleep(500);
  const gOff = await gp(); await run(`(()=>{const f=window.__gt.st.fx;f.gate.on=true;f.gate.thr=-20;f.gate.floor=-60;window.__gt.st.apply();return 0})()`); await sleep(1000); const gOn = await gp();
  check("noise gate quiets sound that is below its threshold", gOff > 0.03 && gOn < 0.01, `quiet signal ${gOff.toFixed(3)} -> ${gOn.toFixed(4)}`); await run(`(()=>{window.__gt.o.stop();return 0})()`);
  await fx("comp", "thr", -50); await fx("comp", "ratio", 10); await fx("comp", "on", true); await sleep(900); const pc = await peak(apk, 2400);
  check("compressor reduces loud sound", pc < p0 * 0.5, `${p0.toFixed(2)} -> ${pc.toFixed(2)}`); await click("#fxReset");
  await fx("eq", "low", 9); await fx("eq", "on", true); await fx("rev", "mix", 40); await fx("rev", "on", true); await sleep(400);
  check("equalizer and reverb settings reach the audio nodes", await run(`(()=>{const n=SAI_M.src.find(s=>s.id===${aid}).strip.n;return n.low.gain.value===9&&n.wet.gain.value>0.3&&!!n.conv.buffer})()`));
  await click("#fxReset"); await run(`document.querySelector('#fxModal [data-close]').click()`);
  await run(`SAI_M.openFx('master')`); await sleep(500); await fx("lim", "ceil", -24); await fx("lim", "on", true); await sleep(2800); const pm = await peak("SAI_M.peak", 2400);
  check("master channel has effects too (limiter)", pm < 0.14, pm.toFixed(2)); await click("#fxReset"); await run(`document.querySelector('#fxModal [data-close]').click()`);

  // item 5: title presets
  const tlBase = await region(0.05, 0.64, 0.28, 0.78); const ov1on = await run(`SAI_M.overlay`); if (ov1on) await click("#ov1"); await sleep(300);
  const tl0 = await region(0.05, 0.64, 0.28, 0.78); check("title tab lists the preset titles", (await run(`document.querySelectorAll('#tlList .card').length`)) >= 5);
  await run(`document.querySelector('#tlList [data-a=tshow][data-id=t1]').click()`); await sleep(500); const tl1 = await region(0.05, 0.64, 0.28, 0.78);
  check("showing a lower-third preset draws it on the output", Math.abs(tl1 - tl0) > 4 && (await run(`SAI_M.titlesOn`)), `${tl0} -> ${tl1}`);
  await run(`document.querySelector('#tlList [data-a=tshow][data-id=t1]').click()`);
  await click("#tlNew"); await run(`(()=>{const s=(i,v)=>{const e=document.querySelector(i);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))};s('#tlName','Guest speaker');s('#tlL1','Dr. Ama Boateng');s('#tlL2','Guest minister')})()`); await click("#tlSave"); await sleep(300);
  check("a new title preset can be created and is saved", (await run(`document.querySelectorAll('#tlList .card').length`)) >= 6 && (await run(`localStorage.getItem('sai-titles').includes('Dr. Ama Boateng')`)));

  // item 11: playlist
  await click("#plNew"); await run(`(async()=>{addToPlaylist([await __png('#ff0000','red.png'),await __png('#0000ff','blue.png')]);SAI_M.src.find(s=>s.kind==='playlist').items.forEach(i=>i.dur=1)})()`); await sleep(700);
  const plPx = () => run(`(()=>{const s=SAI_M.src.find(s=>s.kind==='playlist');const d=s.el.getContext('2d').getImageData(640,360,1,1).data;return d[0]+','+d[1]+','+d[2]})()`);
  check("playlist shows its first item", (await plPx()).startsWith("255,0,0"), await plPx());
  await click("#plPlay"); await sleep(1900); const pl2 = await plPx();
  check("playlist advances to the next item by itself", pl2.endsWith(",255") && (await run(`SAI_M.src.find(s=>s.kind==='playlist').idx`)) === 1, pl2);
  await click("#plPlay");

  // item 6: virtual set
  const camId = await run(`SAI_M.src.find(s=>s.kind==='cam').id`);
  await run(`(()=>{const s=SAI_M.makeVset('Virtual set',${camId},'Studio blue');s.vsKey.color='${keyHex}'})()`); await sleep(1200);
  const vp = await run(`(()=>{const s=SAI_M.src.find(s=>s.kind==='vset');const d=s.el.getContext('2d').getImageData(100,360,1,1).data;return [d[0],d[1],d[2]]})()`);
  check("virtual set replaces the green screen with the studio background", vp[2] > vp[1] && vp[2] > 60, vp.join(","));
  await run(`SAI_M.src.find(s=>s.kind==='vset').pos='close'`); await sleep(1800); check("virtual set camera positions zoom in", (await run(`SAI_M.src.find(s=>s.kind==='vset').cur.z`)) > 1.7);

  // item 4: PowerPoint import
  await run(`SAI_M.importPptx(__file('${b64("/tmp/e2e.pptx")}','e2e.pptx','application/vnd.openxmlformats-officedocument.presentationml.presentation'),false).then(()=>0)`); await sleep(2500);
  const deck = await run(`(()=>{const s=SAI_M.src.find(s=>s.kind==='deck');if(!s)return null;const c=s.slides[1],d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let dark=0;for(let i=0;i<d.length;i+=4)if(d[i]<90)dark++;return {n:s.slides.length,dark}})()`);
  check("PowerPoint file becomes an input with every slide", deck && deck.n === 3, JSON.stringify(deck)); check("slide text is drawn", deck && deck.dark > 400, deck && deck.dark + " dark pixels");
  await run(`document.querySelector('.tile [data-a=dnext]').click()`); check("slides step forward with the input's arrow button", (await run(`SAI_M.src.find(s=>s.kind==='deck').idx`)) === 1);

  // items 13 + 14: keyboard assignment and the key eye
  await click("#mSettings"); await click("#setTabs [data-st=keys]"); await run(`document.querySelector('#keyTbl [data-a=kset][data-id=wipe]').click()`);
  await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'x',code:'KeyX',bubbles:true}))`);
  check("a key can be assigned to an action", await run(`document.querySelector('#keyTbl').textContent.includes('X')`)); await run(`document.querySelectorAll('#setModal [data-close]')[0].click()`);
  await run(`SAI_M.pre = SAI_M.src[1]; SAI_M.pgm = SAI_M.src[0]; SAI_M.fade = null;`); await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'x',code:'KeyX',bubbles:true}))`); await sleep(150);
  check("the assigned key runs its action (wipe)", await run(`!!SAI_M.fade && SAI_M.fade.type==='wipe'`)); await sleep(900);
  await click("#mStreamCfg"); const ty = () => run(`document.querySelector('#dests input[data-f=key][data-i="0"]').type`);
  const t0 = await ty(); await click('#dests [data-eye="0"]'); const t1 = await ty(); await click('#dests [data-eye="0"]'); const t2 = await ty();
  check("eye button shows and hides the stream key", t0 === "password" && t1 === "text" && t2 === "password", `${t0} > ${t1} > ${t2}`);
  check("the NDI page lists NDI sources", await run(`!!document.querySelector('[data-p=ndi] #ndiSel') && document.querySelector('[data-p=ndi]').textContent.includes('NDI')`));
});
