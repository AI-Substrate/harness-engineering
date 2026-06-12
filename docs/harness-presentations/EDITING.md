# Editing the Missing-Layer explainer video

Everything needed to rebuild, retime, or re-voice `missing-layer-101.html` →
`scratch/ml-video/missing-layer-101-full.mp4` from a cold start. Clips and
audio are **never committed** — only scripts, narration text, word grids, and
the deck. The pipeline is fully deterministic: run it twice, get the same
video twice.

## The pipeline at a glance

```
narration/NNN-id.txt ──tts.cjs──▶ scratch/ml-video/NNN-id.mp3
        │                                   │
        └────────────align.cjs◀─────────────┘
                        │
                        ▼
narration/NNN-id.words.json   (exact start/end per word, audio clock)
                        │
        (human/LLM craft pass: --cue-* blocks in the deck CSS)
                        ▼
missing-layer-101.html ──record.cjs──▶ NNN-id.mp4 (video+audio muxed)
                        │
                  comp.cjs (orchestrates all of the above, then
                  concat-stitches missing-layer-101-full.mp4)
```

### Tools (`docs/harness-presentations/tools/`)

| Tool | Job | Key flags |
|---|---|---|
| `tts.cjs` | One slide's narration → mp3 via ElevenLabs | `<slide> --file narration/NNN-id.txt`, `--list-voices`, `--stability`, `--speed` |
| `align.cjs` | Forced alignment: approved mp3 + known transcript → word grid | `<slide>` or `--all`, `--force`, `--lead 1` |
| `record.cjs` | Deterministic WAAPI scrub → frames → mp4; auto-muxes same-stem mp3 | `<slide> --dur 24.5 --lead 1`; defaults to native 4K60 (the approved recipe — see below) |
| `scrub.cjs` | Screenshot exact clip times — verify cues before rendering | `'#s-stack' 6.0,8.2,18.9` |
| `comp.cjs` | Full driver: tts (if txt newer) → record (if needed) → stitch + A/V table | `--only N`, `--force-tts`, `--force-video`, `--stitch-only`, `--lead 1 --tail 1 --min 6` |

### The recording recipe (why renders look like the live deck)

`record.cjs` bakes in three classes of fix — don't strip them:

- **60 fps** (`--fps 60` default). The deck animates on a 60 Hz grid in a
  browser; 30 fps folds two HTML frames into each video frame and fast
  moves strobe ("part of one frame, part of the next").
- **Native 4K output** (`--w 3840 --h 2160` default) + stable-raster
  launch flags (`--disable-font-subpixel-positioning --disable-lcd-text
  --font-render-hinting=none --force-color-profile=srgb`). Together
  these kill text shimmer — glyphs re-rasterize every frame, and
  fractional offsets (translate(-50%,-50%), 1.015 breathe scales)
  otherwise make the AA pattern dance; at 4K the glyph raster is 2× a
  1080p view's, and players downscale-average the rest. For a 1080p
  file with the same stability, supersample instead:
  `--w 1920 --h 1080 --scale 2` (capture at 4K, lanczos-downscale in
  the encode — measured text-card noise floor 0.108 → 0.067).
- **Commit-synced screenshots**: compositor determinism flags
  (threaded animation/scrolling off, all-compositor-stages-before-draw)
  plus a double-rAF wait after each scrub, so a capture can never race
  the renderer.

Capture cost at the defaults is ~0.2 s/frame — a full 20-clip rebuild
is a 1.5–2 h background run (4K60 encodes add a tail on top), a single
clip a few minutes. If a tool change alters rendering (fonts, size,
flags), re-render ALL clips in one pass — mixing old and new captures
in a stitch shows as a subtle text-character shift across cuts.

Puppeteer comes from the mermaid-cli install; prefix node with:

```
NODE_PATH=/Users/jordanknight/.npm-global/lib/node_modules/@mermaid-js/mermaid-cli/node_modules
```

### Credentials (`.env` at repo root, gitignored; template in `.env.example`)

- `ELEVENLABS_API_KEY` — required.
- `ELEVENLABS_VOICE_ID` — Grandpa Joe (`0lp4RIz96WD1RUtvEu3Q`).
- `ELEVENLABS_MODEL_ID=eleven_multilingual_v2` — **do not use eleven_v3**:
  professional voice clones aren't v3-optimized yet; v3 drifts the accent
  American and degrades clone quality at every stability setting. Revisit
  when ElevenLabs ships PVC support for v3.
- `ELEVENLABS_SPEED=1.1` — approved pace. Stability default (0.5) is the
  approved sound.
- Pauses on v2: SSML `<break time="1.5s"/>` inside narration text (≤3s).

## Timing model (the part everything hinges on)

- **Clip clock**: every clip = 1 s silent lead + narration + 1 s tail
  (min 6 s). Audio is muxed at +1 s (`adelay`), then `apad` + `-t` make the
  audio stream *exactly* the video length — that equal-length invariant is
  what lets the concat stitch run with `-c copy` and zero drift.
