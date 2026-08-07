# Research Dossier: Product-Documentation Hierarchy (plan 025)

**Generated**: 2026-06-18T00:27:00Z
**Research Query**: "A new reader-facing product-documentation hierarchy (separate from docs/how), GitHub-native markdown, starting at quick start, that unpicks the onboarding steps in detail (per installing-the-harness.md); each doc links the next."
**Mode**: Pre-Plan (feeds `/the-flow 1b plan`)
**FlowSpace**: Not available — standard tools + 5 parallel explore subagents (adapted from the 8-subagent code template for a documentation-IA topic)
**Findings**: ~60 across 5 threads — Onboarding (OB), Doc Surfaces (DS), CLI Surface (CLI), Repo Layout (RL), Prior/In-flight (PL/IF)

---

## Executive Summary

### What we're building
A **guided learning spine** — `docs/guide/` — that a consumer team reads top-to-bottom: Start Here → Quick Start → understand → adopt → operate → grow. It is **distinct from `docs/how/`** (technical/contributor reference) and from `harness-foundations/` (the thesis essays). GitHub-native markdown only (no Pages), folder `README.md` as the landing page, every doc linking the next.

### Key insights (the research changed the brief)
1. **The onboarding deck is aspirational; reality has moved past it.** `installing-the-harness.md` still has open TODOs (package name, `harness init`, naming) — but the code now answers most of them. Docs must be written against **today's code**, not the deck. (OB-01..09, CLI, the §Critical Discoveries table.)
2. **`harness init` now exists** (added in commit `9e2224a`), and it **stamps the governance doc** — this reverses a previously-recorded assumption that the doc was hand-written. This is load-bearing for Quick Start. (OB-02/03, verified directly.)
3. **`docs/guide/` is the right folder** (not `docs/product-documentation/`): shorter, sorts cleanly, browses natively. `docs/` has **no index today** — the new `README.md` becomes the first real docs landing. (DS folder rec.)
4. **The guide must summarise-and-link, never fork.** Canonical layer wording is **owned by the deck**; install/loop/encoding content already exists across README/foundations/skills — the guide digests and links. (DS overlap flags + canonical-wording note.)
5. **Two adjacent in-flight plans constrain us.** `023` owns onboarding *mechanics* (a 5-rung adopt flow with ephemeral `.harness/temp/adopt-flow.json` state); `024` ships a deterministic `harness flow` engine and **explicitly excludes onboarding**. Our reader-facing docs must stay consistent with `023`'s adopt model and must **not** conflate onboarding with `024`'s `the-flow`. (IF-01/02/03.)

### Quick stats
- **Surfaces inventoried**: ~22 (README, INSTALL, AGENTS, skills/README, 5 foundations essays, 7 docs/how guides, 3 deck pages, layer diagram, CLI README, 3 decks).
- **Real core CLI commands**: 13 + dynamic extension verbs (CLI-01..14).
- **Aspirational-but-not-real commands**: `harness boot`, `harness smoke` (boot/smoke are *extensions*, not core); `arch-check` is a repo extension.
- **Proposed guide docs**: 14 (1 landing + 13 chapters).
- **Estimated complexity**: CS-3 (medium) — high surface area (many files), low integration/novelty/data; real risk is **drift** vs the real CLI/flow (PL-04) and GitHub-native link/render correctness.

---

## Pre-Plan Decision Record (grill session, 2026-06-18)

Eight-question stress test with the user; all decisions locked. The plan stage MUST honor these.

