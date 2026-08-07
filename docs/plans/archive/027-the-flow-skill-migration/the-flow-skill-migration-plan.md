# the-flow skill migration — cursor→nav prompts + minih eval harness
**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-18
**Status**: READY
**Spec source**: unified (this file)

> 📚 Consumes two authoritative workshops (in plan 026): [004-migrate-skill-to-nav.md](../026-the-flow-cursor-meta-migration/workshops/004-migrate-skill-to-nav.md) (the prompt-migration edit ledger) and [005-minih-eval-harness.md](../026-the-flow-cursor-meta-migration/workshops/005-minih-eval-harness.md) (the verification harness). Both are validated and Implementation-Ready; this plan **links** to them rather than restating their content.

## Business Specification

### Summary
Plan 026 shipped the `harness flow` CLI's nav/rail/zone surface as a **clean break** (the `cursor` verb was removed). The the-flow **skill** was a 026 Non-Goal and is now stale: `00-routing.md:175` still calls the removed `cursor` verb (already broken against the local nav-capable CLI), and the skill knows nothing of `nav`/`rail`/`zone`/`create --agent`. This plan applies workshop 004's edit ledger to migrate the skill, and builds + runs workshop 005's minih eval harness to **prove** the migrated skill authors a clean, spine-only flight plan. It also fixes the broken `.minih.json` (deleted skill paths) that currently blocks minih.

### Goals
- the-flow guided mode drives the flight plan with `nav` (not `cursor`) and authors workshops as `--branch-of` excursions → a clean spine-only rail titled `[the-flow]`.
- The nav/CLI mechanics live in a new **load-on-demand** reference file, not the always-loaded engine (progressive disclosure preserved).
- `.minih.json` resolves again; a minih eval agent + deterministic scorer verify the migration and discriminate migrated vs un-migrated.

### Non-Goals
- Re-doing any 026 CLI work (the CLI is done + correct).
- The coach rail-source change (hand-rolled → `harness flow rail`) — workshop 004 Q1, explicitly **phase-2/optional**.
- Publishing/deploying the skill or the CLI (deploy is a separate, gated step — *CLI first, then skill*).
- A reusable cross-skill eval framework — this harness targets the-flow specifically (005 Q4).

### Target Domains
This repo has **no `docs/domains/` registry** — the touched areas, for orientation:

| Area | Status | Relationship | Role |
|------|--------|-------------|------|
| the-flow skill (`~/github/tools/skills/SDD/the-flow/`) | existing | **modify** | Apply the 004 edit ledger (the migration target; tools-repo source) |
| `.minih.json` (this repo) | existing | **modify** | Re-point sources to the proper skills location |
| `agents/flow-skill-eval/` + `scripts/score-flow-eval.sh` (this repo) | **NEW** | **create** | The eval agent + deterministic scorer (005) |

### Testing Strategy
**Lightweight + the eval harness is the integration test.** The migration's success criteria are deterministic, so the proof is `scripts/score-flow-eval.sh` (reads run artifacts) plus a grep gate over the migrated source — not eyeballing. No unit tests are added to the skill (it's prompt markdown); the minih run is the behavioural test.

### Documentation Strategy
**No new docs (D).** Workshops 004/005 are the design records; `docs/how/harness-flow.md` (the CLI reference) was already updated in 026. The migration itself *creates* a skill-internal reference file (`flight-plan-ops.md`) — that's a skill artifact, not repo docs.

### Complexity
- **Score**: CS-3 (medium)
- **Breakdown**: S=1, I=2, D=0, N=1, F=1, T=1 (sum 6)
- **Confidence**: 0.80
- **Assumptions**: 026 CLI surface is stable (verified this session); minih 0.2.2 behaves per its AGENTS_README.
- **Dependencies**: workshops 004 + 005 (done); the local nav-capable `harness` CLI (verified); minih installed (v0.2.2, verified).
- **Risks**: see Risks table.
- **Phases**: 1 (Simple) — two task groups (A: migrate prompts · B: eval harness), B verifies A.

