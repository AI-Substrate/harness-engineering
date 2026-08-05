# Cohort Telemetry Insights — month sweeps, measures & the insights layer
**Mode**: Full
**Plan Version**: 1.0.0
**Created**: 2026-07-02
**Status**: READY
**Spec source**: unified (this file)

📚 Incorporates findings from research-dossier.md · **Design inputs (authoritative)**: [WS001 cohort measures & insights layer](./workshops/001-cohort-measures-and-insights-layer.md) (D1–D7) · 047 workshops [002](../047-session-telemetry-dashboard/workshops/002-report-model-rollups-and-html.md)/[004](../047-session-telemetry-dashboard/workshops/004-central-session-storage-layout.md) · retro [002-046-dogfood-run1-drain](../../../.harness/records/retro/2026-07-02/002-046-dogfood-run1-drain.md)

## Business Specification

### Research Context

The dossier's headline: the shard→report pipeline **already exists for one repo** (`session save --source git-ref|auto` + the filterable 1..N `report`), refs are month-sharded (`refs/harness-telemetry/YYYY/MM/DD/<session>`), plan-identity capture exists in code but is live-empty, and individual identity is structurally absent by design (AC-11/13). The report's flow_stage lens uses the weaker digit mechanism while the authoritative nav-derived `FlowEvent` machinery sits unused one layer down.

### Summary

Turn the per-session telemetry substrate into a **cohort instrument**: one command sweeps a month of committed telemetry for a repo into a measures report, and a new **insights layer** computes practice-analytics on top — time/tokens per semantic flow stage, tool/skill cost, harness-loop discipline, per-work-unit stage shares — rendered as a slick self-contained HTML page with LLM narration at the edge. Implements WS001 D1–D7 verbatim.

### Goals

- "All sessions in this repo for June" is **one command**, fed entirely from committed refs (no temp buffers, no per-session archaeology).
- Stage economics are **semantic and honest**: research/plan/implement/review/ship time+tokens from nav-derived stages, wall AND active clocks for explore→ship.
- Tool/skill/bash cost tables answer "what's costing heaps" with tunable numbers (**sent/received, fresh-only**).
- The **discipline panel** makes loop adherence measurable (observe→drain conversion, backpressure-before-implement, checks-before-push, retro cadence).
- The **per-work-unit table** ships first as the correlation layer's substrate — grain proven before any stats.
- LLM participation is structural: narrator prose + smith-proposed generators, **never LLM-computed numbers**.

### Non-Goals

- **No people analytics** — insights aggregate over work units, never rank contributors (WS001 D6; structurally backed by the identity-free capture design). This plan must not add identity.
- No correlations/causal claims in v1 (the work-unit table is their future food); no week-over-week trends (needs ≥2 reports); no DORA (layer-3 join, own contract later).
- No codex telemetry adapter (deferred, retro DL-001); no multi-repo/org sweep in v1 (per-repo reports compose at layer 3 until a repo facet exists — `--filter-repo` stays echoed-not-applied).
- No capture-layer intelligence ("no smart capture" — WS001 anti-goal).

### Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| telemetry | existing | **modify** | flow_stage lens promotion, sent/received render, sweep collector, insights service + verb |
| the-flow / flight-plan | existing | **consume** | `FlowEvent` stage source (`nav.now` node ids) — read-only reuse of flow-nav/rollup |
| skills (user-global + repo) | existing | **modify** | one thin narrator/smith skill routing the LLM edge |
| docs | existing | **modify** | one docs/how page |

### Testing Strategy

- **Approach**: Hybrid — Full TDD + named non-vacuity mutations for lenses, sweep logic, insight generators, and n-threshold rules; lightweight (snapshot/smoke) for HTML render and docs.
- **Rationale**: matches the telemetry/flow-eval suites' established discipline; the stats-bearing code is exactly where silent wrongness is most expensive.
- **Focus areas**: FlowEvent-primary stage attribution (digit fallback, `unlabeled` only when neither); version tolerance (v2.0 thin vs v2.2 OTLP fixtures); sent/received attribution; work-unit grouping; epistemics enforcement (missing n/caveat ⇒ row refuses to render).
- **Excluded**: pixel-level HTML assertions; LLM output quality (structurally out of scope — the LLM never computes).
- **Mock usage**: real fixtures only — committed shard fixtures for both schema eras; the git plumbing boundary exercised against a real fixture repo (as `--source git-ref` tests already do).

