# validate-harness-flow — dogfood the full harness setup flow

**Mode**: Simple
**Status**: Specified
**Created**: 2026-06-09
📚 Specification incorporates findings from `research-dossier.md`

## Research Context

Two existing pieces cover ~80% of this work:
- **`.harness/extensions/validate-harnessability.ts`** — the parallel orchestrator: temp dir, `git clone --depth=1` loop, detached `nohup` fire-and-forget per repo, `minih last-run` run-id capture, immediate `ctx.ok/degraded/error` return with a `next_action` polling prompt. Has **no unit tests** — validated via real smokes.
- **`agents/install-and-validate-test-extension/`** — a single-shot minih worker that, in a throwaway repo, **drives a setup skill** (`add-extension`) and independently validates the result, emitting a `verdict` + dual-layer `retrospective`.

Key facts: `minih` 0.1.7 is installed; skills are wired via `.minih.json` (already includes all `eng-harness-*` skills). The governance writer (`harness init`) is **not shipped** — the worker hand-writes `.harness/engineering-harness.md` from `references/governance-doc.md`. The no-auto-implement guarantee is already baked into `eng-harness-4-retro` (`SKILL.md:165-167, 223-225, 471-478`).

## Summary

**WHAT**: Add a new dogfood extension, `harness validate-harness-flow`, that clones popular public repos and fires one background `minih` worker per repo to run the **full harness setup flow** — harnessability assessment → hand-written governance doc → detect + author + validate a working `boot` extension — recording its own retros along the way. It fires **3 in parallel**, returns immediately, and a collection step aggregates each child's records + reports into this plan folder. Separately, **we dogfood the same flow on this repo** while building it, recording our own retros, then harvest and report back.

**WHY**: Proves the harness setup flow end-to-end on real, unseen repos, and surfaces friction (gaps like the unshipped governance writer) as retros we can act on — *exercising the loop on the very tool that drives it*.

## Goals

- A new `harness validate-harness-flow` verb that mirrors `validate-harnessability` but fires a **full-setup-flow** worker per repo.
- A new `minih` agent (`agents/validate-harness-flow/`) whose mission is the autonomous setup recipe: install harness into target → assess → governance doc → author+validate `boot` → record retro → emit `verdict` + `retrospective`.
- **Parallel ×3** (one Node, one Python, one Go), fire-and-forget, immediate return with poll/collect prompting.
- **Abandonment is a valid outcome**: a poorly-harnessable repo is *reported* (with grade + reason), not forced through; the operator re-fires a held-back alternate.
- A **collection step** that copies each child's `.harness/records/retro/*.md`, harnessability report, and `output/report.json` into `docs/plans/013-dogfood-harness-flow/runs/<repo>/`, plus a plan-local rollup that links them.
- **We dogfood the flow ourselves** on this repo, recording our own retros via `harness record retro`, and **report all collected records back at the end**.

## Non-Goals

