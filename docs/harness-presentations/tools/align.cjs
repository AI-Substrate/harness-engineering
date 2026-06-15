// ElevenLabs forced alignment for the deck narration — exact word timecodes
// from the already-approved mp3 takes, so slide animation beats can be keyed
// to spoken words. Alignment, not STT: we hand the API the known transcript
// (narration/NNN-id.txt) plus the audio and it snaps the text to the audio.
//
// Output: docs/harness-presentations/<slug>/narration/NNN-id.words.json
//   { loss, words: [{ text, start, end }] }   times in seconds, audio clock.
// The clip clock = audio clock + lead (record.cjs muxes audio at +1s by
// default), so an animation cue for a word at start=4.2 lands at 5.2s of
// clip time. The printed sheet shows both.
//
// Usage:
//   node docs/harness-presentations/tools/align.cjs <slide>      one slide
//   node docs/harness-presentations/tools/align.cjs --all        every slide
//   --pres       presentation slug (auto-detected when only one exists)
//   --lead 1     lead offset used for the clip-time column (default 1)
//   --audio-dir  where the mp3s live (default <repo>/scratch/ml-video/<slug>)
//   --force      re-align even if words.json is newer than the mp3

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');

// Tiny .env loader (no deps). Real env vars win over .env values.
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !m[1].startsWith('#') && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

// Flags accept both `--name=value` and `--name value`. Booleans take no value.
const BOOLEAN_FLAGS = new Set(['all', 'force']);
const args = process.argv.slice(2);
const opts = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith('--')) { positional.push(a); continue; }
  const eq = a.indexOf('=');
  if (eq !== -1) opts[a.slice(2, eq)] = a.slice(eq + 1);
  else if (!BOOLEAN_FLAGS.has(a.slice(2)) && i + 1 < args.length && !args[i + 1].startsWith('--')) opts[a.slice(2)] = args[++i];
  else opts[a.slice(2)] = true;
}
const opt = (name, dflt) => (name in opts && opts[name] !== true ? opts[name] : dflt);
const flag = (name) => name in opts;

const key = process.env.ELEVENLABS_API_KEY;
if (!key) {
  console.error('ELEVENLABS_API_KEY is not set — add it to .env at the repo root.');
  process.exit(1);
}

const { deck, narrDir: NARR, outDir: audioDir } = require('./pres.cjs').resolvePres({
  pres: opt('pres'), out: opt('audio-dir'),
});
const html = fs.readFileSync(deck, 'utf8');
// ^-anchored so the authoring note at the top of the deck (which quotes the
// markup pattern in prose) doesn't count as a slide.
const slides = [...html.matchAll(/^\s*<section class="slide" id="([^"]+)"/gm)].map((m) => m[1]);

const lead = +opt('lead', 1);

let targets;
if (flag('all')) {
  targets = slides;
} else {
  const slideArg = positional[0];
  if (!slideArg) {
    console.error('usage: align.cjs <slide-number-or-id> | --all');
    process.exit(1);
  }
  let id;
  if (/^\d+$/.test(slideArg)) {
    id = slides[+slideArg - 1];
    if (!id) { console.error(`no slide #${slideArg} (deck has ${slides.length})`); process.exit(1); }
  } else {
    id = slideArg.replace(/^#/, '');
    if (!slides.includes(id)) { console.error(`no slide id "${id}" — ids: ${slides.join(', ')}`); process.exit(1); }
  }
  targets = [id];
}

const fmt = (s) => s.toFixed(2).padStart(6);

(async () => {
  for (const id of targets) {
    const stem = `${String(slides.indexOf(id) + 1).padStart(3, '0')}-${id}`;
    const mp3 = path.join(audioDir, `${stem}.mp3`);
    const txt = path.join(NARR, `${stem}.txt`);
    const out = path.join(NARR, `${stem}.words.json`);

    if (!fs.existsSync(mp3)) { console.error(`skip ${stem}: no audio at ${mp3}`); continue; }
    if (!fs.existsSync(txt)) { console.error(`skip ${stem}: no narration at ${txt}`); continue; }
    if (!flag('force') && fs.existsSync(out) && fs.statSync(out).mtimeMs > fs.statSync(mp3).mtimeMs) {
      console.log(`${stem}: words.json up to date`);
      continue;
    }

    const text = fs.readFileSync(txt, 'utf8').trim();
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(mp3)], { type: 'audio/mpeg' }), `${stem}.mp3`);
    form.append('text', text);

    const res = await fetch('https://api.elevenlabs.io/v1/forced-alignment', {
      method: 'POST',
      headers: { 'xi-api-key': key },
      body: form,
    });
    if (!res.ok) { console.error(`${stem}: alignment failed: ${res.status} ${await res.text()}`); continue; }
    const data = await res.json();

    // Keep words only — character-level detail is reconstructible on demand
    // and the word grid is what animation cues key on.
    const words = (data.words || []).map((w) => ({
      text: w.text.trim(),
      start: +w.start.toFixed(3),
      end: +w.end.toFixed(3),
    })).filter((w) => w.text);
    fs.writeFileSync(out, JSON.stringify({ loss: data.loss, lead, words }, null, 2) + '\n');

    console.log(`\n${stem} — ${words.length} words, overall loss ${data.loss?.toFixed?.(3) ?? data.loss}`);
    console.log('  audio   clip  word');
    for (const w of words) {
      console.log(`  ${fmt(w.start)} ${fmt(w.start + lead)}  ${w.text}`);
    }
    console.log(`wrote ${path.relative(ROOT, out)}`);
  }
})();
