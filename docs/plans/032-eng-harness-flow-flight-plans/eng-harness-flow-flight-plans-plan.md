# eng-harness-flow flight plans — two first-class CLI-driven flows + chore co-existence

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-19
**Status**: READY
**Spec source**: unified (this file)

> 📚 Incorporates findings from [research-dossier.md](./research-dossier.md) (5-lens fan-out, 20 prior learnings). **Executes the already-validated design in [plan 028 `eng-harness-flow-flight-map.md`](../028-eng-harness-flow-flight-map/eng-harness-flow-flight-map.md)** — re-baselined against the live CLI (v0.4.0) — rather than re-deriving it.
> **Edit target (CORRECTED post-validation)**: the `eng-harness-flow` skill **lives in THIS repo** (`skills/eng-harness-flow/`) — it is vendored here, unlike `the-flow` (owned by the tools repo). So the skill rewrite, CLI substrate, eval agents + scorers, docs, and golden fixtures are **all in harness-engineering**. The **only** cross-repo touch is `the-flow`'s `harness-seams.md` (tools repo), edited for the R-1 chore/seam reconciliation. (This corrects the original draft's mistaken "skill source in tools repo" assumption — see Validation Record.)
> **Mode note**: the user directed **Simple / single-phase**. The honest CS is **CS-4** (large — net-new adopt overlay + skill supersession + 3 eval agents). Simple is therefore a *deliberate user choice*, not a CS read; the single phase below groups the work into four task groups (A–D).

---

## Business Specification

### Summary
Make `eng-harness-flow` a **first-class, CLI-driven `harness flow` system** — the harness-loop analogue of what plans 024/026/030 did for the-flow. It drives **two mutually-exclusive flows** through the **real `harness flow` verb family** (create / add-node / nav set / nav meta / rail / render / chores): a finite **🧰 adopt** onboarding flow and a cycling **⚙️ loop** flow. Detection picks the live one (gate satisfied → loop; else adopt) — they never co-run. When the loop runs **alongside an active the-flow**, eng-harness-flow injects its four fire-hook steps as **chore nodes** into `the-flow.json` (`run /eng-harness-flow --hook …`) so the main flow's rail tracks them and they stop getting missed; standalone, it authors its own `.harness/loop.flow.json`. This is **dogfooding + an exemplar** of the flow features. Three validation agents (one adapted, two new) prove all three behaviours with deterministic scorers.