| # | Decision | Locked outcome |
|---|---|---|
| D1 | **Primary reader** | External adopting engineer (+ their agent), across **4 intents**: (a) learn harness concepts, (b) install + bootstrap into their repo, (c) weave into flows / get a new flow, (d) drive a harness someone else already set up. |
| D2 | **Shipped vs vision** | Write **shipped-today**, every command verified. **Assume `harness flow` (024) is shipped** (its impl agent maintains that doc). Onboarding (023) is shifting — write now, mark in-flux bits. Lean freely on `intro-to-harness.md` + `harness-foundations/simple-mode.md` for concepts. |
| D3 | **Information architecture** | **Start Here = an intent-router** ("need to X → go here"). Intent (d) gets its **own dedicated doc** ("using a harness that's already set up"), separate from Quick Start (install-first). |
| D4 | **North star (success bar)** | A cold external engineer + agent go from zero to a **verified green `harness boot`** in their own repo using only `docs/guide/`, asking no human. Guardrails: every command runs as written (no drift); intent (d) reader can drive an existing harness from its doc alone. |
| D5 | **Flows depth (c)** | **Orient + link, never re-teach.** One "fitting your workflow" doc gives the mental model + two paths (built-in harness flow / the-flow, OR BYO-SDD + the 3 router touchpoints), then links the canonical flow docs. |
| D6 | **Non-goals** | NOT a CLI/API reference (→ `harness docs` + cli/README); NOT a docs/how replacement; NOT a contribute-to-this-repo guide (→ AGENTS.md); NOT a flow-internals re-teach; NOT marketing (no ROI/token claims). **Rule: "canonical home elsewhere → orient + link only."** |
| D7 | **Maintenance / drift guard** | The agent/PR that changes a surface **updates the guide doc it touches** (a "touches: guide/NN" pointer near command-bearing sections). Light final-phase guard: a script that checks every relative link resolves + greps each cited `harness <cmd>` against the real command list. DRY commands via `--help` / `harness docs`. |
| D8 | **Voice + readership** | Clear, warm, practical, second-person, never salesy — **not** the decks' theatrical register. Plain GitHub markdown (no brand fonts/HTML). **Agent is a first-class co-reader**: copy-pasteable command blocks, predictable headings, self-contained pages, explicit links, a one-line "for agents" pointer where it helps. |
| D9 | **Scope posture** | All docs, but **pragmatic — don't boil the ocean.** Each doc carries a clear **vibe brief** (purpose, voice, must-haves, links) agreed in the plan; iterate if any come up short. |
| D10 | **Folder name** | Recommend **`docs/guide/`** (dossier rec); user tentatively floated `docs/product-documentation/`. Plan to confirm. |

### Call-outs to confirm / fill as we author (per user: leave inline `🚧 TODO(confirm)` notes AND surface them)
1. **Terminology**: settle "engineering harness flow" vs `the-flow` (skill) vs `harness flow` (024 CLI) — one consistent vocabulary across the guide.
2. **Agent-install file**: deck says agent reads `agent_readme.md`; real files are `AGENTS_README.md` / `AGENTS.md` — which does the agent path point at?
3. **Onboarding in-flux (023)**: which exact steps change (resumable `adopt-flow.json`, cold-start discoverability) → mark §adoption.
4. **`harness flow` (024)**: assumed shipped; confirm the guide only orients + links (impl agent owns the deep doc).
5. **Harnessability assessment**: it's an LLM skill (needs manual assembly), not a deterministic command — phrase accordingly in §adoption.
6. **Folder name** (D10).

### Revised tree (reshaped by the grill — intent-mapped)
`docs/guide/` (folder `README.md` = Start Here / intent router). Serves: (a) learn · (b) install · (c) flows · (d) use-existing.

```
README.md                               ⭐ Start Here — intent router: "need to ___ → go here"
01-quick-start.md                       (b) 15-min install → harness init → doctor → skills → /eng-harness-flow → green boot
02-what-is-an-engineering-harness.md    (a) missing layer; eng vs agent harness; deterministic layer (reuse layer PNG; link intro deck + simple-mode)
03-the-harness-loop.md                  (a) Boot→Backpressure→Observe→Retro/Magic Wand→Improve; the router touchpoints
04-adopting-the-harness.md              (b) the 10-step real onboarding walkthrough; mark 023 in-flux bits
05-using-an-existing-harness.md         (d) NEW — drive a harness already set up: help/doctor/docs, boot, observe, the loop; NO install
06-repo-layouts.md                      consumer .harness/ tree; core vs extensions; committed vs gitignored
07-multi-repo-and-org-rollout.md        shared core + per-repo .harness; monorepo; org-shared/metrics marked Roadmap
08-fitting-your-workflow.md             (c) orient+link: harness flow / the-flow vs BYO-SDD + the 3 touchpoints
09-operating-the-loop.md                daily human+agent use: boot at session start, harness observe, retro drain/harvest
10-encoding-and-learning-loops.md       ⭐ encode the fix not the memory; friction→deterministic; magic wand; compounding (link patterns + simple-mode)
11-backpressure-patterns.md             deterministic ladder: tests → arch-check (ext) → smoke/browser → health
12-extending-the-harness.md             author a verb (harness new) → orient+link docs/how/extend-the-harness
13-maintaining-the-harness.md          keeping core/skills current (harness update / skills update) → link docs/how
14-metrics-and-measures.md             STUB (populate later) — metrics + how to gather them → link harness-value-measures
15-where-to-next.md                     reference map out: foundations, docs/how, skills/README, INSTALL, decks, harness docs
```

