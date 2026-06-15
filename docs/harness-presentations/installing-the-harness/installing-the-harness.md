# Installing the Harness — run sheet

**Deck:** Engineering Harness 101 — Installing the Harness (brand-tailored). **Working title:** _Installing the Harness_ (placeholder, easy to change). **Companion HTML (to build):** `docs/harness-presentations/installing-the-harness/installing-the-harness.html` — **copy the missing-layer deck's opener/stage verbatim and modify** (same stage, tokens, orbit title card); fonts via the shared `../nucleus-assets/` (McQueen). **Length target:** under 5 minutes, presenter talking over animated slides. Many short, single-moment slides, one beat each. **Relationship to the other decks:** _The Missing Layer_ (`../missing-layer-101/`) argues *why* the deterministic layer is missing; this deck shows *how* a team installs and adopts it.

> **Process note.** Slides are pulled out here first (Frame / On-slide copy / Talk track / Beats / Time). **Animation is a one-line seed only** — detailed choreography is the next pass, designed slide-by-slide with feedback, the same way the missing-layer deck was built. Pipeline, timing model, cue conventions and gotchas: `../EDITING.md`. Build target with `--pres installing-the-harness`.

---

## The arc in one paragraph

- Intro screen, just like the preview video. This one is installing the harness in to your code base.
- First, a let's see what the the harness physically is.
- It is a cli and a skill.
- The cli is installed with npm and is available machine wide
- A special extension system allows you to customise the harness per repo! This way the core of the harness can be updated and maintained, with improvements shared between all teams. but the harness is highly tuneable to your own repo.
- Installation is easy, you can either run the npm command yourself, or you can just ask your agent to read agent_readme.md (link to full gh repo on screen).
- Once adopted the only mandatory change will be the creation of a .harness folder, where extensions and other content is housed. 
- once this is done, depending on your coding agent you may need to reload the skills (in copilot cli you can type /skills reload). 
- Now, the engingginer harness flow will walk you through adopting your repo. 
- First a harnessability skill will run, to look at all the ways that a harness might work with your existing codebase. It will report on strengths and weaknesses. 
- The agent will then use this report to suggest the creation of your first extension. 
- "The boot extension"
- All harness loops start with teh boot extension, this checks the repo is ready for agentic work. It will do something differnt in every repo. At its core though, it checks the code is building, that any services that are needed can work and more besides. Over time it wil grow in complexity. 
- For now though we just need this one extenions
- "Creating an extension"
- Creating a new extenion is easy, hte cli will do most the work! Let the agent guide you thoough this process. 
- "The engineering harness loop"
- as part of the install the agent will ask you if you want to use the harness's build in flow - called "the-flow" of if you would like to BYO spec driven flow system. 
- If you want to use the built in one, its very simple - just type /the-flow <problem> for example /the-flow please pull this jira ticket and begin work. 
- If you want to BYO workflow then there are a fwe things to know. 
- It's very easy, theer is just one skill to call at various times. 
- first, after before your plan phase and before you start any work you should run /eng-harness-flow. This will ensure the harness is ready to go
- Then once the plan is written you shoudl as /eng-harness-flow to validate back pressure. This will ensure the harness has the capbilites needed help you prove your work is properly complete in a deterministic manner. It may suggest extra work to do on the harness itself before you start your main work. 
- 
- You go and implement your code...  once the work is done you shoudl call /eng-harness-loop again! This will help collect information about how the harness went and provide suggestions on what could be better! This is the self improving loop, a concept that deserves its own video.  
- 

### Beat map (the spine to protect under time pressure)

1. **Open** — same title card, new chapter: we are *installing*, not explaining (S1)
2. **What it is** — two humble things: a CLI and a skill (S2 → S3); a shared core with per-repo extensions (S4)
3. **Install it** — two ways (you, or your agent); one folder appears; reload skills (S5 → S7)
4. **Adopt your repo** — the flow surveys the land (harnessability), then suggests your first extension (S8 → S10)
5. **The boot extension** — every loop starts here; and creating one is easy (S11 → S12)
6. **Work with it** — choose the built-in `the-flow`, or BYO with one skill called at three moments (S13 → S18)
7. **Close** — the `?` orbiter resolves into `your harness`; happy harnessing (S19)

---

## Cast & visual language

- **Voice — this is the big change from the last deck.** The narration is a **nature documentary**: a calm, kindly, slightly wondrous old naturalist (think David Attenborough) observing a harness arrive and take root in the wild of a real repository. Warm, unhurried, present-tense, a little awe. The repo is a *habitat*; the agent and the harness are *creatures* we watch with affection. Every talk track below is written in this voice — keep it consistent and never sales-y.
- **Inherited brand + stage (verbatim from `../missing-layer-101/`):** Purple `#7B14EF` stage, Lavender `#C497FE`, Mauve `#EBDCFD`, ink, white. McQueen SemiBold headings, McQueen Regular pull-outs, Inter body, mono for terminal chrome. **No em dashes in branded on-slide copy.** Same 16:9 bordered stage, container-query sizing, so capture is identical.
- **Inherited cast:** the **agent chip** (`>_` face, status eyes, ambient blink) and the **human `you` chip** carry over unchanged, so the audience stays bound to them. Reuse the **codebase clutter** from the old S5 as *the terrain / habitat* the harness moves across.
- **Opener + closer (reused):** the orbit **title card** bookends the deck. Orbit cast `you` / `the agent` / `your codebase` / `?`; the `?` orbiter is the thread this deck resolves — it crossfades into `your harness` at the sign-off (S19), wearing the harness plate's dress (ink, lavender border, soft glow).
- **New motifs (install-specific):**
  - **The harness as two objects** — a **CLI** (a small terminal object, `harness ▸`) and a **skill** (a skill card). They appear together; a tether binds them.
  - **Core vs extensions** — a central **core** object (shared, maintained; improvement sparks rain into it) with **extension cartridges** that slot into per-repo slots around it. This is the "one heart, many shapes" picture.
  - **`.harness/` folder** — a new shoot in the repo's file tree; the only thing that changes.
  - **The boot extension** — an ignition object; checks light up one by one to *ready*, with a hint of future checks waiting (it grows over time).
  - **The improvement particle (reused, reversed)** — learnings/suggestions render as lavender particles that *settle into* the harness (S17/S18), the same motif the last deck ended on.
- **Scene choreography rule (unchanged):** every slide is a *scene with a clock*, autoplaying its full scene then settling into an ambient loop; objects are *born from their source*; no presenter steps by default. Detailed choreography is designed per-slide in the next pass.

