const boot = require("./e2e-lib");
boot(async ({ win, run, click, srv, sleep, check }) => {
  await win.loadURL(`http://localhost:${srv.port}/index.html?e2e=1`); for (let i = 0; i < 80 && (await run(`document.querySelector('#loading').style.display`)) !== "none"; i++) await sleep(250);
  check("web mode: app loads (not the desktop address)", (await run(`location.hostname`)) === "localhost");
  await click("#addInput"); await sleep(1200); await click("#camAdd"); await sleep(1800); check("web mode: camera works", (await run(`SAI_M.src.length`)) === 1);
  await click("#mStreamCfg"); check("web mode: streaming explains it needs the desktop app", await run(`!document.querySelector('#strNote').hidden && document.querySelector('#strNote').textContent.includes('desktop app')`));
  await click("#setTabs [data-st=rec]"); check("web mode: recording folder and type are locked to WebM", (await run(`document.querySelector('#recExt').disabled`)) && (await run(`document.querySelector('#recExt').value`)) === "webm");
  await run(`document.querySelectorAll('#setModal [data-close]')[0].click();0`); await click("#mRec"); await sleep(3000); await click("#mRec"); await sleep(1500);
  check("web mode: recording downloads a WebM file", (await run(`window.SAI_LAST ? SAI_LAST.size : 0`)) > 5000);
  await click("#addInput"); await run(`document.querySelector('#addList [data-t=ip]').click();0`); check("web mode: IP camera explains the desktop app is needed", !(await run(`document.querySelector('#ipWeb').hidden`)));
});