Intent coverage from Start Here: (a)→02,03,10 · (b)→01,04 · (c)→08 · (d)→05. 16 files (1 router + 15 chapters; 14-metrics-and-measures is an intentional stub).

---

## 🚨 Critical Discoveries

### CD-01 — `harness init` is shipped (reverses a stale assumption)
`harness/cli/src/acts/init.ts` exists, is registered (`app.ts:195` `registerInitAct`), reserved (`registry.ts:56`), and backed by `services/init/init-service.ts` + `governance-template.ts`. Git: `9e2224a feat(init): harness init — INCEPTION writer of the governance doc (FX001) (#17)`. **Implication**: Quick Start and Adoption cite `harness init`; do **not** tell users to hand-write `.harness/engineering-harness.md`. (A previously-stored memory + the `validate-harness-flow` retro PL-05 are now outdated — recorded here as the durable correction.)

### CD-02 — Deck vs reality reconciliation (the whole reason we researched first)

| Deck claim (`installing-the-harness.md`) | Reality today | Doc action |
|---|---|---|
| npm package name "TBD" (S3/S5/Q3) | **`@ai-substrate/engineering-harness`** (README:73-79; package.json) | Cite the real name |
| `harness init` "open question" | **Exists** (CD-01) | Cite it as the governance step |
| ".harness/ is the only mandatory change" | True, and `harness init` creates it | Keep the reassurance, name the command |
| "the engineering harness flow" vs `the-flow` blurred (S8/S13-15) | **Distinct**: `eng-harness-flow` = adoption/loop router; `the-flow` = separate SDD workflow (SKILL.md:6-9; README:85-92) | Keep them clearly separate (§03/§07) |
| "boot is your first extension" | True as the **first adoption deliverable**, authored via `add-extension`/`harness new`; **`boot` is not a core command** | Frame boot as the first *extension*, not a built-in |
| "three moments" hooks, vaguely named | Real hooks: `pre-flight` / `pre-coding` / `coding` / `post-coding` / `post-flight` (+ `--event` aliases) | Cite real hook names (§03/§07) |
| install paths: run it / ask agent to read `agent_readme.md` | Real: `npm i -g …` then `npx skills@latest add …` (or `harness skills install`); agent path reads root agent docs | Cite the real two paths |

### CD-03 — `boot`/`smoke`/`arch-check` are extensions, not core
Core registers: help, doctor, instructions, new, docs, skills, record, observe, init, update, self-install (CLI-01..13). `boot`, `smoke` are **authored per repo**; `arch-check`, `validate-harnessability`, `validate-harness-flow` are **repo extensions** (`.harness/extensions/*`). **Implication**: §10 (backpressure) and the loop docs must say "you author boot/smoke as extensions," never imply they ship.

---

## The REAL onboarding sequence (today) — the spine of §04

Reconciled from the actual `eng-harness-flow` adopt module + CLI + README/INSTALL (OB-01..09). `023`'s 5-rung model (S0 Install → S1 Scout → S2 Governance → S3 Inject → S4 Boot) is the coarse view; below is the concrete, command-level view. Each step is marked **[implemented]** or **[owed/aspirational]**.

