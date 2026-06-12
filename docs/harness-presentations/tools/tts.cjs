// ElevenLabs narration generator for the deck — one audio clip per slide,
// named with the same numbered stem as record.cjs's video clips
// (002-s-stack.mp3 pairs with 002-s-stack.mp4) so muxing is mechanical.
//
// Credentials come from .env at the repo root (gitignored):
//   ELEVENLABS_API_KEY  (required)
//   ELEVENLABS_VOICE_ID (required — the custom voice; or pass --voice=)
//   ELEVENLABS_MODEL_ID (optional, default eleven_multilingual_v2)
//
// Usage:
//   node docs/harness-presentations/tools/tts.cjs <slide> --text "narration..."
//   node docs/harness-presentations/tools/tts.cjs <slide> --file narration.txt
//   node docs/harness-presentations/tools/tts.cjs --list-voices
//
//   <slide>    1-based slide number (e.g. 2) or slide id (s-stack / #s-stack);
//              slide order is read from the deck HTML (no browser needed)
//   --voice    override ELEVENLABS_VOICE_ID
//   --model    override model id
//   --stability / --similarity   voice_settings (defaults .5 / .75)
//   --out      output dir (default <repo>/scratch/ml-video, same as videos)
//   --format   ElevenLabs output_format (default mp3_44100_128)
//
// After writing the mp3 it prints the audio duration and the matching
// record.cjs command — the audio length IS the slide's video duration.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const opt = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : dflt;
};
const flag = (name) => args.includes(`--${name}`);

const API = 'https://api.elevenlabs.io/v1';
const key = process.env.ELEVENLABS_API_KEY;
if (!key) {
  console.error('ELEVENLABS_API_KEY is not set — add it to .env at the repo root.');
  process.exit(1);
}

(async () => {
  if (flag('list-voices')) {
    const res = await fetch(`${API}/voices`, { headers: { 'xi-api-key': key } });
    if (!res.ok) { console.error(`voices request failed: ${res.status} ${await res.text()}`); process.exit(1); }
    const { voices } = await res.json();
    for (const v of voices) console.log(`${v.voice_id}  ${v.name}${v.category ? `  (${v.category})` : ''}`);
    return;
  }

  const slideArg = positional[0];
  if (!slideArg) {
    console.error('usage: tts.cjs <slide-number-or-id> --text "..." | --file narration.txt   (or --list-voices)');
    process.exit(1);
  }

  // Slide order from the deck HTML — keeps numbering identical to record.cjs.
  const deck = path.resolve(positional[1] || path.join(__dirname, '..', 'missing-layer-101.html'));
  const html = fs.readFileSync(deck, 'utf8');
  // ^-anchored so the authoring note at the top of the deck (which quotes the
  // markup pattern in prose) doesn't count as a slide.
  const slides = [...html.matchAll(/^\s*<section class="slide" id="([^"]+)"/gm)].map((m) => m[1]);

  let id;
  if (/^\d+$/.test(slideArg)) {
    id = slides[+slideArg - 1];
    if (!id) { console.error(`no slide #${slideArg} (deck has ${slides.length})`); process.exit(1); }
  } else {
    id = slideArg.replace(/^#/, '');
    if (!slides.includes(id)) { console.error(`no slide id "${id}" — ids: ${slides.join(', ')}`); process.exit(1); }
  }
  const stem = `${String(slides.indexOf(id) + 1).padStart(3, '0')}-${id}`;

  let text = opt('text', null);
  const file = opt('file', null);
  if (file) text = fs.readFileSync(path.resolve(file), 'utf8').trim();
  if (!text) { console.error('no narration: pass --text "..." or --file path.txt'); process.exit(1); }

  const voice = opt('voice', process.env.ELEVENLABS_VOICE_ID);
  if (!voice) {
    console.error('no voice: set ELEVENLABS_VOICE_ID in .env or pass --voice=  (try --list-voices)');
    process.exit(1);
  }
  const model = opt('model', process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2');
  const format = opt('format', 'mp3_44100_128');
  const out = opt('out', path.join(ROOT, 'scratch', 'ml-video'));
  fs.mkdirSync(out, { recursive: true });

  const res = await fetch(`${API}/text-to-speech/${voice}?output_format=${format}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: {
        stability: +opt('stability', 0.5),
        similarity_boost: +opt('similarity', 0.75),
      },
    }),
  });
  if (!res.ok) { console.error(`tts request failed: ${res.status} ${await res.text()}`); process.exit(1); }

  const mp3 = path.join(out, `${stem}.mp3`);
  fs.writeFileSync(mp3, Buffer.from(await res.arrayBuffer()));
  const kb = (fs.statSync(mp3).size / 1024).toFixed(0);

  let dur = null;
  try {
    dur = parseFloat(execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', mp3,
    ]).toString().trim());
  } catch (e) { /* ffprobe missing — skip the hint */ }

  console.log(`wrote ${mp3} (${kb} KB${dur ? `, ${dur.toFixed(2)}s` : ''})`);
  if (dur) {
    console.log(`matching video: node docs/harness-presentations/tools/record.cjs ${id} --dur=${(Math.ceil(dur * 10) / 10).toFixed(1)}`);
  }
})();