### Documentation Strategy

- **Location**: `docs/how/` — one page: run a sweep → read the measures → read the insights → feed the smith's proposals back.
- **Rationale**: matches 046/047 precedent; README already carries the telemetry/evaluation sections.

### Complexity

- **Score**: CS-4 (large)
- **Breakdown**: S=2, I=1, D=1, N=1, F=1, T=1 → 7
- **Confidence**: 0.8
- **Assumptions**: token events survive the shard round-trip (verified first — T1.1); branch≈work-unit convention holds for this repo's history.
- **Dependencies**: 046/047 substrate merged (both sit on `feat/041-flow-conformance-eval` at ship); WS001 D1–D7 authoritative.
- **Risks**: see § Risks & Assumptions.
- **Phases**: 3.

### Acceptance Criteria

| AC | Criterion |
|----|-----------|
| AC-01 | `harness telemetry sweep --month YYYY-MM` produces a month-scoped `TelemetryReport` (+ HTML) for the current repo **from refs alone** — enumerates `refs/harness-telemetry/YYYY/MM/*`, exports each session via `--source git-ref`, reports the set; re-runnable/idempotent |
| AC-02 | The report's `flow_stage` lens is **FlowEvent-primary** (nav node ids), skill-digit fallback, `unlabeled` only when neither exists — and a **versioned semantic mapping** (node-id → research/plan/implement/review/ship) ships in the report layer and appears in report provenance |
| AC-03 | All rendered token columns are **sent/received** (non-cache input / output, FX002 semantics); no cache column anywhere in report or insights HTML; measured-zero still renders `0` |
| AC-04 | A v2.0-era shard sweeps without crash or fabricated numbers: time-only rows with the token gap **declared** in provenance |
| AC-05 | `harness telemetry insights <report.json…>` emits `insights.json` carrying the seven WS001 sections + the discipline panel; every insight row carries `{claim, measures_used, n, interval?, caveat}` and a row below the n-threshold aggregates up or does not render (mutation: strip the caveat/n ⇒ a test flips RED) |
| AC-06 | The per-work-unit table is branch-keyed with stage-share + discipline columns; explore→ship elapsed carried in BOTH wall and active clocks |
| AC-07 | Subagent rows render counts with tokens **honestly unmeasured** (never zero-filled) |
| AC-08 | A self-contained `insights/index.html` renders all sections + a reserved narrator slot; opens file:// with no network |
| AC-09 | The LLM edge is contractual: a narrator packet (computed numbers in, prose out, injected into the reserved slot) and a smith proposal contract (new-generator code proposals, review-gated) exist as a thin skill + doc; nothing in the CLI calls an LLM |
| AC-10 | One `docs/how/` page walks the loop end-to-end |
| AC-11 | **Dogfood**: a real month of THIS repo swept → measures + insights generated; artifacts referenced from the plan's ship notes (the proof AC) |
| AC-12 | `plans_touched` live-emptiness is root-caused: fixed + one live-confirmed capture, **or** honestly documented as unavailable with the branch proxy formalized in the work-unit table's provenance |
| AC-13 | DL-002 resolved: one flushed live `/the-flow <digit>` confirms the skill-arg survives the live path, or the digit lens is formally demoted to best-effort in report provenance |

### Risks & Assumptions