### Acceptance Criteria
1. **AC-01** — `grep -rnE '"cursor"|flow cursor|recommended_next|--recommend'` over the migrated the-flow source returns nothing, and `flight-plan.template.json` contains a `nav` block. *(004 acceptance)*
2. **AC-02** — `references/flight-plan-ops.md` exists with the seven sections (004 §"The new file") **and** is registered in the engine load contract (`SKILL.md` "Two load paths" + `00-routing.md` § Flight plan Prerequisite) — not orphaned. *(004 FC-01)*
3. **AC-03** — every `harness flow create` call-site in the skill passes `--agent the-flow`; the position-advance instruction calls `nav set` (not `cursor`). *(004 ledger rows 2,4,5,6,7)*
4. **AC-04** — `.minih.json` sources resolve: **`minih skills doctor`** reports `the-flow` + `eng-harness-flow` resolved with no error (bare `minih skills` is a no-op help screen — use the `doctor`/`discover` subverb), and `minih run` works **without** `--no-skills`. *(005 D1)*
5. **AC-05** — `agents/flow-skill-eval/` + `scripts/score-flow-eval.sh` exist; the scorer **exits 0** on the migrated candidate and **non-zero** on the un-migrated skill — run the negative case against the un-migrated **deployed** copy (`--skill-source path:/Users/jordanknight/.claude/skills --skill the-flow`) or a pre-migration `git stash` of the source. The scorer must assert **≥1 attached `branch_of` workshop** (an empty workshop set passes an "all branched" check vacuously → false green). *(005 acceptance)*
6. **AC-06** — a `minih run flow-skill-eval` against the migrated candidate produces a flight plan whose rail starts `[the-flow]` and excludes workshops (spine-only). *(the end-to-end proof)*

### Risks & Assumptions
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| the-flow guided mode is human-in-the-loop; the eval agent must auto-drive | High | Med | Agent role-plays the user (005 D3); a stall is recorded as a finding, not a hang |
| minih 0.2.2 peer-verdict false-positives | Med | Low | Keep the eval agent one-shot (no `coordination: enabled`) (005 gotcha) |
| Editing the deployed skill breaks live use during iteration | Med | Med | Iterate on the tools-repo source via `--skill-source` per run; deployed copy stays baseline (005 D5) |
| `.minih.json` `path:` may not expand `~` | Low | Low | Use an absolute path; verify with `minih skills` |

### Open Questions
- **Q1 (005)** candidate isolation — edit source directly vs a copied candidate dir? Recommendation: edit source + `--skill-source` per run. *(non-blocking)*
- **Q2 (005)** agent-definition home — this repo's `agents/` vs the tools repo? Recommendation: this repo (co-located with the CLI + `.minih.json`). *(non-blocking)*

### Workshop Opportunities
None open — the two driving workshops (004, 005) are complete and Implementation-Ready.

