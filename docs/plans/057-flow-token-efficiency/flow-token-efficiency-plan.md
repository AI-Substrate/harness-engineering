# Flow Token Efficiency (builder + eng-harness-flow)
**Mode**: Full
**Plan Version**: 1.1.0 — cross-model validation findings V-01..V-04 folded (gpt-5.6-sol sidecar)
**Created**: 2026-07-10
**Status**: READY
**Spec source**: unified (this file)

## Business Specification

📚 Incorporates findings from research-dossier.md (F-01..F-13, H-01..H-04) and spine.md (the requirements record).

### Summary

The builder flow and eng-harness-flow don't treat tokens as gold: a ~110–120KB fixed read set at every guided entry, duplicated CLI envelopes in every mutation sequence, and six worker-spawn sites with zero model-tier or subagent guidance (dossier F-01/F-02/F-07). The discipline exists as prose (invariant #13, § Artifact Elegance) but isn't landing — 056 proved the fix pattern: **placement beats prose**. This plan encodes token discipline and delegation guidance into the channels agents mechanically re-encounter, slims the CLI's per-call cost, and — first — fixes the telemetry capture gap (F-10) so the plan can measure itself and be re-verified against real wild usage at T+3wk.

### Goals

- Agents running the flow spend fewer tokens for the same correctness: leaner CLI output, tier-matched delegation (chores → cheap subagents; judgement → lead), and per-turn token-discipline wording.
- Token-efficiency improvements are first-class harness gifts — captured, encoded, and paid forward like any friction fix (rules-of-why.md Rules 5–6; cite, don't restate).
- The change is **self-measuring**: per-stage token attribution works in practice (not just schema), a baseline exists, and a T+3wk wild-telemetry review can say whether it worked.

### Non-Goals

- **No under-building** — invariant #13's floor holds; directness past the floor, never less real work.
- **No reference-tree restructure** (boot read-set tiering / compiled quick-card) — the largest, riskiest change; this plan gathers the evidence for it as a follow-on candidate only (Decision D3).
- **No gates, scores, or budgets** — delegation and terseness stay suggestions with a context override; no delegation-score rubrics (per the ponytail eval lesson, H-02: stacked mandates compete for budget).
- **No new telemetry vocabulary beyond FlowEvent density** — no subagent-attribution capture, no file-read attribution (F-12 stays a named gap, investigated not built).
- **No pij convention duplication** — packet shape/pointer delivery stay cited (C1–C7).

### Target Domains

_No `docs/domains/` registry in this repo — informal domain mapping (registry gates N/A)._

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| harness-cli (flow verbs + telemetry) | existing | **modify** | FlowEvent emission on nav moves; `--quiet` for flow mutations; docs/how |
| builder skill (`skills/builder/`) | existing | **modify** | instructions[] lines, tier table in § Shared conventions, spawn-site cites |
| eng-harness-flow skill (`skills/eng-harness-flow/`) | existing | **modify** | token-discipline mirror line (Decision D2) |

### Testing Strategy

- **Approach**: Hybrid — TDD for CLI code (FlowEvent emission, `--quiet`, envelope invariance — vitest, incl. negative tests); guard tests for prose (template lockstep test extension, grep-provable assertions, doctrine-parity guard untouched).
- **Rationale**: CLI changes have contract consumers (envelope shape); prose changes are pinned by existing guard machinery, extended not duplicated.
- **Focus areas**: envelope byte-invariance without `--quiet`; FlowEvent emitted per nav move with correct stage id; template instruction clones surviving the expander.
- **Excluded**: no e2e flow-eval scenario changes (follow-on candidate).
- **Mock usage**: avoid — real fixtures (plan 037 corpus) and real refs.

### Documentation Strategy

- **Location**: docs/how/ only — `docs/how/harness-flow.md` (new `--quiet`, FlowEvent-on-nav semantics); drift-guarded by `check:docs`.
- **Rationale**: the CLI docs are generated/guarded; skill prose is self-documenting.

### Complexity

- **Score**: CS-3 (medium)
- **Breakdown**: S=2, I=1, D=0, N=1, F=1, T=1 → 6
- **Confidence**: 0.80
- **Assumptions**: FlowEvent emission hooks cleanly into `nav set --now` (the CLI is the single position writer, so the join point is deterministic); template instruction additions ride the existing expander clone (F-06).
- **Dependencies**: deploy order CLI-first-then-skill (SKILL.md § Prerequisite); phase 2 runs under phase 1's deployed capture fix.
- **Risks**: see § Risks.
- **Phases**: 2 (real dependency boundary: code must deploy before prose so the P2 run self-measures).

### Acceptance Criteria

1. **AC-01** — per-stage attribution works on a real run: the mechanism T1.1 selects with evidence (primary candidate: **read-side** stage-window derivation from `cursor-moved` `flow_log` markers — real `fired_at`, clipped to the session window, monotonic-guarded, surfaced as an additive `flow_stage_mechanism` value; fallback: **write-side** post-successful-mutation FlowEvent emitter with session detection, `from`/stage/status, `--next` exclusion, spool durability, and never-affects-envelope/exit fail-safety) is test-proven with fixtures AND observed: this plan's own P2 session report buckets turns into >1 stage (no `stage_labels_unavailable`).
2. **AC-02** — `harness flow <mutation> --quiet` suppresses the repeated 7-field `data` summary block; without the flag, envelope output is byte-identical to today (regression test).
3. **AC-03** — non-flow command envelopes are untouched (negative test on at least one non-flow verb).
4. **AC-04** — `docs/how/harness-flow.md` documents both changes **and is added to `docs-manifest.json`** (the P12 curation point — it's a publication-safe user guide) so `check:docs` genuinely guards it (V-02: today the guide is unlisted and the gate is vacuous for it); `npm run check:docs` green after regen.
5. **AC-05** — a baseline record exists in `${PLAN_DIR}/baseline/`: 056 session-level totals + this plan's P1-era session, with the `flow_stage` mechanism counts showing the starvation (the "before").
6. **AC-06** — `flight-plan.template.json` carries one token-discipline line and one delegation/tier line in `instructions[]` (each ≤150 bytes) on the nodes agents re-read (`phase-1`, `boot-1`, `observe-1` at minimum); the expander clones them to phase-N (lockstep/template test extended to pin the new lines).
7. **AC-07** — a **Model-to-task fit & delegation** subsection exists once in builder `00-routing.md` § Shared conventions (tier table: chores→cheap/Sonnet · analysis/review→Opus-class · judgement/hard-reviews→lead; the delegate-when/keep-when test; the escalation rule; the subagent output contract; explicit context-override clause); all six spawn sites (`10-explore.md`, `20-plan.md`, `35-adr.md`, `50-phase-tasks.md`, `70-review.md`, `80-merge.md`) cite it in one line each (grep-provable).
8. **AC-08** — eng-harness-flow carries the token-discipline + delegation posture as a short cite (SKILL.md, ≤3 lines, pointing at the builder § or rules-of-why) — **not** a new parity-guarded block (Decision D2); existing doctrine-parity block untouched (guard green).
9. **AC-09** — **wild-telemetry review affordance**: a `tripwire-runbook.md` exists in the plan folder with the exact re-entry procedure (pull post-deploy refs from real usage, run `harness telemetry report`/`insights`, diff against AC-05's baseline); a `tripwire-review` excursion node hangs off `ship`. The runbook **separates two evidence classes** (V-04): (a) **capture-health proof** — deterministic (`flow_stage` mechanism counts, stage-marker density, `token_coverage`), and (b) **directional outcome** — `stageEconomics` deltas across unlike journeys, explicitly labeled *non-normalized* (task size and the three simultaneous interventions are confounded); the verdict table verdicts each class separately, and **delegation impact is marked unmeasured/low-confidence** unless T1.7's adapter evidence upgrades it.
10. **AC-10** — no gating/scoring/blocking language introduced anywhere in the diff (review assertion); all new guidance carries the suggestion + context-override posture.
11. **AC-11** — the subagent-attribution question (F-12: does the claude-code adapter fold subagent turns into parent totals, or drop them?) is answered with evidence in the execution log and reflected in the tripwire runbook's interpretation notes.

### Risks & Assumptions

| Risk | Notes |
|------|-------|
| FlowEvent-on-nav emits for non-builder flows too (eng-harness-flow's own flight plans, evals) | Same closed shape; extra density is signal, not noise — but verify report mapping tolerates non-SDD node ids (`report.ts:251–259` maps unknowns honestly) |
| `--quiet` blast radius creeps CLI-wide | Decision D1 pins it flow-local; negative test AC-03 guards |
| Stage values leak plan-specific slugs into telemetry | Node ids are kebab slugs from the template/expander (bounded); P12 reviewed — no free prose rides the event |
| Instruction lines bloat the per-turn orient payload | ≤150B/line cap in AC-06; orient measured at 586B human (F-04) — additions stay proportionate |
| Tier table unseen by stage modules under progressive disclosure | Mitigation: the *rule* rides each spawn site's packet template line; the *table* lives once in § Shared conventions (F-07 open question resolved this way) |

### Open Questions

_None blocking — the four handoff decisions are resolved as D1–D5 (§ Clarifications)._

### Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| Boot read-set restructure (tiering / compiled quick-card) | Spike/POC | Deliberately deferred (Non-Goal, D3) — evidence task T1.7 feeds a future workshop, not this plan | What would a quick-card contain? What does the engine actually need per entry? |

### Clarifications

#### Session 2026-07-10

- Q: Workflow Mode? → **A: Full, 2 phases** (deploy-then-measure boundary).
- Q: Testing? → **A: Hybrid** (TDD CLI, guard tests prose).
- Q: Mocks? → **A: Avoid** (real fixtures/refs).
- Q: Docs? → **A: docs/how/ only.**
- **D1 (quiet scope)**: flow-local `--quiet` + `summary()` path only; no CLI-wide renderer change (blast radius, F-04 open question).
- **D2 (ehf mirroring)**: short cite in eng-harness-flow SKILL.md, not a second parity block — parity guards are for must-never-diverge doctrine, not one-liners.
- **D3 (boot read-set)**: explicit non-goal; T1.7 gathers the numbers for a follow-on decision.
- **D4 (measurement gate)**: yes — P1 lands capture density + baseline before P2's prose, so P2's own run is the first self-measured sample.
- **D5 (subagent attribution)**: investigate (T1.6), don't build.
- User directive (mid-plan): the wild-usage telemetry review affordance is mandatory — AC-09.
- **Validation fold (v1.1.0, cross-model gpt-5.6-sol — `validations/flow-token-efficiency-plan-validation.md`)**: V-01 HIGH (no post-mutation capture seam — capture is pre-parse) → T1.1 design-proof + read-side-primary/write-side-fallback contract; V-02 (check:docs vacuous for the guide) → AC-04/T1.6 manifest addition; V-03 (manifest gaps) → rows added; V-04 (tripwire attribution confounds) → AC-09 two-evidence-class split + delegation low-confidence label. All four confirmed against source by the lead before folding.

## Planning Seam

_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: Boot read-set restructure (deliberately deferred to follow-on — not blocking).

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | y | informs Key Findings (13 findings, 3-worker Deep pass) |
| workshops/*.md | n | — |
| spine.md | y | requirements record (thesis, dimensions, doctrine anchors) |

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | Round 1 answered; D1–D5 resolved in-session |
| G2 | Constitution | PASS | P3 fakes-over-mocks honored; P12 publication boundary reviewed (bounded slugs only); P9 evidence-over-assertion drives AC-05/09 |
| G3 | Architecture | PASS | FlowEvent emission via services/ports; `--quiet` threads `CliIo` (no `node:fs` in services, single exit site untouched) |
| G4 | ADR Compliance | N/A | no `docs/adr/` in repo |
| G5 | Structure | PASS | all required sections present |
| G6 | Testing Alignment | PASS | Hybrid: P1 test tasks precede impl; P2 guard-test tasks present |
| G7 | Domain Completeness | PASS | informal domains (no registry); manifest covers all phase files |

### Summary

Phase 1 makes the change measurable and cheap at the CLI: stage-transition FlowEvents emitted by the position writer itself (`nav set`), a flow-local `--quiet`, docs, and a recorded baseline proving today's starvation. Phase 2 encodes the discipline into both skills through the channels 056 proved (template `instructions[]`, § Shared conventions + spawn-site cites, an ehf mirror line) and installs the T+3wk wild-telemetry tripwire. Phase 2 runs under Phase 1's deployed capture fix, making this plan its own first measurement sample.

### Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `harness/cli/src/acts/flow.ts` | harness-cli | internal | `runMutation`/`summary()` quiet path; nav-move FlowEvent hook |
| `harness/cli/src/app.ts` | harness-cli | internal | `--quiet` tri-state argv parse |
| `harness/cli/src/output/output-port.ts` | harness-cli | contract | `CliIo` verbosity field (additive) |
| `harness/cli/src/services/telemetry/capture-service.ts` (+ events.ts if needed) | harness-cli | contract | FlowEvent emission on nav move (existing shape, no schema change) |
| `harness/cli/test/**` (new/extended) | harness-cli | internal | TDD tests for AC-01..03 |
| `docs/how/harness-flow.md` | harness-cli | contract | verb docs |
| `harness/cli/src/services/docs/docs-manifest.json` | harness-cli | contract | add the guide so check:docs guards it (V-02) |
| `docs/plans/057-flow-token-efficiency/baseline/*` | plan artifacts | internal | AC-05 baseline record |
| `docs/plans/057-flow-token-efficiency/tasks/*/execution.log.md` | plan artifacts | internal | written by T1.1/1.7/1.8 evidence tasks (V-03) |
| `docs/plans/057-flow-token-efficiency/the-flow.json` (+ rendered `.md`) | plan artifacts | internal | CLI-owned writes only (tripwire node, task 2.6) — never hand-edited (V-03) |
| `skills/builder/references/flight-plan.template.json` | builder skill | contract | instructions[] lines (AC-06) |
| `skills/builder/references/00-routing.md` | builder skill | contract | § Shared conventions tier table (AC-07) |
| `skills/builder/references/stages/{10-explore,20-plan,35-adr,50-phase-tasks,70-review,80-merge}.md` | builder skill | internal | one-line cites + packet tier field |
| `skills/eng-harness-flow/SKILL.md` | eng-harness-flow skill | contract | ≤3-line token/delegation cite (AC-08) |
| `docs/plans/057-flow-token-efficiency/tripwire-runbook.md` | plan artifacts | internal | AC-09 wild-telemetry re-entry |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | Per-stage token attribution is schema-true but capture-false — 056 run has 2 FlowEvents; nothing emits stage transitions; capture runs pre-parse so there is no post-mutation seam today (dossier F-10 + validation V-01) | T1.1 design-proof picks the mechanism: read-side flow_log stage-windows (primary — retroactive, no capture-timing problem; the exclusion at `events.ts:268-276` is policy against clock distortion, answerable by clipping) vs write-side post-mutation emitter (fallback) |
| 02 | High | All mutation verbs funnel through one `summary()`/`runMutation()`; no verbosity mechanism exists anywhere (F-02/F-03) | Flow-local `--quiet` (D1); single-point change + threading |
| 03 | High | The proven cheap channel is template `instructions[]` (80–193B/line, expander-cloned, re-read every turn); boot-file prose costs ~1000× more per session (F-06 vs F-01/F-05) | All new wording lands there + § Shared conventions; no SKILL.md invariant additions |
| 04 | High | Six spawn sites, zero tier guidance; repo pattern = state once + cite per site (F-07) | AC-07 shape |
| 05 | High | Token doctrine absent from eng-harness-flow entirely (F-08) | AC-08 cite, not parity block |
| 06 | High | Session-level baselining works now; per-stage tooling (`stageEconomics`) ships already; cache never attributed per stage (F-09/F-11/F-13) | Consume in baseline + tripwire; define per-stage metric as fresh in+out |
| 07 | Medium | No subagent-vs-parent split; file reads unattributed (F-12) | T1.6 investigate; tripwire interprets accordingly |
| 08 | High | Eval evidence: stacked mandates compete for budget (a test got dropped); cut the loop's cost, don't add a terseness mandate (H-02) | Suggestion-posture everywhere; AC-10 |

### Phases

#### Phase Index

| Phase | Title | Primary Domain | Objective (1 line) | Depends On |
|-------|-------|---------------|-------------------|------------|
| 1 | Measure + slim the CLI | harness-cli | Stage-transition FlowEvents, flow-local `--quiet`, docs, recorded baseline — deployed | None |
| 2 | Encode the discipline (both skills) + tripwire | builder skill | instructions[] lines, tier table + cites, ehf mirror, T+3wk wild-telemetry runbook — run self-measured under P1 | Phase 1 (deployed) |

#### Phase 1: Measure + slim the CLI

**Objective**: Make per-stage token attribution real at capture time, add the flow-local quiet path, and record the "before" baseline.
**Domain**: harness-cli
**Delivers**: FlowEvent-on-nav emission · `--quiet` on flow mutations · updated docs/how · `baseline/` record · subagent-adapter answer · deployed CLI (`just build` + relink)
**Depends on**: None
**Key risks**: envelope byte-invariance regression (AC-02/03 tests guard); FlowEvent density on non-SDD flows (accepted — same closed shape).

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 1.1 | **Design-proof (V-01)**: verify on the real 056 ref that `cursor-moved` `flow_log` markers carry usable absolute `fired_at` + from/to stages; establish session-window clipping + monotonic guard viability. Decide **read-side** (primary) vs **write-side post-mutation emitter** (fallback — full contract: session detection, `from`/stage/status, `--next` exclusion, spool durability, envelope/exit fail-safety). Record decision + evidence in execution log | harness-cli | mechanism chosen with cited evidence; AC-01 mechanism named | capture runs pre-parse (`app.ts:392`), so naive "emit in capture service" is not viable — validator V-01 |
| 1.2 | Tests first for the chosen mechanism (read-side: rollup/report derive stage windows from clipped flow_log, additive `flow_stage_mechanism` value, 056-fixture proves retroactive attribution; write-side: post-write emission per the 1.1 contract) | harness-cli | red→green vitest; AC-01 | TDD |
| 1.3 | Implement the chosen mechanism | harness-cli | 1.2 green; `harness doctor` ok | Key Finding 01 |
| 1.4 | Tests first: `--quiet` suppresses mutation `data` block; default output byte-identical; non-flow verb untouched | harness-cli | red→green; AC-02, AC-03 | TDD |
| 1.5 | Implement flow-local `--quiet` (argv tri-state in `app.ts`, `CliIo` field, `summary()` gate in `acts/flow.ts`) | harness-cli | 1.4 green | D1 |
| 1.6 | Update `docs/how/harness-flow.md` **and add it to `docs-manifest.json`** (P12-reviewed publication-safe guide); regen + `npm run check:docs` green | harness-cli | AC-04 | V-02 fix |
| 1.7 | Investigate subagent turn handling in the claude-code telemetry adapter (fold vs drop); record answer + evidence in execution log | harness-cli | AC-11 answered | read-only; feeds AC-09's delegation confidence label |
| 1.8 | Evidence task (D3 feed): quantify guided-entry read set + what a compiled quick-card could save; record as follow-on candidate in execution log | builder skill | numbers recorded, no restructure | Non-Goal boundary |
| 1.9 | Write `baseline/` record: 056 ref session totals + current-run `flow_stage` mechanism counts (the starvation proof) via `harness telemetry report`/`insights`; if 1.3 landed read-side, include the retroactive per-stage view of 056 as the richer baseline | plan artifacts | AC-05 | consume F-11 tooling |
| 1.10 | Deploy: `just build` (global relink); `harness checks` green | harness-cli | P2 runs under new capture | deploy order rule |

#### Phase 2: Encode the discipline (both skills) + tripwire

**Objective**: Land the wording and delegation guidance in the mechanically re-encountered channels, and install the wild-telemetry review affordance.
**Domain**: builder skill (+ eng-harness-flow)
**Delivers**: template `instructions[]` lines · § Shared conventions tier table + six cites · ehf cite · tripwire runbook + excursion node · self-measured run evidence
**Depends on**: Phase 1 deployed
**Key risks**: instruction-line bloat (≤150B cap); tier table unseen under progressive disclosure (rule rides the packet lines).

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 2.1 | Guard test first: extend the template/lockstep test to pin the two new instruction lines (and expander clone to phase-N) | builder skill | red→green; AC-06 | Hybrid-TDD |
| 2.2 | Add token-discipline + delegation/tier lines (≤150B each) to `flight-plan.template.json` `instructions[]` on phase-1/boot-1/observe-1 | builder skill | 2.1 green | Key Finding 03 |
| 2.3 | Write **Model-to-task fit & delegation** in builder `00-routing.md` § Shared conventions (~15 lines: tier table, delegate-when/keep-when, escalation, output contract, context-override) citing rules-of-why R5–R6 | builder skill | AC-07 (first half) | mined from delegation-policy quarry (spine § Source material) |
| 2.4 | One-line cites + packet-template tier field at all six spawn sites | builder skill | AC-07 grep-provable | |
| 2.5 | eng-harness-flow SKILL.md ≤3-line cite (token discipline + delegation posture); doctrine-parity guard untouched and green | eng-harness-flow skill | AC-08 | D2 |
| 2.6 | Write `tripwire-runbook.md` (pull wild refs → report/insights → diff stageEconomics + mechanism counts vs baseline → worked/partial/regressed decision table; F-12 interpretation notes); add `tripwire-review` excursion node off `ship` | plan artifacts | AC-09 | user directive |
| 2.7 | Self-measure evidence: pull this P2 session's refs, confirm >2 FlowEvents + per-stage rows render; append to `baseline/` as the "first after" sample | plan artifacts | AC-01 (observed half); AC-05 extended | |
| 2.8 | Sweep: AC-10 no-gating language check across the diff; `harness checks` green | both skills | AC-10 | reviewer also asserts |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | 1.1, 1.2, 1.3, 2.7 | design evidence + vitest + real P2 session report (>1 stage bucket) |
| AC-02 | 1.4, 1.5 | vitest byte-invariance test |
| AC-03 | 1.4 | negative test |
| AC-04 | 1.6 | manifest entry + check:docs |
| AC-05 | 1.9, 2.7 | baseline/ record |
| AC-06 | 2.1, 2.2 | template lockstep test |
| AC-07 | 2.3, 2.4 | grep assertions in review |
| AC-08 | 2.5 | grep + parity guard |
| AC-09 | 2.6 | runbook (two evidence classes) + excursion node |
| AC-10 | 2.8 | sweep + review |
| AC-11 | 1.7 | execution log evidence |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Envelope regression breaks a consumer | Low | High | AC-02/03 byte-invariance + negative tests; default path untouched |
| FlowEvent density inflates telemetry volume | Low | Low | counts-only events, one per nav move; bounded slugs |
| New instruction lines drift from doctrine over time | Medium | Medium | pinned by the extended lockstep test (2.1) |
| P2 wording lands but behaviour doesn't change in the wild | Medium | High | that is exactly what AC-09's tripwire measures; decision table forces an honest verdict at T+3wk |
