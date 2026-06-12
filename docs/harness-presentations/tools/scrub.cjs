// Deterministic frame inspector: scrub one slide of the deck to exact
// times and screenshot each — the same WAAPI clock the recorder uses,
// so what you see here is exactly what lands in the video.
//
// Usage:
//   NODE_PATH=<dir-with-puppeteer> node docs/harness-presentations/tools/scrub.cjs \
//     '#s-stack' 6.0,8.2,12.5 [--out /tmp/scrub/s-stack] [--deck path.html]
//
// Times are CLIP seconds (CSS clock). Narration audio sits at +1s in
// every clip, so a word at audio time T is clip time T + 1 — cue-block
// values in the deck are already clip time.

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opts = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith('--')) { positional.push(a); continue; }
  const eq = a.indexOf('=');
  if (eq !== -1) opts[a.slice(2, eq)] = a.slice(eq + 1);
  else opts[a.slice(2)] = args[++i];
}

const hash = positional[0];
const times = (positional[1] || '').split(',').map(Number).filter((n) => !Number.isNaN(n));
if (!hash || !times.length) {
  console.error("usage: scrub.cjs '#slide-id' 1.0,2.5,6.0 [--out dir] [--deck path]");
  process.exit(1);
}
const deck = path.resolve(opts.deck || path.join(__dirname, '..', 'missing-layer-101.html'));
const dir = opts.out || path.join('/tmp/scrub', hash.replace('#', ''));

(async () => {
  const browser = await puppeteer.launch({ headless: 'shell' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  // kill rAF before page scripts run — the deck must not advance itself
  await page.evaluateOnNewDocument(() => { window.requestAnimationFrame = () => 0; });
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  await page.goto(`file://${deck}${hash}`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 250));
  await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
  for (const t of times) {
    // re-query every frame: browsers hand back fresh animation arrays
    await page.evaluate((ms) => {
      document.getAnimations().forEach((a) => { try { a.currentTime = ms; } catch (e) {} });
    }, t * 1000);
    const f = `${dir}/t${t.toFixed(2).padStart(6, '0')}.png`;
    await page.screenshot({ path: f });
    console.log(f);
  }
  await browser.close();
})();
