# The Missing Layer — run sheet

**Deck:** Engineering Harness 101, lived-experience edition (brand-tailored) **Working title:** *The Missing Layer* (placeholder, easy to change) **Companion HTML (to build):** `docs/harness-presentations/missing-layer-101/missing-layer-101.html`, with a local `nucleus-assets/` copy (McQueen fonts) so it reuses the brand tokens and stage pattern from the original title-card comp**Length target:** under 5 minutes, presenter talking over animated slides. Many short, single-moment slides rather than few dense ones: each slide is one beat, which keeps the animation simple and the pace snappy. **Relationship to the canonical deck:** `docs/harness-presentations/missing-layer-101/intro-to-harness.md` argues from first principles. This deck argues from a *lived day*: a team member, an agent, a piece of work, and the moment the knowledge evaporates. Same destination (the deterministic layer / engineering harness), opposite direction of approach. Source beats also drawn from `harness-foundations/simple-mode.md` (the "agent says done, you look, it's not" hook; agent-harness vs engineering-harness deconfliction; encode the fix, not the memory).

---

## The arc in one paragraph

A team does normal agent-assisted work. The stack they're working in has three layers: human, inference, code — we intro the stack, then meet each layer one by one. Then the lived story: you've prepared your plan, the agent builds, hits friction, works around it, and stamps "done." You look: it isn't. You steer it right with human backpressure and everyone's happy. Then the trap: that entire interaction — the friction, the workaround, the correction — is *lost*. It will happen again tomorrow, to a teammate, or to your future self. Multiply by everyone on the team, every day, many times a day. Two questions fall out: **how does the agent know when it's done?** and **where does your backpressure go so it isn't lost?** What we need is one simple, first-class focal point — and its honest shape is a missing fourth layer between inference and code. It's called an engineering harness. Then one day in the new world: an architecture checker passes, a PR reviewer catches what it missed, and nobody debates where the fix goes — you fix the *checker*, re-run it, it points at the problem, you fix the code. The correction is permanent. The finale shows the whole team feeding it, and it compounding.

### Beat map (the spine to protect under time pressure)

 1. Normal day, three layers — stack intro, then a fast tour of each layer
 2. You've prepared your plan; work begins
 3. Friction happens; "done" happens (and "done" is a claim)
 4. Human backpressure fixes it — and is then **lost**
 5. Scale the loss: whole team, every day, tokens burned, learning gone
 6. The two questions (done-ness, memory)
 7. What we need: a first-class focal point → the missing layer slides into the stack
 8. It has a name: engineering harness
 9. Life with it: the PR catch — fix the CHECK, then the code; the workflow itself improved
10. The team compounding (payoff)

---

## Cast & visual language

- **Brand (inherited from the original title-card comp):** Purple `#7B14EF` leads (stage background), Lavender `#C497FE`, Mauve `#EBDCFD`, ink black, white. McQueen SemiBold headings, McQueen Regular pull-outs, Inter body, mono for terminal chrome. **No em dashes in branded on-slide copy.** No invented purples.
- **The stage:** same 16:9 bordered stage on dark pasteboard as the title card, container-query sizing, so every slide composes identically and screen-captures cleanly.
- **The agent character:** a small rounded ink chip with a mono `>_` face and tiny status eyes. Mood is shown with cheap tricks: eyes as `· ·` (working), `> <` (confused, with a small `?` bubble), `^ ^` (happy, with a `✓`). One character, reused on every slide, so the audience binds to it. Confused mode gets a gentle wobble keyframe. **It is alive everywhere:** ambient blink (scaleY squash every \~4.6s) plus per-scene acting (eyes flash lavender while processing, dart left-right when lost).
- **The human character:** two forms. As a *chip*: a simple mauve circle-head silhouette labelled `you` (S2 plates, face-offs). As a *little person*: an ink silhouette acting out a vignette — sitting at a desk typing (arm taps at the keyboard, head bobs, laptop screen flickers, work fragments rise off the laptop), later: leaning in to inspect, throwing hands up, pointing at a PR. Built as inline SVG with the double-nested `<g>` pattern (outer `<g>` holds SVG placement, inner `<g>` takes the CSS animation, explicit `transform-origin`). Later slides add teammate variants (anonymous `you ×N`).
- **Scene choreography (the explainer-video rule):** every slide is a *scene with a clock*, not a stack of reveals. Each scene declares one master cycle (`--TRIP`-style custom property) and all actors phase-lock to it with `calc(var(--TRIP) * fraction)` delays, so cause and effect read at a glance: packet leaves human → agent's eyes flash as it processes → codebase plate pulses on arrival → claim packet rides back up. Objects are *born from their source* (artifact cards fly out of the typing human's desk; they don't fade in at their destination). Inspired by the `present` repo's comp set (and robot fixture) but not copied. **No presenter steps:** every slide autoplays its full scene on entry and settles into an ambient loop; clicks only move between slides (the step machinery stays in the framework for a future slide that truly needs one held beat, but the default is zero). **Render-review rule:** after any visual change, run `docs/harness-presentations/tools/snap.cjs` (hero frame per slide, present-repo style) and actually inspect the frames before calling it done.
- **The layer plates:** wide slabs with physical thickness (hard offset under-shadow, so they stack like boards), each carrying a mixed-case McQueen wordmark with a purple full stop (`Human.` / `Inference.` / `Codebase.`), a McQueen descriptor, and a ghost outline index numeral (`01`/`02`/`03`) at the right. Slabs stack flush (a trial horizontal stagger read as misalignment and was removed). Human = mauve, Inference = lavender, Codebase = white. The deterministic layer, when it finally arrives, is the **ink-black slab with a lavender glow** — visually the odd one out on purpose, because it's the thing that was missing (its ghost numeral can be a dashed `?` until it earns a number).
- **The loss motif:** knowledge/learnings rendered as small lavender particles. When an interaction is "lost," the particles drift up and fade. This motif repeats (S11, S12) and is then *reversed*: first for a single fix in S18 (the correction flows down INTO the harness and sticks), then at full team scale in the finale (S19).
- **Token motif:** a small mono counter (`tokens ▸ ▮▮▮▮…`) that ticks up during agent work. Used sparingly: S7 and S12.

---

## Slides

