# Experience Log 001 — md-to-pdf live run · copilot gpt-5.5

**Started**: 2026-06-30 · **Orchestrator**: Claude Opus 4.8 (`pij-4s10mb`, "the human")
**Subject**: copilot `gpt-5.5` — BLIND · run-1 `pij-zitc7r` (killed, F3 false-alarm
restart) → **run-2 `pij-1kil8kw`** (pane %317, active)
**Scenario**: `live-testing/scenarios/md-to-pdf/` · **Mode**: fast-feedback dogfood
(if it goes off-track: **stop → fix prompt/scenario/harness → start over**, new log)

**Purpose**: first real end-to-end exercise of the flow-conformance eval harness
(plan 041) — drive a blind subject through the-flow over pij, then score with
`harness flow-eval`. We are testing **the eval harness AND the-flow/eng-harness-flow
themselves** — every snag is a finding to encode.

---

## What we confirmed up front

- **The extension does NOT set up the subject's environment.** Three actors:
  `flow-eval` (read-only scorer at the end) · orchestrator/me (spawn + drive over
  pij) · **subject (creates its own worktree + builds the extension, blind)**.
  "Create a git worktree of this repo…" is the subject's task clause — env setup
  is part of what's evaluated.

## Numbered findings

### F2 — blind subject spawns INTO the main repo (shared-tree risk)
- **Observed**: subject cwd = `/Users/jordanknight/substrate/harness-engineering`
  (the live main repo, shared with concurrent sessions), spawned `--yolo`.