- **No auto-implementation of retro-sourced improvements.** Harvest *presents* options; the user may go deeper; nothing is applied automatically. (Inherited from `eng-harness-4-retro`.)
- **Not** shipping `harness init` (the governance writer) — out of scope; the worker hand-writes governance for now (and the gap is itself a finding).
- **No worker self-substitution** in v1 — the worker reports "abandoned"; it does not itself pick and clone the next candidate.
- Not modifying the `eng-harness-flow` router or any setup skill (we *drive* them, we don't change them).
- Not adding a formal Phase-0 governance gate to *this* repo — the dogfood run **is** the exercise.

## Target Domains

> No `docs/domains/registry.md` in this repo — domains are informal. This feature fits the existing structure cleanly (no new domain).

| Area | Status | Relationship | Role in This Feature |
|------|--------|-------------|---------------------|
| `.harness/extensions/` (harness CLI extensions) | existing | **create** | Add `validate-harness-flow.ts` (sibling of `validate-harnessability.ts`) |
| `agents/` (minih agent defs) | existing | **create** | Add `agents/validate-harness-flow/` (sibling of `install-and-validate-test-extension/`) |
| `docs/plans/013-…/runs/` (collection sink) | **NEW (artifact dir)** | **create** | Aggregated child records + rollup land here |
| `eng-harness-*` skills + `eng-harness-flow` | existing | **consume** | Driven by the worker; not modified |
| `harness record` / `.harness/records/retro/` | existing | **consume** | Children + we record retros here |

## Testing Strategy

- **Approach**: Lightweight (Simple-mode default). The deliverables are an **extension** (runtime glue, mirroring `validate-harnessability.ts` which carries no unit tests) and a **minih agent** (markdown prompt + JSON schemas). Both are validated by **real end-to-end smokes**, not unit tests.
- **Validation focus**:
  1. `harness doctor` / `harness help` list the new verb; `harness validate-harness-flow --help` renders.
  2. A real run clones the targets, fires the workers, and returns a parseable Envelope with run IDs + `next_action`.
  3. At least one worker completes the full recipe on a real repo (governance written, `boot` authored + boots, retro recorded), proven by reading its `output/report.json` + the collected records.
  4. The collection step produces the per-repo dirs + rollup.
- **Excluded**: heavy unit tests for the extension glue (matches repo convention for dogfood extensions). If any *pure helper* is extracted (e.g. repo-name sanitization), it may get a small fake-based unit test per repo convention.
- **Mock Usage**: B — targeted only. The flow uses **real** clones/fires/records; no mocking of `minih`/`git`. Any extracted pure helper uses fakes (no real network) per repo convention.

## Documentation Strategy

- **Location**: `docs/how/` (a short guide on the dogfood extension + how records are collected and reported), plus a one-line pointer from `README.md`/`skills/README.md` if a discoverability gap exists.
- **Rationale**: matches the existing harness guides (`docs/how/extend-the-harness.md`, `record-and-record-types.md`).

## Complexity

- **Score**: CS-3 (medium)
- **Breakdown**: S=1 (2 new files + a collection step + a docs guide), I=2 (minih, git, the setup skills, the record command — many moving integration points), D=1 (records/reports aggregation), N=1 (autonomous full-flow worker mission is novel; orchestrator is copied), F=1 (long-running detached agents, permissions, timeouts), T=1 (validated by smokes not units)
- **Total P**: 7 → CS-3
- **Confidence**: 0.7
- **Assumptions**: `minih` 0.1.7 stays available; chosen public repos clone without auth; the SDK model can complete a full setup within the agent timeout.
- **Dependencies**: `validate-harnessability.ts` (skeleton), `install-and-validate-test-extension` (agent shape), `eng-harness-0-harnessability-assessment` / `eng-harness-0-add-extension` skills, `references/governance-doc.md` (BIO template), `harness record retro`.
- **Risks**: see below.
- **Phases**: 1 (Simple) — build the extension + agent + collection, then execute the dogfood run and report. (Architect may split into a small ordered task group.)

## Acceptance Criteria

1. `harness validate-harness-flow` is registered: appears in `harness help` and `harness doctor` (loaded, not failed/conflict); `--help` renders its options.
2. Running it clones the configured targets (default 3: one Node, one Python, one Go) into a temp dir and fires **one detached `minih` worker per clone**, returning **immediately** with a parseable Envelope containing each `runId`/`runDir` + a `next_action` describing how to poll (`minih status/tail/last-run`) and collect.
3. Options exist to override targets (`--repo <urls...>`), keep temp dirs (`--keep`), pass a model (`--model`), and choose harness install source (`--github` ⇒ npx path; default = local file install). Verb never throws; every non-ok result carries a `next_action`.
4. The worker agent (`agents/validate-harness-flow/`) defines: `agent.json`, `prompt.md` (mission = the autonomous recipe; frontmatter `timeout`, `permissions` with shell/write/network + `/tmp` roots), `instructions.md` (drive the skills; independent verification mandatory; throwaway writes only; capture friction at the moment of friction), `input-schema.json` (`targetRepo` required, `harnessSource`, `keepTarget`), `output-schema.json`.
5. On a real run, at least one worker completes the recipe end-to-end on its target: harness installed into the clone; harnessability assessed (report present); `.harness/engineering-harness.md` written **from the BIO template at `skills/eng-harness-loop/eng-harness-flow/references/governance-doc.md`**, containing all required BIO fields (Boot command · Health check · Interact method · Observe method · Deterministic signal inventory · Evidence paths · Back-pressure gaps · Maturity snapshot); a `boot` extension authored via the `add-extension` skill that **actually boots** (`harness boot` returns an honest `ok`); a retro recorded via `harness record retro`. The governance step is "complete" only when all 8 BIO fields are present. Proven by the worker's `output/report.json` (schema-valid) + the on-disk artifacts.
6. The worker's `output/report.json` carries: `targetRepo`, `harnessabilityGrade` (the assessment's `verdict.final_grade`) + `axisTuple` (Operate-Today % and Adaptability %, read from the assessment `report.json` / root `.harness/reports/harnessability/latest.json`), `abandoned` (bool) with `abandonReason` when true, `governanceWritten`, `bootAuthored`, `bootRuns`, `retroRecorded`, `retroRecordPaths[]`, `verdict` (PASS|FAIL|ABANDONED), `summary`, and a dual-layer `retrospective` (`workedWell/confusing/magicWand/magicWandTarget(project|minih)/difficulties[]` numbered + layer-tagged). The mapping from assessment output → report fields is fixed (above) so the rollup can consume it without inventing paths.
7. **Abandonment path**: when a target's harnessability is poor (`verdict.final_grade` ∈ {D, E, F} — i.e. below C "Workable", reconciling the original {D, F} which skipped the strictly-worse E band — or Operate-Today % in the lowest band), the worker stops after assessment, sets `abandoned: true` + `abandonReason`, `verdict: ABANDONED`, and the run is reported (not a hard FAIL). The operator can re-fire a held-back alternate via `--repo`.
8. A **collection step** (a `--collect` mode of the verb) is **idempotent** and **waits for terminal children before aggregating**: a child is "done" when its `output/report.json` exists with a terminal `verdict`, or `minih status <slug> --run <id>` reports a terminal state. `--collect` polls each required `runId` until terminal **or** a per-run wait cap elapses, then classifies each as `DONE` / `TIMED_OUT` / `MISSING_REPORT`. For each `DONE` child it copies `.harness/records/retro/*.md`, `.harness/reports/harnessability/latest.{md,json}`, and `output/report.json` into `docs/plans/013-dogfood-harness-flow/runs/<repo>/`; `TIMED_OUT`/`MISSING_REPORT` children are recorded in the rollup (not silently dropped). It writes a plan-local rollup (`runs/ROLLUP.md`) linking every run with its state + merged counts/clusters. Child records are never mutated.
9. **No auto-implement**: neither the worker nor the collection/rollup applies any retro-sourced improvement — they record and present. The ONLY corrective changes we make during our work are to a **broken record-write path** (e.g. if `harness record` itself errors), never a retro-sourced change.
10. **Self-dogfood**: during this plan we run the harness loop on *this* repo and record our own retros via `harness record retro`; the final report summarizes both the children's and our own collected records.
11. A `docs/how/` guide documents the extension, the recipe, and the collection/report flow.
12. **Culminating 3-parallel smoke**: a real run of the default 3 targets (one Node, one Python, one Go) fires all three concurrently, and after they reach terminal states `--collect` produces the three `runs/<repo>/` dirs + `runs/ROLLUP.md` — proving the full fire-and-collect path end-to-end (not just a single worker). This is the plan's culminating validation.

