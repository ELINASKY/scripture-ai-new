const boot = require("./e2e-lib"); const { execFileSync } = require("child_process");
boot(async ({ win, run, click, sleep, check, fs }) => {
  const b64 = (p) => fs.readFileSync(p).toString("base64"), FILE = "/tmp/e2e-show.sai", sec = "SECRETKEY123";
  const mk = (p, t = "application/octet-stream") => `__file('${b64(p)}','${p.split("/").pop()}','${t}')`;
  // ===== PowerPoint rendering and title designs =====
  const acc = JSON.parse(fs.readFileSync("/tmp/e2e-rich-theme.json", "utf8")), hex = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)), near = (a, b, t = 45) => a.every((v, i) => Math.abs(v - b[i]) <= t);
  await run(`SAI_M.importPptx(${mk("/tmp/e2e-rich.pptx")},false).then(()=>0)`); await sleep(3500);
  const px = (sl, x, y) => run(`(()=>{const c=SAI_M.src.find(s=>s.kind==='deck').slides[${sl}],d=c.getContext('2d').getImageData(${x},${y},1,1).data;return [d[0],d[1],d[2]]})()`);
  const cnt = (sl, x0, y0, x1, y1, rgb, t = 70) => run(`(()=>{const c=SAI_M.src.find(s=>s.kind==='deck').slides[${sl}],d=c.getContext('2d').getImageData(${x0},${y0},${x1 - x0},${y1 - y0}).data;let n=0;for(let i=0;i<d.length;i+=4)if(Math.abs(d[i]-${rgb[0]})<${t}&&Math.abs(d[i+1]-${rgb[1]})<${t}&&Math.abs(d[i+2]-${rgb[2]})<${t})n++;return n})()`);
  check("PowerPoint: all slides import", (await run(`SAI_M.src.find(s=>s.kind==='deck').slides.length`)) === 2);
  let p = await px(0, 20, 700); check("PowerPoint: slide background colour kept", near(p, [0x12, 0x20, 0x4a], 25), p.join(","));
  p = await px(0, 110, 110); check("PowerPoint: filled rectangle (red)", near(p, [0xd0, 0x20, 0x20]), p.join(","));
  p = await px(0, 624, 144); check("PowerPoint: rounded rectangle (green)", near(p, [0x20, 0xa0, 0x30]), p.join(","));
  p = await px(0, 960, 192); check("PowerPoint: ellipse (blue)", near(p, [0x20, 0x60, 0xe0]), p.join(","));
  check("PowerPoint: text keeps each run's colour", (await cnt(0, 90, 384, 1100, 528, [255, 60, 60])) > 150 && (await cnt(0, 90, 384, 1100, 528, [80, 255, 120])) > 150);
  const top = await px(1, 20, 20), bot = await px(1, 20, 700); check("PowerPoint: gradient background", Math.abs(top[0] - bot[0]) > 120, `${top.join(",")} -> ${bot.join(",")}`);
  p = await px(1, 240, 178); check("PowerPoint: picture placed correctly", near(p, [20, 120, 230]), p.join(","));
  p = await px(1, 672, 144); check("PowerPoint: shape inside a group (yellow)", near(p, [0xe0, 0xc0, 0x10]), p.join(","));
  p = await px(1, 150, 400); check("PowerPoint: table header colour", p[2] > p[0] + 20, p.join(","));
  await click(".dtabs [data-tab=titles]"); await click("#tlSamples"); await sleep(300);
  await run(`document.querySelector('#ov1').click();document.querySelector('#ov4').click();SAI_M.pgm=null;SAI_M.pre=null;0`); await sleep(300);
  const lit = () => run(`(()=>{const c=document.querySelector('#pgmCanvas'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]+d[i+1]+d[i+2]>60)n++;return n})()`);
  for (const [id, name] of [["t6", "modern name"], ["t7", "split name tag"], ["t8", "quote card"], ["t9", "social handle"], ["t10", "headline banner"], ["t11", "side panel"]]) { await run(`document.querySelector('#tlList [data-a=tshow][data-id=${id}]').click();0`); await sleep(350); const n = await lit(); await run(`document.querySelector('#tlList [data-a=tshow][data-id=${id}]').click();0`); check(`title design “${name}” draws on the output`, n > 1500, n + " lit pixels"); }
  await run(`document.querySelector('#ov4').click();document.querySelector('#ov1').click();SAI_M.newProject();0`); await sleep(400);

  // ===== Save and Load =====
  await click("#addInput"); await sleep(1200); await run(`(()=>{document.querySelector('#audSel').selectedIndex=1;return 0})()`); await click("#camAdd"); await sleep(2200);
  await click("#addInput"); await run(`document.querySelector('#addList [data-t=mic]').click();0`); await sleep(1200); await run(`(()=>{const s=document.querySelector('#micSel');s.selectedIndex=s.options.length-1;document.querySelector('#micName').value='Pastor mic';document.querySelector('#micAdd').click();return 0})()`); await sleep(1800);
  await run(`SAI_M.addImagePath('/tmp/e2e-pic1.png').then(()=>0)`); await run(`SAI_M.addVideoPath('/tmp/e2e-clip.webm', true).then(()=>0)`); await sleep(2500);
  await click("#plNew"); await run(`(()=>{const s=SAI_M.src.find(x=>x.kind==='playlist');for(const p of ['/tmp/e2e-pic1.png','/tmp/e2e-pic2.png'])s.items.push({name:p.split('/').pop(),type:'img',url:SAI_M.fileUrl(p),path:p,dur:2});s.loop=false;return 0})()`);
  const camId = await run(`SAI_M.src.find(s=>s.kind==='cam').id`); await run(`SAI_M.makeVset('Studio shot',${camId},'Studio blue');0`);
  await run(`SAI_M.importPptx(${mk("/tmp/e2e.pptx")},false).then(d=>{d.pptPath='/tmp/e2e.pptx';return 0})`); await sleep(2500);
  await run(`(()=>{const s=SAI_M.src.find(x=>x.kind==='cam');s.vol=55;s.tx.zoom=130;s.tx.bri=120;s.strip.fx.lim.on=true;s.strip.fx.lim.ceil=-12;s.strip.apply();SAI_M.src.find(x=>x.kind==='mic').muted=true;SAI_M.mixP=70;document.querySelector('#tlList [data-a=tshow][data-id=t1]').click();document.querySelector('#ov1').click();document.querySelector('#cdLabel').value='Starts in';document.querySelector('#cdLabel').dispatchEvent(new Event('input'));document.querySelector('#ov3').click();SAI_LAYOUT.get().rightW=520;window.dispatchEvent(new Event('resize'));SAI_M.setKey('wipe','X');document.querySelector('#pbgGrid .bgt[data-name="Ocean"]').click();0;return 0})()`);
  await click("#mStreamCfg"); await run(`(()=>{const k=document.querySelector('#dests [data-i="0"][data-f="key"]');k.value='${sec}';k.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#strSave').click();return 0})()`);
  await run(`SAI_M.pre=SAI_M.src[2];SAI_M.pgm=SAI_M.src[0];0`); const before = await run(`JSON.stringify(SAI_M.src.map(s=>s.kind+':'+s.name))`);
  await click("#fileBtn"); check("File menu opens with the project commands", !(await run(`document.querySelector('#fileDrop').hidden`)) && (await run(`document.querySelectorAll('#fileDrop button').length`)) === 6); await run(`document.body.click();0`);
  await run(`SAI_M.saveProjectTo('${FILE}').then(()=>0)`); const txt = fs.existsSync(FILE) ? fs.readFileSync(FILE, "utf8") : "";
  check("Save writes a .sai project file", txt.length > 500 && JSON.parse(txt).app === "Scripture AI", txt.length + " bytes"); check("stream keys are NOT saved in the project file", !txt.includes(sec));
  await run(`SAI_M.newProject();0`); await sleep(500); check("New project clears the inputs", (await run(`SAI_M.src.length`)) === 0);
  const res = await run(`SAI_M.loadProjectFrom('${FILE}').then(r=>JSON.stringify(r))`).then(JSON.parse); await sleep(1500);
  check("Open restores every input, none missing", res.restored >= 7 && res.missing.length === 0, `${res.restored} restored, missing: ${res.missing.join("; ") || "none"}`);
  check("inputs return in the same order with the same names", (await run(`JSON.stringify(SAI_M.src.map(s=>s.kind+':'+s.name))`)) === before);
  check("camera, microphone, picture and video inputs are live again", await run(`(()=>{const g=(k)=>SAI_M.src.find(s=>s.kind===k);return g('cam').el.videoWidth>0&&!!g('mic').stream&&g('img').el.naturalWidth>0&&g('vid').el.videoWidth>0})()`));
  check("fader, mute, picture settings and effects are restored", await run(`(()=>{const c=SAI_M.src.find(s=>s.kind==='cam'),m=SAI_M.src.find(s=>s.kind==='mic');return c.vol===55&&c.tx.zoom===130&&c.tx.bri===120&&c.strip.fx.lim.on&&c.strip.fx.lim.ceil===-12&&m.muted&&SAI_M.mixP===70})()`));
  check("playlist, virtual set and PowerPoint deck are restored", await run(`(()=>{const p=SAI_M.src.find(s=>s.kind==='playlist'),v=SAI_M.src.find(s=>s.kind==='vset'),d=SAI_M.src.find(s=>s.kind==='deck');return p.items.length===2&&p.loop===false&&v.cam===SAI_M.src.find(s=>s.kind==='cam').id&&d.slides.length===3})()`));
  check("overlays, titles, background, layout and shortcuts are restored", await run(`(()=>{return !SAI_M.overlay&&SAI_M.cd.on&&SAI_M.cd.label==='Starts in'&&SAI_M.titles.find(t=>t.id==='t1').live&&SAI_M.titlesOn&&SAI_LAYOUT.get().rightW===520&&document.querySelector('#pbgGrid .bgt.on').dataset.name==='Ocean'})()`));
  check("which input was on Program and Preview is restored", (await run(`SAI_M.src.indexOf(SAI_M.pgm)+','+SAI_M.src.indexOf(SAI_M.pre)`)) === "0,2");
  const j = JSON.parse(txt); j.inputs.find((i) => i.kind === "img").path = "/tmp/does-not-exist.png"; fs.writeFileSync("/tmp/e2e-show2.sai", JSON.stringify(j));
  const r2 = await run(`SAI_M.loadProjectFrom('/tmp/e2e-show2.sai').then(r=>JSON.stringify(r))`).then(JSON.parse); check("a missing file is reported and everything else still opens", r2.missing.length === 1 && r2.restored >= 6, r2.missing.join("; "));
  check("project files must end in .sai (no writing other files)", (await run(`fetch('/project/write',{method:'POST',headers:{'X-SAI':'1'},body:JSON.stringify({path:'/tmp/evil.txt',json:'x'})}).then(r=>r.status)`)) === 400);
  check("local files are only served to the app itself", (await run(`fetch('/localfile?t=wrong&p=/etc/passwd').then(r=>r.status)`)) === 403);
  await run(`SAI_M.loadProjectFrom('${FILE}').then(()=>0)`); await sleep(1500); await run(`SAI_M.autosaveNow();0`); await run(`SAI_M.newProject();0`); await run(`SAI_M.checkRestore();0`); await sleep(400);
  check("after a restart the app offers to bring the last session back", !(await run(`document.querySelector('#restoreModal').hidden`)));
  await click("#restoreYes"); await sleep(6000); check("Restore brings the session back", (await run(`SAI_M.src.length`)) >= 7 && (await run(`SAI_M.src.find(s=>s.kind==='cam').el.videoWidth`)) > 0);

  // ===== Languages and Bible formats =====
  const kjv = JSON.parse(fs.readFileSync("/home/claude/web/kjv.json", "utf8")).verses.filter((r) => r[0] === 1 || r[0] === 43), N = kjv.length, want = (c, v) => kjv.find((r) => r[0] === 43 && r[1] === c && r[2] === v)[3];
  const NAME = { 1: "Genesis", 43: "John" }, OSIS = { 1: "Gen", 43: "John" }, USFM = { 1: "GEN", 43: "JHN" }; fs.mkdirSync("/tmp/lang/usfm", { recursive: true }); const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  fs.writeFileSync("/tmp/lang/s.txt", kjv.map((r) => `${NAME[r[0]]} ${r[1]}:${r[2]} ${r[3]}`).join("\n"));
  fs.writeFileSync("/tmp/lang/s.csv", "book,chapter,verse,text\n" + kjv.map((r) => `${r[0]},${r[1]},${r[2]},"${r[3].replace(/"/g, '""')}"`).join("\n"));
  fs.writeFileSync("/tmp/lang/s-osis.xml", `<?xml version="1.0"?><osis><osisText osisIDWork="T">` + [1, 43].map((b) => `<div type="book" osisID="${OSIS[b]}">` + kjv.filter((r) => r[0] === b).map((r) => `<verse osisID="${OSIS[b]}.${r[1]}.${r[2]}">${esc(r[3])}</verse>`).join("") + "</div>").join("") + `</osisText></osis>`);
  fs.writeFileSync("/tmp/lang/s-zef.xml", `<?xml version="1.0"?><XMLBIBLE>` + [1, 43].map((b) => `<BIBLEBOOK bnumber="${b}">` + [...new Set(kjv.filter((r) => r[0] === b).map((r) => r[1]))].map((c) => `<CHAPTER cnumber="${c}">` + kjv.filter((r) => r[0] === b && r[1] === c).map((r) => `<VERS vnumber="${r[2]}">${esc(r[3])}</VERS>`).join("") + "</CHAPTER>").join("") + "</BIBLEBOOK>").join("") + `</XMLBIBLE>`);
  for (const b of [1, 43]) { let s = `\\id ${USFM[b]} test\n\\h ${NAME[b]}\n`, cur = 0; for (const r of kjv.filter((x) => x[0] === b)) { if (r[1] !== cur) { s += `\\c ${r[1]}\n\\p\n`; cur = r[1]; } let t = r[3]; if (r[1] === 3 && r[2] === 16 && b === 43) t = t.replace("loved", '\\w loved|strong="G25"\\w*') + "\\f + \\fr 3:16 \\ft A famous verse.\\f*"; s += `\\v ${r[2]} ${t}\n`; } fs.writeFileSync(`/tmp/lang/usfm/${b}.usfm`, s); }
  execFileSync("python3", ["-c", "import zipfile;z=zipfile.ZipFile('/tmp/lang/s-usfm.zip','w');[z.write('/tmp/lang/usfm/%d.usfm'%b,'%d.usfm'%b) for b in (1,43)];z.close()"]);
  for (const [label, name, f] of [["plain text lines", "TT", "/tmp/lang/s.txt"], ["CSV", "TC", "/tmp/lang/s.csv"], ["OSIS XML", "TO", "/tmp/lang/s-osis.xml"], ["Zefania XML", "TZ", "/tmp/lang/s-zef.xml"], ["USFM files in a .zip", "TU", "/tmp/lang/s-usfm.zip"]]) {
    const id = await run(`SAI_M.importBible([${mk(f)}],'${name}')`); const n = await run(`SAI_M.bibleSize('${id}')`), v = await run(`SAI_M.getVerse('${id}',43,3,16)`);
    check(`import ${label}: every verse is read and the text is intact`, n === N && v === want(3, 16), `${n} verses`);
  }
  let err = ""; fs.writeFileSync("/tmp/lang/bad.txt", "this is not a bible\njust some words\n"); try { await run(`SAI_M.importBible([${mk("/tmp/lang/bad.txt")}],'BAD').then(()=>0)`); } catch (e) { err = e.message; }
  check("a file that is not a Bible is refused with a clear message", /verses could be read/.test(err), err.slice(0, 80));
  check("the French Bible (Bible de l'Épée) is included", await run(`[...document.querySelector('#ver').options].some(o=>o.value==='apee')`));
  await run(`(()=>{const s=document.querySelector('#ver');s.value='apee';s.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#sim').value='Jean chapitre trois verset seize';document.querySelector('#simBtn').click();return 0})()`); await sleep(1100);
  check("French speech “Jean chapitre trois verset seize” is detected and shown in French", (await run(`[...document.querySelectorAll('#dets .card b')].map(b=>b.textContent)`)).includes("John 3:16") && (await run(`document.querySelector('#preview').textContent`)).includes("Dieu a tant aimé"));
  await run(`(()=>{const s=document.querySelector('#ver');s.value='kjv';s.dispatchEvent(new Event('change',{bubbles:true}));return 0})()`);
  await click("#mSettings"); await click("#setTabs [data-st=lang]"); await sleep(400); await run(`(()=>{document.querySelector('#aliasBox input[data-b="43"]').value='Yohane, Yoane';document.querySelector('#aliasSave').click();return 0})()`); await sleep(300); await run(`document.querySelectorAll('#setModal [data-close]')[0].click();0`);
  await run(`(()=>{const g=document.querySelector('#go');g.value='yohane 3:17';g.dispatchEvent(new Event('input',{bubbles:true}));g.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return 0})()`); await sleep(500);
  check("book names in my own language work when typing", (await run(`document.querySelector('#preview').textContent`)).includes("sent not"));
  await run(`(()=>{document.querySelector('#sim').value='turn to yohane chapter three verse eighteen';document.querySelector('#simBtn').click();return 0})()`); await sleep(800);
  check("…and in scripture detection", (await run(`[...document.querySelectorAll('#dets .card b')].map(b=>b.textContent)`)).includes("John 3:18"));
});