| # | Step | Command / action | Source | Status |
|---|---|---|---|---|
| 1 | Install the CLI (machine-wide) | `npm install -g @ai-substrate/engineering-harness` | README:71-79 | [implemented] |
| 2 | Stamp governance substrate | `harness init` → writes `.harness/engineering-harness.md` (TODO skeleton) | init.ts; governance-template.ts | [implemented] |
| 3 | Sanity-check the CLI | `harness doctor` (`--json`) | doctor.ts:17-59 | [implemented] |
| 4 | Install the skills | `harness skills install --target <cli> [--global]` (wraps `npx skills@latest add AI-Substrate/harness-engineering/skills -y`) | skills.ts; INSTALL.md | [implemented] |
| 5 | Reload skills in the agent (if needed) | e.g. Copilot CLI `/skills reload` | deck S7 | [implemented, agent-dependent] |
| 6 | Run the router (it auto-detects adoption) | `/eng-harness-flow` | SKILL.md:24-34,73-81 | [implemented] |
| 7 | Scout: harnessability assessment | router offers `eng-harness-0-harnessability-assessment` → `.harness/reports/harnessability/latest.{md,json}` | adopt.md:113-127 | [implemented] |
| 8 | Inject: record where the repo's flow calls the router | injection map written into `.harness/engineering-harness.md` | adopt.md:128-150 | [implemented] |
| 9 | Author the first **boot** extension | `harness new boot --wrap "<cmd>"` (guided by `add-extension`) | add-extension.md:33-49 | [implemented] |
| 10 | Verify | `harness doctor`, `harness help`, `harness boot` | adopt.md:178-186 | [implemented] |

> **Consistency constraint (IF-01):** `023` makes this sequence resumable via ephemeral `.harness/temp/adopt-flow.json` (created at step 1, updated each stop, deleted at completion, gitignored). §04 should describe the journey as a **resumable flow** (survives `/compact`), not a static checklist — but must not over-specify the JSON (that's `023`'s contract).

---

## Doc-surface inventory & the boundary rule (feeds every "see also")

### The boundary rule (one sentence)
> Put content in **`docs/guide/`** when it answers *"what do I do next?"* for a reader adopting/operating the harness; put it in **`docs/how/`** when it answers *"how does this repo / CLI / extension actually work?"* for a contributor.

The guide **must not restate** CLI contracts, extension-authoring mechanics, record schemas, or update internals — it summarises the user-facing outcome and links the canonical `how` doc.

### Surfaces → action (DS-01..22, condensed)

