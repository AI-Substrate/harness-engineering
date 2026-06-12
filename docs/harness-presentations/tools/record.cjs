// Per-slide video recorder for the deck (technique ported from the `present`
// repo's render-pipeline: WAAPI scrubbing → PNG frames → ffmpeg).
//
// Records ONE slide per run so each scene becomes its own video clip — the
// voiceover gets generated per slide later, and clip lengths will be re-cut
// to match the audio. Duration is therefore a per-run flag, not baked in.
//
// Why scrubbing instead of real-time screen capture (per present's AGENTS.md):
//   - Page.startScreencast is rAF-rate-capped (~10fps) and stutters.
//   - Virtual time policies don't drive CSS @keyframes in headless.
//   - Pausing document.getAnimations() and stepping .currentTime IS
//     deterministic at any fps: frame i is exactly t = i/fps seconds.
//
// Frame 0 is captured with every animation paused at currentTime=0 AFTER
// fonts are ready, so the clip always starts at the true start of the scene.
//
// Usage:
//   NODE_PATH=<dir-with-puppeteer> node docs/harness-presentations/tools/record.cjs \
//     <slide> [deck.html] [--dur=12] [--fps=30] [--w=1920] [--h=1080] \
//     [--scale=1] [--out=<repo>/scratch/ml-video] [--crf=16] [--preset=slow] [--keep-frames]
//
//   <slide>  1-based slide number (e.g. 2) or slide id (s-stack / #s-stack)
//   --dur    clip length in SECONDS (float ok) — adjust per slide once
//            voiceover timings are known
//   --scale  deviceScaleFactor: 1 = 1920x1080, 2 = 4K
//
// Known-good NODE_PATH on this machine:
//   /Users/jordanknight/.npm-global/lib/node_modules/@mermaid-js/mermaid-cli/node_modules

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const opt = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : dflt;
};
const flag = (name) => args.includes(`--${name}`);

const slideArg = positional[0];
if (!slideArg) {
  console.error('usage: record.cjs <slide-number-or-id> [deck.html] [--dur=12] [--fps=30] ...');
  process.exit(1);
}
const deck = path.resolve(positional[1] || path.join(__dirname, '..', 'missing-layer-101.html'));
const durSec = +opt('dur', 12);
const fps = +opt('fps', 30);
const W = +opt('w', 1920), H = +opt('h', 1080);
const scale = +opt('scale', 1);
// Default output: repo scratch/ (gitignored) so clips are visible in-repo.
const out = opt('out', path.join(__dirname, '..', '..', '..', 'scratch', 'ml-video'));
const crf = opt('crf', '16');
const preset = opt('preset', 'slow');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await puppeteer.launch({
    headless: 'shell',
    defaultViewport: { width: W, height: H, deviceScaleFactor: scale },
    args: [
      `--force-device-scale-factor=${scale}`,
      `--window-size=${W},${H}`,
      '--hide-scrollbars',
      '--disable-background-timer-throttling',
    ],
  });
  try {
    const page = (await browser.pages())[0] || (await browser.newPage());
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    // rAF-kill BEFORE any page script runs: a live rAF loop would mutate DOM
    // state between the currentTime scrub and the screenshot.
    await page.evaluateOnNewDocument(() => {
      window.requestAnimationFrame = () => 0;
      window.cancelAnimationFrame = () => {};
    });

    const url = 'file://' + deck;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    const slides = await page.evaluate(() =>
      [...document.querySelectorAll('.slide')].map((s) => s.id));

    let id;
    if (/^\d+$/.test(slideArg)) {
      id = slides[+slideArg - 1];
      if (!id) { console.error(`no slide #${slideArg} (deck has ${slides.length})`); process.exit(1); }
    } else {
      id = slideArg.replace(/^#/, '');
      if (!slides.includes(id)) { console.error(`no slide id "${id}" — ids: ${slides.join(', ')}`); process.exit(1); }
    }
    // Clips are numbered by deck order (001-s-title, 002-s-stack, ...) so they
    // sort into presentation order and pair with same-stem audio files.
    const stem = `${String(slides.indexOf(id) + 1).padStart(3, '0')}-${id}`;

    await page.goto(`${url}#${id}`, { waitUntil: 'networkidle0' });
    // Record mode: the stage ("grab inside the line") fills the viewport
    // exactly — no border, no HUD, no letterbox. cq units track the resize.
    await page.addStyleTag({
      content: `
        html, body { margin: 0 !important; padding: 0 !important;
                     overflow: hidden !important; background: #000 !important; }
        .stage-wrap { position: fixed !important; inset: 0 !important;
                      width: 100vw !important; }
        .stage { width: 100% !important; border: 0 !important; }
        .frame-lbl, .hud { display: none !important; }
      `,
    });
    await page.evaluate(() => document.fonts.ready);
    // Pause everything at t=0 for a deterministic start. getAnimations()
    // returns a fresh array each call, so the scrub loop re-queries too.
    await page.evaluate(() => {
      for (const a of document.getAnimations()) { a.pause(); a.currentTime = 0; }
    });

    const total = Math.round(durSec * fps);
    const pad = Math.max(String(total - 1).length, 3);
    const framesDir = path.join(out, `frames-${stem}`);
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.mkdirSync(framesDir, { recursive: true });

    const t0 = Date.now();
    for (let i = 0; i < total; i++) {
      await page.evaluate((t) => {
        for (const a of document.getAnimations()) { try { a.currentTime = t; } catch (e) {} }
      }, i * (1000 / fps));
      await page.screenshot({
        path: path.join(framesDir, `f_${String(i).padStart(pad, '0')}.png`),
        clip: { x: 0, y: 0, width: W, height: H },
      });
      if ((i + 1) % fps === 0 || i === total - 1) {
        process.stdout.write(`\r${id}: frame ${i + 1}/${total}`);
      }
    }
    console.log(`  (capture ${((Date.now() - t0) / 1000).toFixed(1)}s)`);

    const mp4 = path.join(out, `${stem}.mp4`);
    execFileSync('ffmpeg', [
      '-y',
      '-framerate', String(fps),
      '-i', path.join(framesDir, `f_%0${pad}d.png`),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-crf', String(crf),
      '-preset', preset,
      '-movflags', '+faststart',
      mp4,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    const mb = (fs.statSync(mp4).size / 1024 / 1024).toFixed(2);
    if (!flag('keep-frames')) fs.rmSync(framesDir, { recursive: true, force: true });
    console.log(`wrote ${mp4} (${durSec}s @ ${fps}fps, ${total} frames, ${mb} MB)`);
    console.log('console errors:', errors.length ? errors : 'none');
  } finally {
    await browser.close();
  }
})();
