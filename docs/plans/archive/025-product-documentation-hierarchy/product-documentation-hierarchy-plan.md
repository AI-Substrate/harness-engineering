# Product-Documentation Hierarchy (`docs/guide/`)

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-18
**Status**: READY
**Spec source**: unified (this file)

> 📚 Incorporates findings from `research-dossier.md` (including the grill-session Pre-Plan Decision Record D1–D10).

---

## Business Specification

### Research Context
Five parallel explore threads reconciled the aspirational `installing-the-harness.md` deck against today's code and inventoried every existing doc surface. Key reconciliations: `harness init` **is** shipped (CD-01); `boot`/`smoke`/`arch-check` are **extensions**, not core commands (CD-03); `eng-harness-flow` (router) ≠ `the-flow` (SDD); `docs/guide/` is the right home, separate from `docs/how/`; the deck owns canonical layer wording. An 8-question grill then locked scope, audience, success bar, voice, and a drift-guard convention (D1–D10 in the dossier).

### Summary
Our consumer-facing documentation is a deep-end throw: README/INSTALL assume too much. This plan authors a **guided learning spine** at `docs/guide/` — a `README.md` intent-router plus 15 chapter docs (one an intentional metrics stub) — that takes an external adopting engineer (and their agent) from "what is this?" to a verified green `harness boot`, and onward to operating and growing the harness. It **orients and links** rather than re-teaching anything with a canonical home, is written shipped-today with marked Roadmap callouts, and ships a light drift guard so it can't silently rot.

### Goals
- A single reader path that serves four intents from one Start Here: **(a)** learn harness concepts, **(b)** install + bootstrap into their repo, **(c)** weave into / start a flow, **(d)** drive a harness someone else already set up.
- A cold engineer + agent reach a **verified green `harness boot`** using only `docs/guide/`, no human needed.
- Every command verified against the real CLI; every page links the next; renders in GitHub's native UI (no Pages).
- Distinct from `docs/how/` (contributor/technical) and `harness-foundations/` (thesis) — this is the adopter's learning + operating path.

### Non-Goals (D6)
- **Not** a CLI/command reference — that is `harness docs` + `harness/cli/README.md` (orient + link).
- **Not** a replacement for `docs/how/` (technical task reference stays there).
- **Not** a guide to building/contributing to **this** repo — that is `AGENTS.md`.
- **Not** a re-teach of `the-flow` / `harness flow` internals (orient + link).
- **Not** marketing — no ROI / token-saving claims (the deck itself warns against this).
- **Not** GitHub Pages — GitHub-native markdown rendering only.

### Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| documentation (`docs/guide/`) | **NEW surface** | **create** | The reader-facing guide hierarchy — markdown content only |

> **No code domains are touched.** This is a documentation-only deliverable, so code-domain scaffolding (`domain.md`, `docs/domains/registry.md`, source dirs) is **N/A** — the G7 NEW-domain-setup check does not apply to a docs-only surface. There is no domain registry in this repo.