| Surface | Path | Guide action |
|---|---|---|
| Product overview | `README.md` | RESTATE short digest → link |
| Skills install matrix | `INSTALL.md` | LINK-OUT (reference) |
| Skills landing | `skills/README.md` | LINK-OUT (reference) |
| Thesis essays | `harness-foundations/{first-principles,patterns-that-work,directives,simple-mode,super-simple-mode}.md` | RESTATE digest → link (esp. §02/§09) |
| How-to guides | `docs/how/{extend-the-harness,record-and-record-types,using-harness-docs,architecture-conformance,keeping-the-harness-up-to-date}.md` | LINK-OUT (reference targets for §10/§11/§12) |
| How-to (internal) | `docs/how/{dogfood-harness-flow,harness-value-measures}.md` | §12 links value-measures; dogfood is internal |
| Canonical layer diagram | `docs/media/harness-layers.{mmd,png}` | REUSE the image in §02 (don't redraw) |
| Decks / static-site | `docs/static-site/*.html`, the 3 decks | LINK-OUT for the visual intro; deck **owns** layer wording |
| AGENTS / CHANGELOG | `AGENTS.md`, `CHANGELOG.md` | IGNORE (internal) |
| CLI README | `harness/cli/README.md` | LINK-OUT (authoritative CLI contract) |

### Canonical wording is owned elsewhere (do not fork)
README:46-48 + intro-to-harness.md declare the **deck owns** the layer-model wording, and `docs/media/harness-layers.mmd` is the diagram source. §02 reuses the rendered PNG and links the deck; it does not re-author layer definitions. (DS canonical-wording note.)

---

## Real CLI surface the docs must cite (CLI-01..14)

| Command | Invocation | What it does | Core/Ext |
|---|---|---|---|
| help | `harness help` | explain harness + list dynamic verbs | core |
| doctor | `harness doctor [--json]` | readiness + loaded/failed/conflicted extensions | core |
| instructions | `harness instructions [verb]` | print agent briefing / a verb's instructions.md | core |
| new | `harness new <name> [--wrap …] [--js] [--record]` | scaffold a new extension | core |
| docs | `harness docs [id]` | list curated bundled docs / print one (raw md) | core |
| skills | `harness skills [install\|update] …` | skills front door + install/update (wraps `npx skills`) | core |
| record | `harness record [type] [--slug …] [--list]` | scaffold/list committed records | core |
| observe | `harness observe "<desc>" [--kind …] [--list] [--clear]` | capture friction during work | core |
| init | `harness init` | stamp `.harness/engineering-harness.md` | core |
| update | `harness update [--check] [--target …] [--global]` | update global CLI / reconcile skills | core |
| self-install | `harness self-install` | first-time global bootstrap | core |
| `<verb>` | `harness <verb>` | any `.harness/extensions/<name>` verb (e.g. boot, arch-check) | extension |

**Install block (verified, copyable):**
```bash
npm install -g @ai-substrate/engineering-harness
harness doctor
npx skills@latest add AI-Substrate/harness-engineering/skills -a claude-code -g   # or: harness skills install --target claude-code --global
```
**Router hooks (§03/§07):** `--hook pre-flight|pre-coding|coding|post-coding|post-flight` (permanent `--event` aliases: `session-start|post-spec|pre-implement|task-pause|phase-end|plan-complete`). SKILL.md:37-48.

> **This-repo caveat (AGENTS.md:19-22):** examples that run inside *this* repo use `node harness/cli/bin/harness.js …`, not `npx`. The guide targets **consumer** repos, where `npm i -g` + `harness …` (and `npx --no-install harness …`) are correct.

---

## Repo layout & multi-repo reality (§05/§06; RL-01..06)

### Consumer `.harness/` layout (what a normal adopted repo has)
```
.harness/
├─ engineering-harness.md          # governance/BIO doc (harness init stamps it)   [tracked]
├─ extensions/<name>/              # per-repo verbs: extension.ts + instructions.md  [tracked]
├─ records/{retro,harness-change}/ # committed team-memory records                  [tracked]
├─ reports/harnessability/latest.{md,json}  # scout output                          [tracked]
└─ temp/                           # scratch incl. observe buffer & adopt-flow.json  [gitignored]
```
**Core vs extensions (RL-02):** the **core** is the global npm CLI (installed once, never committed); **repo-specific behaviour** lives in `.harness/extensions/` and is discovered at runtime. One shared, maintained heart; many local shapes.

### Multi-repo / org rollout — implemented vs concept (RL-05)
- **[implemented]** Core shipped once via npm and used across all repos; each repo owns its `.harness/` substrate + extensions.
- **[concept/roadmap]** "Improvements shared between all teams" = the *centrally maintained core*, **not** a shared cross-repo extension registry. Org-wide metrics/rollups are dogfood/reporting concepts, not a shipped central substrate. §06 must label these as direction, not feature.
- **Monorepo**: each app/package can carry extensions; one `.harness/` at the repo root is the model (note for §06).

### This repo ≠ a plain consumer (RL-06)
This checkout is **dual-role** (product source `harness/cli/` + `skills/` AND a dogfood site via `.minih.json`/`agents/`). §05 must describe the **consumer** layout (just `.harness/` + global CLI), not this repo's tree.

---

## Prior learnings & in-flight constraints (PL/IF) — honor these

| ID | Constraint the guide must honor | Source |
|---|---|---|
| PL-01/02 | `docs/how/` is the current user-guide home; `harness docs` is the curated CLI front door. The guide complements, doesn't replace, that model. | using-harness-docs.md; plan 007 |
| PL-03 | `harness docs <id>` emits **raw markdown** (not an envelope) — don't claim "every command emits an envelope." | retro 007 |
| **PL-04** | **Skill-vs-surface drift is the dominant docs-only failure.** Keep package name, commands, paths, install phrasing identical across every surface. Bake a link/command check into the final phase. | retro 008 |
| PL-05 | Don't assume deterministic onboarding outputs that don't exist (harnessability assessment still needs assembly); but note `harness init` now DOES exist (CD-01). | retro validate-harness-flow |
| IF-01 | Stay consistent with `023`'s 5-rung adopt flow + ephemeral `adopt-flow.json` state (resumable across `/compact`). | plan 023 workshop 001 |
| IF-02 | One breadcrumb spelling; no stale `npx harness instructions`; cold-start install info must travel product-side. | plan 023 |
| IF-03 | `024` ships `harness flow` (the-flow + harness-loop) and **excludes onboarding** — don't conflate onboarding with `024`. | plan 024 |

---

## Proposed documentation tree (grounded in the findings)

`docs/guide/` — flat + numbered, folder `README.md` is "Start Here". Six implicit parts.

```
docs/guide/
├── README.md                              ⭐ START HERE — what it is, who it's for, the map, two reading paths
├── 01-quick-start.md                      ~15 min: real install → harness init → doctor → skills → /eng-harness-flow → first boot
├── 02-what-is-an-engineering-harness.md   the missing layer; eng- vs agent-harness; deterministic layer (reuse layer PNG, link deck)
├── 03-the-harness-loop.md                 Boot→Backpressure→Observe→Retro/Magic Wand→Improve; the /eng-harness-flow hooks; eng-harness-flow ≠ the-flow
├── 04-adopting-the-harness.md             THE onboarding walkthrough — the 10-step real sequence, resumable (adopt-flow), two install paths
├── 05-repo-layouts.md                     the consumer .harness/ tree; core vs extensions; committed vs gitignored
├── 06-multi-repo-and-org-rollout.md       shared core + per-repo .harness; monorepo; mark org-shared/metrics as roadmap
├── 07-fitting-your-workflow.md            non-coercive; BYO SDD vs built-in the-flow; the three router touchpoints; injection map
├── 08-operating-the-loop.md               daily human+agent use: boot at session start, harness observe, retro drain/harvest
├── 09-encoding-and-learning-loops.md      ⭐ encode the fix not the memory; friction→deterministic capability; magic wand; compounding
├── 10-backpressure-patterns.md            deterministic ladder: tests → arch-check (ext) → smoke/browser → health (least→most reliable)
├── 11-extending-the-harness.md            author a verb (harness new) → links docs/how/extend-the-harness.md + harness docs authoring-verbs
├── 12-measuring-and-maintaining.md        value measures + keeping core/skills current (harness update, skills update) → links docs/how/*
└── 13-where-to-next.md                    reference map out: foundations, docs/how, skills/README, INSTALL, decks, harness docs
```

**Part grouping** (drives the Start-Here TOC): Get going (01) · Understand it (02-03) · Adopt it (04-07) · Operate it (08) · Grow it (09-11) · Sustain & deeper (12-13).

**Per-page nav template** (each doc links the next — GitHub-native relative links):
```markdown
# <Title>
> **<one-line value>.** <who/when> · ~N min   [· Before this: [..](..)]

…body…

---
### Next steps
- <concrete actions>
---
<sub>← Prev: [Title](file.md) · [↑ Start here](README.md) · Next: [Title](file.md) →</sub>
```

---

## Open questions / decisions for the plan stage

1. **Folder name**: `docs/guide/` (recommended) vs the user's tentative `docs/product-documentation/`. (DS recommends `docs/guide/`.)
2. **MVP wave vs all-13**: write all 14 as full docs, or scaffold all + fully write a 6-doc MVP (01,02,03,04,07,09) and stub the rest? (Affects phase count / CS.)
3. **Onboarding depth in §04**: how much of `023`'s `adopt-flow.json` mechanism to expose to readers vs keep as "it just resumes"? (IF-01 says stay consistent, don't over-specify.)
4. **Diagrams**: rely on GitHub-rendered ```mermaid blocks (render in native UI) and/or reuse `harness-layers.png`? Confirm mermaid renders acceptably in the target GitHub.
5. **Drift guard**: add a lightweight final-phase check (links resolve, command strings match the real CLI) given PR-04 names drift as the top docs risk?
6. **Cross-link with 023**: 023 plans a "doc sweep" — coordinate so 025 owns the *guide* and 023 updates the *surfaces it already lists* without overlap.

## External research opportunities
None — this is an internal IA/synthesis task; all inputs are in-repo or in the referenced decks. No `/deepresearch` needed.

## Handoff
Dossier is the deliverable for `/the-flow 1b plan`. The plan should: lock the folder name (Q1) and MVP scope (Q2), turn the 14-doc tree into phases (likely: Phase 1 scaffold + landing + nav template + Quick Start; Phase 2 understand+adopt; Phase 3 operate+grow; Phase 4 sustain + drift/link check), and bake PL-04's drift guard into the final phase.
