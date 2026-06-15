// Hero-frame contact sheet for the deck (pattern borrowed from the
// `present` repo: never trust a slide you haven't rendered and looked at).
//
// For every <section class="slide"> in the deck it deep-links to the slide,
// waits for fonts + the scene to settle into its ambient loop, and writes
// one hero frame per slide to --out (default /tmp/ml-sheet).
//
// Usage:
//   NODE_PATH=<dir-with-puppeteer> node docs/harness-presentations/tools/snap.js \
//     [deck.html] [--pres=<slug>] [--out=/tmp/ml-sheet] [--settle=3400] [--w=1280] [--h=800]
//
// Known-good NODE_PATH on this machine:
//   /Users/jordanknight/.npm-global/lib/node_modules/@mermaid-js/mermaid-cli/node_modules

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : dflt;
};
const { deck } = require('./pres.cjs').resolvePres({
  pres: opt('pres'), deck: args.find((a) => !a.startsWith('--')),
});
const out = opt('out', '/tmp/ml-sheet');
const settle = +opt('settle', 3400);
const W = +opt('w', 1280), H = +opt('h', 800);
// Render at 2x by default so previews match the 4K delivery fidelity —
// hairline strokes (e.g. the title outline) alias badly at 1x and lie to us.
const DPR = +opt('dpr', 2);

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'shell' });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const url = 'file://' + deck;
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  const slides = await page.evaluate(() =>
    [...document.querySelectorAll('.slide')].map((s) => s.id));

  for (const id of slides) {
    await page.goto(`${url}#${id}`, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, settle));
    const file = path.join(out, `${id}.png`);
    await page.screenshot({ path: file });
    console.log('wrote', file);
  }
  console.log('console errors:', errors.length ? errors : 'none');
  await browser.close();
})();