- **CSS clock == clip clock**: the recorder kills `requestAnimationFrame`
  before page scripts run, pauses all `document.getAnimations()`, and sets
  `currentTime = frame / fps` per frame. A CSS `animation-delay: 6.04s`
  fires at exactly 6.04 s of video, every render, forever — at any fps,
  so cue blocks never move when the frame rate changes.
- **Word grid → cue**: a word starting at `T` seconds in `words.json`
  (audio clock) is spoken at `T + 1.0` clip time. Cue-block values in the
  deck are already clip time.

## The cue-block convention (in the deck CSS)

Each slide's CSS starts with a `--cue-*` variable block; every value carries
a comment quoting the spoken phrase it keys:

```css
/* word-sync cues from narration/002-s-stack.words.json (+1s mux lead). */
#s-stack {
  --cue-you: 6.04s;     /* "You at the top." */
  --cue-agent: 8.24s;   /* "the AGENT in the middle." */
  ...
}
```

Choreography rules reference `var(--cue-*)` / `calc(var(--cue-*) + .15s)` —
**timing data lives in one block per slide; the choreography never hardcodes
times**. Idioms used throughout:

- `backwards` fill hides an element until its cue (don't remove it).
- Impacts (stamps, flips, slams) start *early* so the hit lands ON the word:
  S8 slam starts at `cue − .6s` (impact = end of zoom), S13 flips at
  `cue − .7s` (settle ≈ 75% through), S9 flip impact ≈ `+.4s` in.
- Enter-then-loop = comma-separated animations sharing the cue delay.
- Loops phase-lock by sharing one cue delay across every member
  (S2/S4 production loops, S15 proof/enc, S7 trek clock).
- Ambient micro-motion must carry every quiet stretch (bobs, breathes,
  blinks, pulses) — slides are NEVER static, even while waiting for a cue.
- One or two one-shot "flourish" keyframes per slide, keyed to a word
  (color/filter/box-shadow only — never fight a `forwards` transform fill
  on the same element).

### Derived values — recompute these if their cue moves

These aren't raw word times; each is documented in a comment at its
definition, but in short:

| Slide | Var | Derivation |
|---|---|---|
| S4 `#s-infer` | `--loop0` | `cue-inferred − (6×TRIP + .62×TRIP)` — 7th sheen sweep's leading edge lands on "inferred" |
| S7 `#s-friction` | `--trek-go` | `cue-env − 2.56s` (16% of the 16 s trek = hold-1 start) |
| S12 `#s-mult` | amdPulse delay `18.8s` | nearest `5 + 4.6k ≥ cue-agents + .55` (keeps pulse peak catching l4's crumbs) |
| S13 `#s-quest` | `.qb` breathe `+4.27s` | keeps the two cards breathing in counter-phase (1.5 periods apart) |
| S15 `#s-miss` | `--cue-loop` | `clip("up.") − 1.54s` (proof peaks at 55%, enc buries at 88%) |
| S18 `#s-fix` | spark delay | `cue-sensor − 1s` (sparkArc is exactly 1 s; arrival-keyed) |
| S19 `#s-fin` | `--sync-fix` | `cue-fix − 2.4s` (uniform shift of the hand-tuned fall/kick/chip cluster) |
| S19 `#s-fin` | `--sync-drip` | must stay a multiple of 3.2 s (drips phase-locked to hglow) |

## Cold-start recipes

### A. Re-take ONE slide's narration (text change)

1. Edit `narration/NNN-id.txt`.
2. `node tools/comp.cjs --only N` — regenerates the mp3 (txt newer than
   mp3), re-records, restitches.
3. `node tools/align.cjs N --force` — fresh word grid.
4. Update that slide's `--cue-*` block from the new grid (+1 s), including
   any derived values above. The craft intent is in the comments — keep
   each cue on the word its comment quotes.
5. Verify: `node tools/scrub.cjs '#<id>' <cue-times>` and eyeball the PNGs.
6. `node tools/comp.cjs --only N --force-video`.

### B. Change pace / voice / model (EVERY cue moves)

1. Set `.env` (`ELEVENLABS_SPEED`, voice, model).
2. **Back up first**: `cp scratch/ml-video/*.mp3 scratch/ml-video/backup-<date>/`
   — approved takes are irreplaceable; rollback is free, regeneration isn't.
3. `node tools/comp.cjs --force-tts --force-video` — all audio + video.
   Listen to a few clips BEFORE doing the cue work — if the voice is wrong,
   fix that first.
4. `node tools/align.cjs --all --force`.
5. Re-derive every slide's cue block from the new grids. This is an
   LLM-judgment pass, not mechanical: the comments quote the word each cue
   keys on — find that word in the new grid, take its start + 1 s, and
   recompute the derived values table above.
6. Scrub-verify each slide at its cue times, then
   `node tools/comp.cjs --force-video`.

### C. Visual-only slide edit (no audio change)

1. Edit the slide's CSS/markup. Keep timing in the cue block; respect the
   fill-mode and phase-lock idioms above.
2. Scrub-verify: `node tools/scrub.cjs '#<id>' <times>`.
3. `node tools/comp.cjs --only N --force-video` — **comp.cjs does not
   detect HTML changes**; `--force-video` is mandatory after deck edits.

### D. Full rebuild from nothing (fresh clone)

```
cp .env.example .env       # fill in the ElevenLabs key
node tools/comp.cjs        # tts (all mp3s missing) → record → stitch
node tools/align.cjs --all # word grids (committed, so usually current)
```

If the committed `words.json` files match the committed narration text and
you regenerate audio, the takes will differ slightly — re-align and re-check
cues (recipe B steps 4–6).

## Verification habits

- `comp.cjs` ends with a per-clip table: narration / video / audio lengths.
  Video and audio must be EQUAL per clip (that's the no-drift invariant);
  mismatches > 0.06 s are flagged.
- Never trust a render you haven't scrubbed: `scrub.cjs` at the cue times
  shows the exact frames the video will contain.
- Useful spot-checks: a frame just BEFORE the first cue (element must be
  absent), one ON each major cue, one near the end (everything settled,
  ambient loops alive).

## Gotchas (each cost us a debugging session)

- `.tw { width: 0 }` is global; anything typing via `max-width` needs a
  scoped `width: auto` (S6's plan.md header was invisible for weeks).
- `.hplate`'s first span is `.hl`, so harness chips are
  `:nth-of-type(2)–(5)`, not `(1)–(4)`.
- Inline `style="--d:…"` beats any CSS rule setting `--d` — S16's job pills
  are cued in the MARKUP, not the stylesheet.
- S20/S1 orbital pills: orb spins forward, pill spins reverse with
  identical duration/delay. Touch either delay and every label tilts.
  Fade the `.e` wrapper instead.
- Shared rules (`.lhead`, `.acard`, `.tw`, `bigstamp/slam/puff/jolt`) serve
  several slides — always override inside `#slide-id` scope, never edit the
  shared rule.
- A later animation in a comma list wins shared properties while running —
  one-shot flares must not animate properties a `forwards` fill is holding
  (use color/filter/box-shadow), and `uniFlash`-style one-shots must be
  listed AFTER an infinite loop on the same property.
- Every agent gets its idle blink from the base `.agent-chip .eyes` rule.
  Any slide that puts its own `animation:` on `.eyes` must re-list
  `blinkEyes 4.6s ease-in-out infinite` in the comma list AND keep its own
  keyframes off the `transform` channel (the blink lives there — glow with
  color/text-shadow only). S2 shipped a frozen agent because `agentScan`
  forgot both.
- Background `&` launches don't notify; use the harness's background runner
  or a Monitor on the log file.
- Slides that CONTINUE the previous slide's scene (S8→S9, S9→S10,
  S17→S18) must have the persistent elements on stage at frame 0 — no
  entrance fade/pop, or the stitched video blinks at the cut (full scene
  → blank frame → rebuild). Only genuinely new elements get entrances.
  Check a boundary with:
  `ffmpeg -sseof -0.1 -i NNN.mp4 -frames:v 1 last.png` vs
  `ffmpeg -i MMM.mp4 -frames:v 1 first.png`.
- An intermediate keyframe that lists `transform` SPLITS the transform
  interpolation into segments, and the easing function restarts per
  segment — velocity decays to ~0 into the keyframe then relaunches
  fast, a visible 2-frame jolt at 30fps (qFlip shipped this at its old
  62% keyframe). Keep a move's transform ONE from→to segment; put
  mid-animation opacity/color beats on their own keyframes — a keyframe
  only segments the properties it actually lists. To hunt this class:
  consecutive-frame diffs (`blend=all_mode=difference,signalstats`)
  near-zero then spiking mid-animation = a velocity snap.
- "Tearing"/judder suspicions about the recorder: captures are
  deterministic and commit-synced (see "The recording recipe" above).
  To prove a render is clean, full-clip-compare two renders of the
  same deck:
  `ffmpeg -i a.mp4 -i b.mp4 -filter_complex "psnr=stats_file=p.log" -f null -`
  — every frame ≥50dB means identical captures. We chased "super mild
  tearing" here once: the captures were already clean (924/924 frames
  identical across recorder versions); the real causes were a keyframe
  velocity snap (gotcha above), 30fps judder, and text-raster shimmer —
  all fixed in the deck/recipe, not the capture loop.

## Numbering & layout

- Slides are numbered by order of `<section class="slide" id="…">` in the
  deck (regex is `^`-anchored — the authoring note at the top quotes the
  pattern in prose and must not count).
- Stems: `001-s-title`, `002-s-stack`, … shared by txt / words.json / mp3 /
  mp4 so muxing is mechanical.
- Output dir: `scratch/ml-video/` (gitignored). Full comp:
  `missing-layer-101-full.mp4`.
