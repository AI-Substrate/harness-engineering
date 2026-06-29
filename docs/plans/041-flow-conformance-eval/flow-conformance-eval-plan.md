# Flow-Conformance Eval Harness
**Mode**: Full
**Plan Version**: 1.0.0
**Created**: 2026-06-29
**Status**: READY
**Spec source**: unified (this file)

## Business Specification

### Research Context
📚 Incorporates findings from `research-dossier.md` (Deep explore — F-01..F-11, 3 historical, 5 risks) and the authoritative `workshops/001-scenario-and-assertion-schema.md` (Contract Ready). Key grounding: every composable piece already exists — `pij` control plane (F-01), telemetry/OTel v2.2 joined by `captured_env.PIJ_SESSION_ID` (F-05/F-06), the extension contract (F-08), and the `agents/flow-skill-eval` precedent (F-03). The one real capability gap is **F-07**: no telemetry query-by-session path exists today (only `telemetry sync`).

### Summary
Build a **scenario-driven, flow-conformance eval harness**: an orchestrator (this Claude session, via flow-pair control-plane) drives a *blind* subject agent through a full `the-flow` SDD journey on a *fixed* task (md→PDF extension), then grades how faithfully the subject obeyed the flow. Grading is **two-layer**: deterministic assertions resolved from the subject's telemetry (joined by pij session id) + its worktree filesystem, plus a thin orchestrator-LLM-judged layer for quality calls. Scenarios are *data* (`scenario.json` + prompts + `assertions.json`); the engine is generic, so "later we add more" costs a directory, not code. Machinery is encoded the harness way — a core `telemetry get` verb + a `flow-eval` extension.

### Goals
- Drive any agent/model through `the-flow` end-to-end on a fixed task and produce a reproducible conformance verdict.
- Grade **deterministically** from telemetry (skills called, seams fired, checks run, files written) + filesystem (artifacts, `command-succeeds`), with a clearly-separated judged layer for quality.
- Make scenarios pure data so new scenarios need no engine change.
- Close the telemetry query-by-session gap (F-07) as a reusable, first-class `harness telemetry get` verb.
- Compare models (Opus vs GPT…) apples-to-apples via a pinned worktree base + the same `assertions.json`.

### Non-Goals
- **Not** building the md→PDF extension ourselves — that is the *subject's* task; we only assert on its result.
- **Not** automating the entire orchestrator-drives-pij loop into one button this plan — pane-driving stays orchestrator-shell/runbook territory (flow-pair already owns it); the deliverables are the prompts, the scenario, and the deterministic scorer.
- **Not** modifying telemetry capture/emission (plans 034–038 are frozen here) — this plan only *reads* telemetry.
- **Not** a CI gate — this is on-demand live testing, never a blocking check.

### Target Domains

> This repo has **no `docs/domains/` registry** — the rows below are *logical* component groupings for orientation + the G7/manifest mapping, not formal domains.

| Domain (logical) | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| telemetry (`harness/cli/src/services/telemetry`, `acts/telemetry.ts`) | existing | **modify** | Add a read-only `telemetry get <pij-session-id>` verb + a session-evidence service (read-only; capture path untouched) |
| flow-eval / live-testing (`.harness/extensions/flow-eval`, `live-testing/scenarios`) | **NEW** | **create** | The scenario loader, resolver registry, scorer, and report writer |
| extensions contract (`harness/cli/src/services/extensions`) | existing | **consume** | The `flow-eval` extension binds the `HarnessVerb`/`ctx` contract (no changes) |
| flow-pair / pij orchestration | existing | **consume** | Reuse the orchestrator↔subject protocol to drive the run (no changes; prompts + scenario are new data) |

### Testing Strategy
- **Approach**: **Hybrid** — TDD for the deterministic core (session-evidence read path, every assertion resolver, the scorer), lightweight validation for scaffolding (scenario scaffold, prompts, docs).
- **Rationale**: this harness's entire value is *deterministic proof*; the resolvers and scorer must themselves be proven non-vacuous. The repo already ships a **real telemetry fixture corpus** (plan 037) to test resolvers against real OTLP/segment data rather than mocks.
- **Focus Areas**: resolver correctness (each `type` → pass/fail/unknown), the unknown-vs-fail boundary, score math (unknowns excluded, required-fail caps), report shape.
- **Excluded**: the md→PDF extension's own behaviour (subject's problem); the full interactive pij drive (manual/runbook-verified).
- **Mock Usage**: **Targeted — external only**. Real telemetry fixtures + a real temp worktree for FS resolvers; mock only the genuinely external `pij` pane control + the orchestrator-judged LLM call seam.