### Testing Strategy
- **Approach**: Lightweight.
- **Rationale**: the deliverable is markdown; correctness = (1) a deterministic **drift guard** (every relative link resolves; every cited `harness <cmd>` exists in the real command list) and (2) a manual **cold-read test** against the north star.
- **Focus Areas**: command accuracy, link integrity, GitHub-native rendering (incl. ` ```mermaid ` blocks), the four-intent routing, prev/next continuity.
- **Excluded**: unit tests (no code); heavy CI gating (a hand-runnable check for v1).
- **Mock Usage**: N/A — no code, no mocks.

### Documentation Strategy
- **Location**: `docs/guide/` — a NEW reader-facing hierarchy, separate from `docs/how/`.
- **Rationale**: the deliverable *is* documentation. `docs/how/` remains the contributor/technical reference the guide links into.

### Complexity
- **Score**: CS-3 (medium)
- **Breakdown**: S=2 (16 files), I=0 (no code integration), D=0, N=1 (IA design + deck-vs-reality reconciliation), F=1 (GitHub-native rendering + agent-readability + drift), T=1 (drift guard + link check)
- **Confidence**: 0.80
- **Assumptions**: `harness flow` (024) is shipped and its impl agent maintains its deep doc; onboarding (023) will shift slightly; the real CLI command list is stable enough to verify against.
- **Dependencies**: the real `harness` CLI command surface (CLI-01..14); `docs/media/harness-layers.png`; `intro-to-harness.md` + `simple-mode.md` as concept sources.
- **Risks**: see Risks table.
- **Phases**: Simple — one phase, inline tasks.

### Acceptance Criteria
- **AC-01** — A cold external engineer + agent, starting only from `docs/guide/README.md`, can install the CLI + skills and reach a **verified green `harness boot`** in their own repo without asking a human. *(north star, intent b)*
- **AC-02** — Every `harness <cmd>` cited in the guide exists in the real CLI command list, and every relative link resolves (drift guard passes). *(guardrail)*
- **AC-03** — A newcomer to a repo that already has a harness can drive it (boot, observe, the loop) using only `05-using-an-existing-harness.md`, with no install/adopt. *(intent d)*
- **AC-04** — Start Here (`README.md`) routes all four reader intents (a/b/c/d) to a correct entry doc in one hop.
- **AC-05** — `08-fitting-your-workflow.md` orients + links to canonical flow docs and does **not** reproduce `the-flow` / `harness flow` internals. *(D5/D6)*
- **AC-06** — Concept docs (02/03/10) reuse `docs/media/harness-layers.png` and link `intro-to-harness.md` + `simple-mode.md` rather than re-authoring layer definitions. *(canonical-wording ownership)*
- **AC-07** — Every doc ends with a `← Prev · ↑ Start Here · Next →` nav footer; the reading order is continuous and acyclic.
- **AC-08** — All 6 open call-outs appear as inline `🚧 TODO(confirm)` markers in the relevant docs **and** in a single consolidated list surfaced to the user. *(D-record)*
- **AC-09** — Voice is second-person, practical, non-salesy; plain GitHub markdown (no brand fonts/HTML); commands in copy-pasteable fenced blocks (agent-readable). *(D8)*
- **AC-10** — `docs/guide/` is discoverable via a root `README.md` → `docs/guide/` link. **Ownership: plan 023's doc sweep owns `README.md`** — 025 supplies the exact link line and coordinates; 025 does not edit `README.md` directly (deconflicts double-ownership).

### Risks & Assumptions
- **Drift** (top risk, PL-04): docs describe commands/flows in flux. Mitigated by AC-02 drift guard + the "impl agent updates the doc it touches" convention.
- **Aspirational leakage**: writing the deck's vision as if shipped. Mitigated by D2 (shipped-today + marked Roadmap callouts) and the 6 call-outs.
- **Overlap with 023's doc sweep**: 025 owns the *guide*; 023 updates the *surfaces it already lists*. Coordinate to avoid double-editing the same lines.
- **Mermaid rendering**: assume GitHub native UI renders ` ```mermaid ` blocks; fall back to the PNG where uncertain.

### Open Questions  *(the 6 call-outs — tracked as inline `🚧 TODO(confirm)` + surfaced)*
1. **Terminology**: one consistent vocabulary for `the-flow` (skill) vs `harness flow` (024 CLI) vs "engineering harness flow".
2. **Agent-install file**: deck says `agent_readme.md`; real files are `AGENTS_README.md` / `AGENTS.md` — which does the agent path point at?
3. **Onboarding in-flux (023)**: which exact steps change (resumable `adopt-flow.json`, cold-start discoverability)?
4. **`harness flow` (024)**: confirm the guide only orients + links (impl agent owns the deep doc).
5. **Harnessability assessment**: it's an LLM skill (manual assembly), not a deterministic command — phrase accordingly.
6. **(resolved)** Folder name → `docs/guide/`.

### Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| _(none)_ | — | The grill already resolved IA, audience, scope, voice, and the drift convention. | — |

### Clarifications

#### Session 2026-06-18
- **Q: Primary reader?** → External adopting engineer + agent, across 4 intents (a learn / b install+bootstrap / c weave-flows / d use-existing). *(D1)*
- **Q: Shipped vs vision?** → Shipped-today + marked Roadmap callouts; assume `harness flow` (024) shipped; lean on `intro-to-harness.md` + `simple-mode.md`; mark 023-in-flux bits. *(D2)*
- **Q: IA shape?** → Start Here = intent-router; intent (d) gets its own doc. *(D3)*
- **Q: Success bar?** → Cold engineer + agent → verified green `harness boot` from `docs/guide/` alone; (d) reader drives an existing harness from its doc. *(D4)*
- **Q: Flows depth?** → Orient + link, never re-teach. *(D5)*
- **Q: Non-goals?** → CLI ref / docs-how replacement / contribute guide / flow internals / marketing — all out; "canonical home elsewhere → orient+link". *(D6)*
- **Q: Drift?** → Impl agent updates the doc it touches; light final-task drift guard (links + commands). *(D7)*
- **Q: Voice + readership?** → Clear/warm/practical/second-person, not theatrical; plain markdown; agent is a first-class co-reader. *(D8)*
- **Q: Scope?** → All docs, pragmatic, per-doc vibe briefs, iterate if short. *(D9)*
- **Q: Workflow Mode?** → Simple (one phase, inline tasks). **Q: Folder?** → `docs/guide/`. *(D10)*

---

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: none — all resolved in the grill.

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | y | informs Key Findings + the tree + the onboarding sequence + D1–D10 |
| workshops/*.md | n | — |

---

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No critical `[NEEDS CLARIFICATION]`; grill resolved all. |
| G2 | Constitution | PASS | Docs-only; respects the publication boundary (public, sanitized, no private identifiers). |
| G3 | Architecture | N/A | `architecture.md` governs the CLI's hexagonal arch — not touched by docs. |
| G4 | ADR Compliance | N/A | No `docs/adr/`. |
| G5 | Structure | PASS | All required sections present. |
| G6 | Testing Alignment | PASS | Lightweight: drift-guard validation task present (T016); ACs are measurable. |
| G7 | Domain Completeness | PASS | Single docs surface; no code domains → NEW-domain setup check N/A (noted in Target Domains). |

### Summary
Author `docs/guide/` as a 16-file reader spine: a `README.md` intent-router plus 15 chapters (one an intentional metrics stub) grouped Get-going → Understand → Adopt → Operate → Grow → Sustain. Each doc is written shipped-today, orients-and-links to canonical sources, carries a prev/next nav footer, and is agreed against a per-doc vibe brief before authoring. A final drift-guard task verifies links + command names and surfaces the open call-outs.

### Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `docs/guide/README.md` | documentation | content | Start Here intent-router (landing page) |
| `docs/guide/01-quick-start.md` | documentation | content | install → green boot |
| `docs/guide/02-what-is-an-engineering-harness.md` | documentation | content | concepts (a) |
| `docs/guide/03-the-harness-loop.md` | documentation | content | the loop (a) |
| `docs/guide/04-adopting-the-harness.md` | documentation | content | onboarding walkthrough (b) |
| `docs/guide/05-using-an-existing-harness.md` | documentation | content | drive existing (d) |
| `docs/guide/06-repo-layouts.md` | documentation | content | `.harness/` layout |
| `docs/guide/07-multi-repo-and-org-rollout.md` | documentation | content | multi-repo (+ Roadmap) |
| `docs/guide/08-fitting-your-workflow.md` | documentation | content | flows (c), orient+link |
| `docs/guide/09-operating-the-loop.md` | documentation | content | daily use |
| `docs/guide/10-encoding-and-learning-loops.md` | documentation | content | flagship: encoding |
| `docs/guide/11-backpressure-patterns.md` | documentation | content | deterministic ladder |
| `docs/guide/12-extending-the-harness.md` | documentation | content | author a verb, orient+link |
| `docs/guide/13-maintaining-the-harness.md` | documentation | content | keep core/skills current, orient+link |
| `docs/guide/14-metrics-and-measures.md` | documentation | content | **stub** — metrics + how to gather (populate later) |
| `docs/guide/15-where-to-next.md` | documentation | content | reference map out |
| `README.md` (root) | documentation | cross-domain | guide link **supplied to 023's README sweep** (023 owns the edit) — not edited by 025 |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | `harness init` is shipped and stamps the governance doc (CD-01). | Quick Start + Adoption cite `harness init`; never "hand-write the doc". |
| 02 | Critical | `boot`/`smoke`/`arch-check` are **extensions**, not core commands (CD-03). | Frame boot as the first *extension*; §11 shows authoring; never imply they ship. |
| 03 | High | The install deck is aspirational; reality has moved (CD-02). | Write shipped-today + marked Roadmap callouts; verify every command. |
| 04 | High | Drift is the dominant docs failure (PL-04). | Mandatory drift guard (T016) + "impl agent updates its doc" convention. |
| 05 | High | Honor 023 (adopt flow + `adopt-flow.json`) and 024 (`harness flow`; excludes onboarding). | §04 stays consistent with the 5-rung adopt model; §08 treats `harness flow` as shipped, orient+link. |
| 06 | Medium | Canonical layer wording is owned by the deck; `harness-layers.png` exists. | §02 reuses the PNG + links the deck; do not re-author layer definitions. |

### Per-Doc Vibe Briefs  *(the contract for each doc — agreed before authoring; D9)*

| Doc | Intent | Vibe / voice | Must-haves | Orients to (links) | Size |
|-----|--------|--------------|------------|--------------------|------|
| `README.md` (Start Here) | router | warm, orienting, "pick your path" | the 4 "need to ___ → go here" routes; 1-para what-this-is; the map | every chapter; the decks for the visual intro | S |
| `01-quick-start.md` | b | brisk, confident, do-this-now | verified install block; `harness init`; `doctor`; skills install + reload; `/eng-harness-flow`; the green-boot finish line | INSTALL.md; §04 for depth | M |
| `02-what-is-an-engineering-harness.md` | a | clear, a little vivid; concept-first | the missing layer; eng- vs agent-harness; deterministic layer; the layer PNG | intro deck; `simple-mode.md`; `first-principles.md` | M |
| `03-the-harness-loop.md` | a | practical mental-model | Boot→Backpressure→Observe→Retro/Magic Wand→Improve; the router touchpoints (hooks) | `directives.md`; §08; §09 | M |
| `04-adopting-the-harness.md` | b | patient, step-by-step, reassuring | the 10-step real sequence; two install paths; 🚧 023 in-flux notes; resumable framing | skills/README; §05; §11 | L |
| `05-using-an-existing-harness.md` | d | newcomer-friendly, "you just cloned this" | drive it with no install: `harness help/doctor/docs`, boot, `observe`, the loop | §03; §09; `harness docs` | M |
| `06-repo-layouts.md` | b/d | concrete, map-like | the consumer `.harness/` tree; core vs extensions; committed vs gitignored | record-and-record-types; §11 | M |
| `07-multi-repo-and-org-rollout.md` | b | honest about shipped vs roadmap | shared core + per-repo `.harness`; monorepo note; 🚧 Roadmap callouts for org-shared/metrics | §06; README "about" | M |
| `08-fitting-your-workflow.md` | c | non-coercive, "enhances not replaces" | the 2 paths (harness flow / the-flow vs BYO-SDD + 3 touchpoints); when to use which | the-flow + harness flow canonical docs; §03 | M |
| `09-operating-the-loop.md` | a/all | rhythm-of-work, human+agent | boot at session start; `harness observe` during work; retro drain/harvest | §03; skills/README; record-and-record-types | M |
| `10-encoding-and-learning-loops.md` | a (flagship) | the payoff; a little inspiring but grounded | encode the fix not the memory; friction→deterministic; magic wand; compounding | `patterns-that-work.md`; `simple-mode.md`; §11 | L |
| `11-backpressure-patterns.md` | a/grow | pragmatic ladder | tests → arch-check (ext) → smoke/browser → health; least→most reliable | architecture-conformance; §12 | M |
| `12-extending-the-harness.md` | grow | enabling, "it's easy" | author a verb with `harness new`; where extensions live | docs/how/extend-the-harness; `harness docs authoring-verbs` | S |
| `13-maintaining-the-harness.md` | sustain | steady, lifecycle | keeping core/skills current (`harness update`, `skills update`); staleness handling | keeping-the-harness-up-to-date; docs/how | S |
| `14-metrics-and-measures.md` | sustain | **stub for now**; later: practical, dashboard-minded | what to measure (change-failure rate, lead time, token usage, harness bypass rate, skills usage) + how to gather them; `🚧 TODO(populate)` | harness-value-measures; installing deck (metrics) | S (stub) |
| `15-where-to-next.md` | all | a clean send-off + index | reference map out to every canonical source | foundations; docs/how; skills/README; INSTALL; decks; `harness docs` | S |

### Implementation

**Objective**: Author the `docs/guide/` reader spine (1 router + 15 chapters; `14-metrics-and-measures.md` is an intentional stub for now), each to its vibe brief, with continuous nav, shipped-today accuracy, and a passing drift guard.
**Testing Approach**: Lightweight — the drift guard (links resolve + cited commands exist) + a cold-read pass against AC-01/AC-03.

#### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | T001 | Scaffold `docs/guide/` + write Start Here `README.md` (4-intent router) + define the prev/next nav-footer template | documentation | `docs/guide/README.md` | Folder exists; README renders as the landing page in GitHub UI; routes a/b/c/d each to one chapter; nav template fixed | AC-04, AC-07 |
| [ ] | T002 | Write `01-quick-start.md` | documentation | `docs/guide/01-quick-start.md` | A cold reader reaches a verified green `harness boot` following only this doc; every command verified; nav footer present | AC-01, AC-02, KF-01; note: `boot` is an **extension**, not core |
| [ ] | T003 | Write `02-what-is-an-engineering-harness.md` (reuse layer PNG) | documentation | `docs/guide/02-what-is-an-engineering-harness.md` | Concepts land; layer PNG embedded; links intro deck + simple-mode; no re-authored layer defs; nav footer | AC-06, KF-06 |
| [ ] | T004 | Write `03-the-harness-loop.md` | documentation | `docs/guide/03-the-harness-loop.md` | Contains the loop Boot→Backpressure→Observe→Retro/Magic Wand→Improve AND names + links the exact router hooks (pre-flight/pre-coding/coding/post-coding/post-flight); nav footer present | D2 |
| [ ] | T005 | Write `04-adopting-the-harness.md` (10-step sequence; 🚧 023 notes) | documentation | `docs/guide/04-adopting-the-harness.md` | Steps match the real adopt flow; `harness init` cited; in-flux bits marked `🚧 TODO(confirm)`; nav footer | KF-01, KF-05, AC-08 |
| [ ] | T006 | Write `05-using-an-existing-harness.md` | documentation | `docs/guide/05-using-an-existing-harness.md` | A newcomer can drive an existing harness from this doc alone, no install; nav footer | AC-03 |
| [ ] | T007 | Write `06-repo-layouts.md` | documentation | `docs/guide/06-repo-layouts.md` | Consumer `.harness/` tree accurate (committed vs gitignored); core vs extensions clear; nav footer | RL-01..04 |
| [ ] | T008 | Write `07-multi-repo-and-org-rollout.md` (Roadmap callouts) | documentation | `docs/guide/07-multi-repo-and-org-rollout.md` | Shipped vs roadmap separated; org-shared/metrics marked `🚧 Roadmap`; nav footer | KF-03, RL-05, AC-08 |
| [ ] | T009 | Write `08-fitting-your-workflow.md` (orient + link) | documentation | `docs/guide/08-fitting-your-workflow.md` | 2 paths + 3 touchpoints described; links canonical flow docs; no internals re-teach; nav footer | AC-05, KF-05 |
| [ ] | T010 | Write `09-operating-the-loop.md` | documentation | `docs/guide/09-operating-the-loop.md` | Names the session-start boot, the `harness observe` capture step, and the retro drain/harvest sequence with all cited commands real; nav footer present | D8 |
| [ ] | T011 | Write `10-encoding-and-learning-loops.md` (flagship) | documentation | `docs/guide/10-encoding-and-learning-loops.md` | "Encode the fix not the memory" + compounding land; links patterns + simple-mode; nav footer | KF-04 |
| [ ] | T012 | Write `11-backpressure-patterns.md` | documentation | `docs/guide/11-backpressure-patterns.md` | Deterministic ladder accurate; least→most reliable; nav footer | KF-02; note: `boot`/`smoke`/`arch-check` are **extensions**, not core |
| [ ] | T013 | Write `12-extending-the-harness.md` (orient + link) | documentation | `docs/guide/12-extending-the-harness.md` | `harness new` shown; links docs/how/extend-the-harness; nav footer | AC-05 |
| [ ] | T014 | Write `13-maintaining-the-harness.md` (orient + link) | documentation | `docs/guide/13-maintaining-the-harness.md` | Names the two update commands (`harness update`, `harness skills update`) and links the canonical docs/how pages (keeping-the-harness-up-to-date); nav footer present | — |
| [ ] | T015 | Write `14-metrics-and-measures.md` — **intentional stub** | documentation | `docs/guide/14-metrics-and-measures.md` | File exists with title + one-line scope + `🚧 TODO(populate)` marker + a skeleton list of candidate measures (change-failure rate, lead time to delivery, token usage, harness bypass rate, skills usage) + a how-to-gather placeholder; linked from Start Here + nav footer; intentionally not fully written | links harness-value-measures; populate later |
| [ ] | T016 | Write `15-where-to-next.md` (reference map) | documentation | `docs/guide/15-where-to-next.md` | Links every canonical source; closes the spine; nav footer | AC-07 |
| [ ] | T017 | Drift guard + surface call-outs (+ supply README link to 023) | documentation | `docs/guide/*` | Script/check: every relative link resolves AND every cited `harness <cmd>` exists in the real command list → pass; the 6 call-outs surfaced in one list; the exact root-README→`docs/guide/` link line supplied to plan 023's README sweep (single owner — see Risks) | AC-02, AC-08, AC-10 |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | T001, T002 | cold-read → green boot |
| AC-02 | T002, T017 | drift guard |
| AC-03 | T006 | cold-read (d) |
| AC-04 | T001 | router renders, 4 routes |
| AC-05 | T009, T013 | orient+link, no internals |
| AC-06 | T003 | PNG embedded, deck linked |
| AC-07 | T001, T016 | nav footers continuous |
| AC-08 | T005, T008, T017 | inline TODOs + surfaced list |
| AC-09 | T002–T016 | voice + markdown + copy-paste blocks |
| AC-10 | T017 | link supplied; 023 owns README edit |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Command/flow drift | High | High | T016 drift guard + "impl agent updates its doc" convention |
| Aspirational leakage | Medium | High | D2 shipped-today + `🚧 Roadmap`/`🚧 TODO(confirm)` callouts |
| Overlap with 023 doc sweep (incl. `README.md`) | Medium | Medium | 025 owns `docs/guide/*`; 023 owns `README.md` + existing-surface edits. 025 supplies the root-README guide link to 023's sweep (single owner) — no double-edit |
| Mermaid not rendering in target GitHub | Low | Low | Prefer the PNG; keep mermaid optional |

---

## Validation Record (2026-06-18)

### Validation Thesis
**Raison d'être**: Turn the research dossier (14→15-doc tree + verified 10-step onboarding + decisions D1–D10) into a lean, actionable contract to author `docs/guide/`.
**Value claim**: The implementer (human/agent) writes coherent, command-accurate, navigable docs without re-deciding scope/voice/structure.
**Artifact promise**: The implement stage can execute T001–T017 to produce `docs/guide/` satisfying AC-01..AC-10 with no further product decisions.
**Intended beneficiaries**: (1) the doc implementer; (2) the external adopting engineer + agent who reads `docs/guide/`.
**Proof target**: Implementation. **Evidence standard**: testable Done-Whens, measurable ACs, real commands, 4-intent coverage, drift guard.
**Thesis source**: `research-dossier.md` (D1–D10) + `original-ask.md`.
**Thesis verdict**: Advanced.
**Main thesis risk**: Residual drift is executional (keeping commands/links current), not a plan-thesis mismatch.

| Agent | Lenses Covered | Thesis Axes | Issues | Verdict |
|-------|---------------|-------------|--------|---------|
| Coherence/Completeness | Concept Docs, Edge Cases, Hidden Assumptions, System Behavior, Evidence Sufficiency, Proof-Level Fit | Implementation Readiness, Evidence Sufficiency, Downstream Usefulness | 2 MEDIUM + 1 LOW (fixed); 1 MEDIUM (Simple-vs-Full) user-accepted/open | ⚠️→✅ |
| Thesis Alignment | Thesis Alignment | Thesis, User-Value Preservation, Proof-Level Fit | 0 | ✅ |
| Forward-Compatibility | Forward-Compatibility, Integration & Ripple, Domain Boundaries | Downstream Usefulness | 1 HIGH (fixed) | ⚠️→✅ |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| implement stage | unambiguous Done-When + path per task | none | ✅ | T001–T017 each carry a concrete path + pass condition (vague Done-Whens T004/T010/T014 sharpened) |
| docs/guide readers (a/b/c/d) | 4 intents covered, one-hop from Start Here | none | ✅ | Start Here routes 4 intents; intent (d) has dedicated `05-using-an-existing-harness.md` |
| drift guard (T017) | enumerable real command list | none | ✅ | `harness/cli/src/app.ts` enumerates core commands + dynamic verbs |
| plan 023 doc sweep | no file double-ownership | contract drift (RESOLVED) | ✅ | README collision deconflicted — 025 owns `docs/guide/*`, supplies the link to 023 (single owner of `README.md`); see T017 + AC-10 + Risks |

**Thesis alignment**: Value claim advanced (Yes); proof level Implementation = Implementation; main thesis risk is executional drift, not thesis mismatch.

**Outcome alignment**: "A cold external engineer + agent reach a verified green `harness boot` using only docs/guide/, no human needed." — the plan advances this; the README ownership collision the validator flagged is now deconflicted (T017/AC-10).

**Standalone?**: No — downstream consumers exist (implement stage, docs/guide readers, drift guard, plan 023 sweep).

**Notes**: The Coherence agent recommended splitting Simple → ≥2 phases; the user explicitly chose **Simple** (one phase, inline tasks) — accepted, revisit if the single phase proves heavy.

Overall: ⚠️ **VALIDATED WITH FIXES**
