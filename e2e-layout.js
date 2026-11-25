const boot = require("./e2e-lib");
boot(async ({ win, run, click, sleep, check }) => {
  const R = (sel) => run(`(()=>{const e=document.querySelector('${sel}'),r=e.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.x),shown:getComputedStyle(e).display!=='none'}})()`);
  const noScroll = () => run(`document.documentElement.scrollHeight <= innerHeight + 2 && document.documentElement.scrollWidth <= innerWidth + 2`);
  const drag = (sel, dx, dy) => run(`(async()=>{const s=document.querySelector('${sel}'),r=s.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;s.dispatchEvent(new PointerEvent('pointerdown',{clientX:x,clientY:y,bubbles:true,cancelable:true}));for(let i=1;i<=6;i++){window.dispatchEvent(new PointerEvent('pointermove',{clientX:x+${dx}*i/6,clientY:y+${dy}*i/6,bubbles:true}));await new Promise(r=>setTimeout(r,20))}window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));return 0})()`);
  const esc = () => run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));0`);
  await click("#addInput"); await sleep(1200); await click("#camAdd"); await sleep(1800); await click("#addInput"); await sleep(900); await click("#camAdd"); await sleep(1500);

  const d = { right: await R(".right"), pre: await R(".mon.pre"), view: await R(".mon.pre .view"), tiles: await R("#srcList"), audio: await R(".audio") };
  check("starting layout fits the screen with no scrolling", await noScroll());

  await drag("#spV", -170, 0); let r2 = await R(".right");
  check("dragging the divider between mixer and presentation panel widens the panel", r2.w > d.right.w + 140 && r2.w < d.right.w + 200, `${d.right.w} -> ${r2.w} px`);
  check("the mixer side gets narrower by the same amount", (await R(".left")).w < 1366 - r2.w, `${(await R(".left")).w} px`);
  await drag("#spV", 900, 0); r2 = await R(".right"); check("the panel cannot be dragged smaller than a usable minimum", r2.w >= 255 && r2.w <= 270, r2.w + " px");
  await drag("#spV", -500, 0); r2 = await R(".right"); check("the panel cannot take over more than most of the window", r2.w <= 1366 * 0.73, r2.w + " px");
  await dbl("#spV"); r2 = await R(".right"); check("double-clicking a divider resets it", r2.w === d.right.w, r2.w + " px");
  async function dbl(sel) { await run(`document.querySelector('${sel}').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));0`); }

  await drag("#spH1", 0, 70); const v2 = await R(".mon.pre .view"), t2 = await R("#srcList");
  check("dragging the divider under the monitors makes them taller", v2.h > d.view.h + 55, `${d.view.h} -> ${v2.h} px`);
  check("…and the inputs area gives up that space", t2.h < d.tiles.h - 50, `${d.tiles.h} -> ${t2.h} px`); check("still no scrolling after resizing", await noScroll());
  await drag("#spH1", 0, -200); check("monitors can be made smaller too", (await R(".mon.pre .view")).h < d.view.h - 20, (await R(".mon.pre .view")).h + " px");
  await drag("#spH2", 0, -90); const a2 = await R(".audio"); check("dragging the divider above the audio mixer makes the mixer taller", a2.h > d.audio.h + 70, `${d.audio.h} -> ${a2.h} px`);
  await drag("#spM", 120, 0); const p2 = await R(".mon.pre"); check("dragging between Preview and Output changes their widths", p2.w > d.pre.w + 80, `${d.pre.w} -> ${p2.w} px`);
  await run(`(()=>{const s=document.querySelector('#tileSize');s.value=330;s.dispatchEvent(new Event('input',{bubbles:true}));return 0})()`); check("tile size slider makes input tiles bigger", (await R(".tile")).w === 330);

  // remembered after a restart
  const before = await run(`JSON.stringify(SAI_LAYOUT.get())`); await win.webContents.reload(); for (let i = 0; i < 60 && (await run(`document.querySelector('#loading').style.display`)) !== "none"; i++) await sleep(300);
  check("the layout is remembered after the app restarts", (await run(`JSON.stringify(SAI_LAYOUT.get())`)) === before && (await R(".audio")).h === a2.h, before);
  await click("#mLayout"); const rs = await R(".right"); check("the Layout button puts everything back to normal", rs.w === d.right.w && (await R(".audio")).h === d.audio.h && !(await run(`document.querySelector('.monitors').classList.contains('fixed')`)));

  // expanding sections
  for (const [name, sel, test] of [["dock", ".dock", (r) => r.w > 1300], ["audio", ".audio", (r) => r.w > 1300 && r.h > 560], ["out", "#pgmCanvas", (r) => r.w > 1000 && r.h > 500], ["pre", "#preCanvas", (r) => r.w > 1000], ["tiles", "#srcList", (r) => r.w > 1300 && r.h > 450]]) {
    await click(`[data-xp=${name}]`); await sleep(250); const r = await R(sel);
    check(`expand ${name}: the section fills the work area`, test(r) && (await run(`document.body.dataset.max`)) === name && (await noScroll()), `${r.w}×${r.h} px`);
    if (name === "out") check("expanded Output hides the other sections", !(await R(".right")).shown && !(await R("#srcList")).shown);
    if (name === "dock") check("expanded presentation panel hides the mixer side", !(await R(".left")).shown);
    await esc(); await sleep(200); check(`Esc brings ${name} back to normal`, !(await run(`document.body.dataset.max`)) && (await R(".right")).shown && (await R(".left")).shown);
  }
  await click("[data-xp=out]"); await sleep(200); await run(`document.querySelector('.mon.pgm .mh').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));0`); await sleep(200);
  check("double-clicking a section title toggles expand", !(await run(`document.body.dataset.max`)));
  await click("[data-xp=out]"); await click("#mLayout"); check("Layout button also leaves an expanded section", !(await run(`document.body.dataset.max`)));
  const f0 = await run(`SAI_M.frames`); await sleep(500); check("video keeps drawing while sections are resized", (await run(`SAI_M.frames`)) > f0 + 5);
});