### Documentation Strategy
- **Location**: `docs/how/` — a how-to guide: authoring a scenario bundle, the assertion `type` registry, running the harness, reading a report. (Joins `extend-the-harness.md`, `dogfood-harness-flow.md`.)

### Complexity
- **Score**: CS-4 (large)
- **Breakdown**: S=2, I=2, D=2, N=2, F=1, T=2
- **Confidence**: 0.80
- **Assumptions**: telemetry buffer/refs carry the subject's evidence keyed by `PIJ_SESSION_ID`; `pij path <id> --dir` resolves a session's on-disk dir; plan-037 fixtures are sufficient to unit-test resolvers.
- **Dependencies**: installed `pij` (F-01), flow-pair skill, telemetry substrate (034–038), extension contract w/ `ctx.fsWrite` (plan 031).
- **Risks**: worktree telemetry location (Phase-1 spike); pij pane orchestration not unit-testable; blind-packet contamination; model silent fallback. (Detailed in Risks.)
- **Phases**: 3.

### Acceptance Criteria
- **AC-01**: Given a `PIJ_SESSION_ID` with buffered telemetry, `harness telemetry get <id> --json` returns a normalized **session-evidence** object: `skills{name→count}`, `files.{written,edited}`, and derived facts from `event_stream` (skill order, `checks` events+status, `flow`/`harness` seams+verbs, `compaction`) — the exact shape is the `SessionEvidence` interface in § Session-Evidence contract. Reads buffer first, falls back to `refs/harness-telemetry/*`; exposed programmatically as `getSessionEvidence(id): Promise<SessionEvidence|null>` (no-cache).
- **AC-02**: The read path locates a session's telemetry even when the subject ran in a **git worktree** (cwd-independent via `pij path <id> --dir`, with a dual-tree buffer scan fallback) — proven by an integration test.
- **AC-03**: Telemetry capability gaps (`subagents[].tokens` null, empty `plans_touched`) surface as explicit `unknown`/absent — never fabricated, never silently zero.
- **AC-04**: `flow-eval` loads a scenario directory (`scenario.json` + `assertions.json` + `prompts/`) and validates its shape against the workshop schema; a malformed scenario returns a clear `error` envelope. The extension's only action verb is `score` (collect evidence → resolve → report); it **never drives pij** (orchestration is the runbook's job — Non-Goals).
- **AC-05**: Every assertion `type` in the registry resolves to `pass|fail|unknown` per the workshop's lane rules; a fixture scenario over fixture telemetry + a temp worktree yields a report whose per-assertion verdicts match expected (non-vacuous: a mutated fixture flips the verdict).
- **AC-06**: `judged` assertions are surfaced as fields for the orchestrator to fill; the report separates `deterministic` results from `judged` fields, computes `score` excluding `unknown`, and sets `verdict=FAIL` iff `required_failed>0`.
- **AC-07**: Reports are written to `.harness/live-testing/<slug>/<run-id>/report.{json,md}` via `ctx.fsWrite` — deterministic table + judged section + verdict + captured subject `{harness,model,pij_session_id}` + `base_ref`.
- **AC-08**: The `md-to-pdf` scenario exists: `scenario.json` (pinned `base.ref`, Simple flow), a **BLIND** `subject.md` (eval framing + report contract ONLY — zero how-to), `orchestrator.md` (explore→plan `--simple`→validate→compact→implement→review→fix→validate over pij), and `assertions.json` matching the workshop's worked example.
- **AC-09**: A documented end-to-end runbook demonstrates the full loop (spawn subject via pij → drive flow → locate subject telemetry by session id → score → report); the deterministic scoring half is exercised by an automated test, the pij-drive half is runbook-verified.
- **AC-10**: `docs/how/` guide covers authoring a scenario + the `type` registry + running the harness + reading a report.