> Each slide lists: **Frame** (why it exists), **On-slide copy** (proposed, minimal, brand-safe), **Talk track** (suggested spoken words), **Beats** (must-land points), **Animation** (entry state + presenter-advanced steps), **Time**. On-slide copy is deliberately sparse: the presenter carries the narrative, the slide carries the picture. Several slides are intentionally single-moment "punch" slides (S8, S9, S13) with almost nothing on them.

---

### S1 · Title — Engineering Harness 101

**Frame.** Reuse the Nucleus 101 title-card design nearly verbatim: same stage, tags, McQueen headline, orbit scene, termbar footer. Retitle for this deck. The termbar plants BOTH threads the deck resolves: done-ness and learning-loss (per `simple-mode.md`'s twin hooks).

**On-slide copy.**

- Tags: `Engineering Harness` + flag `A Lived Experience`
- H1: `Engineering Harness 101.` (keep the stroked-outline treatment on `101`, lavender dot)
- Sub: `One team. One piece of work. And the layer that was missing the whole time.`
- Footer termbar: `$ [ a normal day ] + [ one piece of work ] = is it actually done? + where did the learning go?` (cursor blink)

**Talk track.** "This is Engineering Harness 101, but we're not going to do theory. We're going to follow one piece of work through a team that works the way most of us work today, and we're going to chase two questions: how do we know the work is actually done, and what happens to everything the team learns along the way."

**Beats.**

- This is situational, not first-principles
- Plant BOTH questions: done-ness and learning-loss
- Promise: by the end you'll see the missing layer

**Animation.** Inherited from the title card: staggered fade-ups (tags → h1 → sub → footer), orbit spinning, cursor blink. One presenter step max (everything can autoplay on entry).

**Time.** 15s

---

### S2 · The stack you already have

**Frame.** Intro ALL layers in one picture: three plates, simple words, no over-explaining (the next three slides give each layer its own moment). **Deliberately no deterministic layer** — that absence is the whole deck's engine, so the stack must look complete and comfortable here. Leave subtle extra vertical breathing room between Inference and Codebase (the gap the new layer will later fill) but don't draw attention to it.

**On-slide copy.**

- Kicker: `A typical setup`
- Plate 1 (mauve): `HUMAN` · `intent, judgement, taste`
- Plate 2 (lavender): `INFERENCE` · `the agent: plans, reasons, writes code`
- Plate 3 (white): `CODEBASE` · `your product, your tests, your build`
- Side arrows: `intent ↓` on the left, `code & claims ↑` on the right

**Talk track.** "Here's the stack most teams run today. You at the top. The agent in the middle. Your codebase at the bottom. Intent flows down, code and claims of success flow up. Note the word: claims. Looks complete, right? Keep that thought. Let's meet each layer for a second."

**Beats.**

- Three layers, named plainly
- Intent down, claims up ("claims," said out loud, is the seed of the done-ness thread)
- Plant the seed: "looks complete" (do NOT name the missing layer yet)

**Animation.** Isometric scene, asymmetric split: editorial McQueen column left (`The stack you already have.`), the three layers as **floating isometric floors** right (CSS preserve-3d, orthographic camera on the parent, each floor only travels in Z; dark under-copy at `translateZ(-1cqw)` gives slab thickness; painted grid + foreshortened ghost numeral decals on each surface; bloom + ground-shadow ellipse for atmosphere; whole stack idles on a slow bob). The gap under floor 02 is visibly larger: the slot the missing layer will fill. Fully autoplay, zero clicks: type column fades up, floors land from above in order with overshoot (0.2–1s), billboard labels (`Human.` / `Inference.` / `Codebase.` + traits) slide in with dashed leader lines (1–1.4s; leaders sit on the wordmark centerline, all dots on one vertical line, ink-ringed for contrast), the cast pops in *standing on their floors* (1.7–1.9s, grounded by blurred shadow ellipses), the mono legend (`▼ intent / ▲ code & claims`) fades up, and at 2.3s the **work drop** begins on a shared \~4.6s cycle: a lavender intent dot falls *through* the floors (each floor flashes via a coat overlay as it passes, the agent's eyes flash lavender at floor 02), lands on Codebase, then a white claim dot rises back up to Human. Loops while the presenter talks: the diagram *is* the workflow.

**Time.** 15s

---

### S3 · Layer tour — Human

**Frame.** First of three fast layer-tour slides. Almost no text; representations carry it. The human layer is intent, judgement, risk, taste, priorities — the stuff only people bring. Warm, light slide.

**On-slide copy.**

- The mauve `HUMAN` plate parked at the top of the stage as a header band (the other two plates ghosted faintly below: we are "inside" this layer)
- The `you` chip centre-stage, surrounded by floating artifact cards, one or two words each:
  - a backlog card with three prioritised rows (`1 ▸ 2 ▸ 3`)
  - a judgement toggle card: `ship it / not yet`
  - a `risk` dial card, needle mid-range
  - a `taste` card (a small ✦)
  - a review note card: `"is this actually good?"`

**Talk track.** "Top layer: you. Intent, judgement, priorities, risk, taste. You decide what matters and whether the thing is actually good. Nothing below this layer decides what matters."

**Beats.**

- Humans bring intent and judgement
- "Decides what matters" (this phrase echoes later)

**Animation.** Entry: poster layer header (shared `.lhead` template, parameterised by layer colour): McQueen wordmark `Human.` wipes in left-to-right with a mauve full stop, the three trait words stamp in one at a time, a mauve rule draws underneath, and a giant ghost `01` outline drifts behind the scene. Other layers ghost at the foot. Fully autoplay, zero clicks: a little ink human pops in *at a desk, typing* — arm tapping the keyboard, head bobbing, laptop screen flickering, mono work fragments (`{ }`, `plan.md`, `v2 ✓`) rising off the laptop. The artifact cards are **born at the desk** and fly out one by one to their positions with a bounce overshoot (priorities → judgement → risk → taste → the "is this actually good?" note), then idle on a slow float. The human never stops typing: this layer *produces* intent, judgement, taste.

**Time.** 12s

---

### S4 · Layer tour — Inference

**Frame.** The agent's layer: plans, reasons, writes code; spec-driven development lives here. Show the artifacts of agent work. This slide also carries the deck's one deconfliction beat (per both source docs): when people say "harness" they usually mean the agent harness, which lives HERE — and that is not today's harness. Neutral-to-positive tone otherwise; the agent's blind spot is revealed by the story later, not editorialised here.

**On-slide copy.**

- The lavender `INFERENCE` plate as the header band (human plate ghosted above, codebase ghosted below)
- The agent chip centre-stage (eyes `· ·`), surrounded by its artifacts:
  - a `spec.md` card with tidy skeleton lines
  - a plan checklist card (`☑ ☑ ☐ ☐`)
  - a diff card with green `+` and red `-` gutter lines
  - a chat snippet card (`> make it so`)
  - a thinking ellipsis bubble (`…`) that pulses
- Small caption chip: `plans · reasons · writes code`
- Corner tag (small, mono): `the "agent harness" lives here · not today's harness`

**Talk track.** "Middle layer: inference. The agent. It plans, it reasons, it writes the code. Your spec-driven flow and your prompts live here. Quick aside: when people say harness, they usually mean this layer, the agent harness — the runtime driving the model, your Copilot or Claude Code or Cursor. That is not the harness this talk is about. Hold that thought. And remember: everything this layer produces is, at the end of the day, is inferred."

**Beats.**

- The agent does the cognitive work: plan, reason, write
- SDD/prompts live at this layer
- Deconfliction: agent harness lives here; NOT today's topic (one sentence, no dwelling)
- Soft plant: its output is inference

**Animation.** Fully autoplay, zero clicks. Entry: poster layer header (`.lhead` template): `Inference.` wipes in with a lavender full stop, traits stamp in, lavender rule draws, ghost `02` drifts behind; ghosted human bar above the scene, codebase bar below. The agent chip pops in centre (bigger than usual: this is its layer) with a pulsing `…` thinking bubble, then deals its artifacts out of itself with a bounce (spec.md → plan checklist → diff → prompt, 1 to 1.75s); the deconfliction tag stamps in with a small shake at 2.2s. Ambient production loop on the shared `--TRIP` cycle (from 2.3s): the diff types itself in line by line then resets, the two pending checklist boxes tick over, the agent's eyes flash lavender while it works, and a faint lavender "inferred" sheen ripples across all four cards in dealing order as the closing beat of each cycle (the soft plant: its output is inference).

**Time.** 15s

---

### S5 · Layer tour — Codebase

**Frame.** The bottom layer, and the visual opposite of the previous two: *dense*. Code files, scripts, configs, tests, CI, databases — deliberately cluttered, because this is where the real engineering complexity lives. This clutter is the setup for the harness reveal later ("a simple view over the complex"). Don't say that yet; just let the density register.

**On-slide copy.**

- The white `CODEBASE` plate as the header band
- A packed constellation of small artifact cards, mono-labelled, slightly overlapping, varied rotation:
  - file cards: `src/…` (a fan of 3), `tests/`, `package.json`, `Dockerfile`
  - script cards: `deploy.sh`, `seed-db.sh`, `Makefile`
  - config cards: `ci.yml`, `.env.example`
  - a DB cylinder, a tiny green/red CI status dot pair
- Caption chip: `where the real complexity lives`

**Talk track.** "Bottom layer: the codebase. Code, tests, scripts, pipelines, configs, databases. Every repo's different, every one of these has its own quirks, and this is where all the real engineering complexity lives. Keep this picture in your head; it matters later."

**Beats.**

- The code layer is genuinely complex and idiosyncratic
- Visual seed for "simple view over the complex" (planted, not spoken)
- "Keep this picture in your head"

**Animation.** Fully autoplay, zero clicks. Entry: poster layer header (`.lhead` template): `Codebase.` wipes in with a white full stop, traits stamp in, white rule draws, ghost `03` drifts behind; the two layers above ghost in as bars at the top. The constellation rains in fast (translateY + slight rotation, tight 40ms stagger, intentionally busy): 20 items, three card languages (white file cards, ink `$` script cards, mauve config cards) plus a CSS database cylinder and a few nameless filler chips that thicken the pile; neighbours genuinely overlap. Ambient loop: the pile never sits still: every card micro-jostles at an offset phase (half translate, half rotate), the `ci.yml` status dots blink pass/fail alternately (brand purple/ink, not green/red), and the db cylinder's lid blips once per `--TRIP` cycle. The caption chip `where the real complexity lives` stamps in last (1.6s).

**Time.** 12s

---

### S6 · Let's say you're working on your plan

**Frame.** The story begins, in second person: you've done the preparation right. Spec-driven development, shaped prompts, a plan that looks great. Everything here should feel *competent* — this team is not doing anything wrong. The agent picks it up and goes.

**On-slide copy.**

- Kicker: `Let's say…`
- A plan/spec document card (white, mono header `plan.md`) with skeleton lines and three ticks: `spec done ✓` `prompts shaped ✓` `looks great ✓`
- Agent chip beside it, eyes `· ·`, status: `building…`

**Talk track.** "Let's say you're working on your plan. And you've done this properly: spec-driven development, good prompts, a plan that genuinely looks great. The agent picks it up and gets going. So far, textbook."

**Beats.**

- Second person: this is YOUR normal flow
- The preparation was good (spec, prompts, plan)
- Agent starts work

**Animation.** Fully autoplay, zero clicks. The typing human from S3 returns lower-left (desk scene, now a shared cast component; work bits read `spec ✓ / prompts / v3`). The `plan.md` card is born at their laptop and rises to centre stage with a bounce (0.4s), then assembles itself: mono header types in (1.2s), skeleton lines wipe down (1.5 to 1.8s), and `spec done ✓ / prompts shaped ✓ / looks great ✓` stamp on one by one (2.1 to 2.8s). The agent slides in from the right (2.9s), the finished plan shrinks and docks beside it like a baton handoff (3.8 to 4.7s, a single forwards-filling transform so the same card travels), the agent gives a small receiving nod, and a `building…` status pill plus an indeterminate progress bar fade up beneath it (4.7s). Ambient loop: progress chunk sweeping, status dots pulsing, agent eyes flashing lavender on the `--TRIP` cycle, human still typing.

**Time.** 15s

---

### S7 · Friction

**Frame.** The lived moment everyone recognises, part one: the agent hits frictions and works *around* them rather than through them. Confused-agent comedy lives here. The token counter ticks the whole time. (The "done" claim is the NEXT slide, so this one ends mid-journey.)

**On-slide copy.**

- Kicker: `Some time later`
- A winding path from `plan` toward an unseen destination off-stage right, with three obstacle markers on it: `env won't boot` · `weird test setup` · `how do I even run this?`
- Agent chip wobbling at each obstacle (eyes `> <`, `?` bubble), then detouring around
- Mono token ticker in the corner, climbing

**Talk track.** "Then reality. The environment won't boot the way the docs say. The test setup is weird. Half the battle is just working out how to run the thing. The agent is resourceful, so it works around each of these. Burning tokens the whole way."

**Beats.**

- Friction is normal and plural
- The agent works AROUND friction, not through it
- Tokens burn during the figuring-out

**Animation.** Autoplays. The dashed route fades in (dashes march toward the destination), the docked `plan.md` pops at the trailhead, the three obstacle signs stamp in on their pins, and the token meter fades up bottom-right with odometer reels already spinning. The agent fades in at the trailhead at 1.6s and treks one 16s cycle forever: walking keyframes are arc-length sampled from the actual SVG path so it stays glued to the line; at each pin it stops for ~0.8s (rotate-shake wobble, `?` bubble pops, eyes crossfade to `> <`), then arcs a detour bulge around the pin on its label-free side and rejoins the line; the meter glows lavender during every detour. It exits off-stage right, fades, and restarts the trek invisibly — the slide is always mid-journey.

**Time.** 20s

---

### S8 · "Done."

**Frame.** Punch slide. The claim gets its own moment: a near-empty stage and one enormous stamp. The audience should *feel* the confidence — and remember S2's word, "claims." Almost nothing on the slide.

**On-slide copy.**

- Giant lavender stamp, centre stage: `DONE ✓`
- The agent chip beneath it, eyes `^ ^`
- Token ticker in the corner, stopped, final tally visible

**Talk track.** "And eventually: done. The agent believes it. The tests are green. Done."

**Beats.**

- "Done" is a claim, not a fact (don't say this out loud yet; the stamp size and pause do the work)
- The agent is sincere

**Animation.** Autoplays. Empty stage; the agent trots in from the left (0.3–1.7s, walking bob). Beat. At 2.1s the `DONE ✓` stamp slams down from camera (scale 3.6 → overshoot → rest), the stage jolts, eight dust particles kick out sideways, and the eyes flip to `^ ^`. The frozen meter fades up at 2.8s — square stop-chip, final tally `312,406`. Ambient: the stamp breathes a slow lavender glow, the agent does a proud double-hop every 2.6s.

**Time.** 10s

---

### S9 · You go and look

**Frame.** Punch slide, the counter-beat. The human inspects, and the claim collapses. This is the "did you even try to run this?" moment from the source docs. Keep it fast and a little funny.

**On-slide copy.**

- The S8 stamp scene, now with the `you` chip arriving with a magnifier
- The stamp flips on its Y-axis: `DONE ✓` becomes `not done ✗` (ink, not an off-brand red)
- Agent eyes drop to `> <`

**Talk track.** "You go and look. And… no. That's actually not done. The button's there but the flow breaks on the second click. You catch yourself asking the classic: did you even try to run this?"

**Beats.**

- The check is YOU looking at it
- "Did you even try to run this?" (verbatim, it's the recognition line)

**Animation.** Autoplays. The S8 end-state fades in already standing (stamp, `^ ^` agent, frozen meter). The `you` chip slides in from the left at 0.5s; a magnifier sweeps across the stamp 1.5–3.9s and holds. At 3.6s the stamp flips on its Y axis (overshoot ease, reads heavy) to a solid white plate: `not done ✗` in ink; the stage jolts, four dust specks puff, the magnifier lowers away, and the agent shake-wobbles as its eyes drop to `> <`. Ambient: a slow sad bob, the meter dimmed.

**Time.** 12s

---

### S10 · Human backpressure

**Frame.** Name the concept, resolve the scene warmly. You push back, the agent fixes it, it's genuinely done, everyone's happy. This is a *good* outcome — the system worked. The trap comes next slide, so let this one land as a success.

**On-slide copy.**

- `you` chip and agent chip facing each other
- A pressure arrow from `you` to the agent labelled `human backpressure`
- Small floating correction notes along the arrow: `that bit's wrong` · `this never ran` · `fix that`
- Then a fresh stamp: `actually done ✓`
- Both characters happy

**Talk track.** "So you push back: that bit's wrong, this never ran, fix that. What you just did has a name: human backpressure. You're the sensor telling the agent where it really is. The agent takes it, fixes it, and now it genuinely is done. Everyone's happy. This is a success story."

**Beats.**

- Name the concept: human backpressure
- You are the sensor
- The agent responds well to backpressure
- This is a happy ending (set up the rug-pull)

**Animation.** Autoplays. The two chips pop in facing each other (0.2/0.4s); the pressure arrow draws left-to-right at 0.7s and its dashes march toward the agent forever; the `human backpressure` label stamps in at 1.1s; the three correction notes pop along the arrow at 1.5/1.9/2.3s and idle on a float. At 2.9s the agent re-works (lavender box-shadow shimmer + eye glow); at 3.9s the solid-lavender `actually done ✓` stamp slams in up top with a stage jolt; at ~4.3s confetti bursts, the agent's eyes flip to `^ ^`, and both chips settle into a happy hop loop. Ambient: marching dashes, hops, stamp breathing glow.

**Time.** 20s

---

### S11 · And then it's gone

**Frame.** The rug-pull and the emotional core of the deck. Everything that just happened — the frictions, the workarounds, the correction — existed only in that conversation. It evaporates. Same problem, tomorrow, someone else. Keep the slide quiet and stark; this is the one to slow down on.

**On-slide copy.**

- The whole S10 scene shrinks into a small chat-window card labelled `that session`
- The card dissolves into lavender particles that drift up and fade
- Line (McQueen pull-out, centered): `That interaction was lost.`
- Sub-line: `Next time it happens to a teammate. Or to future you.`

**Talk track.** "But here's the problem. Where did all of that go? The frictions the agent found, the workarounds, your corrections, your backpressure. It lived in one chat session, and it's gone. Next week the same friction is waiting, unchanged, for the next person on your team. Or for you, in a month, when you've forgotten."

**Beats.**

- The interaction was LOST (say the word)
- Loss is the default, not an accident
- Teammates and future-you inherit the same problem

**Animation.** Autoplays. A chat-window card (`that session` titlebar, containing a miniature of the S10 scene: tiny you/agent chips, dashed arrow, skeleton lines, a small `actually done ✓` pill) pops centre at 0.25s. At 1.6s it flickers twice; from 2.2s it dissolves bottom-to-top (clip wipe) while 15 lavender/mauve/white particles lift off in row order and drift up — the loss motif's debut. `That interaction was lost.` fades up at 4.1s, the sub-line at 4.7s. From 5.2s, faintly in the corner (opacity .22), a second agent walks a short dashed path toward the same pin, wobbles at it, fades, and repeats forever.

**Time.** 20s

---

### S12 · Multiply it

**Frame.** Scale the wound. This is happening to everybody, every day, many times. Tokens spent figuring things out, learnings discarded. Maybe fragments survive in agents files or docs, and that's the best case. The slide should feel like watching money evaporate.

**On-slide copy.**

- Grid of 6 to 8 mini work-lanes, each with its own agent + human pair, each replaying a tiny silent version of the S7/S10 loop
- Every lane hits a wobble (friction), every lane emits drift-away particles
- Shared mono ticker: `tokens ▸ ▮▮▮▮▮▮▮▮▮` climbing fast
- One lane's particles land in a small file card `agents.md`, which visibly overflows (lines spill past the card edge)
- Line: `Every person. Every day. Many times.`

**Talk track.** "Now multiply it. Everyone on the team, every day, many times a day, paying tokens to rediscover the same things, and throwing the learning away at the end of every session. Best case, a few crumbs land in an agents file or a doc somewhere. Mostly the things never even get realised as learnings at all and the tokens just burn."

**Beats.**

- Team-wide, daily, repeated
- Tokens are real money spent re-figuring-out
- agents.md / docs are the lossy, overflowing best case
- Most learning is never even captured

**Animation.** Autoplays. Lane 1 pops at 0.3s, the other five multiply out at 0.95–1.55s. Each lane runs a silent 4.6s friction loop at its own phase (six phases spread across the cycle): mini human watches as the mini agent walks the dashed track, hits the pin, shake-wobbles, carries on, fades, repeats; two learning-particles lift off the snag point and evaporate every cycle. Lane 4's particles fall *down* instead, into the `agents.md` card below (pops 2.2s), which absorbs with a pulse and visibly overflows — skewed skeleton lines hanging past its edges. The meter (fades 1.9s) counts `4.XXM` with a slow tenths reel and a fast hundredths reel; the line `Every person. Every day. Many times.` fades up at 2.8s. Ambient: everything loops forever.

**Time.** 20s

---

### S13 · The two questions

**Frame.** Pivot from problem to design brief. Strip the stage back to near-empty and pose the two questions the whole story has been begging — the same two the title termbar planted. No answers yet. This is the quietest slide in the deck.

**On-slide copy.**

- Question card A (white): `How does the agent know when it's done?` · small sub: `without you standing there`
- Question card B (ink, lavender border): `Where does your backpressure live?` · small sub: `so teammates and future you get it for free`
- Nothing else on stage

**Talk track.** "So, two questions. One: how does the agent know when it's done? And two: when you steer it with your experience, where does that go? How do we make a memory of your backpressure, in the environment itself, that other people and your future self can actually use?"

**Beats.**

- Q1: done-ness needs to be knowable, deterministically
- Q2: backpressure and experience need a durable home in the environment
- These are environment questions, not model questions
- Callback: these are the title's two questions, now earned

**Animation.** Autoplay. Bare purple stage. Card A (white) flips up from flat with a weighty settle at .6s; card B (ink, lavender border) answers it at 1.8s. Both idle on a slow offset breath (scale 1.00 to 1.015, 5.4s cycle) so the stage stays alive while the presenter talks. Nothing else on stage; the cards hold the exact coordinates S14 will inherit.

**Time.** 15s

---

### S14 · What we need

**Frame.** The design brief, stated plainly before the reveal: one simple, first-class focal point with two jobs. A: tools so the agent knows, deterministically, when it's done. B: a place to encode the friction away for the next person and future you. Keep it abstract here — the SHAPE of the answer is the next slide's reveal.

**On-slide copy.**

- Header: `What we need`
- A single glowing focal node (ink circle, lavender ring) centre stage
- Two labelled spokes resolving into it:
  - `A · tools to know it is done` (from question card A)
  - `B · a place to encode friction away` (from question card B)
- Small sub under the node: `simple · first class · one place`

**Talk track.** "What we need is one really simple, first-class focal point. A: it's a single place to find all the tools that your engineering environment offers. B: it's the obvious place to encode the friction away, for the next person and for future you. One place. Not scattered docs, not tribal knowledge. So what shape is that thing?"

**Beats.**

- ONE focal point, first class, simple
- A: deterministic done-ness
- B: encode friction out of existence
- End on the question: "what shape is it?" (tee up the reveal)

**Animation.** Autoplay. The two S13 cards are still on stage (recreated in place, same coordinates); header sets top-left. The focal node bounces in below them at 1.2s (ink circle, lavender border, breathing lavender core, slow-spinning dashed ring). Spokes draw from each card down into the node at 1.5s; then both cards shrink and sink along their spokes into the node (1.9s / 2.05s), a ring pulse fires, and each card leaves behind its distilled label (`A · tools to know it is done`, `B · a place to encode friction away`) plus an `A` / `B` badge on the node rim, carrying the cards' white/ink identities. Sub `simple · first class · one place` fades up. Ambient: lavender packets run down the spokes and are absorbed forever, phase-locked to a 1.8s node tick; badges float.

**Time.** 15s

---

### S15 · The missing piece

**Frame.** The reveal. The honest shape of the focal point is not a doc or a vibe: it is a *layer*. Bring back the S2 stack and slide the new plate in. This is the money shot of the deck.

**On-slide copy.**

- The S2 stack returns: HUMAN / INFERENCE / CODEBASE
- A gap cracks open between INFERENCE and CODEBASE
- The ink plate with lavender glow slides in: `DETERMINISTIC` · `runnable proof · encoded backpressure`
- The focal node from S14 (carrying its `A` and `B`) lands inside the new plate as embedded chips: `done?` and `encode`

**Talk track.** "Remember the stack that looked complete? It was missing a layer. A deterministic layer, sitting between the agent and your codebase. Runnable proof going up. Encoded backpressure living inside. This is the missing piece."

**Beats.**

- It's a LAYER in the stack, between inference and code
- Callback: "the stack that looked complete"
- Runnable proof up; encoded backpressure within

**Animation.** Autoplay. The S2 isometric stack re-assembles fast (floors drop in by .7s, wordmark labels by 1.1s; traits omitted since the layers have been toured). At 1.6s the crack opens: Human and Inference ease up, Codebase eases down, and the empty slot glows lavender. At 2.5s the ink Deterministic plate slides in along the plane's own axis with a weighty overshoot settle and a lavender coat flash; its label pops with the only trait line on the slide (`runnable proof · encoded backpressure`). The S14 focal node (`A·B`) arcs down from above at 3.85s, sinks into the plate, and splits into the `done?` and `encode` decals lying on its face like floor markings. One unified stack pulse at 5.15s, all coats blinking. Ambient: a white proof dot rises out of the plate up through the stack while a lavender backpressure dot sinks in and stays, floors flashing as each dot passes, all phase-locked to one 2.8s clock; the plate's glow breathes brightest as the backpressure lands.

**Time.** 25s

---

### S16 · It has a name

**Frame.** Name and define it: the deterministic layer is an **engineering harness**. Plain words, three jobs. Key idea to land: it's a *simple view over the complex engineering concepts that live at the code layer* — callback to the S5 clutter — and it's the ONE place agents look to see what this environment can do, and the obvious place to improve when something's missing. It removes the question of where improvements go.

**On-slide copy.**

- The ink plate from S15, now enlarged to hero position: `ENGINEERING HARNESS`
- Sub: `a simple view over the complex engineering reality below`
- Behind/below it, a faint ghost of the S5 codebase clutter, visibly "tidied" behind the plate
- Three chips emerging from it: `discover` (what can this environment do?) · `prove` (am I done? run the checks) · `improve` (missing a feature? add it here)
- Small terminal strip: `$ harness --help` with a couple of plausible commands listing in (`boot`, `test`, `smoke checkout-flow`)

**Talk track.** "This layer is called an engineering harness. Remember the clutter at the code layer? The harness is a simple view over all of that complexity. When you want to encode a backpressure check, or remove a friction, this is the obvious place. It's the one place the agent looks to see what this environment can do. And if a feature's missing, maybe it should add it. If one's weak, improve it. There's no more question about *where* improvements to your environment go."

**Beats.**

- Name: engineering harness
- "Simple view over the complex" (callback to S5's clutter)
- One place to look = one place to improve
- Missing feature → add it; weak feature → improve it
- It kills the "where does this fix live?" question

**Animation.** Autoplay. The ink plate zooms up from small to hero scale with an overshoot settle (camera-zoom feel); `Engineering harness.` and the sub set in McQueen on its face. The S5 clutter reappears as faint outline cards, scattered at angles, then sweeps into two tidy rows tucked behind the plate's top and bottom edges (chaos to order, fast) and the plate bumps as they dock. The three jobs pop out on dashed connector stems (discover 2.95s, prove 3.25s, improve 3.55s) with their one-line descriptors; ambient: they light up in turn, like being browsed. The terminal rises at 4s, types `harness --help`, and lists `boot` / `test` / `smoke checkout-flow`; the agent pops in beside it at 5.6s, leans in 7 degrees, eyes go `^ ^`. Cursor blinks forever; plate glow breathes.

**Time.** 25s

---

### S17 · Life with it: PR time

**Frame.** A second lived story, now in the new world — and the deck's strongest proof. The team has an architecture checker in the harness. Work flows through it, the check is green, the PR goes up. Then the human reviewer catches it: the architecture is wrong. The check *missed it*. And here's the punchline beat: nobody debates where the fix goes. Not the prompt, not a doc, not a judgement call. Everyone — including the agent — points at the same place: the checker. The deck's first story asked "where does the correction live?"; this slide answers it under pressure.

**On-slide copy.**

- Kicker: `A few weeks later · PR review`
- The harness plate parked small at the bottom of the stage, carrying its chips, including `arch check`
- A PR card centre stage (`PR #214`, a few diff lines) with a green status row: `build ✓ · tests ✓ · arch check ✓`
- A reviewer chip (`teammate`) with a speech bubble: `"the architecture is wrong"`
- Beat moment: arrows from the reviewer, from `you`, and from the agent all converge, not on the PR, but on the `arch check` chip
- Caption: `everyone already knows where the fix goes`

**Talk track.** "A few weeks in. The team's harness has an architecture checker now. Work goes through, everything's green, the PR goes up. And the human reviewer goes: hang on, this architecture is wrong. The checker passed something it shouldn't have. Now here's the moment that matters. Nobody asks where this correction should live. Not a comment thread, not another paragraph in a doc. Everyone, including the agent, points at the same thing: the fix is in the harness. We fix the *check* first."

**Beats.**

- The harness can be wrong, and that's fine, it's expected
- Human review still catches things (humans stay in the loop)
- The punchline: it's not a judgement call; the fix target is OBVIOUS
- Fix the CHECK first, not the code

**Animation.** Autoplay. The harness plate fades up at the bottom (`harness.` + boot / test / smoke / arch check chips popping in). The PR card flies in from the agent's side, diff bars wipe, and the three status pills pop (brand purple ticks, not green); the agent's eyes go `^ ^`. You watch from the left. At 3.2s the teammate slides in from the right; the bubble stamps at 3.8s and pulses forever while the status row stays passing (the dissonance IS the visual) and the `arch check ✓` pill wobbles; agent eyes drop back to `· ·`. At 4.9s three thin lines draw from you, the agent, and the teammate, converging on the `arch check` chip, which lifts out of the plate and glows. Caption fades up at 6.1s. Ambient: lavender dots run down all three lines into the chip, staggered, forever.

**Time.** 20s

---

### S18 · Fix the check, then the code

**Frame.** The resolution, and the compounding-interest moment. The checker gets the new rule, re-runs, and now points straight at the problem. Then the code gets fixed, green across the board. The correction is not a PR comment that scrolls away; it's a permanent sensor that every teammate and every future agent session inherits. This is the loss motif running in reverse for the first time: one piece of human judgement, encoded, flowing down and *sticking*. Land the line: because the harness exists as a clearly defined concept of its own, the team's workflow itself just improved.

**On-slide copy.**

- The `arch check` chip from S17, opened up into a small rule card; a new rule line types in: `+ rule: <the thing the reviewer saw>` (keep it generic)
- Re-run strip: `$ harness check architecture` → `✗ 1 violation · src/…` (the checker now catches it)
- Agent fixes the code (small shimmer on the PR card), re-run: `✓ clean`; PR merges
- The rule line detaches as a lavender particle and flows DOWN into the harness plate, crystallising as a brighter `arch check` chip (loss motif, reversed)
- Badge on the chip: `every teammate · every future session`
- Line: `Fixed once. Caught forever.`

**Talk track.** "So we encode what the reviewer saw into the checker, and re-run it. Now it points straight at the problem. The agent fixes the code, everything's green, the PR merges. But look at what just happened. That correction isn't a comment in a PR thread anymore. It's a sensor. Every teammate and every future agent session inherits it, automatically. Because the harness exists as its own clearly defined thing, the team's workflow itself just got better. That's compounding interest. Now watch it at team scale."

**Beats.**

- Fix the check → re-run → it finds the problem → fix the code (the order matters)
- The correction became a permanent, runnable sensor
- Everyone inherits it: teammates AND future agent sessions
- The harness improved the WORKFLOW, not just this PR (compounding interest)
- Tee up the finale: "now watch it at team scale"

**Animation.** Autoplay. Recreates the S17 end state quietly (plate with the lifted, glowing `arch check` chip; PR card now small top-right; agent). The rule card flies OUT of the chip at .6s, skeleton rules wipe in, and the new rule types: `+ rule: ui never talks to the db`. The run strip rises at 2.8s, types `harness check architecture`, and lands `✗ 1 violation · src/checkout/…` at 4.35s with a strip shake (✗ is an ink-on-white disc, no off-brand red); agent eyes flick `> <`. The PR card shimmers twice (the fix), the second run types fast and lands `✓ clean` at 6.95s, `merged ✓` stamps the PR at 7.3s. Then the reversed loss motif: the rule detaches as a lavender spark at 7.9s, arcs down into the plate, and the chip crystallises — solid lavender, ink text, re-seated permanently. Badge pops (`every teammate · every future session`), `Fixed once. Caught forever.` fades up at 9.5s, agent eyes `^ ^`. Ambient: plate glow, blinking cursor.

**Time.** 20s

---

### S19 · Finale — the team, compounding

**Frame.** The payoff: S18's single fix, at full team scale. The emotional reversal of S11/S12 completed. Same team grid as S12, but now every fixed friction flows DOWN into the harness plate and *sticks* as a new command chip. The layer visibly grows. End on the brand: a closing termbar equation.

**On-slide copy.**

- The team lanes return (same cast as S12), working away
- Below them, the ink harness plate spanning the full stage width, already carrying the `arch check` chip from S18
- As each lane resolves a friction, a particle streams down into the plate and crystallises as a tiny labelled chip (`seed db`, `reset env`, `flaky setup`, `lint imports`, `smoke checkout`); the plate visibly grows
- Line: `Your experience, encoded. Everyone benefits.`
- Footer: termbar: `$ [friction found] + [encoded once] = never rediscovered ▍`

**Talk track.** "And this is what it looks like when the whole team lives in it. Same people, same work, same frictions. But now every fix lands in one place, as something runnable. The harness gets a little more capable every day, and everyone — including every future agent session — starts on top of everything the team has ever learned. That's the missing layer. That's an engineering harness."

**Beats.**

- Everyone feeds it, everyone benefits
- Fixes become runnable capability, not chat history
- It builds and builds over time (compounding)
- Close the loop: the missing layer, named

**Animation.** Autoplay. The six S12 lanes pop back in (.3 to 1.05s) above the full-width harness plate,
which rises at .55s already carrying `boot · test · smoke` and S18's crystallised lavender `arch check`. The lanes cycle work on the S12 clock, and the loss motif finally runs in reverse at team scale: one by one (2.4 to 6.5s), each lane's fix detaches from its snag point as a lavender spark, exits through the row gap, threads a gutter *between* lanes (never through one), and falls into the plate. On each landing the plate flares and a new chip crystallises in — `seed db`, `reset env`, `flaky setup`, `lint imports`, `smoke checkout` — popping solid lavender, then settling into normal chip dress. As each lane's fix lands, its agent's eyes flip `··` to a lavender `^^` and stay that way. `Your experience, encoded. Everyone benefits.` fades up at 7.2s; the termbar rises at 8.2s and types the closing equation (8.8 to 11.2s), cursor blinking forever. Ambient: from 9.6s, drips keep falling from the lanes phase-locked to the plate glow (every pulse reads as the plate absorbing the team's fixes); lanes keep cycling; the last lane's agent flips happy when its drip lands. Hold here for Q&A.

**Time.** 25s

---

### S20 · Sign-off — Happy harnessing.

**Frame.** The bookend. The title card's orbit scene returns — you, the agent, your codebase circling one piece of work — and the deck's opening question finally resolves: the ghost `?` pill crossfades into a solid ink `your harness` pill wearing the harness plate's dress (ink, lavender border, soft glow). The core now reads `whatever comes next`. Sign off warm.

**On-slide copy.**

- Orbit pills: `you` · `the agent` · `your codebase` · `your harness` (resolved from `?`)
- Core: `>_` / `whatever comes next`
- Line: `Happy harnessing.`
- Sub: `go find your missing layer`

**Talk track.** "That's the talk. Same three layers you walked in with, plus the one that was missing. Go find yours. Happy harnessing."

**Beats.**

- Callback: the title card's `?` orbiter, answered
- The harness joins the family portrait, in the plate's own dress
- Warm send-off, hold for applause/goodbyes

**Animation.** Autoplay. The orbit scene fades in at .15s, rings spinning on the title card's clocks, core pulsing. At 2.1s the ghost `?` crossfades into the ink `your harness` pill with a castPop wobble and a lavender ping ring, then settles into a soft glow breathe. `Happy harnessing.` fades up at 2.75s (McQueen, lavender full stop), `go find your missing layer` at 3.5s. Ambient: orbits spin forever, core pulses, harness pill glows.

**Time.** 10s (hold as the exit screen)

---

## Timing budget

#SlideTargetS1Title0:15S2The stack you already have0:15S3Layer tour: Human0:12S4Layer tour: Inference0:15S5Layer tour: Codebase0:12S6Let's say you're working on your plan0:15S7Friction0:20S8"Done."0:10S9You go and look0:12S10Human backpressure0:20S11And then it's gone0:20S12Multiply it0:20S13The two questions0:15S14What we need0:15S15The missing piece0:25S16It has a name0:25S17Life with it: PR time0:20S18Fix the check, then the code0:20S19Finale: compounding0:25**Total5:31**

**If running long:** S12 can merge into S11 as one extra step that multiplies the lanes (−20s); the layer tours (S3 to S5) compress naturally to \~10s each at talking pace (−9s); S14 can fold into S13 as a third step (−15s). All together gets to \~4:47. If it must go shorter, S17/S18 can compress to one slide by cutting the PR-card setup and opening on the reviewer's bubble (−15s), but prefer keeping both: the vignette is the deck's proof moment. **Protected beats:** S8→S9 (the done/not-done one-two), S11 (the loss), S15 (the layer reveal), and the S17→S18 vignette (the proof that the harness improves the workflow even when the check is wrong) must not be cut or rushed; the deck is those moments. S5's clutter is also load-bearing (it pays off in S16).

---

## HTML deck architecture (build plan)

Single self-contained HTML file, `docs/harness-presentations/missing-layer-101/missing-layer-101.html`, designed so slides can be added, removed, and reordered by moving one `<section>` block and nothing else. Brand assets (`McQueen-Regular.woff2`, `McQueen-SemiBold.woff2`) live in `docs/harness-presentations/nucleus-assets/` so the deck is self-sufficient in this folder.

- **Stage:** reuse the title-card comp's 16:9 stage pattern verbatim (content-box border trick, `container-type: size`, cq units) so capture and scaling behaviour is identical. One stage; slides live inside it.
- **Slide unit:** each slide is one `<section class="slide" id="s-stack" data-title="The stack">…</section>`. All of a slide's markup lives inside its section; all of its CSS is scoped under its id (`#s-stack .plate {…}`). No slide references another slide's DOM. Cross-slide "continuity" (e.g. S8's end-state appearing at the start of S9) is done by *recreating* the visual in the new slide, never by sharing nodes.
- **Steps:** presenter-advanced reveals are elements carrying `data-step="1"`, `data-step="2"`, … inside the slide. The controller adds `.on` to every element whose step ≤ current step. All motion is CSS keyed off `.slide.active` and `.on`, so `prefers-reduced-motion` can kill it globally.
- **Controller (small, generic, \~60 lines):** collects `document.querySelectorAll('.slide')` in DOM order at load (no hardcoded count or order anywhere). `→`/`space`/click = next step, or next slide when steps exhausted; `←` = back; `Home`/`End` jump. Maintains `location.hash` as `#s-stack/2` (slide id + step) for deep-linking and refresh-resume. Renders progress dots from the collected list. Reordering sections automatically reorders navigation, dots, and hashes.
- **Shared design tokens:** one `:root` block (brand colors, fonts, easing curves) + a small shared component layer (`.plate`, `.agent-chip`, `.human-chip`, `.particles`, `.termstrip`, `.kicker`, `.stamp`, `.artifact-card`) so per-slide CSS stays thin and the cast looks identical everywhere. The layer-tour slides (S3 to S5) share one layout template (`.layer-tour` header band + artifact field) with per-slide content only.
- **Ambient vs stepped animation:** entry/ambient animations (orbits, breathing, token tickers, finale particle rain) run on `.slide.active` via CSS `animation`; stepped reveals are `transition`s triggered by `.on`. Particle effects are DOM spans with CSS animations, no canvas, to keep it dead simple and reduced-motion-safe.
- **Verification:** puppeteer screenshot sweep per slide per step (same harness as the loop.html/layers.html scripts), never opening a local browser.

## Next deliverable (queued, not started)

**“Introduction to Harness Engineering Fundamentals”** one-to-two pager. Plan: derive it from this deck's arc because the lived-experience framing is the simplest explanation we have. Skeleton: (1) the day everyone recognises (S6 to S11 in \~6 sentences), (2) the two questions, (3) the missing layer in one diagram and one paragraph, (4) what a harness is in plain words (simple view over the complex; discover/prove/improve), (5) what changes for a team that has one. Keep canonical layer names consistent with `docs/harness-presentations/missing-layer-101/intro-to-harness.md`; do not fork wording for layer definitions, simplify by *omission* not by *rephrasing*.

## Open questions for iteration

1. **Title:** "The Missing Layer" vs plain "Engineering Harness 101". The title card currently proposes 101 as the H1 with the missing-layer line in the sub.
2. **Tone of S7 comedy:** how silly can the confused agent be for this audience? Current spec is mild (wobble + `?` bubble).
3. **Layer-tour representations (S3 to S5):** current artifact lists are proposals; swap in anything more org-resonant (e.g. real-ish script names) if there are safe ones.
4. **S12 lane count:** 6 to 8 lanes reads as "everyone" without chaos; could go denser for effect.
5. **S16 command names:** `boot` / `test` / `smoke checkout-flow` are generic-plausible; happy to swap in org-resonant examples if there are safe ones.
6. **S18 rule example:** the typed-in rule is deliberately generic (`+ rule: <the thing the reviewer saw>`); a concrete-but-safe example (e.g. a layering rule like `domain must not import UI`) would land harder if one fits the audience.
7. **Presenter notes in-deck:** talk track lives here in the run sheet; an optional `?notes` overlay in the HTML is easy to add if wanted.