---

## Slides

> Each slide lists **Frame** (why it exists), **On-slide copy** (minimal, brand-safe), **Talk track** (the spoken words, in the documentary voice — this is what TTS reads), **Beats** (must-land points), **Animation** (one-line seed; full pass later), **Time**. Slide ids (`s-xxx`) become the HTML section id and the narration/clip stem.

---

### S1 · Title — Installing the Harness  <!-- id: s-title -->

**Frame.** Copy the missing-layer title card verbatim (stage, tags, McQueen headline, orbit nucleus, termbar) and retitle for this chapter. Same series, same orbit cast, so the `?` orbiter can resolve to `your harness` at the close. This is where the documentary voice is established.

**On-slide copy.**

- Tags: `Engineering Harness` + flag `A Field Guide`
- H1: `Installing<br>the<br>HARNESS.` (hero word in **outlined CAPS** + lavender full stop; lowercase can't outline cleanly in McQueen — the `e` aperture breaks the stroke, so the outlined word is set uppercase. Series mark `101` optional, see open Q)
- Sub: `How a real codebase grows the layer it was missing.`
- Footer termbar: `$ [ one repo ] + [ one command ] = a harness takes root ▍`

**Talk track.** "In every working codebase, there is a quiet gap where something ought to be. Today, we watch that gap be filled. This is the story of installing an engineering harness: how, in just a few small steps, an ordinary repository grows the very layer it has been missing all along."

**Beats.**

- Same opener, new chapter: installing, not explaining
- Establish the kindly documentary voice
- Promise: by the end, the harness is installed and adopted

**Animation.** Inherited orbit nucleus, unchanged: three dashed rings, counter-rotating pills (`you` white, `the agent` lavender, `your codebase` mauve, `?` ghost), `corepulse` core (`>_` / `one piece of work`), `ghostPing` on the `?` every 4.5s. Spins from frame 0. Entry on the narration clock: orbit already turning; tags `fadeup` first; H1 `Installing / the / Harness.` rises with the stroked-outline treatment, and the **lavender full stop clicks in solid on the spoken word "harness"** (the `n101Fill` / `harness.` trick); sub fades up; termbar **self-types** `$ [ one repo ] + [ one command ] = a harness takes root ▍` via `typeOn`, cursor blinks forever. **New flourish (the secret):** on the opening line ("a quiet gap where something ought to be…") the `?` ghost does one slightly deeper `ghostPing` and **drifts a hair inward toward the core, then eases back** — the one orbiter curious about the gap, a plant the viewer only decodes after S19 resolves `?` → `your harness`. Ambient hold: orbit spins, core pulses, `?` pings, cursor blinks.

**Time.** 15s

---

### S2 · What it actually is  <!-- id: s-what -->

**Frame.** Demystify before installing. The harness is not a framework or a vibe; it is two tangible things, revealed as two simple objects on the stage: a command-line tool and a skill.

**On-slide copy.**

- Kicker: `First, what is it?`
- Two objects: a terminal `the CLI` (`harness ▸`) and a skill card `the skill`
- Caption chip: `two simple things`

**Talk track.** "But before we install anything, let us look closely at the creature itself. For all its reputation, the harness is a humble thing. It is, in truth, just two parts. A command line tool. And a skill, that your agent already knows how to use. That is all. Two simple things, working quietly together."

**Beats.**

- The harness = a CLI + a skill (nothing mystical)
- Deliberately small and concrete

**Animation.** Two plain objects on a bare purple stage, rising from centre (quiet match-cut from where the S1 orbit core sat). Kicker `First, what is it?` fades up top-left. **The CLI** — a small terminal object (mono chrome, `>` prompt reading `harness ▸`, blinking cursor) glides in **left** (`cardGlide` + `--glide`) on *"a command line tool"*, clean settle, no bounce. **The skill** — a rounded lavender-edged card with a small `✦` glyph, label `the skill`, glides in **right** on *"and a skill."* On *"working quietly together,"* a tether draws between them (`spDraw`) and a single lavender packet travels back and forth along it, slow and even. Caption `two simple things` stamps in last (`stampShake`) on the spoken words. **The life (craft, no metaphor):** once tethered, the CLI's cursor blink and the skill card's lavender glow fall onto the same `--TRIP` clock and pulse in unison — "two things, one tool." Secret: they don't start synced; the skill glow ticks, the CLI cursor answers a beat later, then they lock. Agent stays off-stage (its proper entrance is the adoption act, S8). Ambient hold: the shared pulse, the packet drifting the tether, cursor blink.

**Time.** 12s

---

### S3 · The CLI  <!-- id: s-cli -->

**Frame.** The first part up close. Installed once with npm, it lives machine-wide, available in every repository you visit.

**On-slide copy.**

- Header: `The CLI`
- Terminal strip: `$ npm install -g <harness-cli>` → `harness ✓ available everywhere`  *(exact package name TBD, see open Q3)*
- Sub: `installed once · lives machine wide`

**Talk track.** "The first part is the command line tool. It is installed just once, with a single npm command, and from that moment it lives across your whole machine, waiting patiently in every repository you wander into. One install, and the tool is simply there, wherever you go."

**Beats.**

- npm install, machine-wide
- Install once, available everywhere

**Animation.** Header `The CLI` fades up top-left; the terminal object (left-centre) **self-types** `$ npm install -g <harness-cli>` (`cliType` steps), then on the spoken beat the output `harness ✓ available everywhere` fades in beneath it. **Machine-wide propagation:** five ghosted repo tiles (`api`, `web`, `infra`, `mobile`, `docs`) sit scattered across the right; a lavender `harness` mark fans out from the terminal's right edge to each (`cliFan`, staggered ~0.22s), and each tile lights with a `harness ✓` badge as its mark lands (`badgePop` + `tileLit` brighten). Sub `installed once · lives machine wide` fades up. **The secret:** a sixth far tile, `a new repo`, stays dark while the others light; near the end a white `you` pill **hops in** to it (`youHop`), and its `harness ✓` badge pops ~0.5s *before* `you` lands — the tool was already there. Built & verified via snap. Ambient: terminal cursor blink. *(Placeholder `--cue-*` until narration; re-align from `003-s-cli.words.json`.)*

**Time.** 12s

---

### S4 · The extension system  <!-- id: s-ext -->

**Frame.** The most important concept of the whole install. The CLI's **core** is shared and centrally maintained, so improvements reach every team, while a per-repo **extension** system tunes the harness to each codebase. One heart, many shapes — maintainable *and* bespoke.

**On-slide copy.**

- Header: `One core, many shapes`
- A central `core` (maintained; improvement sparks flowing in) with `extension` cartridges slotting into repo-shaped slots
- Sub: `core: shared and maintained · extensions: tuned to your repo`

**Talk track.** "Now, here is the clever part. The heart of the harness, its core, is shared. It is maintained and improved centrally, and every team inherits those improvements as they arrive. But each repository is its own world. So the harness carries an extension system: a way to tune itself, precisely, to the codebase it finds itself in. A shared heart. And a local shape. The best of both."

**Beats.**

- Core is shared + centrally maintained (improvements shared across teams)
- Extensions tune the harness per repo
- Maintainable AND bespoke

**Animation.** Header `One core, many shapes` fades up. The **core** bounces into centre — an ink hub carrying the `>_` mark and `core` label (continuity with the orbit core), breathing a lavender glow. **Improvement sparks** rain continuously from above *into* the core (`sparkFall`, staggered) — "maintained centrally." Four **extension cartridges** (`tests`, `db schema`, `lint rules`, `smoke`) slide into slots around it, each a subtly different silhouette (the "many shapes"); faint tethers connect each to the core. **The load-bearing beat:** on the shared `--TRIP` clock the core breathes, then an inheritance ripple runs OUT along the tethers (`tlFlash`) and each cartridge glows in turn (`extGlow`, staggered) — improvement in the middle, everyone inherits it. A dashed `+ add another` slot waits below (extensibility is ongoing). Built & verified via snap. *(Placeholder cues until narration aligned.)*

**Time.** 16s

---

### S5 · Installing is easy  <!-- id: s-install -->

**Frame.** Installing into YOUR repo is easy, with two paths: run the command yourself, or simply ask your agent to read `agent_readme.md`. Show both paths. (No repo URL on screen — the live repo URL differs per presentation.)

**On-slide copy.**

- Header: `Installing is easy`
- Path A · `you`: `$ <harness init command>`
- Path B · `your agent`: `"read agent_readme.md"`
- Sub: `do it yourself, or let the agent do it`

**Talk track.** "Installing it into your own repository could hardly be easier, and you may choose your path. You might run the command yourself, by hand. Or, you might simply turn to your agent and ask it to read the readme, and the agent, ever obliging, does the rest for you. Either way, the work is small."

**Beats.**

- Two install paths: human-run, or agent-run via agent_readme.md
- It is genuinely easy

**Animation (built & verified).** Header `Installing is easy`. Two lanes resolve to the **same outcome**. **Lane A · you** (upper): the `you` chip, a terminal that self-types `$ <harness init>`, cursor blinking. **Lane B · your agent** (lower): the `agent` chip (ambient blink), an `agent_readme.md` doc card; a lavender scan beam sweeps down the doc as the agent reads it, the chip glows while it works, then it acts *for* you. Each lane sends a pulse rightward along its arrow into a shared **`installed ✓`** node, which pops when they arrive. Sub `do it yourself, or let the agent do it`. **The secret:** the agent's pulse reaches the outcome a half-beat *before* the manual one — quietly saying the agent path is the easy one — then the node lights as both land. **No repo URL on screen** (removed — the live repo URL differs per presentation). Built & verified via snap. *(Placeholder cues; command is open Q3.)*

**Time.** 14s

---

### S6 · The only mandatory change  <!-- id: s-folder -->

**Frame.** Reassure: adoption disturbs almost nothing. The one required change is a new `.harness/` folder, the home for extensions and harness content.

**On-slide copy.**

- Header: `The only mandatory change`
- A file tree with `.harness/` appearing (new), unfolding to `extensions/`, `…`
- Sub: `one new folder · everything harness lives here`

**Talk track.** "And what does all this cost your repository? Remarkably little. The only change it must accept is a single new folder, named dot-harness. This is where the harness makes its home: its extensions, its configuration, everything it needs, kept tidily in one place. One folder. Nothing else is disturbed."

**Beats.**

- Only mandatory change = a `.harness/` folder
- It houses extensions + harness content
- Minimal footprint (reassurance)

**Animation (built & verified).** Header `The only mandatory change`. A calm repo **file tree** is present (`src/`, `tests/`, `package.json`, `README.md`, `Dockerfile`), settled and still. A new **`.harness/`** row slides in highlighted (lavender), with a soft "new" pulse, then **unfolds its children** indented beneath it (`extensions/`, `config.yml`, a faint `…`). As `.harness/` lights, the rest of the tree dims a touch — the visual reading of "nothing else is disturbed." Sub `one new folder · everything harness lives here`. **The secret:** the existing files give the faintest settle as the new row makes room, then go perfectly still — only `.harness/` ever moves. *(Placeholder cues.)*

**Time.** 12s

---

### S7 · One small nudge  <!-- id: s-reload -->

**Frame.** A small practical step: depending on your coding agent, you may need to reload skills so the harness skill is picked up. Short utility slide (merge candidate — see open Q).

**On-slide copy.**

- Header: `One small nudge`
- Terminal: `/skills reload`  *(note: e.g. Copilot CLI)*
- Sub: `so your agent notices its new skill`

**Talk track.** "One small piece of housekeeping. Depending on which coding agent you keep, you may need to give it a gentle nudge, so that it notices its new skill. In Copilot's command line, for instance, a simple reload will do. A little thing, and easily forgotten."

**Beats.**

- May need to reload skills (agent-dependent)
- Example: `/skills reload` in Copilot CLI

**Animation (built & verified).** Header `One small nudge`. Centre: the **agent chip** (eyes `··`) beside a **harness skill card** (the `✦`) that sits *dim* — the agent hasn't noticed it yet. A compact terminal **self-types** `/skills reload` (small note: `e.g. Copilot CLI`). On the reload, the skill card **flickers, then lights up** (border + glow), a `loaded ✓` badge pops, and the agent's eyes flip to `^^` — it has noticed its new skill. Sub `so your agent notices its new skill`. Short, single-beat utility slide. *(Open Q6: standalone or fold into S6 — kept standalone for now.)* *(Placeholder cues.)*

**Time.** 8s

---

### S8 · Now, adoption  <!-- id: s-adopt -->

**Frame.** Transition into the guided part. With the tool present and the folder made, the engineering-harness **flow** now walks you through adopting your specific repo. The harness gets to know its new home. (Naming: "the engineering harness flow" — confirm vs `the-flow`, open Q.)

**On-slide copy.**

- Kicker: `Now, adoption`
- A guiding path threads into the repo (the terrain/habitat)
- Sub: `the flow walks you through it`

**Talk track.** "With the tool in place, and the folder made, the real work begins. Adoption. The harness now sets out to learn this particular repository, its quirks and its character, guided by a flow that walks you through it, step by patient step. Let us follow along."

**Beats.**

- The install flow now guides adoption of your repo
- Transition into the guided steps

**Animation (built & verified).** Kicker `Now, adoption`. On the right, the **codebase** appears as a loose constellation of repo cards (`src/`, `api/`, `web/`, `tests/`, `infra/`, `db/`), settled and calm. A **dashed guiding path** threads in from the lower-left toward the codebase, its dashes marching forward, with a few lit **step stones** along it. The **agent chip** pops in at the path's start and bobs gently, poised to walk it. Sub `the flow walks you through it`. A quiet transition beat, the threshold of the guided part. *(Placeholder cues.)*

**Time.** 10s

---

### S9 · Harnessability  <!-- id: s-scan -->

**Frame.** First adoption step: a *harnessability* skill surveys the existing codebase — all the ways a harness could work with it — and reports strengths and weaknesses. The naturalist studies the terrain before acting.

**On-slide copy.**

- Header: `Harnessability`
- A scan sweeping the codebase clutter (the terrain)
- A report: `strengths ▸ …` / `weaknesses ▸ …`
- Sub: `how well can a harness live here?`

**Talk track.** "Its first instinct is not to build, but to observe. A harnessability survey moves quietly across the codebase, studying every way a harness might take hold here. And when it is done, it reports back, honestly. Here, your strengths. And here, more delicately, your weaknesses. The lay of the land, mapped, before a single step is taken."

**Beats.**

- Harnessability skill surveys the codebase first
- Reports strengths AND weaknesses
- Observe before building

**Animation (built & verified).** Header `Harnessability`. Left: the **codebase** as a constellation of file cards (`src/`, `api/`, `tests/`, `db/`, `ci.yml`, `Dockerfile`, `web/`). A lavender **scan beam sweeps** across it (twice). As it passes, a **report card** on the right fills row by row: a `strengths` group (lavender ▸ markers: `clear build`, `typed code`, `has tests`), then more gently a `weaknesses` group (mauve ▸ markers: `flaky env`, `slow setup`, `no smoke checks`) — honest, never alarmist, no off-brand red. Sub `how well can a harness live here?`. Observe before building. *(Generic-plausible findings, swap per open Q8; placeholder cues.)*

**Time.** 15s

---

### S10 · Your first extension  <!-- id: s-first -->

**Frame.** Bridge into the boot extension. From the report, the agent suggests your *first* extension, and almost always points to the same place to begin.

**On-slide copy.**

- Header: `Your first extension`
- Report → arrow → a single proposed extension card; agent chip presenting it
- Sub: `the report points the way`

**Talk track.** "From that map, a recommendation emerges. The agent reads its own survey, and gently suggests where to begin: your very first extension. And almost always, it points to the same humble starting place."

**Beats.**

- Agent uses the report to suggest the first extension
- Tee up the boot extension

**Animation (built & verified).** Continuity bridge from S9: a condensed `harnessability` report card (echo of the previous slide) sits left and settles, then at the read cue its rows dim and it collapses inward while a flowing `▸▸▸` connector carries the recommendation rightward. A single proposed extension card pops in (popIn) on the right, lavender-lit with a glow and a `recommended` badge (badgePop). The agent chip appears just after, presenting it with a gentle bob and eyes on the shared ambient blink. Sub `the report points the way` fades up last. Cues: head .3s · report .8s · flow 2.0s · fold/dim 2.6s · ext-card 2.8s · agent 3.2s · sub 3.8s.

**Time.** 10s

---

### S11 · The boot extension  <!-- id: s-boot -->

**Frame.** Name and explain the foundational extension. Every harness loop begins with the boot extension: it checks the repo is ready for agentic work. Different in every repo, but at its core it confirms the code builds, required services can run, and more — and it grows in complexity over time. For now, this one is all you need.

**On-slide copy.**

- Hero: `The boot extension`
- An ignition object; a checklist filling: `builds ✓ · services up ✓ · …`
- Sub: `every loop starts here · is the repo ready?`
- Small note: `different in every repo · grows over time`

**Talk track.** "And so we meet the first, and most important, of them all. The boot extension. Every harness loop, without exception, begins here. Its task is to ask one simple question: is this repository ready for work? In every codebase the answer looks a little different. But at its heart, it checks that the code still builds, that the services it needs can wake and run, and a good deal more besides. Modest, at first. But it will grow, in time, into something far more capable. For now, though, this single extension is all we need."

**Beats.**

- All harness loops start with the boot extension
- Verifies the repo is ready for agentic work (builds, services, more)
- Different per repo; grows over time
- For now, this one extension is enough

**Animation (built & verified).** Ignition object: a circular boot core (power glyph) appears and idles with a faint breath; a progress ring around it fills in four discrete steps (SVG stroke-dashoffset, steps(4)) as the checklist beside it lights one row at a time — `builds`, `services up`, `migrations`, `health ok` each crossfading from a dim `○` to a lavender `✓` with the row text brightening. When the fourth check lands the core ignites (glow ramp) and a `ready` badge pops (badgePop). Below, two ghosted future rows (`smoke …`, `+ more over time`) pulse faintly (faintPulse) as the hint of checks still to come. Sub `every loop starts here · is the repo ready?` and the small note `different in every repo · grows over time` fade in around the question and the growth beat. Cues: head .3s · core 1.0s · sub 5.0s · checks 7.0 / 8.4 / 9.8 / 11.2s · ready 12.6s · note 13.5s. (Q8: example checks are generic-plausible; swap in org-resonant ones when known.)

**Time.** 20s

---

### S12 · Creating an extension  <!-- id: s-create -->

**Frame.** Show how approachable authoring is. Creating a new extension is mostly done *for* you — the CLI scaffolds it, and the agent guides you through it.

**On-slide copy.**

- Header: `Creating an extension`
- Terminal: `$ <harness extension new>` → files appear in `.harness/extensions/`  *(confirm command, open Q3)*
- Agent chip guiding
- Sub: `the CLI does most of the work · the agent guides you`

**Talk track.** "You might imagine that building one of these would be a daunting affair. It is not. The command line tool does the greater part of the work for you, laying out each piece, while the agent walks beside you, guiding every choice. You need only follow along, and an extension takes shape, almost on its own."

**Beats.**

- Creating an extension is easy
- The CLI scaffolds most of it; the agent guides you

**Animation (built & verified).** A terminal pops (popIn) and self-types `$ harness extension new` (cliType), then an output line `scaffolding ▸ .harness/extensions/` fades in. A mini file tree to the right unfolds the scaffolded files one row at a time (childIn): `my-extension/` → `extension.yml` → `run.cjs` → `README.md`. The agent chip stands beside the tree guiding, with a small `▸` pointer and a gentle bob, eyes on the ambient blink. Sub `the CLI does most of the work · the agent guides you` fades up last. Cues: head .3s · term .9s · type 1.4s · agent 3.0s · scaffold 3.2s · files 3.6 / 4.2 / 4.8 / 5.4s · sub 6.2s. (On-slide command `harness extension new` is the Q3 placeholder — one string to swap once locked.)

**Time.** 14s

---

### S13 · How do you want to work?  <!-- id: s-flow -->

**Frame.** The fork. As part of install, the agent asks how you want to work day-to-day: use the harness's built-in flow (`the-flow`), or bring your own spec-driven workflow. The next slides cover each branch.

**On-slide copy.**

- Header: `How do you want to work?`
- Two doors: `the-flow` (built in) · `BYO` (bring your own spec-driven flow)
- Sub: `the agent asks during install`

**Talk track.** "With the harness rooted, one last question remains, and the agent will put it to you. How would you like to work, from here on? You may use the harness's own built-in flow, which it calls, simply, the-flow. Or you may bring your own. Both are equally welcome. Let us look at each, in turn."

**Beats.**

- Install asks: built-in `the-flow` vs BYO workflow
- Both supported
- Tee up the two branches

**Animation (built & verified).** The agent chip asks from top-centre (popIn) with a faint `?`; two dashed paths fork down to either side (SVG, dashFlow marching) into two doorway cards that pop in — `the-flow · built in` (left) and `BYO · bring your own` (right), given equal lavender weight so neither reads as preferred. Both doors breathe gently once settled. Sub `the agent asks during install` fades up last. Cues: head .3s · agent 1.0s · fork 2.0s · left door 2.8s · right door 3.2s · sub 4.2s.

**Time.** 12s

---

### S14 · the-flow  <!-- id: s-theflow -->

**Frame.** Branch A. Beautifully simple: one command with your problem in plain words, and the harness drives the whole spec-driven flow. Show the Jira example.

**On-slide copy.**

- Header: `the-flow`
- Terminal: `$ /the-flow pull this Jira ticket and begin work`
- Sub: `one command · plain words · it carries it through`

**Talk track.** "The built-in path is the simpler of the two. You type the-flow, and then, in plain words, whatever it is you need. Pull this ticket, and begin the work. And that is all. The harness takes your request and carries it the whole way through, from spec, to plan, to finished change. There is nothing more to learn."

**Beats.**

- `/the-flow <problem>` in plain language
- Example: pull a Jira ticket and begin
- It drives the whole spec-driven flow

**Animation (built & verified).** A terminal pops and self-types `$ /the-flow pull this Jira ticket and begin work` (cliType, 46ch). Below it the canonical four-stage pipeline `research → plan → implement → validate` appears; once the command lands a pulse runs the chain, lighting each stage in turn (lavender), the final `validate` settling with a ✓ and a glow. (This is `the-flow`'s shape — the same shape S15 shows for a bring-your-own flow.) Sub `one command · plain words · it carries it through` fades up last. Cues: head .3s · term .9s · type 1.4s · pipeline 4.2s · stages 4.8 / 5.7 / 6.6 / 7.5s · sub 8.4s.

**Time.** 12s

---

### S15 · Bring your own  <!-- id: s-byo -->

**Frame.** Branch B, and the unifier. A bring-your-own spec-driven workflow has the same canonical shape as `the-flow` — *research → plan → implement → validate* — so whether you took the built-in path or your own, the harness asks only one small thing: **one skill, `/eng-harness-flow`**, called at the same few moments. (Naming RESOLVED — see open Q1: one skill, `/eng-harness-flow`, plugs into either flow.)

**On-slide copy.**

- Header: `Bring your own`
- The canonical flow timeline `research → plan → implement → validate` with three `/eng-harness-flow` plug-in markers
- Sub: `the-flow or your own · eng-harness-flow plugs in here`

**Talk track.** "Perhaps, though, you already have a workflow you have grown fond of. The harness does not mind in the least. Your flow has the same shape as its own — research, plan, implement, validate — so it asks only one small thing of you, either way: a single skill, eng-harness-flow, called at a few key moments along the way. Just three, in fact. Let us see when each one falls."

**Beats.**

- BYO workflow is fully supported
- It is ONE skill, called at a few points
- Three moments, coming up

**Animation (built & verified).** The canonical flow timeline draws in (`research → plan → implement → validate`) in muted tones — the same shape for the-flow or your own; then three lavender call-out markers light at three points along it, each reading `/eng-harness-flow` with its moment beneath (`before work`, `after the plan`, `after the work`), popping in with a stem down to the line (staggered). The repeated token makes the "one skill, three moments" point visible. Sub `the-flow or your own · eng-harness-flow plugs in here` fades up last. Cues: head .3s · line 1.2s · nodes 1.8s · markers 3.4 / 4.6 / 5.8s · sub 6.8s.

**Time.** 12s

---

### S16 · Moment one · before work  <!-- id: s-before -->

**Frame.** BYO call-site 1. Before the plan phase, before any work, call the skill to make sure the harness is ready. The pre-flight check.

**On-slide copy.**

- Kicker: `Moment one · before work`
- Terminal: `$ /eng-harness-flow`
- Sub: `is the harness ready? · run before planning`

**Talk track.** "The first moment comes early, before you have planned a single thing. You call the skill, and it makes certain the harness is awake, and ready for the journey ahead. A pre-flight check, if you like, before the real work begins."

**Beats.**

- Call before plan / before work
- Ensures the harness is ready to go

**Animation (built & verified, VO-aligned).** Kicker top-left. A terminal pops and self-types `$ /eng-harness-flow` (cliType, 17ch); an output line `pre-flight ▸ ready` fades in. A two-row pre-flight checklist ticks green one at a time (`harness awake`, `repo ready` — dim `○` crossfades to lavender `✓`, the row brightening). Then the path ahead lights: a row of `▸▸▸` chevrons flows toward a `begin` marker (flowPulse). Sub `is the harness ready? · run before planning` fades up last. Cues keyed to recorded VO (narration/016-s-before).

**Time.** 12s

---

### S17 · Moment two · validate backpressure  <!-- id: s-validate -->

**Frame.** BYO call-site 2, and the key "encode done-ness" beat. Once the plan is written, call the skill again to validate backpressure: confirm the harness can prove your work is properly, deterministically complete. It may suggest improving the harness itself *before* the main work begins.

**On-slide copy.**

- Kicker: `Moment two · after the plan`
- Terminal: `$ /eng-harness-flow` → `validating backpressure…` → `suggest: add check ▸ …`
- Sub: `can we prove this is done? · may improve the harness first`

**Talk track.** "The second moment arrives once your plan is written. You call the skill again, and this time it looks further ahead, asking a harder question. When this work is finished, will we be able to prove it? Deterministically, beyond all doubt? If the harness is not yet equipped to do so, it will say so, plainly. And it may suggest you strengthen the harness itself, first, before the main work begins. A little preparation now, to make the proof possible later."

**Beats.**

- Call after the plan is written
- Validates backpressure: can completion be proven deterministically?
- May recommend improving the harness BEFORE the main work

**Animation (built & verified, VO-aligned).** Kicker top-left. Terminal self-types `$ /eng-harness-flow`, then outputs `validating backpressure…` and, a beat later, `suggest: add check ▸ smoke`. A horizontal backpressure gauge fills partway and stalls (not yet provable), its marker pulsing at the gap. A suggested `+ smoke check` cartridge then surfaces and slides into a small harness core (`>_ harness`), which glows as it accepts the new check. Sub `can we prove this is done? · may improve the harness first` fades up last. Cues keyed to recorded VO (narration/017-s-validate).

**Time.** 18s

---

### S18 · Moment three · the self-improving loop  <!-- id: s-loop -->

**Frame.** BYO call-site 3, and the emotional close of the how-to. You implement your code; when the work is done, call the skill once more. It gathers how the harness performed and suggests what could be better — the self-improving loop. Name it as a marvel worthy of its own film (tee a sequel).

**On-slide copy.**

- Kicker: `Moment three · after the work`
- Terminal: `$ /eng-harness-flow` → `how did the harness do? ▸ suggestions…`
- Sub: `it learns from the run · the self improving loop`
- Small tag: `a story for another day`

**Talk track.** "And the third moment comes at the very end. You have written your code; the work is done. You call the skill one final time, and now it turns to reflect. How did the harness fare? What slowed it? What could be better? It gathers up what it learned, and offers its suggestions, so that next time, the harness is a little wiser than it was before. This is the self-improving loop. A quiet, compounding marvel. But that, dear viewer, is a story for another day."

**Beats.**

- Call after the work is done
- Collects how the harness performed; suggests improvements
- The self-improving loop (tee up a future video)

**Animation (built & verified, VO-aligned).** Kicker top-left. Terminal self-types `$ /eng-harness-flow`, then outputs `how did the harness do? ▸ suggestions…`. A central harness core (`>_ harness`) breathes; learnings rise INTO it (reversed spark motif — sparks float upward and settle, the core brightening). Three improvement chips precipitate and settle toward the core (`+ faster boot`, `+ seed data`, `+ smoke check`) — the harness, a little wiser. A late, quiet tag `a story for another day` fades in (the sequel tease). Sub `it learns from the run · the self improving loop` fades up last. Cues keyed to recorded VO (narration/018-s-loop).

**Time.** 16s

---

### S19 · Sign-off — Happy harnessing  <!-- id: s-bye -->

**Frame.** Bookend with the orbit scene from the title card, resolving the `?` orbiter into `your harness`, now installed. Warm documentary send-off.

**On-slide copy.**

- Orbit pills: `you` · `the agent` · `your codebase` · `your harness` (resolved from `?`)
- Core: `>_` / `ready for work`
- Line: `Happy harnessing.`
- Sub: `go and plant yours`

**Talk track.** "And there it is. The same familiar trio you began with, joined, at last, by the layer that was missing all along. A harness, installed, adopted, and already beginning to improve itself, with every passing day. Go now, and plant yours. Happy harnessing."

**Beats.**

- Callback: the `?` orbiter resolves to `your harness`
- The harness joins the family portrait, in the plate's dress
- Warm send-off, hold as exit screen

**Animation (built & verified).** The S1 orbit returns (fadein), now resolved: the core reads `>_ / ready for work`, and the fourth orbiter — the `?` ghost from the title — crossfades to a lavender `your harness` pill (two synced o3 orbs, opacity crossfade) with a soft lavender ping (joinPing), so it joins `you · the agent · your codebase` in the family's dress. `Happy harnessing.` fades up (lavender callback dot), then `go and plant yours`. Holds as the exit screen. Cues: scene .4s · headline 1.6s · resolve 2.6s · sub 4.4s (VO-align on the final pass).

**Time.** 10s

---

## Timing budget

| # | Slide | Target |
|---|---|---|
| S1 | Title | 0:15 |
| S2 | What it actually is | 0:12 |
| S3 | The CLI | 0:12 |
| S4 | The extension system | 0:16 |
| S5 | Installing is easy | 0:14 |
| S6 | The only mandatory change | 0:12 |
| S7 | One small nudge (reload) | 0:08 |
| S8 | Now, adoption | 0:10 |
| S9 | Harnessability | 0:15 |
| S10 | Your first extension | 0:10 |
| S11 | The boot extension | 0:20 |
| S12 | Creating an extension | 0:14 |
| S13 | How do you want to work? | 0:12 |
| S14 | the-flow | 0:12 |
| S15 | Bring your own | 0:12 |
| S16 | Moment one · before work | 0:12 |
| S17 | Moment two · validate backpressure | 0:18 |
| S18 | Moment three · the loop | 0:16 |
| S19 | Sign-off | 0:10 |
| | **Total** | **4:10** |

**Narration text status (2026-06-15, post tone-calibration).** All 19 spoken-prose tracks live in `narration/NNN-<id>.txt` (em-dash-free, no stage directions) and are now the **canonical** voice — they diverge intentionally from the ornate inline Talk-track drafts after the Option-3 tone pass (see open Q7). Recording is deferred and there are **no valid alignments**: S16/S17/S18's earlier `.words.json` are now **stale** (their text changed in the tone pass), so all 19 need a single fresh ElevenLabs pass (speed **1.1**) → `align.cjs` → re-key every slide's `--cue-*` to real word timecodes. Until then every slide carries hand-estimated `--cue-*` placeholders.

**Note on pace — read this before locking the script.** The table above (4:10) reflects a *brisk* delivery (~4.3 words/sec). The kind-old-naturalist voice is the opposite: a calm Attenborough cadence runs ~2.5 to 3.0 words/sec. At ~1,070 narration words across the 19 talk tracks, the honest spoken runtime is therefore **~5:30 to 6:30**, not 4:10 — and the per-slide `Time.` lines below are *minimums*, not the lyrical-pace truth. The render adds a 1s lead + 1s tail per slide on top (the missing-layer deck targets 5:31 in its sheet yet renders ~8:00). **So there is a real decision (see open question 9): either (a) trim narration ~25% (target ~800 words) to hold near 5:00 spoken, or (b) accept a longer, more luxuriant cut.** Worst per-slide offenders if holding the budget: **S7** (45 words in 8s ≈ 5.6 w/s — already a merge candidate), **S18** (86 words in 16s ≈ 5.4 w/s, *and a protected finale beat that must not be rushed — give it ~26s*), **S14** (58 words in 12s). **If trimming:** S7 (reload) folds into S6 as a footnote; S10 (first extension) folds into S11's open; the lyrical tracks in S4, S11, S17, S18 can each lose a sentence without losing wonder. **Protected beats (do not rush):** S4 (core vs extensions, the load-bearing concept), S11 (the boot extension), S17 (validate backpressure, the deterministic-done-ness beat), S18 (the finale).

---

## Open questions for iteration

1. **BYO skill name — RESOLVED.** It is **one** skill, `/eng-harness-flow`, called at all three moments (S16, S17, S18 all print the same token). Rationale (locked by the user): `the-flow` canonically is *research → plan → implement → validate*, and a bring-your-own workflow is the same shape — so whether you use the built-in `the-flow` or your own flow, `/eng-harness-flow` plugs into the same moments. S18's earlier `/eng-harness-loop` token is dropped; "the self-improving loop" remains only as the *concept name* on S18, not a second command. (The shared canonical shape is now reflected on S14's pipeline and S15's timeline.)
2. **Terminology collision.** Three similarly-named things are in play: "the engineering harness **flow**" (the *adoption* walkthrough, S8), "**the-flow**" (the built-in day-to-day workflow, S14), and "the engineering harness **loop**" (the S13 section heading / the self-improving loop, S18). Confirm they are distinct and lock the on-screen labels so they do not read as the same thing.
3. **Exact CLI commands + package name.** Placeholders used: `npm install -g <harness-cli>` (S3), the repo install command (S5), `<harness extension new>` (S12). Provide the real package name and commands. Given (verbatim, kept): `agent_readme.md`, `.harness/`, `/skills reload`, `/the-flow <problem>`.
4. **On-screen GitHub URL — RESOLVED (removed).** No repo URL is shown on any slide. The live repo URL differs per presentation, so S5 shows only the two install paths converging on the `installed ✓` outcome.
5. **S1 headline wording.** "Same opener" — keep the `Engineering Harness 101` series mark, or retitle the H1 to `Installing the Harness`? Currently proposing the retitle with the series tag retained. Confirm how much of the title-card text changes when we copy + modify the HTML.
6. **S7 (reload skills).** Keep as its own 8s slide, or fold into S6? It is a real gotcha but a small beat.
7. **Voice calibration — RESOLVED (Option 3: warm, not ornate).** A tone-validation pass (2026-06-15) compared all 19 narration tracks against the *recorded* first deck (`missing-layer-101`) and found the install deck had drifted markedly more ornate/archaic than deck 1's brisk, contraction-heavy voice — i.e. the abstract "Attenborough" goal disagreed with what deck 1 actually recorded. Calibrated back via **Option 3**: keep the warm naturalist *vocabulary* but (a) remove the literal animal/habitat metaphors that violate the standing steer (`creature`, `take hold`, `makes its home`, `rooted`, anatomical `heart`), (b) cut the `dear viewer` vocative (no precedent in deck 1), and (c) restore natural contractions throughout (`Let us`→`Let's`, `it is`→`it's`, etc.). `plant yours` (S19) kept deliberately as the user-authored callback to deck 1's `Go find yours`. **Canonical spoken text now lives in `narration/*.txt` (updated this pass); the inline Talk tracks below are the original ornate drafts and were intentionally not back-ported.**
8. **Boot-extension specifics (S11).** The example checks (`builds`, `services up`) are generic-plausible; swap in safe, org-resonant examples if any exist.
9. **Runtime vs the lyrical voice — RESOLVED (keep the luxuriant cut).** The user confirmed the longer cut is intended: the sibling missing-layer deck also runs ~8:00, so consistency wins over the 4:10 brisk-math table. **No trimming; S7 and S10 stay as their own slides.** Measured cadence from the three recorded tracks is ~2.37 words/sec (at ElevenLabs speed 1.1); across all 1,087 narration words that is **≈7:40 of speech (~8:00 rendered with per-slide leads)** — on target. The 4:10 timing table above is retained only as the original brisk-delivery reference and is *not* the plan of record.

---

## Validation Record (2026-06-15)

### Validation Thesis

**Raison d'être**: Convert the user's raw "installing the harness" flow into a structured slide-by-slide run sheet that is the content contract for the next explainer video — phase 1 of the two-phase process (slides first; per-slide animation design with feedback next).

**Value claim**: Every beat the user wrote becomes a faithful one-beat slide, in the requested kind-old-naturalist (David Attenborough) voice, so the downstream animation pass, narration (TTS), and HTML build don't lose or distort intent.

**Artifact promise**: A downstream builder can take each slide block and design animation, generate narration from the Talk track, and build the HTML section without re-deriving content or losing any intended beat.

**Intended beneficiaries**: the user (review/critique); downstream build steps (animation design pass, `tts.cjs` narration, HTML deck author).

**Proof target**: Contract (per-slide content + narration source). Animation choreography intentionally deferred.

**Evidence standard**: every source bullet maps to a slide; structural parity with `../missing-layer-101/missing-layer-101.md`; voice consistency; brand constraints; naming risks surfaced not resolved.

**Thesis source**: user request this turn + user-authored "## The arc in one paragraph" bullets + missing-layer-101.md conventions.

**Thesis verdict**: Advanced.

**Main thesis risk**: The skill-name and terminology ambiguities are correctly surfaced as open questions rather than resolved, so the only residual risk is the build proceeding before the user locks those names — the intended hand-off state, not a fidelity defect.

---

| Agent | Lenses Covered | Thesis Axes Covered | Issues | Verdict |
|-------|---------------|---------------------|--------|---------|
| Source-Fidelity & Thesis | Thesis Alignment, Evidence Sufficiency, Proof-Level Fit | Thesis Alignment, User/Product Value Preservation, Evidence Sufficiency | 24/24 beats mapped, 0 dropped; 1 MEDIUM advisory (S16/S8 readiness overlap) | ✅ |
| Structural & Forward-Compat | Forward-Compatibility, Concept Documentation, Integration & Ripple, Technical Constraints | Downstream Usefulness, Review Compression | 0 blocking; on-slide glyphs are TTS-safe render notes | ✅ |
| Voice & Brand | User Experience, Concept Documentation, Technical Constraints, Edge Cases | User/Product Value Preservation | 1 HIGH timing (fixed: note re-baselined + Q9 raised); 2 minor voice slips (S5/S14); 0 em dashes in rendered copy | ⚠️ → fixed/open |
| Naming/Terminology | Hidden Assumptions, Concept Documentation, Domain Boundaries, Evidence Sufficiency | Review Compression | 2 MEDIUM (on-slide command collision S16-S18; "the flow"/"the-flow" labels) + 2 LOW — all surfaced as open Qs | ⚠️ open |

**Lens coverage**: 11/15 (Thesis Alignment ✓, Forward-Compatibility ✓, Evidence Sufficiency, Proof-Level Fit, User Experience, Concept Documentation, Integration & Ripple, Technical Constraints, Hidden Assumptions, Edge Cases, Domain Boundaries).

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| Animation design pass | One clear beat + Frame + 1-line Animation seed per slide | shape mismatch | ✅ | All 19 slides carry Frame + a single Animation (seed) line; choreography correctly deferred |
| `tts.cjs` narration | Plain-prose Talk track (no stage directions); id → `NNN-<id>` stem | contract drift | ✅ | Talk tracks are clean spoken prose; 19 kebab ids → `001-s-title` … `019-s-bye` |
| HTML deck author | Unique kebab `s-xxx` ids; on-slide copy; reusable orbit opener AND closer | shape mismatch | ✅ | 19 unique valid ids; S1 copies the title card (cast matches HTML 5175-5186); S19 closes `?`→`your harness` consistently |
| The user | Open questions + naming risks surfaced + credible runtime | contract drift | ✅ | 9 open Qs incl. both naming collisions; runtime now honestly re-baselined (Q9) |

**Thesis alignment**: Value claim advanced at the Contract proof level with strong evidence — every source beat is captured as a faithful one-beat slide; the only residual risk is the build proceeding before the user locks the ambiguous skill/terminology names, which is the intended hand-off state.

**Outcome alignment**: The artifact directly advances the user's OUTCOME ("we're telling a story the voice is that of a kind old man like david attenborough ... get the slides all sorted out") — all 19 slides are sorted with the Attenborough/naturalist voice consistently applied across every Talk track, the opener/closer bookend is faithfully reused, and the run sheet is structurally complete and forward-compatible with the TTS/HTML/animation pipeline.

**Standalone?**: No — downstream consumers (animation pass, `tts.cjs`, HTML author) exist; Forward-Compatibility engaged.

Overall: VALIDATED WITH FIXES

---

## Validation Record — Tone Pass (2026-06-15)

**Artifact**: the 19 narration `.txt` tracks. **Question**: "compare to first presentation, is the tone right?"

**Thesis**: the install-deck narration must read as the *same narrator/series* as the recorded first deck (`missing-layer-101/narration/*.txt`); proof target = **Decision** (decide match y/n + name the direction); evidence = side-by-side quotes across concrete voice dimensions.

**Finding (3 agents — they split, which was the signal)**: the decks were in genuinely different registers. Deck 1 = brisk, contraction-heavy, modern dev-speak, mechanical/sensor metaphors, flat opener. Deck 2 (as written) = ornate, near-contraction-free, literary, nature/creature metaphors, `dear viewer`, atmospheric opener. Near-binary contraction signal + metaphor-family flip = a real, listener-noticeable seam. Crux: the run-sheet's abstract "Attenborough" goal **disagreed with what deck 1 actually recorded**. Secondary: the literal animal/habitat metaphors also violated the standing user steer (warmth, not animals).

| Agent | Lenses | Verdict |
|-------|--------|---------|
| Voice-Match / Thesis | Thesis Alignment, Evidence Sufficiency | ❌ "different narrator" (CRITICAL) |
| Register-Drift / Consistency | Consistency, Edge Cases, Hidden Assumptions, Concept Documentation | ❌ thesis not met; ~7 anchors + closer + `dear viewer` |
| Series-Continuity / Forward-Compat | Forward-Compatibility, UX, Integration & Ripple | ✅ "same narrator, lifted"; strong bookend (minority/lenient read) |

**Resolution (user: "fix it" → Option 3)**: kept the warm naturalist vocabulary; removed literal-animal anchors (`creature`/`take hold`/`makes its home`/`rooted`/anatomical `heart`); cut `dear viewer` (S18); restored natural contractions across 15/19 files (`Let us`→`Let's` ×3). `plant yours` (S19) kept as the user-authored deck-1 callback. 17 files rewritten (010, 019 unchanged). Verified: 0 residual steer words, still em-dash/smart-quote clean.

**Thesis alignment**: value claim now advanced at the Decision proof level — the seam is closed toward deck 1 (warm words + conversational cadence) without flattening the voice; residual risk is the larger fork (is Attenborough or brisk the *canonical* series voice?) which the user deferred by choosing the middle path.

**Outcome alignment** (echoed verbatim from the Forward-Compatibility agent): *"The VPO Outcome — 'we're telling a story the voice is that of a kind old man like david attenborough' — is advanced by the artifact as written: deck 2's narration is a warm, kindly, story-told register that continues deck 1 without a seam, reuses the 'Happy harnessing' sign-off, and bends itself to deck 1's vocabulary so no re-recording is forced; the lone watch-item is keeping the single 'creature' flourish from escalating into literal-animal metaphor in later chapters."* (Watch-item now actioned: `creature` removed.)

Overall: ⚠️ VALIDATED WITH FIXES — tone recalibrated to Option 3; the canonical-series-voice fork (deck 1 brisk vs deck 2 warm) remains the user's to lock if/when deck 1 is ever revisited.