| Risk | Notes |
|------|-------|
| Token events may not survive the shard round-trip (dossier risk #1) | T1.1 verifies FIRST; if absent, adding totals to the sync payload is a **P12-reviewed capture-domain change** — scoped as its own task, never silently absorbed |
| `plans_touched` root cause may be deep | AC-12 allows the honest-documentation exit; branch proxy is the formalized interim |
| Branch≈work-unit convention has exceptions | Work-unit table provenance names the keying rule; exceptions surface as visible `unassigned` rows, never silent merges |
| Month sweeps over many sessions could be slow | Per-session exports are cacheable on disk (re-sweep skips unchanged refs); acceptable v1 perf bar is "a month of this repo in minutes" |

### Open Questions

- The principal's scenario list (WS001 Q1) — slots into the insights library as new generators; must not reopen D1–D7.
- DORA source contract (WS001 Q2) — deferred until a layer-3 GitHub join is scheduled.

### Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| Collector surface & sweep mechanics | CLI Flow | The one real layer-2 design choice left | verb shape; ref enumeration + caching; incremental re-sweep; multi-repo composition posture |
| Insight template schema & HTML contract | Data Model | Gates the first generator AND the narrator slot | row schema; n-threshold value; section/HTML contract |
| LLM edge protocol | Integration Pattern | Deferrable — additive to a working v1 | narrator packet shape; smith proposal review loop; the no-computed-numbers boundary made mechanical |

### Clarifications

#### Session 2026-07-02

- Q: Workflow mode? → A: **Full** (3 real phases, CS-4).
- Q: Testing strategy? → A: **Hybrid** (TDD+mutations for stats-bearing code; lightweight for HTML/docs).
- Q: Mock usage? → A: **Real fixtures only** (incl. both schema eras).
- Q: Documentation? → A: **docs/how page only**.
- (Conversation-locked, recorded in WS001: sent/received vocabulary; the-flow included in skill table; FlowEvent-primary stages; work-unit grain; no-people anti-goal; narrator/smith LLM roles; ritual-marker panel v1-committed.)

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: Collector surface & sweep mechanics · Insight template schema & HTML contract · LLM edge protocol

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | y | informs Key Findings (F-01..F-10) |
| workshops/001-*.md | y | authoritative — D1–D7 + v1 section set locked |

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | Round 1 answered; no critical markers remain |
| G2 | Constitution | PASS | P2 pure services (insights = service + acts wiring, ports type-only); P5/P9 honesty/evidence are the plan's core mechanic; P12 named on the conditional sync-payload task |
| G3 | Architecture | PASS | Entrypoint→Acts→Services→Ports respected; no new top-layer |
| G4 | ADR Compliance | N/A | no `docs/adr/` in repo |
| G5 | Structure | PASS | all required sections present |
| G6 | Testing Alignment | PASS | Hybrid: TDD tasks precede impl in stats-bearing tasks; lightweight validation tasks present for HTML/docs |
| G7 | Domain Completeness | PASS | informal domain convention (no registry — matches 047); manifest covers all phase files |

### Summary

Three phases: (1) make the measures layer month-capable and semantically honest — verification spikes first, then the FlowEvent lens promotion, sent/received render, and the `sweep` collector composing the existing `--source git-ref` + `report` verbs; (2) build the insights layer — a pure service + `telemetry insights` verb computing the WS001 v1 sections with mandatory epistemics, rendered to self-contained HTML; (3) attach the LLM edge contractually, write the docs/how page, and prove the whole loop by sweeping a real month of this repo.

### Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `harness/cli/src/services/telemetry/report.ts` | telemetry | internal | lens promotion, semantic stage map, sent/received render |
| `harness/cli/src/services/telemetry/sweep.ts` (new) | telemetry | internal | pure month-sweep planning (ref list → export set → report input) |
| `harness/cli/src/services/telemetry/insights.ts` (new) | telemetry | internal | pure insights computation (sections, templates, n-threshold) |
| `harness/cli/src/services/telemetry/insights-html.ts` (new) | telemetry | internal | self-contained HTML render + narrator slot |
| `harness/cli/src/acts/telemetry.ts` | telemetry | contract | `sweep` + `insights` verb wiring (CLI is the API) |
| `harness/cli/src/services/telemetry/capture-service.ts` | telemetry | internal | plans_touched root-cause fix (AC-12, bounded) |
| `harness/cli/test/services/telemetry/**` + fixtures | telemetry | internal | both-era shard fixtures; TDD + mutation tests |
| `.claude/skills/telemetry-insights-narrate/SKILL.md` (new) | skills | contract | the thin LLM-edge skill (narrator packet + smith proposals) |
| `docs/how/cohort-telemetry-insights.md` (new) | docs | internal | the loop walkthrough |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | Shard→report pipeline already exists (`--source git-ref`, N-input `report`) — dossier F-01/F-02 | Sweep is composition; do NOT build a new read path |
| 02 | Critical | Ref-sourced exports' token fidelity unverified end-to-end — dossier risk #1 | T1.1 verification spike FIRST; conditional P12-reviewed follow-up if tokens are absent |
| 03 | High | flow_stage lens is digit-based; nav-derived FlowEvent/`flow_stage_time_s` exists unused (report.ts:13-14 vs :468-482) | T1.4 promotes FlowEvent primary; digit fallback kept + tested |
| 04 | High | `plans_touched` capture exists (capture-service.ts:388) but live-empty (phase-3 finding) | T1.2 root-cause; AC-12's honest exit if deep |
| 05 | High | Identity structurally absent (segment.ts:127, AC-11/13); shard commits authored `harness-telemetry` | D6 anti-goal is free; plan adds NO identity |
| 06 | Medium | Schema eras: v2.0 thin vs v2.2 OTLP — dossier F-08 | Version-tolerant sweep; declared gaps, no backfill (AC-04) |

### Phases

#### Phase Index

| Phase | Title | Primary Domain | Objective (1 line) | Depends On |
|-------|-------|---------------|-------------------|------------|
| 1 | Measures foundation & month sweep | telemetry | Verify the substrate, promote the stage lens, render sent/received, ship the `sweep` collector | None |
| 2 | The insights layer v1 | telemetry | `telemetry insights` service+verb computing the WS001 sections with mandatory epistemics + HTML | Phase 1 |
| 3 | LLM edge, docs & real-month dogfood | telemetry / skills / docs | Contractual narrator/smith edge, the docs/how page, and the proof sweep over this repo | Phases 1–2 |

#### Phase 1: Measures foundation & month sweep

**Objective**: Make the measures layer month-capable and semantically honest, verification-first.
**Domain**: telemetry
**Delivers**: verified substrate facts (tokens/plans_touched/digit), FlowEvent-primary flow_stage lens + semantic map, sent/received render, `harness telemetry sweep`.
**Depends on**: None (046/047 substrate already on branch).
**Key risks**: T1.1 may reveal a sync-payload gap → its follow-up is a separately-scoped P12-reviewed task, not silent absorption.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 1.1 | **Verification spike (tokens)**: export one real session `--source git-ref` and diff against its temp-sourced export | telemetry | Written comparison in execution log; token fidelity confirmed OR the gap precisely named | Finding 02; gates 1.6's scope |
| 1.2 | **Root-cause `plans_touched` live emptiness** (instrumented live session in a plan-bearing repo; read the captured segment) | telemetry | Cause named; fix landed + one live-confirmed capture, or AC-12 honest-documentation exit taken | Finding 04 |
| 1.3 | **DL-002 live digit confirm**: one flushed live `/the-flow <digit>` invocation; compare captured segment to the fixture path | telemetry | AC-13 satisfied either way (confirmed, or digit demoted in provenance) | retro DL-002 |
| 1.4 | **TDD: FlowEvent-primary flow_stage lens** — failing tests first (FlowEvent-labeled sessions, digit-fallback sessions, neither→`unlabeled`), then promote the lens; versioned semantic stage map (node-id → research/plan/implement/review/ship) in report provenance | telemetry | AC-02; mutations: lens-ignores-FlowEvent → RED; map-version-dropped → RED; existing report tests stay green | Finding 03 |
| 1.5 | **TDD: sent/received render** — token columns collapse to sent/received everywhere in report output; no cache column | telemetry | AC-03; mutation: cache column reintroduced → RED | WS001 D2 |
| 1.6 | **TDD: `harness telemetry sweep --month YYYY-MM [--out]`** — pure sweep service (ref enumeration → per-session export set → report input) + acts wiring; per-session export cache; version-tolerant (both-era fixtures) | telemetry | AC-01 + AC-04; mutations: v2.0-shard-fabricates-tokens → RED; re-sweep-re-exports-unchanged-ref → RED | Findings 01/06 |
| 1.7 | **CONDITIONAL (fires iff 1.1 confirms the token gap): P12-reviewed session-token sync-payload change** — add session token totals to the synced shard payload; explicit publication-boundary review recorded | telemetry | Tokens present in a freshly synced shard's export, or the task is closed "not needed" citing 1.1's evidence. **Gate on 3.3**: the dogfood month must either carry token-bearing shards, or AC-11's ship note declares the token gap as a named limitation | Finding 02; P12 |

#### Phase 2: The insights layer v1

**Objective**: Compute the locked WS001 v1 sections over 1..N reports with mandatory epistemics, rendered to self-contained HTML.
**Domain**: telemetry
**Delivers**: `insights.ts` service, `harness telemetry insights` verb, `insights.json` schema, HTML with narrator slot.
**Depends on**: Phase 1.
**Key risks**: epistemics enforcement must be structural (a row without n/caveat cannot render), not conventional.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 2.1 | **TDD: insight row schema + epistemics enforcement** — `{claim, measures_used, n, interval?, caveat}`; n-threshold aggregates-up-or-omits | telemetry | AC-05 mutations: caveat stripped → RED; below-threshold row renders → RED | WS001 epistemic contract |
| 2.2 | **TDD: the seven sections** — stage economics (+ explore→ship wall & active), skill breakdown (the-flow included, non-additive footnote), bash by count & by sent, subagents honest-unmeasured, active/wall ratio, outlier sessions, per-work-unit table (branch-keyed, stage-share columns) | telemetry | AC-05/06/07; each section a named generator with its own tests | WS001 v1 set |
| 2.3 | **TDD: discipline panel** — observe→drain conversion, backpressure-before-implement, checks-before-push, retro cadence (sequence joins over harness events per work unit) | telemetry | Panel rows carry the same epistemics; mutation: sequence-join order broken → RED | WS001 v1-committed |
| 2.4 | **`telemetry insights` verb + insights.json** — acts wiring, schema-versioned output, provenance (input reports, mapping version, keying rule, **declared copilot tail-capture time-skew caveat keyed by harness** — dossier H-05, document-don't-fix) | telemetry | Given 1 valid + 1 missing/corrupt report path: verb errors per envelope semantics with the bad input named, and a partial run records the omission in insights.json provenance (test asserted) | P4/P10; H-05 |
| 2.5 | **HTML render** — self-contained `insights/index.html`, all sections + reserved narrator slot | telemetry | AC-08 smoke test: renders offline, slot present, no computed number originates outside insights.json | lightweight per strategy |

#### Phase 3: LLM edge, docs & real-month dogfood

**Objective**: Attach LLM participation contractually, document the loop, and prove it on this repo's real month.
**Domain**: telemetry / skills / docs
**Delivers**: narrator/smith skill + contract doc, docs/how page, the dogfood artifacts.
**Depends on**: Phases 1–2.
**Key risks**: the dogfood is the real gate — measure quality judged against actual data, not fixtures.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 3.1 | **Narrator/smith skill** — thin skill: narrator packet (insights.json in → prose for the slot out) + smith proposal contract (generator code proposals, review-gated); no CLI inference | skills | AC-09; the no-computed-numbers rule stated as a hard rule in the skill | WS001 D7 |
| 3.2 | **docs/how page** — sweep → measures → insights → narrate → feed back | docs | AC-10; markdown-lint stays ≤ pre-existing findings | precedent: 046 4.1 |
| 3.3 | **Real-month dogfood** — sweep a real month of THIS repo; generate measures + insights + narrated HTML; capture observations; record artifact refs | telemetry | AC-11; findings drained to retro; measure defects become fix tasks (the 046 pattern) | the proof |
| 3.4 | **Harvest** — drain observations; encode ≥1 quick win or defer explicitly | telemetry | ≥1 observation encoded (named artifact path) or an explicit deferral recorded in a `.harness/records/retro/` drain record | mirrors 046 4.4 |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | 1.6 | sweep tests + dogfood 3.3 |
| AC-02 | 1.4 | lens tests + mutations |
| AC-03 | 1.5 | render tests |
| AC-04 | 1.6 | both-era fixture tests |
| AC-05 | 2.1, 2.2, 2.3, 2.4 | epistemics mutations; panel + verb/envelope tests |
| AC-06 | 2.2 | work-unit table tests |
| AC-07 | 2.2 | subagent row test |
| AC-08 | 2.5 | HTML smoke test |
| AC-09 | 3.1 | skill review |
| AC-10 | 3.2 | docs gate |
| AC-11 | 3.3 (gated by 1.7 when it fires) | dogfood artifacts; token gap declared if unresolved |
| AC-12 | 1.2 | root-cause note + live capture (or honest exit) |
| AC-13 | 1.3 | live digit capture (or demotion note) |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Token gap in synced shards (T1.1) | Medium | High | Verification-first; conditional P12-reviewed payload task, separately scoped |
| plans_touched root cause deep | Medium | Medium | AC-12 honest exit; branch proxy formalized |
| Month-sweep performance | Low | Medium | Per-session export cache; re-sweep skips unchanged refs |
| Epistemics erode in the pretty layer | Medium | High | Structural enforcement (2.1) + mutation tests; narrator slot cannot mint numbers (2.5 smoke) |
