// Full-composition builder: narration text -> ElevenLabs audio -> per-slide
// clip (record.cjs, which muxes the audio) -> one stitched mp4.
//
// Narration lives in docs/harness-presentations/narration/NNN-<id>.txt, one
// file per slide; the NNN-<id> stem matches tts.cjs/record.cjs output naming.
// Each slide's video duration = its audio length + a settle pad (min 6s).
//
// Incremental: a slide's audio regenerates only when its .txt is newer than
// the .mp3; its clip re-records only when the .mp3 is newer than the .mp4.
// The final stitch is a stream copy (no re-encode), so re-runs are cheap.
//
// Usage:
//   NODE_PATH=<dir-with-puppeteer> node docs/harness-presentations/tools/comp.cjs \
//     [--only 7] [--pad 1.4] [--min 6] [--force-tts] [--force-video] [--stitch-only]
//
//   --only N       rebuild just slide N (then restitch)
//   --pad SECONDS  settle pad added after the narration ends (default 1.4)
//   --min SECONDS  minimum clip length (default 6)
//
// Known-good NODE_PATH on this machine:
//   /Users/jordanknight/.npm-global/lib/node_modules/@mermaid-js/mermaid-cli/node_modules

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const NARR = path.join(ROOT, 'docs', 'harness-presentations', 'narration');
const OUT = path.join(ROOT, 'scratch', 'ml-video');

const BOOLEAN_FLAGS = new Set(['force-tts', 'force-video', 'stitch-only']);
const args = process.argv.slice(2);
const opts = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith('--')) continue;
  const eq = a.indexOf('=');
  if (eq !== -1) opts[a.slice(2, eq)] = a.slice(eq + 1);
  else if (!BOOLEAN_FLAGS.has(a.slice(2)) && i + 1 < args.length && !args[i + 1].startsWith('--')) opts[a.slice(2)] = args[++i];
  else opts[a.slice(2)] = true;
}
const opt = (name, dflt) => (name in opts && opts[name] !== true ? opts[name] : dflt);
const flag = (name) => name in opts;

const pad = +opt('pad', 1.4);
const minDur = +opt('min', 6);
const only = opt('only', null);

const TOOLS = __dirname;
const run = (script, runArgs) =>
  execFileSync(process.execPath, [path.join(TOOLS, script), ...runArgs], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_PATH: process.env.NODE_PATH ||
        '/Users/jordanknight/.npm-global/lib/node_modules/@mermaid-js/mermaid-cli/node_modules',
    },
  });
const probe = (f) => parseFloat(execFileSync('ffprobe', [
  '-v', 'error', '-show_entries', 'format=duration',
  '-of', 'default=noprint_wrappers=1:nokey=1', f,
]).toString().trim());
const mtime = (f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : -1);

const slides = fs.readdirSync(NARR)
  .filter((n) => /^\d{3}-.+\.txt$/.test(n))
  .sort()
  .map((n) => {
    const stem = n.replace(/\.txt$/, '');
    return {
      stem,
      num: +stem.slice(0, 3),
      id: stem.slice(4),
      txt: path.join(NARR, n),
      mp3: path.join(OUT, `${stem}.mp3`),
      mp4: path.join(OUT, `${stem}.mp4`),
    };
  });
if (!slides.length) { console.error(`no narration files in ${NARR}`); process.exit(1); }

fs.mkdirSync(OUT, { recursive: true });

for (const s of slides) {
  if (only && s.num !== +only) continue;
  if (flag('stitch-only')) break;

  if (flag('force-tts') || mtime(s.txt) > mtime(s.mp3)) {
    console.log(`\n=== ${s.stem}: narration`);
    run('tts.cjs', [s.id, '--file', s.txt]);
  }
  const audio = probe(s.mp3);
  const dur = Math.max(minDur, Math.ceil((audio + pad) * 10) / 10);

  const videoStale = flag('force-video') || mtime(s.mp3) > mtime(s.mp4) ||
    (fs.existsSync(s.mp4) && Math.abs(probe(s.mp4) - dur) > 0.15);
  if (videoStale || !fs.existsSync(s.mp4)) {
    console.log(`=== ${s.stem}: clip (${dur}s for ${audio.toFixed(2)}s narration)`);
    run('record.cjs', [s.id, '--dur', String(dur)]);
  } else {
    console.log(`=== ${s.stem}: up to date (${dur}s)`);
  }
}

// stitch — stream copy; all clips share codec parameters by construction
const missing = slides.filter((s) => !fs.existsSync(s.mp4));
if (missing.length) {
  console.error(`cannot stitch, missing clips: ${missing.map((s) => s.stem).join(', ')}`);
  process.exit(1);
}
const list = path.join(OUT, 'concat.txt');
fs.writeFileSync(list, slides.map((s) => `file '${s.mp4}'`).join('\n') + '\n');
const full = path.join(OUT, 'missing-layer-101-full.mp4');
execFileSync('ffmpeg', [
  '-y', '-f', 'concat', '-safe', '0', '-i', list,
  '-c', 'copy', '-movflags', '+faststart',
  full,
], { stdio: ['ignore', 'ignore', 'pipe'] });
const total = probe(full);
const mb = (fs.statSync(full).size / 1024 / 1024).toFixed(1);
console.log(`\nwrote ${full} (${slides.length} slides, ${Math.floor(total / 60)}m${(total % 60).toFixed(0).padStart(2, '0')}s, ${mb} MB)`);
