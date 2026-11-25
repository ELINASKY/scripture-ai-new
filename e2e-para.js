const boot = require("./e2e-lib");
boot(async ({ run, click, sleep, check }) => {
  for (let i = 0; i < 40 && !(await run(`!!window.__paraReady`)); i++) await sleep(500);
  check("the paraphrase finder is ready after startup", await run(`!!window.__paraReady`));
  const feed = (t) => run(`(()=>{document.querySelector('#sim').value=${JSON.stringify(t)};document.querySelector('#simBtn').click();return 0})()`);
  const cards = () => run(`[...document.querySelectorAll('#dets .card')].map(c=>c.textContent)`);
  await feed("brothers and sisters everyone has sinned and fallen short of God's glory"); await sleep(1300); let c = await cards();
  check("a paraphrase appears as a suggestion marked “matched by meaning”", c.length > 0 && /Romans 3:23/.test(c[0]) && /by meaning/.test(c[0]), (c[0] || "").slice(0, 90));
  check("it is only a suggestion: nothing is put on screen automatically", !(await run(`document.querySelector('#preview').textContent`)).includes("fall short") && !(await run(`document.querySelector('#preview').textContent`)).includes("sinned"));
  const n1 = c.length; await feed("please remember to sign the attendance book at the back before you leave"); await sleep(800); check("ordinary announcements produce no suggestion", (await cards()).length === n1);
  await click("#mSettings"); await click("#setTabs [data-st=voice]"); await sleep(400); await run(`document.querySelector('#voPara').click();document.querySelector('#voSave').click();0`); await sleep(600);
  await feed("Don't worry about anything but pray about everything with thanksgiving"); await sleep(1200); check("the switch in Settings › Voice turns paraphrase suggestions off", (await cards()).length === n1);
  await click("#mSettings"); await click("#setTabs [data-st=voice]"); await sleep(300); await run(`document.querySelector('#voPara').click();document.querySelector('#voSave').click();0`); await sleep(600);
  await feed("God's word is a light that guides my path"); await sleep(1300); c = await cards(); check("…and on again", c.length > n1 && /Psalms 119:105/.test(c[0]) && /by meaning/.test(c[0]), (c[0] || "").slice(0, 90));
});