## Risks & Assumptions

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | Worker can't complete a full setup within timeout / model limits | Generous timeout (≥1800s); pick small repos; library/CLI boot (build+test) is the cheapest proof |
| R2 | Governance writer unshipped → worker must hand-write `engineering-harness.md` | Give the worker the BIO template inline; treat the gap as a logged finding |
| R3 | Chosen repo has ambiguous/expensive boot | Worker detects cheapest readiness proof; abandonment path covers "no good boot" |
| R4 | `eng-harness-flow`/setup skills are interactive (print-then-offer) | Worker drives the **child setup skills directly** (the `install-and-validate` pattern), not the router conversationally |
| R5 | Parallel runs interfere (shared paths) | Per-repo temp dirs + per-repo run dirs (copied from `validate-harnessability` de-dup logic) |
| R6 | Collecting from children mutates their state | Collection is read-only copy; rollup is additive in the plan folder only |

## Open Questions

> Resolved by recommended defaults (per "accept other defaults"); revisit any if desired.

1. **Verb/agent name** → `validate-harness-flow` (parallels `validate-harnessability`). *(default)*
2. **Install source** → local file install default; `--github` opt-in. *(default)*
3. **Abandonment automation** → worker reports `ABANDONED`; operator re-fires alternate; no self-substitution in v1. *(default)*
4. **Candidate count** → fire 3 (Node/Python/Go), hold alternates for re-fire. *(default)*
5. **Collection trigger** → `--collect` mode on the verb (re-runs idempotently once children finish). *(default; architect confirms)*

## Workshop Opportunities

> Logged for visibility (Simple mode — not run). Pull into `/plan-2c` only if a choice feels unsettled.

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| WS-A Worker mission contract | Integration Pattern | The autonomous recipe + abandonment threshold are the crux | Exact ordered steps; which grade/band abandons; how "abandoned" is signaled |
| WS-B Boot detection heuristics | CLI Flow | "Good boot" varies by repo shape | web/lib/CLI/docker detection; what proves "boots" |
| WS-C Collection & rollup shape | Storage Design | Aggregation paths + report format | dirs, dedup by `retro_id`, rollup doc layout |
| WS-D Dogfooding-ourselves loop | Other | The process half (us using the flow) | where our retros land; end-of-plan harvest+report shape |