### Risks & Assumptions
| Risk | Mitigation |
|------|------------|
| Worktree telemetry lands in the wrong tree | Phase-1 spike; resolver uses `pij path --dir`, dual-tree fallback (AC-02) |
| pij pane orchestration isn't unit-testable | Mock the pane-control seam; runbook-verify the live drive (AC-09) |
| Blind packet leaks how-to → contaminates measurement | `subject.md` authoring rule + a review checklist gate (like flow-pair's forbidden-paths) |
| Bad `--model` silently runs default → void comparison | Canary-verify pane footer / `pij tail` before trusting a run |
| Telemetry gaps misread as failures | Three-valued verdict; `unknown` excluded from score (AC-03/AC-06) |

### Open Questions
- None blocking. The worktree-telemetry-location question is scoped as a Phase-1 spike, not an open design gap.

### Workshop Opportunities
| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| _(none remaining)_ | — | The scenario+assertion contract is already workshopped (001, Contract Ready). | — |

### Clarifications
#### Session 2026-06-29
- **Workflow Mode** → Full (CS-4, multi-component).
- **Testing Strategy** → Hybrid (TDD for deterministic core; lightweight scaffolding).
- **Mock Usage** → Targeted — external only (real telemetry fixtures + temp worktree; mock pij/judge seams).
- **Documentation** → `docs/how/`.
- **Binding principle (user steer)**: encode machinery as first-class harness extensions/verbs wherever possible; loose scripts only where the extension contract can't reach (pij pane driving).

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: none — the scenario/assertion contract is resolved (workshop 001).

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | y | informs Key Findings + risks |
| workshops/*.md | y | authoritative — the scenario/assertion/report schemas are lifted, not re-derived |

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No critical [NEEDS CLARIFICATION] markers |
| G2 | Constitution | N/A | No `docs/project-rules/constitution.md` |
| G3 | Architecture | N/A | No `docs/project-rules/architecture.md` |
| G4 | ADR Compliance | N/A | No `docs/adr/` |
| G5 | Structure | PASS | All required sections present |
| G6 | Testing Alignment | PASS | Hybrid: test tasks precede impl in deterministic-core phases; ACs measurable |
| G7 | Domain Completeness | PASS | No domain registry; logical groupings mapped + manifest covers every file |

### Summary
Three phases along clean dependency boundaries: **(1)** a read-only `telemetry get <session>` core verb + session-evidence service (the deterministic foundation the scorer needs, F-07); **(2)** the `flow-eval` extension — scenario loader, the `type`-dispatched resolver registry, the scorer, and the report writer; **(3)** scenario #1 (`md-to-pdf`) — the pinned scenario, the blind subject + orchestrator prompts, `assertions.json`, the orchestration runbook, docs, and an end-to-end validation. Phase 2 depends on Phase 1's evidence object; Phase 3 depends on both.

### Domain Manifest

| File | Domain (logical) | Classification | Rationale |
|------|--------|---------------|-----------|
| `harness/cli/src/acts/telemetry.ts` | telemetry | internal | Register the new `get` subcommand alongside `sync` |
| `harness/cli/src/services/telemetry/session-evidence.ts` | telemetry | contract | NEW — locate + parse a session's segments/OTLP into the evidence object (the read API the scorer consumes) |
| `harness/cli/test/services/telemetry/session-evidence.test.ts` | telemetry | internal | NEW — TDD against plan-037 fixtures + worktree-location case |
| `.harness/extensions/flow-eval/extension.ts` | flow-eval | contract | NEW — the `flow-eval` verb (HarnessVerb) |
| `.harness/extensions/flow-eval/lib/scenario.ts` | flow-eval | internal | NEW — load + validate a scenario bundle |
| `.harness/extensions/flow-eval/lib/resolvers.ts` | flow-eval | internal | NEW — `type`→resolver registry (telemetry/fs/judged/composite) |
| `.harness/extensions/flow-eval/lib/scorer.ts` | flow-eval | internal | NEW — walk assertions, three-valued verdict, score math |
| `.harness/extensions/flow-eval/lib/report.ts` | flow-eval | internal | NEW — write `report.{json,md}` via `ctx.fsWrite` |
| `.harness/extensions/flow-eval/*.test.ts` | flow-eval | internal | NEW — resolver/scorer unit tests + a fixture scenario |
| `live-testing/scenarios/md-to-pdf/scenario.json` | flow-eval | internal | NEW — scenario #1 metadata |
| `live-testing/scenarios/md-to-pdf/prompts/orchestrator.md` | flow-eval | internal | NEW — the drive choreography |
| `live-testing/scenarios/md-to-pdf/prompts/subject.md` | flow-eval | internal | NEW — the BLIND packet |
| `live-testing/scenarios/md-to-pdf/assertions.json` | flow-eval | internal | NEW — scenario #1 assertions |
| `docs/how/flow-conformance-eval.md` | flow-eval | internal | NEW — authoring + running guide |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | No `telemetry get`-by-session verb exists (only `sync`); `telemetry` is a CORE command family (`acts/telemetry.ts`, `registerTelemetryAct`). | Phase 1 adds `get` as a core subcommand mirroring `sync` — the dogfood path. |
| 02 | Critical | The deterministic join is `captured_env.PIJ_SESSION_ID`, aggregated across **all** a session's segments; evidence lives in `event_stream` (`kind: skill/checks/flow/harness/compaction`) + `segment.{skills,files}`. | session-evidence service aggregates per-session, exposes a normalized object. |
| 02b | High | `pij path <id> --events\|--state\|--dir` resolves a peer's on-disk telemetry dir cwd-independently. | Use as the primary session→disk locator (worktree-safe), buffer-scan as fallback. |
| 03 | High | Telemetry gaps are real: `subagents[].tokens` null (Copilot), `plans_touched` empty off-`docs/plans` cwd (worktree!). | Three-valued resolver; `unknown` excluded from score; never fabricate. |
| 04 | High | Mermaid is validated but **not rendered**; no PDF lib in repo. | The subject's task is genuinely hard — good backpressure bait; we only assert on its result, never build it. |
| 05 | Medium | Extensions: `.harness/extensions/<name>/extension.ts` default-exports a `HarnessVerb`; `ctx.fsWrite` writes reports (feature-detect). Reserved core verbs can't be shadowed (`flow-eval` is safe). | Phase 2 binds the contract; report via `ctx.fsWrite`. |
| 06 | Medium | Real telemetry fixture corpus (plan 037) under `harness/cli/test/.../fixtures`. | Unit-test resolvers against real OTLP/segment fixtures, not mocks. |

### Session-Evidence contract (the Phase 1 → Phase 2 interface)

Phase 1 exports **one** read-only function; the `telemetry get` CLI verb is a thin wrapper over it. Phase 2's telemetry-lane resolvers consume this object — no other coupling. **No-cache**: reads fresh on each call so an `fs` `command-succeeds` resolver always sees the latest worktree/telemetry state.

```typescript
// harness/cli/src/services/telemetry/session-evidence.ts  (NEW — the contract)
export interface SessionEvidence {
  pij_session_id: string;
  harness: string;                          // 'claude' | 'copilot' | …
  segments: number;                         // count aggregated for this session
  skills: Record<string, number>;           // name → count (summed across segments)
  skill_order: string[];                    // first-occurrence order (for `skill-sequence`)
  files: { written: string[]; edited: string[] };
  flow_seams: string[];                     // hooks seen (event_stream kind:flow/harness) — for `flow-seam-fired`
  harness_verbs: Record<string, number>;    // verb → count: observe/retro/checks… (for `harness-verb-ran`)
  checks: Array<{ status: 'ok' | 'degraded' | 'error' }>;   // for `checks-ran`
  compactions: number;                      // for `compaction-occurred`
  tools: Record<string, number>;            // for `tool-used`
  gaps: string[];                           // e.g. ['subagent_tokens:null','plans_touched:empty'] → resolvers map these to `unknown`, never fail
}

// Locates the session dir worktree-safely via the `folder` field of the pij STATE file
// (~/.pij/<id>.json, == `pij path <id> --state`) — NOT `pij path --dir` (that is the peer DATA
// dir; corrected in the Phase-1 spike). Dual-tree buffer scan fallback; null when none found.
// Reads the gitignored buffer (the live source the scorer needs); refs/harness-telemetry/*
// fallback is deferred (needs a git-read capability — out of Phase-1 scope).
//
// TWO exports (built + reviewed in Phase 1):
//   1. getSessionEvidence(id, deps, opts?)        — port-injected internal; node-free; what the CLI act + unit tests bind
//   2. getSessionEvidenceFromContext(id, ctx, opts?) — the Phase-2 ENTRY POINT: takes a VerbContext-shaped
//                                                       ctx {cwd, fs:{readText,readdir}, env:{get}}, adapts ctx→deps
//                                                       internally (HOME←env.get; cwd←ctx.cwd). Phase-2 resolvers call THIS.
export function getSessionEvidenceFromContext(
  pijSessionId: string,
  ctx: { cwd: string; fs: { readText(p: string): string | null; readdir(p: string): string[] }; env: { get(n: string): string | undefined } },
  opts?: { worktree?: string },
): Promise<SessionEvidence | null>;
```

### Phases

#### Phase Index

| Phase | Title | Primary Domain | Objective (1 line) | Depends On |
|-------|-------|---------------|-------------------|------------|
| 1 | Telemetry session-evidence read path | telemetry | A read-only `telemetry get <pij-session-id>` verb returning a normalized evidence object (worktree-safe) | None |
| 2 | The `flow-eval` engine | flow-eval | Scenario loader + `type`-dispatched resolvers + three-valued scorer + report writer | Phase 1 |
| 3 | Scenario #1 (md→PDF) + orchestration + docs | flow-eval | The pinned scenario, blind+orchestrator prompts, assertions, runbook, docs, end-to-end validation | Phases 1–2 |

#### Phase 1: Telemetry session-evidence read path
**Objective**: Given a pij session id, deterministically locate and parse that session's telemetry into a normalized evidence object — the foundation the scorer's telemetry lane consumes.
**Domain**: telemetry
**Delivers**: a `harness telemetry get <pij-session-id> [--json] [--worktree <path>]` core subcommand; a `session-evidence.ts` service; worktree-location resolution; tests against plan-037 fixtures.
**Depends on**: None
**Key risks**: worktree buffer location (the spike) — resolved via `pij path --dir` + dual-tree fallback.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 1.1 | Spike + test: confirm where the buffer lands for a worktree session; encode the locator (`pij path <id> --dir` primary, dual-tree scan fallback) | telemetry | A test proves a worktree-run session's dir is found cwd-independently | AC-02; Finding 02b |
| 1.2 | Write failing tests for `session-evidence`: parse fixtures → `{skills, files, events-derived facts}`; assert skill order, `checks` status, `flow`/`harness` seams, `compaction` | telemetry | Tests fail (no impl yet), pinned to plan-037 fixtures | TDD; Finding 06 |
| 1.3 | Implement `session-evidence.ts`: scan session segments (buffer→refs fallback), join by `captured_env.PIJ_SESSION_ID`, aggregate across segments, derive the evidence object; gaps → explicit `unknown`/absent | telemetry | 1.2 tests pass; null tokens / empty plans_touched surface as `unknown` | AC-01, AC-03; Finding 02/03 |
| 1.4 | Register `telemetry get` subcommand in `acts/telemetry.ts` (mirror `sync`: Envelope + exit code); `--json` returns the evidence object | telemetry | `harness telemetry get <id> --json` returns evidence; unknown id → honest `error`/empty envelope | AC-01; Finding 01 |
| 1.5 | Rebuild (`npm run build`) + integration test through the built binary | telemetry | `node harness/cli/dist/index.js telemetry get <id> --json` works end-to-end | dist/ is what runs live |

#### Phase 2: The `flow-eval` engine
**Objective**: A generic, config-driven evaluator — load a scenario, resolve each assertion by `type` to a three-valued verdict, score it, write the report.
**Domain**: flow-eval
**Delivers**: the `flow-eval` extension (`score` + `scaffold` verbs — never drives pij), scenario loader+validator, the resolver registry (telemetry via Phase 1 / fs / judged / fs+telemetry composite), the scorer, the report writer; unit tests + a fixture scenario.
**Depends on**: Phase 1 (telemetry lane).
**Key risks**: resolver non-vacuity — proven via mutated fixtures.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 2.1 | Scenario loader + schema validation (`scenario.ts`) per workshop §1–§2 | flow-eval | Loads a valid bundle; malformed → clear `error` | AC-04 |
| 2.2 | Failing tests for each resolver `type` (telemetry/fs/composite) over a fixture scenario + fixture telemetry + temp worktree | flow-eval | Tests fail pre-impl; include a mutated-fixture case that must flip | TDD; AC-05 |
| 2.3 | Implement the resolver registry (`resolvers.ts`): `type`→fn, each declaring its lane; telemetry resolvers call Phase 1's evidence API; fs resolvers read the worktree (incl. `command-succeeds`) | flow-eval | 2.2 tests pass; verdicts pass/fail/unknown per workshop lanes | AC-05; Finding 02 |
| 2.4 | Scorer (`scorer.ts`): walk assertions, three-valued, `score`=Σpass/Σ(pass+fail), `required_failed` caps verdict; `judged` surfaced as fields | flow-eval | Score excludes unknowns; required-fail → FAIL; judged separated | AC-06 |
| 2.5 | Report writer (`report.ts`) → `.harness/live-testing/<slug>/<run-id>/report.{json,md}` via `ctx.fsWrite` (feature-detect) | flow-eval | Files written with deterministic table + judged + verdict + subject/base_ref | AC-07; Finding 05 |
| 2.6 | `flow-eval` extension wiring (`extension.ts`): `score --scenario <slug> --session <pij-id> [--worktree <path>]` (collect evidence + resolve + report — the ONLY action verb; never drives pij) + `scaffold --slug <s>` (write a scenario skeleton); rebuild + `harness flow-eval --help` registers | flow-eval | `flow-eval score` produces a report from a session id; `--help` lists both verbs; no pij-driving in the extension | AC-04; Finding 05; critic-F1 |

#### Phase 3: Scenario #1 (md→PDF) + orchestration + docs
**Objective**: Make the harness runnable on a real scenario — author the pinned md→PDF scenario, the blind + orchestrator prompts, the assertions, the drive runbook, docs, and validate the loop.
**Domain**: flow-eval
**Delivers**: `live-testing/scenarios/md-to-pdf/` (scenario.json + prompts + assertions.json); the orchestration runbook; `docs/how/flow-conformance-eval.md`; an end-to-end validation.
**Depends on**: Phases 1–2.
**Key risks**: blind-packet contamination; live pij drive not fully automatable.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 3.1 | `scenario.json` — task, pinned `base.ref`, subject defaults (claude/opus), Simple flow choreography | flow-eval | Validates against the loader (2.1) | AC-08 |
| 3.2 | `prompts/subject.md` — BLIND packet: eval framing + report contract ONLY, **no how-to**; + a forbidden-content review checklist | flow-eval | A review confirms zero task guidance leaks | AC-08; blind-contamination risk |
| 3.3 | `prompts/orchestrator.md` — the drive choreography over pij (spawn→explore→plan `--simple`→validate→compact→implement→review→fix→validate; canary-verify model; compact before implement) | flow-eval | Runbook is executable against flow-pair | AC-08, AC-09 |
| 3.4 | `assertions.json` for md-to-pdf — the workshop's worked example (A1..A11) | flow-eval | Loads; each row maps to a registry `type` | AC-08 |
| 3.5 | End-to-end validation: automated scoring half over a captured/fixture session; runbook-verify the live pij drive once | flow-eval | Scorer produces a `report.{json,md}`; runbook step-list verified | AC-09 |
| 3.6 | `docs/how/flow-conformance-eval.md` — authoring a scenario, the `type` registry, running, reading a report | flow-eval | Guide present; a fresh reader can author scenario #2 | AC-10 |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | 1.3, 1.4 | `telemetry get --json` returns evidence object |
| AC-02 | 1.1 | worktree-location integration test |
| AC-03 | 1.3 | unknown/absent on gap fixtures |
| AC-04 | 2.1, 2.6 | loader rejects malformed; `--help` registers |
| AC-05 | 2.2, 2.3 | resolver tests incl. mutated-fixture flip |
| AC-06 | 2.4 | scorer unit tests (score math, required-fail, judged split) |
| AC-07 | 2.5 | report files written + shape asserted |
| AC-08 | 3.1–3.4 | scenario loads; blind-packet review |
| AC-09 | 3.5 | scoring test + runbook verification |
| AC-10 | 3.6 | guide present |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Worktree telemetry lands in the wrong tree | Medium | High | Phase-1 spike (1.1); `pij path --dir` + dual-tree fallback |
| pij pane orchestration not unit-testable | High | Medium | Mock the pane seam; runbook-verify the live drive (3.5) |
| Blind packet leaks how-to | Medium | High | Authoring rule + forbidden-content review (3.2) |
| Bad `--model` silently runs default | Low | High | Canary-verify footer/`pij tail` before trusting a run (3.3) |
| Telemetry gaps misread as fail | Medium | Medium | Three-valued verdict; unknown excluded (1.3/2.4) |