### Clarifications
#### Session 2026-06-18
- **Workflow Mode** → Simple (focused fix; CS-3; one phase, two task groups). *(Round-1 defaulted — no interview; focused internal-tooling fix with two Implementation-Ready workshops as the source.)*
- **Testing** → Lightweight + the minih eval harness as the deterministic integration test.
- **Mock usage** → Avoid (real CLI, real skill, real minih).
- **Documentation** → No new repo docs (workshops are the design; CLI doc done in 026).

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: none — all resolved (004, 005).

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | n | — (the workshops are the design research) |
| workshops/*.md | y (004, 005 in plan 026) | authoritative design decisions — the task source |

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No `[NEEDS CLARIFICATION]`; Round-1 defaulted with rationale |
| G2 | Constitution | N/A | No `docs/project-rules/constitution.md` |
| G3 | Architecture | N/A | No `docs/project-rules/architecture.md` |
| G4 | ADR Compliance | N/A | No accepted ADR constrains skill prompts / minih config |
| G5 | Structure | PASS | All required sections present |
| G6 | Testing Alignment | PASS | Lightweight; the scorer + grep gate are the measurable checks; ACs are testable |
| G7 | Domain Completeness | N/A | No domain registry in this repo (areas tabled for orientation) |

### Summary
Apply workshop 004's 13-row edit ledger to the the-flow skill (cursor→nav, the new `flight-plan-ops.md`, `--agent the-flow`, the load-contract wiring), fix `.minih.json`, then build workshop 005's minih eval agent + deterministic scorer and run the loop until the migrated skill scores green. One Simple phase, two task groups; group B verifies group A.

### Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `~/github/tools/skills/SDD/the-flow/references/flight-plan-ops.md` | the-flow skill | contract (new) | The on-demand CLI-mechanics reference (004) |
| `~/github/tools/skills/SDD/the-flow/references/00-routing.md` | the-flow skill | internal | cursor→nav fix + SLIM + create `--agent` + load wiring |
| `~/github/tools/skills/SDD/the-flow/{SKILL.md,references/coach.md,flight-plan.template.json,flight-plan.template.md,flight-plan.schema.json}` | the-flow skill | internal | 004 ledger rows 6–12 |
| `.minih.json` | minih config | internal | re-point sources (005 D1) |
| `agents/flow-skill-eval/{prompt.md,output-schema.json,input-schema.json,instructions.md}` | eval harness | internal (new) | the eval agent (005) |
| `scripts/score-flow-eval.sh` | eval harness | internal (new) | deterministic scorer (005) |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | `00-routing.md:175` calls the removed `cursor` verb — already broken vs the local nav CLI | Ledger row 2 (T-A2) |
| 02 | High | A new reference file with no loader is dead (FC-01) | Wire the load contract (T-A6) |
| 03 | High | `.minih.json` points at deleted `skills/eng-harness-{setup,loop}` → minih can't run | Re-point sources (T-B1) |
| 04 | Med | the-flow is human-in-the-loop; the eval agent must auto-drive | Role-play the user (T-B2) |
| 05 | Med | The scorer must *discriminate* (fail on un-migrated) or it proves nothing | Negative check in AC-05 / T-B5 |

### Implementation

**Objective**: Migrate the the-flow skill to the nav/harness-flow surface (004) and prove it with a minih eval harness (005).
**Testing Approach**: Lightweight — the deterministic scorer + grep gate are the proof; the minih run is the behavioural test.

#### Tasks

| Status | ID | Task | Group | Path(s) | Done When | Notes |
|--------|-----|------|-------|---------|-----------|-------|
| [ ] | T-A1 | Create `flight-plan-ops.md` (7 sections) | A prompts | `…/the-flow/references/flight-plan-ops.md` | File exists with §1–§7 per 004 | 004 §"The new file" |
| [ ] | T-A2 | Fix the break: `cursor`→`nav set` | A prompts | `…/references/00-routing.md:175` | line uses `nav set --now/--next/--clear-next` | 004 row 2 (KF-01) |
| [ ] | T-A3 | SLIM the cadence block (before/after) | A prompts | `…/references/00-routing.md` ~170–186 | flags moved to `flight-plan-ops.md`, when-index kept | 004 row 3 + "The SLIM" |
| [ ] | T-A4 | Add `--agent the-flow` to all create call-sites | A prompts | `00-routing.md:31,189`, `coach.md:324`, `SKILL.md:101` | every `flow create` carries `--agent the-flow`; the line-31 sequence sets initial position via `nav set --now research` (after `add-node research`) | 004 rows 4–7 |
| [ ] | T-A5 | Add `nav`/`rail` to the precheck probe | A prompts | `SKILL.md:99` | probe list names nav/rail | 004 row 8 |
| [ ] | T-A6 | Wire the loader into the engine contract | A prompts | `SKILL.md` "Two load paths" + `00-routing.md` §Flight plan | load directive present in both | 004 row 9 (FC-01) → AC-02 |
| [ ] | T-A7 | Migrate template + schema prose | A prompts | `flight-plan.template.json` (7–10), `template.md` (regen), `schema.json:5` | `nav` block; no stale `cursor`/`recommended_next`; render twin regenerated | 004 rows 10–12 |
| [ ] | T-A8 | Verify the migration grep gate | A prompts | migrated source tree | AC-01 grep returns nothing | 004 acceptance |
| [ ] | T-B1 | Fix `.minih.json` sources → user-global | B eval | `.minih.json` | **`minih skills doctor`** resolves the-flow + eng-harness-flow; no `--no-skills` | 005 D1 → AC-04 |
| [ ] | T-B2 | Scaffold `agents/flow-skill-eval/` | B eval | `agents/flow-skill-eval/{prompt,output-schema,input-schema,instructions}` | agent drives the-flow autonomously, writes flow to `.harness/temp/flow-eval/$MINIH_RUN_ID/`; builds the spine **connected** (`--next`) before any `--branch-of` (avoids E309) | 005 §"The agent definition" + 004 §6 |
| [ ] | T-B3 | Verify `.harness/temp/` gitignored | B eval | `.gitignore` | confirm already present (`.gitignore` has `.harness/temp/`) — no duplicate | 005 D2 |
| [ ] | T-B4 | Write `scripts/score-flow-eval.sh` | B eval | `scripts/score-flow-eval.sh` | re-derives the 6 checks; resolves the run dir from `minih last-run` (run dir is `<ISO>-<pid>`, **not** `$MINIH_RUN_ID`); asserts **≥1 attached workshop** | 005 §"The scorer" |
| [ ] | T-B5 | Run the loop; confirm discrimination | B eval | (run) | scorer exits 0 on migrated, **non-zero** on the un-migrated **deployed** copy; rail `[the-flow]`, spine-only, ≥1 workshop attached | 005 §"loop" → AC-05/06 |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | T-A2, T-A7, T-A8 | grep gate (T-A8) |
| AC-02 | T-A1, T-A6 | file exists + load-contract grep |
| AC-03 | T-A2, T-A4 | grep + read |
| AC-04 | T-B1 | `minih skills` |
| AC-05 | T-B4, T-B5 | scorer exit codes (both directions) |
| AC-06 | T-B2, T-B5 | scorer rail/excursion checks on a real run |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Eval agent can't auto-drive a human-in-the-loop skill | High | Med | Role-play the user; stall = finding (T-B2) |
| Scorer passes both migrated + un-migrated (no discrimination) | Med | High | Negative test is an explicit AC (T-B5 / AC-05) |
| Iteration breaks the deployed skill | Med | Med | `--skill-source` on the source candidate; deployed stays baseline |
| `.minih.json` `path:` `~`-expansion | Low | Low | absolute path + `minih skills doctor` check |

## Validation Record

Auto-validated 2026-06-18 via `validate-v2` (the plan stage's mandated pass) — 4 parallel agents grounded in the real plan + workshops 004/005 + the skill + the CLI + minih.

**Verdict**: Completeness **STRONG** (13/13 ledger, 9/9 005 components, ACs testable) · Source-fidelity **STRONG** (0 HIGH, no workshop contradictions — every cited line:fact verified) · Thesis **sound** (Simple/CS-3 honest; discrimination is first-class; engine genuinely slimmed) · Forward-compat found **2 HIGH** (the harness could pass on a broken migration) — **both fixed**:

| Finding | Sev | Fix applied |
|---------|-----|-------------|
| FC-1 — `minih skills` is a no-op; real validator is `minih skills doctor` | HIGH | AC-04, T-B1, the last risk row (+ workshop 005) → `minih skills doctor` |
| FC-2 — scorer "all branched" passes vacuously with 0 workshops → false green | HIGH | AC-05, T-B4 require **≥1 attached workshop**; T-B2 builds the spine connected before `--branch-of` (004 §6) (+ workshop 005 scorer) |
| FC-4 — scorer must resolve run dir from `minih last-run`, not `$MINIH_RUN_ID` | MED | T-B4 (+ workshop 005) |
| TH-01 — negative-test baseline tree unspecified | MED | AC-05, T-B5 name the un-migrated **deployed** copy (or a `git stash`) |
| CP-02 — initial `nav set --now research` uncaptured | MED | T-A4 Done-When |
| TH-02 — `.harness/temp/` already gitignored | LOW | T-B3 → verify-only |
| FC-3 — workshop 004's `getting-started.md`-missing note is stale (it exists) | LOW | corrected in workshop 004 |

**Residual (LOW, deferred to implement)**: FC-5 (name the deploy mapping tools-repo→`~/.agents`), FC-6 (demote the events-grep discriminator to advisory — the structural checks are the gate), CP-06 (Domain Manifest `.gitignore` row). None block execution.