## Clarifications

### Session 2026-06-09

- **Q (Workflow Mode)** → **Simple** (user-pinned: "Spec to be simple mode").
- **Q (Testing Strategy)** → **Lightweight** (default). Deliverables are an extension + agent def validated by real smokes; mirrors `validate-harnessability.ts` (no unit tests). Pure helpers, if any, get fake-based unit tests per repo convention.
- **Q (Mock Usage)** → **B, targeted only** (default). Real clones/fires/records; no mocking `minih`/`git`.
- **Q (Documentation Strategy)** → **docs/how/ guide** (+ README pointer if needed) (default) — matches existing harness guides.
- **Q (Agent Harness Readiness, this repo)** → No formal Phase-0 gate. The plan **dogfoods** the harness flow on this repo (recording our own retros) as scope WS-D; that *is* the exercise, not a prerequisite gate.
- **Q (Open Questions 1–5)** → resolved by the recommended defaults above (user: "accept other defaults").

---

## Validation Record (2026-06-09)

### Validation Thesis

**Raison d'être**: Prove the harness setup flow works end-to-end on real, unseen public repos AND surface friction as retros, via a dogfood extension firing parallel `minih` workers; plus dogfooding the flow on this repo and reporting all records back.

**Value claim**: The setup flow becomes verifiable on real repos (not just this one), and friction becomes visible/actionable as retros — so the harness product can be improved on evidence.

**Artifact promise**: `/plan-3` can architect a buildable plan covering the extension, the agent, the autonomous recipe, the collection, the no-auto-implement guarantee, and the dogfood loop, with testable ACs.

**Intended beneficiaries**: harness maintainers; downstream `/plan-3` + `/plan-6`; future agents running the dogfood.

**Proof target**: Contract.

**Evidence standard**: testable ACs; named reuse templates (`validate-harnessability.ts`, `install-and-validate-test-extension`); cited no-auto-implement guarantee; clear scope/non-goals.

**Thesis source**: `original-ask.md` + `research-dossier.md`.

**Thesis verdict**: Advanced (Contract target met; Contract actual).

**Main thesis risk**: The 3-parallel + collect culmination was stronger in the summary than in the ACs — addressed by adding AC-12 (culminating 3-parallel smoke) and tightening AC-8 (terminal-wait collection).

---

| Agent | Lenses Covered | Thesis Axes Covered | Issues | Verdict |
|-------|---------------|---------------------|--------|---------|
| Clarity + Completeness | Evidence Sufficiency, Proof-Level Fit, Hidden Assumptions, Edge Cases, Deployment & Ops, Domain Boundaries, Concept Docs | Evidence Sufficiency, Proof-Level Fit | 2 HIGH + 2 MEDIUM, all fixed | ⚠️ → ✅ |
| Thesis Alignment | Thesis Alignment, Evidence Sufficiency, Proof-Level Fit, Hidden Assumptions | Thesis Alignment, User/Product Value | 0 blocking (1 risk noted, fixed) | ✅ |
| Forward-Compatibility | Forward-Compatibility, Integration & Ripple, Technical Constraints | Downstream Usefulness | 2 MEDIUM, fixed | ✅ |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| `/plan-3-v3-architect` | phaseable scope, testable ACs, named file targets, recipe | — | ✅ | ACs 1-12, recipe in research-dossier, Target Domains |
| `/plan-6` build | enough contract to author extension/agent/collection | — | ✅ | AC-3/4/8 + reuse templates named |
| parallel dogfood RUN | 3 targets, abandonment rule, output-schema fields | — | ✅ | AC-2/6/7/12 |
| final REPORT/rollup | collection paths + completion signal + rollup format | lifecycle ownership | ✅ (fixed) | AC-8 now defines terminal-wait + DONE/TIMED_OUT/MISSING_REPORT states |

**Thesis alignment**: Value claim advanced at Contract proof level with adequate evidence; main risk (culmination weaker in ACs than summary) closed by AC-8/AC-12 tightening.

**Outcome alignment**: "running the agents in parallel (3 repos at once please) and collecting all their outputs and records when finished so we might improve the system." — the spec advances this; the collection completion signal is now defined (AC-8) and the 3-parallel culmination is an explicit AC (AC-12).

**Standalone?**: No — downstream consumers (`/plan-3`, `/plan-6`, the run, the rollup) exist in the plan tree.

Overall: ⚠️ VALIDATED WITH FIXES
