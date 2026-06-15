// Full-composition builder: narration text -> ElevenLabs audio -> per-slide
// clip (record.cjs, which muxes the audio) -> one stitched mp4.
//
// Narration lives in docs/harness-presentations/<slug>/narration/NNN-<id>.txt,
// one file per slide; the NNN-<id> stem matches tts.cjs/record.cjs output
// naming. The stitched result is scratch/ml-video/<slug>/<slug>-full.mp4.
// Each slide's video duration = its audio length + a settle pad (min 6s).
//
// Incremental: a slide's audio regenerates only when its .txt is newer than
// the .mp3; its clip re-records only when the .mp3 is newer than the .mp4.
// The final stitch is a stream copy (no re-encode), so re-runs are cheap.
//
// Usage:
//   NODE_PATH=<dir-with-puppeteer> node docs/harness-presentations/tools/comp.cjs \
//     [--pres <slug>] [--only 7] [--lead 1] [--tail 1] [--min 6] [--force-tts] [--force-video] [--stitch-only]
//
//   --pres SLUG     presentation subfolder (auto-detected when only one exists)
//   --only N        rebuild just slide N (then restitch)
//   --lead SECONDS  silence before the narration starts (default 1)
//   --tail SECONDS  silence after the narration ends (default 1)
//   --min SECONDS   minimum clip length (default 6)
//
// Known-good NODE_PATH on this machine:
//   /Users/jordanknight/.npm-global/lib/node_modules/@mermaid-js/mermaid-cli/node_modules

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// NARR (narration source) and OUT (scratch render dir) are resolved per
// presentation from --pres, after flag parsing — see resolvePres below.

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

const lead = +opt('lead', 1);
const tail = +opt('tail', 1);
const minDur = +opt('min', 6);
const only = opt('only', null);

const { slug, narrDir: NARR, outDir: OUT } = require('./pres.cjs').resolvePres({
  pres: opt('pres'), out: opt('out'),
});

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
    run('tts.cjs', [s.id, '--file', s.txt, '--pres', slug]);
  }
  const audio = probe(s.mp3);
  const dur = Math.max(minDur, Math.ceil((lead + audio + tail) * 10) / 10);

  const videoStale = flag('force-video') || mtime(s.mp3) > mtime(s.mp4) ||
    (fs.existsSync(s.mp4) && Math.abs(probe(s.mp4) - dur) > 0.15);
  if (videoStale || !fs.existsSync(s.mp4)) {
    console.log(`=== ${s.stem}: clip (${dur}s = ${lead}s lead + ${audio.toFixed(2)}s narration + tail)`);
    run('record.cjs', [s.id, '--dur', String(dur), '--lead', String(lead), '--pres', slug]);
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
const full = path.join(OUT, `${slug}-full.mp4`);
execFileSync('ffmpeg', [
  '-y', '-f', 'concat', '-safe', '0', '-i', list,
  '-c', 'copy', '-movflags', '+faststart',
  full,
], { stdio: ['ignore', 'ignore', 'pipe'] });
// per-clip video vs audio stream check: any mismatch breaks stitch sync
const probeStream = (f, sel) => parseFloat(execFileSync('ffprobe', [
  '-v', 'error', '-select_streams', sel, '-show_entries', 'stream=duration',
  '-of', 'default=noprint_wrappers=1:nokey=1', f,
]).toString().trim());
console.log(`\n${'slide'.padEnd(18)}${'narration'.padStart(10)}${'video'.padStart(9)}${'audio'.padStart(9)}`);
let bad = 0;
for (const s of slides) {
  const n = probe(s.mp3), v = probeStream(s.mp4, 'v:0'), a = probeStream(s.mp4, 'a:0');
  const mismatch = Math.abs(v - a) > 0.06;
  if (mismatch) bad++;
  console.log(`${s.stem.padEnd(18)}${n.toFixed(2).padStart(10)}${v.toFixed(2).padStart(9)}${a.toFixed(2).padStart(9)}${mismatch ? '  << MISMATCH' : ''}`);
}
if (bad) console.log(`\n${bad} clip(s) have video/audio length mismatch — stitch sync at risk`);

const total = probe(full);
const mb = (fs.statSync(full).size / 1024 / 1024).toFixed(1);
console.log(`\nwrote ${full} (${slides.length} slides, ${Math.floor(total / 60)}m${(total % 60).toFixed(0).padStart(2, '0')}s, ${mb} MB)`);