### Goals
- Two real, CLI-driven flight-plan flows for `eng-harness-flow`: `harness-adopt` (new overlay) + a modernized `harness-loop`.
- Drive position with **real `harness flow nav` commands only** — full dice, never hand-edited JSON (skill invariant #6).
- Consciously **supersede the skill's stateless contract**, scoped to *flow position*; verb modules stay harness-blind; the five lifecycle hooks stay fixed.
- Loop ↔ the-flow co-existence via **chore injection** (4 fire hooks), idempotent, lifecycle-tracked; chores-only while the-flow is active.
- Three eval agents + three deterministic scorers proving adopt / standalone-loop / coexistence.

### Non-Goals
- **No** new convenience verb (e.g. `flow inject-chores`) — sequential `add-node`/`insert-node` calls suffice (research GAP-9).
- **No** core schema reshape — chore model, statuses, and event log already exist; status vocab is overlay-declared.
- **No** change to the five hooks, the `--event` aliases, or the `--json`/`--hooks` envelope contract.
- **No** automation of `minih` runs from the skill, and **no** running `/compact` from the skill.
- the-flow skill is **not vendored** here (edits land in the tools repo).

### Target Domains
> No `docs/domains/` registry exists in this repo — domains below are informal code areas, not formalized domain docs. Gate G7 is therefore lightweight.

| Domain (informal) | Status | Relationship | Role in this feature |
|---|---|---|---|
| flow-cli (`harness/cli/src/services/flow/`) | existing | **modify** | Add `harness-adopt` overlay+template; modernize `harness-loop` template; zone defaults; gen:flows inline; render fixtures |
| eng-harness-flow-skill (tools repo) | existing | **modify** | Supersede stateless contract; two-flow Graph; flight-plan-ops analogue; chore-injection; capability precheck; coach rail |
| eval-harness (`agents/`, `scripts/`) | existing | **modify/create** | Adapt validate-harness-flow; add loop-flow-eval + flow-coexist-eval + two scorers |
| docs (`docs/how/harness-flow.md`) | existing | **modify** | Document new node types, zones, two-flow model, chore-injection |

### Testing Strategy
**Approach: Lightweight** (default for Simple). The deterministic backbone is: `harness flow render --check` against committed golden fixtures, the CLI vitest suite (`just test`), and the three eval scorers (`scripts/score-*.sh`, `#!/usr/bin/env bash`, `jq -e` fail-fast gates). **Focus areas**: overlay/template validity, zone banding, chore-injection idempotency, flow selection. **Excluded**: heavy unit TDD of skill prose (proven by eval agents instead). **Mock usage: A — avoid mocks** (the flow service already uses the in-repo fake-fs adapter; eval agents drive the real CLI).

### Documentation Strategy
**B — docs/how/ only**: update `docs/how/harness-flow.md` (the authoritative CLI reference) for the new node types/zones/two-flow model. The skill's own `flight-plan-ops` analogue is a *skill artifact* (ships with the skill in the tools repo), not repo documentation.

### Complexity
- **Score**: CS-4 (large)
- **Breakdown**: S=2, I=2, D=1, N=1, F=1, T=2 (sum 9)
- **Confidence**: 0.80
- **Assumptions**: the chore data model + `harness-loop` schema + render/nav are stable (verified); the tools-repo skill source is editable; CLI v0.4.0 carries the full verb surface (verified).
- **Dependencies**: `harness flow` CLI (v0.4.0, verified capable); the-flow's `harness-seams.md` (for R-1 reconciliation).
- **Risks**: see `### Risks & Assumptions`.
- **Phases**: 1 (user-directed Simple; grouped task groups A–D).

### Acceptance Criteria
1. **AC-01 (adopt overlay)**: `harness-adopt.schema.json` + `harness-adopt.template.json` exist; creating + seeding an adopt flow renders valid (`render` exits 0); spine = `install → governance → build-boot → bridge`; `scout`/`inject` are `branch_of` excursions; rail title `[adopt]`; `bridge` is a `decision` node with `next:[]`.
2. **AC-02 (loop template modernized)**: `harness-loop.template.json` uses a `nav` block (not `cursor`), carries `provenance` + root identity, splits `retro` → `retro-drain` + `retro-harvest`, adds a `drain-gate` `decision`, sets zones; `improve.next:[]` (acyclic); create+render valid.
3. **AC-03 (zones + render parity)**: every adopt/loop node renders in the correct band (preflight/flight/postflight) via explicit `--zone` in templates (no CLI ZONE_BY_TYPE change required); `harness flow render --check` passes against committed golden fixtures for both flows.
4. **AC-04 (real CLI drive)**: the skill drives the live flow through real `harness flow` commands only (create/add-node/nav set/nav meta/rail/render/chores); no hand-edited JSON; a capability precheck runs before the first mutation.
5. **AC-05 (first-class skill artifacts)**: the skill ships a `flight-plan-ops` analogue (nav model, spine-vs-excursion, verb flags, gotchas, build-order) and **documents/references** the two overlays (which are bundled in the CLI per T004 — the skill does not author the schemas); the stateless-contract assertions in SKILL.md/00-routing.md/getting-started.md are **rewritten** to scope persistence to flow position (verb modules stay harness-blind; five hooks + the `--json`/`--hooks` envelope contract **frozen/unchanged**).
6. **AC-06 (flow selection)**: detection selects exactly one flow — gate (S0 install + S2 governance + S4 boot) unsatisfied → adopt live; satisfied → loop live; never both.
7. **AC-07 (chore injection alongside the-flow)**: with an active `the-flow.json`, the skill places the **4 fire-hook chores** with this **exact chore shape** — `chore.kind = "command"`, `chore.importance = "recommended"` (`pre-flight`/boot = `"strongly-recommended"`), `command = "run /eng-harness-flow --hook <hook>"` for `<hook> ∈ {pre-flight, pre-coding, post-coding, post-flight}`, status `todo`. **Dedup key = the `--hook <X>` token in `command`** (exactly one chore per hook per the-flow plan). **Reconciliation with the-flow's seam emission (R-1)**: if a the-flow seam node (`harness-boot`/`backpressure`/`harness-retro`) already carries that hook's `/eng-harness-flow --hook <X>` command, the skill **flags that node** (`set-node --chore-kind command --importance …`) rather than adding a duplicate; otherwise it `add-node`s a new chore-flagged node. Injection is therefore **idempotent** (re-run → byte-identical node set); chore lifecycle moves `todo → done|skipped`; **no `.harness/loop.flow.json` is authored while the-flow is active**.
8. **AC-08 (standalone loop)**: with no the-flow active, the skill authors `.harness/loop.flow.json` and drives it via nav.
9. **AC-09 (adopt eval)**: `agents/validate-harness-flow` adapted to prove the adopt flow (dogfood probe) — emits verdict + dual-layer retro; deterministic checks confirm adopt spine + terminal=boot + bridge-is-decision.
10. **AC-10 (loop eval)**: `agents/loop-flow-eval` (new) + `scripts/score-loop-eval.sh` prove the standalone loop — rail `[harness-loop]`, loop spine shape, `nav.now` resolves, `render` exits 0, real verbs (no hand-crank).
11. **AC-11 (coexist eval)**: `agents/flow-coexist-eval` (new) + `scripts/score-flow-coexist.sh` prove the 4 chore refs present, injection idempotent (no dupes), `nav.now` still valid, **no `.harness/loop.flow.json`** present.
12. **AC-12 (CLI + docs green)**: `docs/how/harness-flow.md` updated for new node types/zones/two-flow model; CLI vitest (`just test`) green; golden render fixtures committed; `check:flows` passes.
13. **AC-13 (user-facing visibility — the raison d'être)**: when the loop runs alongside the-flow, the 4 chores **appear on the the-flow rail** (`harness flow rail --chores show|collapse` lists them as square pips with their `--hook` ref), and running a chore's command moves its status `todo → done` (reflected on the next rail render). This is the "stop missing things" outcome made observable, not just an internal injection proof. Verified by the coexist-eval reading `harness flow chores` + `rail`.

### Risks & Assumptions
| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-1 | Double-placement: the-flow already emits harness **seam nodes**; user wants **chores** → two emitters could duplicate the 4 hooks | Med | High | **RESOLVED (frozen, not deferred)**: eng-harness-flow is the **single owner** of chore placement in the-flow. Dedup key = the `--hook <X>` token in a node's `command`. If a the-flow seam node already carries that hook command → **flag it** (`set-node --chore-kind command --importance …`); else **add** a chore node. A note lands in the-flow's `harness-seams.md` (tools repo) stating eng-harness-flow owns the chore flag so seam emission and chore injection don't double-fire. Idempotent by construction; coexist-eval asserts byte-identical node set on re-run. (See AC-07.) |
| R-2 | Superseding the pervasive stateless contract leaves contradictions in the skill | Med | High | Rewrite every stateless assertion (SKILL.md, 00-routing.md, getting-started.md) consciously; scope persistence to flow position only; keep verb modules harness-blind + the five hooks fixed (AC-05). |
| R-3 | Zone bands wrong (renderer ZONE_BY_TYPE lacks new types) | Med | Med | Set explicit `--zone` on every template node (no CLI change); golden fixtures + `render --check` catch regressions (AC-03). |
| R-4 | `decision` node (bridge/drain-gate) render unverified | Low | Med | Golden fixture covers a decision node; `render --check` (028 §9 Q3). |
| R-5 | Build-order/gotchas (forward `--next` rejected; `set-node` can't re-parent; E308 keys on `!provenance`; fixtures CLI-generated) | Med | Low | Encode last-to-first build order; never hand-edit JSON/MD; regenerate fixtures via CLI only. |

### Open Questions
- None blocking. R-1's chore-vs-seam ownership is now **frozen in the spec** (see R-1 + AC-07): eng-harness-flow owns chore placement, dedups on the `--hook` token, flags existing seam nodes rather than duplicating. No workshop needed unless T103 surfaces a CLI limitation.

### Workshop Opportunities
| Topic | Type | Why Workshop | Key Questions |
|---|---|---|---|
| _(none — R-1 resolved in-spec)_ | — | The one candidate (chore-vs-seam ownership) is now frozen in R-1 + AC-07; no open workshop. | — |

### Clarifications
#### Session 2026-06-19
- **Workflow Mode**: Simple — *user-directed* ("single phase, choose defaults"). CS-4 recorded honestly; single phase groups work A–D.
- **Testing Strategy**: Lightweight (default) — deterministic scorers + `render --check` + vitest are the backbone.
- **Mock Usage**: A — avoid mocks (real fake-fs adapter + real CLI in evals).
- **Documentation Strategy**: B — docs/how/ only (`harness-flow.md`); the skill's ops doc ships with the skill.
- **Scope decisions** (locked during playback, see [original-ask.md](./original-ask.md)): chores-only in the-flow when active / own `.harness/loop.flow.json` standalone; chore set = the 4 fire hooks; three agents + three scorers; cross-repo split.

---

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: one (chore-vs-seam ownership, R-1) — pre-resolved in task B2; workshop only if B2 hits conflict.

| Artifact | Present? | Effect on the plan |
|---|---|---|
| research-dossier.md | y | informs Key Findings + risks |
| workshops/*.md | n | none |
| plan 028 flight-map | y (sibling plan) | the authoritative design this plan executes |

---

## Implementation Plan

### Gate Matrix
| Gate | Check | Status | Notes |
|---|---|---|---|
| G1 | Clarify | PASS | Round 1 defaults recorded; no critical markers |
| G2 | Constitution | PASS | checked vs `docs/project-rules/constitution.md` — publication boundary (P12: no personal/home/`.claude` paths in shipped/tracked content) applies; enforced in review (FT-002/FT-003 fixed) |
| G3 | Architecture | PASS | checked vs `docs/project-rules/architecture.md` — no layer/dependency-direction violation (CLI mutation + skill + evals stay in-layer) |
| G4 | ADR Compliance | N/A | no Accepted ADRs touching this |
| G5 | Structure | PASS | all required sections present |
| G6 | Testing Alignment | PASS | Lightweight: ≥1 validation per task group; ACs measurable |
| G7 | Domain Completeness | PASS | no registry; informal domains mapped + in manifest |

### Summary
Author a `harness-adopt` overlay + modernize the `harness-loop` template (CLI), rewrite the `eng-harness-flow` skill to drive both via real `harness flow` commands and inject chores into an active the-flow (tools repo), and prove all three behaviours with three eval agents + three deterministic scorers (here). One phase, four task groups (A CLI · B skill · C evals · D docs); the build order respects forward-ref and fixture gotchas.

### Domain Manifest
| File | Domain | Classification | Rationale |
|---|---|---|---|
| `harness/cli/src/services/flow/schemas/harness-adopt.schema.json` | flow-cli | contract | new overlay |
| `harness/cli/src/services/flow/schemas/harness-adopt.template.json` | flow-cli | internal | new seed template |
| `harness/cli/src/services/flow/schemas/harness-loop.template.json` | flow-cli | internal | modernize (nav, provenance, retro split, drain-gate, zones) |
| `harness/cli/src/services/flow/schemas-content.ts` | flow-cli | internal | regenerated by gen:flows (inlines overlays) |
| `harness/cli/test/**` + golden fixtures dir | flow-cli | internal | overlay/template/zone/render tests + golden `.md` |
| `skills/eng-harness-flow/SKILL.md` | eng-harness-flow-skill | contract | supersede stateless contract; two-flow front door |
| `skills/eng-harness-flow/references/00-routing.md` | eng-harness-flow-skill | contract | two-flow Graph + selection + chore-injection |
| `skills/eng-harness-flow/references/flight-plan-ops.md` | eng-harness-flow-skill | contract | NEW nav-mechanics analogue |
| `skills/eng-harness-flow/references/coach.md` | eng-harness-flow-skill | internal | rail for both flows |
| `~/github/tools/skills/SDD/the-flow/references/harness-seams.md` | the-flow (tools repo) | cross-domain | **only** cross-repo edit — note that eng-harness-flow owns chore placement (R-1) so the-flow's seam emission and chore injection don't double-fire |
| `agents/validate-harness-flow/**` | eval-harness | internal | adapt for adopt flow |
| `agents/loop-flow-eval/**` | eval-harness | internal | NEW |
| `agents/flow-coexist-eval/**` | eval-harness | internal | NEW |
| `scripts/score-loop-eval.sh`, `scripts/score-flow-coexist.sh` | eval-harness | internal | NEW deterministic scorers |
| `docs/retros/{loop-flow-eval,flow-coexist-eval}.md` | eval-harness | internal | NEW — eval runs emit dual-layer retros here (one append per run; repo-relative `runDir`) |
| `docs/how/harness-flow.md` | docs | internal | document new types/zones/flows |

### Key Findings
| # | Impact | Finding | Action |
|---|---|---|---|
| 01 | Critical | Plan 028 already specifies the two-flow flight-map (nodes/types/zones/hooks, cycle=nav-reset, bridge=decision) | Execute 028's design; don't re-derive |
| 02 | Critical | Chore is an orthogonal flag (workshop 004) — a seam node *becomes* a chore by adding `chore:{kind,importance}`; `command` holds any string | Inject chore-flagged nodes with `command: "run /eng-harness-flow --hook …"` |
| 03 | High | CLI substrate ~80% there: full verb surface + chore model + `harness-loop` schema exist | Net-new = adopt overlay + modern loop template + zones + skill + evals |
| 04 | High | Stateless contract is pervasive in the skill | Rewrite consciously, scope to flow position (R-2) |
| 05 | High | the-flow already emits seam nodes for the same 4 hooks | Idempotency-guard + reconcile with harness-seams.md (R-1) |
| 06 | Med | Gotchas: forward `--next` rejected; `set-node` can't re-parent; E308 keys on `!provenance`; golden fixtures CLI-only | Build last-to-first; never hand-edit; regenerate via CLI |

### Implementation

**Objective**: Stand up the two CLI-driven flows, the superseded skill that drives them + injects chores, and the three-agent verification, in one phase.
**Testing Approach**: Lightweight — `render --check` + golden fixtures + CLI vitest + three eval scorers; mocks avoided.

#### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|---|---|---|---|---|---|---|
| [x] | T001 | Author `harness-adopt` overlay schema (node types install/scout/governance/inject/build-boot + decision; statuses incl. todo/skipped) | flow-cli | `harness/cli/src/services/flow/schemas/harness-adopt.schema.json` | ✅ schema validates; `flow create harness-adopt` ok | per 028 §4; PL-09 overlay-declared statuses |
| [x] | T002 | Author `harness-adopt.template.json` (spine install→governance→build-boot→bridge; scout/inject as branch_of; explicit zones) | flow-cli | `…/schemas/harness-adopt.template.json` | ✅ create+render exit 0; rail `[adopt]`; AC-01 | build last-to-first (R-5); D-04: template is `{cursor,nodes}` seed, provenance stamped by create |
| [x] | T003 | Modernize `harness-loop.template.json` (7 nodes; split retro→retro-drain/retro-harvest; add drain-gate decision; zones; 4 fire-hook commands; improve.next:[]) | flow-cli | `…/schemas/harness-loop.template.json` | ✅ create+render exit 0; acyclic; AC-02 | PL-02 cycle=nav-reset |
| [x] | T004 | Regenerate `schemas-content.ts` via `gen:flows` (inline both overlays) | flow-cli | `…/schemas-content.ts` | ✅ 3 schemas + 2 templates; byte-stable | PL-03 bundled harness-owned overlays |
| [x] | T005 | Golden render fixtures for both flows (incl. decision nodes) | flow-cli | `harness/cli/test/**` | ✅ `flow-fixtures --check` passes (5); AC-03/AC-04(render)/R-4 | fixtures CLI-generated only (PL-20) |
| [x] | T006 | CLI vitest for overlays/zones/decision-render (+ set-node chore ext) | flow-cli | `harness/cli/test/services/flow/harness-flows.test.ts` | ✅ `just test` 951/951 green; AC-12 | +D-01: set-node act/mutation extended with --chore-kind/--importance/--zone |
| [x] | T102 | Author `flight-plan-ops.md` analogue (nav model, spine-vs-excursion, verb flags, build-order, gotchas, AC-07 chore shape + dedup key, standalone loop, capability precheck) | eng-harness-flow-skill | `skills/eng-harness-flow/references/flight-plan-ops.md` | ✅ AC-05 | mirror the-flow's; prerequisite to T101/T103 |
| [x] | T101 | Rewrite SKILL.md + 00-routing.md: two-flow Graph, selection predicate (gate→adopt/loop), supersede stateless→"state contract" (scope to position), capability precheck; freeze the 5-hook/`--json`/`--hooks` envelope | eng-harness-flow-skill | `skills/eng-harness-flow/SKILL.md`, `references/00-routing.md` | ✅ AC-04/AC-05/AC-06 | R-2; implements T102's contract |
| [x] | T103 | Chore-injection logic: discover active the-flow.json, place 4 fire-hook chores (AC-07 shape), dedup on `--hook` token (flag existing seam node OR add), lifecycle todo→done/skipped; + ownership note to the-flow's `harness-seams.md` | eng-harness-flow-skill (+ tools harness-seams.md) | `…/references/{00-routing,flight-plan-ops}.md`; `~/github/tools/.../the-flow/references/harness-seams.md` | ✅ proven via CLI dogfood (insert-node + set-node); AC-07/AC-13; R-1 | chores-only while the-flow active; **only** cross-repo touch |
| [x] | T104 | Standalone path: author/drive `.harness/loop.flow.json` via nav; git status decided | eng-harness-flow-skill | `skills/eng-harness-flow/references/{00-routing,flight-plan-ops}.md` | ✅ AC-08; D-05: already tracked (only `.harness/temp/` ignored) → no `.gitignore` edit | resolves the gitignore ambiguity |
| [x] | T105 | Coach rail for both flows sourced from `harness flow rail`; no `&nbsp;`/HTML entities | eng-harness-flow-skill | `skills/eng-harness-flow/references/coach.md` | ✅ D-06: § 1a rewritten — the-flow.json detection + chores-on-rail (AC-13) | rail-narration-no-html-entities |
| [x] | T201 | Adapt `agents/validate-harness-flow` to prove the adopt flow (dogfood probe; verdict + retro; adopt-flow checks) | eval-harness | `agents/validate-harness-flow/**` | ✅ prompt + output-schema gain `adoptFlow` block (spine/bootLast/bridge-decision/navDriven); AC-09 | EV-04 style |
| [x] | T202 | New `agents/loop-flow-eval` (faithful-drive) + `scripts/score-loop-eval.sh` (5 gates) | eval-harness | `agents/loop-flow-eval/**`, `scripts/score-loop-eval.sh` | ✅ scorer ALL 5 PASS vs a driven loop; AC-10 | copy flow-skill-eval pattern |
| [x] | T203 | New `agents/flow-coexist-eval` + `scripts/score-flow-coexist.sh` (5 gates incl. AC-13 visibility + idempotency) | eval-harness | `agents/flow-coexist-eval/**`, `scripts/score-flow-coexist.sh` | ✅ scorer ALL 5 PASS vs the-flow+4 chores; AC-11/AC-13 | hybrid; `#!/usr/bin/env bash`; `--json` before `flow` |
| [x] | T204 | Run the evals against the in-repo skill source via `--skill-source path:skills/eng-harness-flow --skill eng-harness-flow` | eval-harness | `agents/*/runs/**` | ✅ loop-flow-eval + flow-coexist-eval RAN (gpt-5.5, in-repo skill) → **both scorers 5/5 PASS**; validate-harness-flow adapted, adopt-path CLI-verified (full clone-probe deferred) | EV-09 `--skill-source path:`; in-repo source |
| [x] | T301 | Update `docs/how/harness-flow.md` for new node types, zones, two-flow model, chore-injection | docs | `docs/how/harness-flow.md` | ✅ bundled-flows section + chore-injection + set-node flags; AC-12 | |

### Acceptance Coverage Map
| AC | Covered by | Verified in |
|---|---|---|
| AC-01 | T001, T002 | adopt create+render; rail `[adopt]`; bridge decision |
| AC-02 | T003 | loop create+render; acyclic |
| AC-03 | T002, T003, T005 | `render --check` golden fixtures |
| AC-04 | T101, T102, T005 | real CLI drive; precheck; no hand-edit |
| AC-05 | T101, T102 | flight-plan-ops present; stateless rewritten |
| AC-06 | T101 | selection predicate |
| AC-07 | T103, T203 | chore injection idempotent; score-flow-coexist |
| AC-08 | T104, T202 | loop.flow.json standalone |
| AC-09 | T201 | validate-harness-flow adopt run |
| AC-10 | T202 | score-loop-eval |
| AC-11 | T203 | score-flow-coexist |
| AC-12 | T004, T005, T006, T301 | gen:flows, check:flows, vitest, doc |
| AC-13 | T103, T203 | coexist-eval reads `harness flow chores` + `rail` → chores visible, status todo→done |

### Risks
(see `### Risks & Assumptions` in the business half — R-1…R-5)

---

## Validation Record (2026-06-19)

### Validation Thesis
**Raison d'être**: Give `eng-harness-flow` the same first-class CLI-driven flight-plan treatment the-flow got — two mutually-exclusive flows (adopt/loop) + chore co-existence — to dogfood the flow features, provide an exemplar, and stop harness-loop steps getting missed.
**Value claim**: Harness obligations become tracked/visible on the-flow's rail; the skill's position becomes deterministic substrate (real `harness flow nav` commands, full dice) instead of prose.
**Artifact promise**: An implementor can build the two overlays + skill rewrite + 3 eval agents with minimal clarification.
**Intended beneficiaries**: implementation agents; harness-loop users; the-flow users (no missed steps).
**Proof target**: Implementation.
**Evidence standard**: testable ACs, task→AC map, encoded gotchas, eval scorer gates.
**Thesis source**: original-ask.md + plan 028 + research-dossier.md.
**Thesis verdict**: Advanced (after fixes).
**Main thesis risk**: T101 (stateless supersession) + T103 (chore placement) carry design weight; mitigated by authoring T102 (`flight-plan-ops.md` contract) first and freezing the chore shape + dedup key + R-1 ownership in-spec.

| Agent | Lenses Covered | Issues | Verdict |
|---|---|---|---|
| Coherence + Completeness | Coherence, Edge Cases, Hidden Assumptions, System Behavior, CS-challenge | 2 CRITICAL + 3 HIGH + 4 MED → fixed/addressed | ⚠️→✅ |
| Accuracy / Source-Truth | Technical Constraints, Integration & Ripple, Concept Docs, Evidence Sufficiency | 1 HIGH (edit-target path) fixed; 10 claims verified accurate | ⚠️→✅ |
| Thesis Alignment | Thesis Alignment, Proof-Level Fit, User-Value Preservation | 1 HIGH + 3 MED → fixed (AC-13 added, R-1 frozen, T102 reordered) | ⚠️→✅ |
| Forward-Compatibility | Forward-Compatibility, Contract Integrity, Test Boundary | 2 CRITICAL + 1 HIGH + 2 MED → fixed (chore contract + dedup key + scorer gates) | ⚠️→✅ |

### Forward-Compatibility Matrix
| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|---|---|---|---|---|
| IMPLEMENT stage (T001–T301) | clear Done-When + ordering; chore/dedup contract | contract drift | ✅ (was ❌) | AC-07 now specifies chore shape (kind/importance/command) + dedup key; T102 reordered before T101 |
| Eval scorers | deterministic, machine-readable gates | test boundary | ✅ (was ❌) | T203 now lists 5 concrete gates incl. dedup key = `--hook` token |
| Eval agents (T201–T203) | measurable behavioural contracts | specificity | ✅ | AC-01 adopt spine + AC-07 chore shape + AC-13 visibility |
| the-flow integration (harness-seams.md) | R-1 ownership resolved | lifecycle ownership | ✅ (was ❌) | R-1 frozen: eng-harness-flow owns placement, dedups on hook, flags existing seam nodes; harness-seams.md note added (T103) |
| docs/how/harness-flow.md (T301) | node types/zones/chore model defined | learnability | ✅ | AC-12 + chore shape now defined |

**Thesis alignment**: The value claim (deterministic, tracked, dogfooded harness loop) is advanced at the Implementation proof level after fixes; the main residual risk (T101/T103 design weight) is mitigated by the T102-first contract and the in-spec chore/R-1 freeze.

**Outcome alignment**: The plan advances "so that the main flow tracks them for us too and we dont miss things" — AC-13 now makes the 4 chores observable on the the-flow rail with lifecycle status, turning the injection from an internal proof into the user-facing "stop missing things" outcome.

**Standalone?**: No — downstream consumers (implement stage, eval scorers, docs, the-flow integration) all depend on this plan's shape.

Overall: **VALIDATED WITH FIXES**