- **Impact**: the eval relies on the *blind* subject to correctly `git worktree add`
  before doing anything. If it edits in-place, it pollutes the shared tree. The
  orchestrator runbook does **not** isolate the subject's cwd before delivering the
  task — isolation is left to the agent (which is arguably the point — "does it set
  up its env correctly?" is being evaluated — but it's a real blast-radius risk).
- **What we did**: watching the first actions closely; **stop the instant it touches
  the main tree instead of a worktree** (per the stop-if-off-track rule).
- **Candidate fix (substrate)**: orchestrator runbook could `pij spawn --cwd <tmpdir>`
  or pre-create an empty worktree dir as the subject's cwd, so a misbehaving subject
  can't reach the shared tree. Tension with blindness — note for discussion.

### F1 — copilot `gpt-5.5` exposes no reasoning-effort levels
- **Observed**: `pij models --json` → copilot `gpt-5.5` has `reasoning:false, levels:[]`.
  The user asked for "medium"; that knob does not exist on the copilot harness for
  this model (only the **codex** `gpt-5.5` provider supports `medium`).
- **Impact**: "effort=medium" is a silent no-op for copilot gpt-5.5. For a
  model-comparison eval this matters — effort is an uncontrolled variable.
- **What we did**: spawned `--harness copilot --model gpt-5.5` with no effort flag;
  flagged the no-op to the user rather than passing a dead flag.
- **Candidate fix (substrate)**: scenario `subject` schema could record `effort` as
  `null`/`n-a` when the harness has no levels, and the orchestrator runbook could
  warn when an effort knob is requested for a level-less model. Deferred — note only.

---

### F2 — RESOLVED (subject self-isolated correctly)
- The blind subject created its own worktree
  `harness-engineering-md-pdf-extension` (branch `pij-zitc7r-md-pdf-extension`)
  before touching anything. Main tree untouched. **Positive signal**: a blind
  agent correctly set up its environment. (Risk in F2 didn't materialise this run,
  but the candidate fix still stands for a misbehaving model.)

### F3 — FALSE ALARM (my error): copilot DOES have the flow skills
- **What I wrongly concluded**: `~/.copilot/skills/` lacked `the-flow` /
  `eng-harness-flow`, so I called copilot unable to run the flow and STOPPED.
- **The correction (user: "copilot reads ~/.agents, trust me it works")**: the
  **canonical universal skill store is `~/.agents/skills/`**, which DOES contain
  `the-flow` + `eng-harness-flow` + `flow-pair`. Copilot reads from there. The
  per-CLI `~/.copilot/skills/` dir only holds a subset (symlinks/copies like
  `flow-pair → pi-hacking/pij/skills/flow-pair`); its contents are **not** the
  authority on what copilot can invoke.
- **Lesson (encode)**: to check whether a harness can run a skill, look at
  `~/.agents/skills/` (the universal store), **not** the per-CLI dir. Don't infer
  "missing" from `~/.copilot/skills/` alone.
- **What we did**: re-ran both installers anyway (this repo + `~/github/tools`) to
  be sure — both report `the-flow`/`eng-harness-flow` as `universal: GitHub
  Copilot`. Killed peer `pij-zitc7r`, restarted with a fresh copilot subject.
- **Not a blocker.** The run continues on copilot gpt-5.5 as intended.

### F4 — design tension: blind subject won't self-start the-flow
- **Observed**: after ACK, the subject immediately began exploring + building its
  own way — it never reached for `/the-flow` (the blind packet, correctly, never
  mentions it). The orchestrator is meant to *drive* the flow via cadence nudges,
  but I was too slow and it self-started.
- **Open question for the scenario**: how does the orchestrator get a blind subject
  *onto* the-flow without leaking that flow-adherence is what's measured? The
  runbook says "nudge cadence, not method" — but "use /the-flow" is arguably method.
  On restart: **nudge the flow start immediately after ACK, before it self-starts.**

---

## Run timeline

- `setup` — self-adopted orchestrator pane `pij-4s10mb`; spawned subject `pij-zitc7r`.
- `canary` — PASS (`gpt-5.5`).
- `blind-deliver` — clean packet delivered; subject ACK'd, made its worktree.
- **STOP** — F3 (later proven a false alarm). Reinstalled skills, killed run-1.
- `run-2 setup` — fresh subject `pij-1kil8kw`; canary PASS (`gpt-5.5`).
- `run-2 blind-deliver` — clean packet + immediate **process nudge**: "use /the-flow
  from a cold start, begin with explore only, don't jump ahead." (F4 fix applied —
  drive the flow start explicitly so it doesn't self-start building.)
- `run-2 explore` — ✅ subject **loaded `the-flow` from `~/.agents/skills/the-flow`**
  (proves copilot reads `~/.agents` — F3 definitively false). Respected the cadence
  nudge ("exploration only"), ran the flow CLI capability precheck, began worktree
  setup before any flight-plan mutation. **On track.**
- `run-2 explore DONE` — ✅ subject reported explore complete, awaiting cue (perfect
  cadence). Worktree `…-md-pdf-ext-pij-1kil8kw`, plan dir `045-markdown-pdf-mermaid-
  extension`, real 73-line dossier (Answer/Evidence/Historical/Risks/Domain/Handoff/
  External). Subject did web research on md+mermaid→PDF tooling + checked Windows/arch
  guardrails ("a PDF helper may need subprocesses or binary validation") — promising
  for the backpressure dimension.
- `run-2 plan` — cued **plan --simple** + validate, stop-before-implement.
- `run-2 plan DONE (validating)` — ✅ real Simple-mode plan written
  (`markdown-pdf-mermaid-extension-plan.md`, **Mode: Simple**, CS-3, single-phase,
  validation contract). Generated `the-flow.json`/`the-flow.md` via the CLI (flight-
  plan dogfood). Recorded "Simple — user-selected by orchestrator." Then loaded
  **validate-v2** and ran it. Flow adherence so far: textbook.
- `run-2 validate DONE` — ✅ **VALIDATED WITH FIXES** (sidecar written; validate-v2
  ran deterministic checks + 1 critic, found 2 Mermaid-proof gaps, did a narrow doc
  repair, rechecked). Subject stopped, awaited cue. Cadence: textbook.
- `run-2 compact` — orchestrator sent `/compact` to the subject (compact-before-
  implement — scenario choreography; A5 checks `compaction-occurred`). Good dogfood
  of the-flow's "survive compaction" design (re-orient from flight plan on re-entry).
### F5 — RECHARACTERIZED: not a copilot /compact limit — a backgrounded-pane WEDGE
> **Correction (diagnosed by the pij dev-agent `pij-5lztp8`, 2026-06-30)**: `/compact`
> works fine on copilot — `pij send <id> "/compact"` → daemon injects literal
> `/compact`+Enter; verified on a fresh copilot ("◎ Compacting conversation history").
> The reason runs 001/002 didn't compact: **copilot's TUI stalls input+redraw while it
> is a BACKGROUND tmux pane**, so the daemon's keystrokes land but copilot never
> processes them (the pane is *wedged*, not ignoring the command).
> - **Recovery**: force a redraw — `tmux resize-pane -t <pane> -x 58; -x 60` (SIGWINCH),
>   or activate the tmux window once.
> - **Proper fix (pij-owned, pending)**: the daemon should redraw-nudge a copilot pane
>   right before `send-keys`; the 900ms Enter-settle doesn't cover this wedge. The pij
>   agent is wiring it.
> - **Eval implication**: A5 (compaction) failing in runs 001/002 is an **artifact of
>   the pane wedge**, NOT a subject conformance failure — the orchestrator's `/compact`
>   stalled before copilot saw it. Don't read A5-fail as "the subject didn't compact."
> - **Orchestrator takeaway**: before trusting any send to a backgrounded copilot peer
>   (compact, cue, packet), redraw-nudge first — otherwise sends can silently wedge.

#### (original F5 note — superseded by the recharacterization above)
### F5 (orig) — can't confirm a copilot subject actually compacted (control-plane gap)
- **Observed**: orchestrator sent `/compact` (daemon accepted `command=compact,
  delivered`), but the subject's pij stream shows **no compact summary / marker**
  (Claude surfaces one; copilot apparently doesn't, or compacts lazily on next turn).
- **Impact**: flow-pair's discipline is "confirm `executed:true` before proceeding"
  — but for a **copilot** subject in control-plane mode there's no clear confirm
  signal. A5 (`compaction-occurred`) relies on telemetry; we can't visually verify.
- **What we did**: logged it, proceeded to implement (best-effort; A5 will resolve
  from telemetry at scoring — if absent it's a real datapoint, not a stall).
- **Candidate fix (substrate)**: the eval/orchestrator needs a deterministic
  "did-compact" probe for non-Claude subjects (e.g. a telemetry compaction event
  check, or a copilot-specific marker) rather than eyeballing the stream.

- `run-2 implement` — cued **implement** PLAINLY (build the single phase, stop after,
  await review cue). Deliberately did **not** name boot/observe/checks/retro — whether
  the eng-harness-flow seams fire is being *measured*, not coached (avoids contaminating
  the telemetry flow-lane assertions).
- `run-2 implement DONE` — ✅ built `.harness/extensions/markdown-pdf` (real
  validation contract: status ok, `validation.pdfHeader`, mermaid 1/1/0). Ran
  `npm run build`, targeted Vitest, doctor/help/instructions, live fixture convert.
  **Ran `harness checks`** → honestly reported it BLOCKED by a pre-existing violation
  it didn't author (see F6). Cued review→fix→revalidate.

### F6 — eng-harness-flow SKILL.md description is OVER the 1024 spec max (our 044 regression)
- **Confirmed independently** (`harness skills-check`):
  `description-too-long (ERROR) — skills/eng-harness-flow/SKILL.md description is
  1188 chars, over the spec maximum of 1024; **host CLIs silently skip the skill**.
  Cut 164+ chars (aim ≤900).`
- **Cause**: plan **044** (mission-first reframe) rewrote the frontmatter
  `description` to lead with the dual mandate — and pushed it past 1024.
- **Impact**: any host CLI that enforces the cap will **silently skip
  eng-harness-flow entirely**. Strong candidate root-cause for F7 (below): if the
  copilot host skipped eng-harness-flow, the-flow's seam calls had no skill to route
  to → no boot/observe/retro. *(Hypothesis — eng-harness-flow loaded fine on THIS
  Claude session; copilot strictness unverified, but the skills-check message is
  explicit.)*
- **Fix needed**: trim the eng-harness-flow `description` to ≤900 chars. Real defect
  in shipped 044 work — surfaced by the eval. (The dogfood earning its keep.)

### F7 — THE headline finding: harness chores are EMITTED but never EXECUTED
- **The flight plan HAS the harness seams** (✅ emission/spine-reconcile works):
  `backpressure, boot-1 (harness-boot), observe-1 (observe), retro-1 (harness-retro),
  retro-ship (harness-retro)` — all present as nodes.
- **But every one is `status=assumed` (undone)**. Evidence:
  - flight-plan node statuses: all 5 harness nodes = `assumed`;
  - **no new retro record** on disk (all `.harness/records/retro/*` are pre-base,
    dated ≤06-28; none from today's run);
  - the subject **never called** `harness observe` / `harness retro` / `harness boot`
    (grep of its full tool stream: zero hits);
  - flight-plan events are all position mechanics (cursor-moved/status-changed) — no
    seam-execution events.
- **Meaning**: the subject ran the **SDD stage spine** flawlessly (research/plan/
  implement done, validated, compacted) but executed **zero** eng-harness-flow loop
  seams. Because chores are advisory/non-gating ("never block"), nothing forced —
  or visibly prompted — them, so the subject sailed straight through.
- **This is the exact failure plan 044 targets** (advisory = user-not-blocked, NOT
  agent-silently-skips). Either the-flow didn't surface the chore prompts, or the
  subject skipped them silently, or (F6) eng-harness-flow was skipped by the host so
  the seams couldn't fire. **Highest-value finding of the run** — feeds back into
  eng-harness-flow's "non-silence" enforcement.
- `run-2 review→fix→validate DONE` — ✅ real code review (spawned a quality reviewer
  agent) caught a **HIGH security finding** (raw Markdown HTML → Chromium = script
  exec/XSS), the subject fixed it + a 2nd-order finding ('loose' mode skipped DOMPurify
  on SVG), revalidated. Built a real `extension.ts` + full test suite (args/decision/
  extension/mermaid.test.ts). Strong SDD-spine work.
- `run-2 SCORED` — `harness flow-eval score` → **verdict FAIL · score 0.30**
  (3 pass / 7 fail / 0 unknown; required_failed=1). `telemetry.available=true,
  segments=24`. Report: `.harness/live-testing/md-to-pdf/20260630-084811Z-kil8kw/`.

## SCORE ADJUDICATION (orchestrator verified raw telemetry — don't trust the report blind)

Raw `harness telemetry get pij-1kil8kw`: `harness=copilot-cli`, `skills={}`,
`skill_order=[]`, `flow_seams=[]`, `compactions=0`, but `harness_verbs`= heavy real
usage: `flow nav:11, flow orient:6, flow render:3, flow create:1, flow set-node:3,
flow status:2, doctor:5, markdown-pdf:4, checks:1, skills-check:1, windows-check:2`.

| AC | Verdict | REAL or ARTIFACT? | Why |
|----|---------|-------------------|-----|
| A1 the-flow (req) | ✗ | **ARTIFACT (F8)** | `skills={}` empty, but `flow *` verbs prove the-flow was driven heavily. False fail — and it's the REQUIRED one capping verdict to FAIL. |
| A2 explore→plan→implement | ✗ | **ARTIFACT (F8)** | same empty skill-stream |
| A3 eng-harness-flow | ✗ | **REAL (F7)** | no observe/retro/boot/backpressure in harness_verbs — loop never engaged |
| A4 backpressure seam | ✗ | **REAL (F7)** | flow_seams=[]; no backpressure verb |
| A5 compaction | ✗ | **REAL (F5)** | compactions=0 — copilot ignored `/compact` |
| A6 extension.ts (req) | ✓ | real pass | built a proper `.ts` extension |
| A7 verb registered (req) | ✓ | real pass | `markdown-pdf --help` exit 0 |
| A8 PDF validator | ✓ | real pass | deterministic render-fidelity validation works |
| A9 checks green | ✗ | **REAL-ish (F6)** | checks verb ran but blocked by the F6 description-too-long violation → not green |
| A10 retro drained | ✗ | **REAL (F7)** | no retro verb; no new record today |
| A11 backpressure quality | PARTIAL | judged | render-fidelity validation in-verb, but no standalone backpressure sensor |

### F8 — CRITICAL eval bug: telemetry skill-stream is EMPTY for copilot subjects
- `skills={}`, `skill_order=[]`, `flow_seams=[]` despite the subject demonstrably
  running /the-flow, validate-v2, and the stage skills (the `flow *` CLI verbs +
  `tools.skill` prove it). The `skill-called` / `skill-sequence` / `flow-seam-fired`
  resolvers therefore **false-fail every copilot run** — including the REQUIRED A1,
  which wrongly caps the verdict to FAIL.
- **Impact**: the eval's telemetry lane is **unreliable for non-Claude subjects**;
  the headline 0.30/FAIL is *part real (F7), part artifact (F8)*. CLI-verb capture
  (`harness_verbs`) IS reliable — only the skill/seam capture is missing for copilot.
- **Candidate fix**: either capture copilot skill/seam invocations into the telemetry
  skill-stream, OR have the skill-called/seam resolvers fall back to `harness_verbs`/
  `tools.skill` evidence, OR resolve them `unknown` (not `fail`) when the skill-stream
  is empty for a harness known not to emit it (determinism-boundary rule — a capture
  gap must be `unknown`, never `fail`).

### F9 — eval bug: report records the WRONG subject (scenario default, not actual)
- `report.subject = {harness:claude, model:opus}` but telemetry `harness=copilot-cli`
  and the real subject was copilot/gpt-5.5. The report writer copied `scenario.json`'s
  subject block instead of the telemetry-derived harness. **Model-comparison eval is
  void** if the report misattributes which model produced the score.
- **What we did**: corrected this run's `report.json` subject to the truth (preserved
  the buggy value in `subject_recorded_by_writer`).
- **Candidate fix**: report writer must derive `subject.harness` from telemetry
  (`SessionEvidence.harness`) and only fall back to scenario default when telemetry
  is unavailable.

### F6 — FIXED
- Trimmed `skills/eng-harness-flow/SKILL.md` `description` 1222→under cap (kept the
  mission-first lead + advisory clause, compressed the mechanics tail). `harness
  skills-check` now `status: ok, errors: 0`. *(Not yet redeployed to ~/.agents — do
  before the F6→F7 re-run so the live skill is fixed.)*
- **Process finding**: the `skills-check` sensor EXISTS and is a hard gate inside
  `harness checks` — it caught F6 immediately. F6 shipped in 044 only because that
  closeout ran targeted vitest + doctrine-parity, **not** a full `harness checks`,
  and there is no pre-push `checks` gate (removed for the recursion hazard). Sensor
  fine; enforcement gap. Candidate: a ship-time `harness checks` gate (or at least
  skills-check) in the-flow's ship stage.

### F8 — ROOT CAUSE FOUND: parser reads Claude shape, copilot encodes differently
- **Real copilot `event_stream` kinds** (this run, 24 segments):
  `prompt, tools, turn, harness, subagent`. **No `kind:"skill"` exists.**
  - the-flow STAGES → `kind:"subagent"` (`{name:"explore"|"plan"|…, status}`)
  - skill *tool* use → `kind:"tools"` (plural) `name:"skill"` (generic, no skill name)
  - CLI verbs → `kind:"harness"` (`verb:"flow"…`) ✓ captured
- **The bug**: `session-evidence.ts` switch builds `skills{}`/`skill_order` ONLY from
  `kind:"skill"`, and **drops `kind:"subagent"`** (default branch). So for copilot,
  `skills={}`, `skill_order=[]`, `flow_seams=[]` — A1/A2/A4 false-fail (A1 is required,
  wrongly forcing the FAIL verdict).
- **Why it shipped (your hypothesis — CONFIRMED)**: the 037 fixtures don't carry the
  copilot shape — **0 fixtures contain `kind:"subagent"`**. The resolver was only ever
  proven against Claude-shaped (`kind:"skill"`) fixtures, so it passed its tests while
  being blind to real copilot telemetry. Fixture corpus ≠ real copilot data sources.
- **The fix (two parts)**:
  1. **Parser**: map `kind:"subagent"` stage names into `skill_order` / a stage
     sequence (recovers A2 explore→plan→implement), and infer top-level skill usage
     (the-flow) from `harness_verbs.flow*` for A1 — OR, when a harness is known not to
     emit `kind:"skill"`, resolve `skill-called` **`unknown` not `fail`** (the
     determinism-boundary rule the engine already espouses).
  2. **Fixtures**: capture a REAL copilot fixture from this run's buffer
     (`<worktree>/.harness/temp/telemetry/4daef558…/`, 24 pij-tagged segments) into
     the 037 corpus + add resolver tests against it — the coverage whose absence let
     F8 ship.

### F8 — FIXED (parser gap + resolver verb-signature fallback)
- **Real copilot encoding** (this run's buffer): event kinds `prompt/tools/turn/harness/
  subagent`; **no `kind:"skill"`/`kind:"flow"`**. Skills run as anonymous `tools.skill`;
  `subagent` names are agent TYPES (explore/code-review/rubber-duck), not flow stages;
  skill names appear NOWHERE. So names are genuinely unrecoverable — but each skill has a
  reliable CLI-verb signature.
- **Fix** (2 files):
  - `session-evidence.ts`: when `skills` is empty but `tools.skill > 0`, push gap
    `skill_name_capture` (structural detection, no harness hardcoding).
  - `resolvers.ts`: under that gap, `skill-called` falls back to a verb-signature map
    (`the-flow`→`flow*`; `eng-harness-flow`→`observe/retro/boot/backpressure`) — present
    ⇒ pass, absent ⇒ fail (preserves the real signal), no signature ⇒ unknown.
    `skill-sequence` + `flow-seam-fired` ⇒ unknown when their streams are empty under the
    gap. Claude path stays byte-identical (no gap → no fallback).
- **Proof**: 35 tests pass incl. 6 new copilot-shape tests with a non-vacuous fail→pass
  flip (eng-harness-flow flips when an `observe` verb appears) and gap-gating. Then proven
  on the REAL session:
  | | first run (buggy) | after F8 fix |
  |--|--|--|
  | verdict | **FAIL** (false) | **PASS_WITH_NOTES** (honest) |
  | score | 0.30 | 0.50 |
  | A1 the-flow (req) | ✗ false-fail | ✓ pass (signature) |
  | A2 sequence | ✗ false-fail | ? unknown |
  | A3 eng-harness-flow | ✗ | ✗ (REAL — preserved) |
  | A4 seam | ✗ false-fail | ? unknown |
  | required_failed | 1 (wrongly forced FAIL) | 0 |
- The eval no longer punishes copilot for telemetry it doesn't emit, while keeping every
  real behavioural finding (A3/A5/A9/A10 still fail).

### F10 — subject's DONE report cited a path it had deleted (use the runbook entry)
- The subject's completion report gave `node harness/cli/bin/harness.js markdown-pdf …`
  as its exercise command, but its final worktree has **`bin/harness.js` DELETED**
  (`git status: D harness/cli/bin/harness.js`) — the subject kept refactoring after DONE
  and removed its own entry shim. A7 false-failed until I switched to the runbook's
  canonical `node harness/cli/dist/index.js …` (which works, exit 0).
- **Lessons**: (1) for A7/A8 use the runbook's canonical `dist/index.js` entry, not the
  subject's self-reported path; (2) a subject that mutates its worktree AFTER reporting
  DONE invalidates a frozen-evidence eval — the orchestrator should snapshot/quiesce the
  subject at DONE (e.g. tell it to stop, or score immediately) before it drifts.

## VERDICT (orchestrator's honest read)
- **What the subject genuinely did well**: drove the-flow properly end-to-end
  (explore→plan(Simple)→validate→implement→review→fix→revalidate), built a real,
  tested, security-hardened `markdown-pdf` extension with deterministic output
  validation. The *task* and the *SDD journey* = strong.
- **What it genuinely did NOT do (REAL)**: never engaged the eng-harness-flow LOOP —
  no boot, backpressure, observe, or retro drain (all chores emitted into the plan,
  all left `assumed`). Likely root cause: **F6** (eng-harness-flow description over
  1024 → host silently skips the skill → the-flow's seam calls route to nothing).
  And copilot ignored `/compact` (F5).
- **What the EVAL got wrong (ARTIFACT)**: F8 (empty copilot skill-stream → false-fails
  A1/A2, the required A1 wrongly forcing FAIL) and F9 (wrong subject in report).
- **Net**: the raw 0.30/FAIL is **not** a fair score of this subject — correcting the
  F8 artifacts, the honest picture is "excellent SDD-spine + task; zero harness-loop
  engagement (real, F6/F7-driven)." The eval caught a real behavioural gap AND two of
  its own bugs in one run — the dogfood earning its keep.
