# flow-eval report — md-to-pdf-flow

- **Verdict**: PASS_WITH_NOTES
- **Score**: 1.00 (5 pass / 0 fail / 8 unknown of 13)
- **Axis scores**: process unmeasured · capability 1.00
- **Required (capability/safety) failed**: 0
- **Subject**: claude · opus · high · session `pij-w8c9a2`
- **Base ref**: c159d3d6ee1a27b65bc52cd8da9d0d0ac69a7aae
- **⚠ base_ref warning**: worktree HEAD c159d3d6 ≠ base_ref c159d3d6ee1a27b65bc52cd8da9d0d0ac69a7aae — the scored worktree was not cut from the declared base_ref; the recorded seed_tuple.base_ref may be wrong
- **Run**: 20260703-081444Z-w8c9a2 (2026-07-03T08:14:44.048Z → 2026-07-03T08:14:47.384Z)
- **Resolved commands** (`--resolve`): A8=node harness/cli/bin/harness.js md-to-pdf --help · A9=node harness/cli/bin/harness.js md-to-pdf .harness/extensions/md-to-pdf/fixtures/sample.md --out sample-check.pdf --json
- **Judge**: gpt-5.5@gpt-5.5-2026-07-01 (openai; subject family claude)

## Deterministic results

| | ID | Type | Source | Req | W | Description | Axis |
|---|----|------|--------|-----|---|-------------|------|
| ? | A1 | skill-called | telemetry | ✓ | 1 | drove the SDD journey via /the-flow (the mandated method) | process |
| ? | A2 | skill-sequence | telemetry |  | 1 | ran explore → plan → implement in order (subject-driven — the subject owns its own cadence here, so this is genuinely scoreable, not orchestrator choreography) | process |
| ? | A3 | skill-called | telemetry |  | 1 | engaged the engineering-harness loop (guided the-flow auto-fires its seams; a direct-jump-only run legitimately misses this, hence not required) | process |
| ? | A4 | flow-seam-fired | telemetry |  | 1 | hit the backpressure seam before coding | process |
| ? | A5 | compaction-occurred | telemetry |  | 1 | compacted at least once (the-flow recommends compact-before-implement; subject-owned) | process |
| ✓ | A6 | file-created | fs | ✓ | 1 | a CLI-driven flight plan exists — the spine was instantiated from the template (plan 024: the CLI is the only writer; a missing flight plan means the flow was narrated, not run) | capability |
| ✓ | A7 | file-created | fs | ✓ | 1 | created the new extension under .harness/extensions/ | capability |
| ✓ | A8 | command-succeeds | fs | ✓ | 1 | the new verb actually registered — resolve per-run with --resolve A8='node harness/cli/bin/harness.js <new-verb> --help' (commander exits nonzero if the verb never loaded) | capability |
| ✓ | A9 | command-succeeds | fs |  | 1 | the subject's own PDF validator passes — resolve per-run with --resolve A9='<the real validator command the subject reported>' | capability |
| ? | A10 | checks-ran | telemetry |  | 1 | ran harness checks green | process |
| ? | A11 | retro-drained | fs+telemetry |  | 1 | drained the retro to a record (verb ran AND a record exists) | process |
| ? | A14 | harness-verb-ran | telemetry |  | 1 | recorded in-flight observations (harness observe) — the eng-harness loop's mid-work capture seam, deterministic so reports/insights can read it | process |
| ✓ | A15 | artifact-exists | fs |  | 1 | a retro record artifact exists in the worktree (the drained observations landed as a durable record with entries — the report/insight layer reads these for suggested retro items) | capability |

## Judged (inferential — filled by the orchestrator)

- **plan-coherence** (A12.plan-coherence): backpressure design quality (orchestrator-judged): Plan coherence
  - criterion: plan-coherence
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Survey coheres with the plan: ACs cross-referenced to tasks (T004/T008), promised phase-0 sensors actually landed as 15 vitest tests incl. the unconfigured-on-missing-engine path; ABSENT tier honestly names visual-SVG fidelity as human-judgement with a real probe trail (playwright/e2e/cypress globs, no match).
- **report-contract-coverage** (A12.report-contract-coverage): backpressure design quality (orchestrator-judged): Report contract coverage
  - criterion: report-contract-coverage
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: backpressure-coverage.md carries the full contract: sensor inventory with probe trail, tiered coverage matrix (BUILDABLE/EXISTS/ABSENT), Certainty: Partial verdict with reasoning, recommended Phase 0, advisory done-when lines.
- **explanation-matches-telemetry** (A12.explanation-matches-telemetry): backpressure design quality (orchestrator-judged): Explanation matches telemetry
  - criterion: explanation-matches-telemetry
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Telemetry unavailable (pi harness, 0 segments — DL-005); judged from the raw pi transcript: flow nav set --now backpressure + status --to done (cmds #31-33) precede all implementation writes, and the survey's promised tests match what was actually built (15 passing, verified fresh at score time).
- **plan-coherence** (A13.plan-coherence): flow fidelity vs mimicry (orchestrator-judged, cross-checked against telemetry): Plan coherence
  - criterion: plan-coherence
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Flight plan is CLI-written end-to-end (provenance harness 0.7.0, 10-node template spine, flow create/nav set/orient/status in the transcript); artifacts chain coherently: research-dossier -> plan (G1-G7 PASS/NA, Status READY) -> execution.log -> review -> ship-deferred with the push/PR confirm gate honoured.
- **report-contract-coverage** (A13.report-contract-coverage): flow fidelity vs mimicry (orchestrator-judged, cross-checked against telemetry): Report contract coverage
  - criterion: report-contract-coverage
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Completion report carried the contract: DONE, worktree, extension path, one-line exercise+confirm command (re-executed fresh: ok, 1/1 mermaid, WeasyPrint PDF), plus two honest limitations (pre-existing degraded checks named precisely and verified; inability to self-compact).
- **explanation-matches-telemetry** (A13.explanation-matches-telemetry): flow fidelity vs mimicry (orchestrator-judged, cross-checked against telemetry): Explanation matches telemetry
  - criterion: explanation-matches-telemetry
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Raw transcript corroborates the flow-drive claims (create/nav/orient/status, checks x2, backpressure before code). THREE soft spots recorded: 'retro drained' overstates — the record was Write-tool-authored, no drain/record-retro verb and zero harness observe calls in the stream; boot-1/observe-1 left status 'assumed' (not faked as done — honest, but the loop's boot/observe seams never ran). Flow fidelity genuine; loop-chore vocabulary mildly inflated.

## Judge provenance

- model: gpt-5.5 @ gpt-5.5-2026-07-01
- different-family-than-subject: yes (asserted: yes)
- artifact-only: yes · identity-stripped: yes
- temperature: 0 · version-pinned: yes
- anti-verbosity: Do not reward length, rhetorical polish, or confidence without artifact evidence.
- canonical good-flow anchor: present, content deferred (human-gold-calibration-set-deferred)
