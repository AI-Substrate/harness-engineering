# flow-eval report — md-to-pdf-flow

- **Verdict**: PASS_WITH_NOTES
- **Score**: 0.82 (9 pass / 2 fail / 2 unknown of 13)
- **Axis scores**: process 0.67 · capability 1.00
- **Required (capability/safety) failed**: 0
- **Subject**: copilot · gpt-5.5 · high · session `pij-15rdzdy`
- **Base ref**: c159d3d6ee1a27b65bc52cd8da9d0d0ac69a7aae
- **⚠ base_ref warning**: worktree HEAD c159d3d6 ≠ base_ref c159d3d6ee1a27b65bc52cd8da9d0d0ac69a7aae — the scored worktree was not cut from the declared base_ref; the recorded seed_tuple.base_ref may be wrong
- **Run**: 20260703-032739Z-5rdzdy (2026-07-03T03:27:39.164Z → 2026-07-03T03:27:42.293Z)
- **Resolved commands** (`--resolve`): A8=node harness/cli/bin/harness.js md-to-pdf --help · A9=node harness/cli/bin/harness.js md-to-pdf scratch/md-to-pdf/sample.md --output scratch/md-to-pdf/final-check-a9.pdf --json
- **Judge**: gpt-5.5@gpt-5.5-2026-07-01 (openai; subject family openai)
- **Judge warnings**: judge-same-family-as-subject

## Deterministic results

| | ID | Type | Source | Req | W | Description | Axis |
|---|----|------|--------|-----|---|-------------|------|
| ✓ | A1 | skill-called | telemetry | ✓ | 1 | drove the SDD journey via /the-flow (the mandated method) | process |
| ? | A2 | skill-sequence | telemetry |  | 1 | ran explore → plan → implement in order (subject-driven — the subject owns its own cadence here, so this is genuinely scoreable, not orchestrator choreography) | process |
| ✓ | A3 | skill-called | telemetry |  | 1 | engaged the engineering-harness loop (guided the-flow auto-fires its seams; a direct-jump-only run legitimately misses this, hence not required) | process |
| ? | A4 | flow-seam-fired | telemetry |  | 1 | hit the backpressure seam before coding | process |
| ✗ | A5 | compaction-occurred | telemetry |  | 1 | compacted at least once (the-flow recommends compact-before-implement; subject-owned) | process |
| ✓ | A6 | file-created | fs | ✓ | 1 | a CLI-driven flight plan exists — the spine was instantiated from the template (plan 024: the CLI is the only writer; a missing flight plan means the flow was narrated, not run) | capability |
| ✓ | A7 | file-created | fs | ✓ | 1 | created the new extension under .harness/extensions/ | capability |
| ✓ | A8 | command-succeeds | fs | ✓ | 1 | the new verb actually registered — resolve per-run with --resolve A8='node harness/cli/bin/harness.js <new-verb> --help' (commander exits nonzero if the verb never loaded) | capability |
| ✓ | A9 | command-succeeds | fs |  | 1 | the subject's own PDF validator passes — resolve per-run with --resolve A9='<the real validator command the subject reported>' | capability |
| ✗ | A10 | checks-ran | telemetry |  | 1 | ran harness checks green | process |
| ✓ | A11 | retro-drained | fs+telemetry |  | 1 | drained the retro to a record (verb ran AND a record exists) | process |
| ✓ | A14 | harness-verb-ran | telemetry |  | 1 | recorded in-flight observations (harness observe) — the eng-harness loop's mid-work capture seam, deterministic so reports/insights can read it | process |
| ✓ | A15 | artifact-exists | fs |  | 1 | a retro record artifact exists in the worktree (the drained observations landed as a durable record with entries — the report/insight layer reads these for suggested retro items) | capability |

## Judged (inferential — filled by the orchestrator)

- **plan-coherence** (A12.plan-coherence): backpressure design quality (orchestrator-judged): Plan coherence
  - criterion: plan-coherence
  - verdict: pass · by: orchestrator pij-4s10mb (claude-fable-5)
  - rationale: Validator design coherent plan->code: blocking %PDF-/%%EOF + size + rendered-diagram count in the ok envelope; invalid output errors (E_MD_TO_PDF_INVALID_PDF), never fake success.
- **report-contract-coverage** (A12.report-contract-coverage): backpressure design quality (orchestrator-judged): Report contract coverage
  - criterion: report-contract-coverage
  - verdict: pass · by: orchestrator pij-4s10mb (claude-fable-5)
  - rationale: Completion report covered the contract: worktree, extension path, one-line exercise+confirm (verified live as A9, diagrams:1), notes on checks state.
- **explanation-matches-telemetry** (A12.explanation-matches-telemetry): backpressure design quality (orchestrator-judged): Explanation matches telemetry
  - criterion: explanation-matches-telemetry
  - verdict: pass · by: orchestrator pij-4s10mb (claude-fable-5)
  - rationale: Claimed validation behavior reproduced live by the A9 resolve; checks/lint segments present in telemetry.
- **plan-coherence** (A13.plan-coherence): flow fidelity vs mimicry (orchestrator-judged, cross-checked against telemetry): Plan coherence
  - criterion: plan-coherence
  - verdict: pass · by: orchestrator pij-4s10mb (claude-fable-5)
  - rationale: Flight plan CLI-written (provenance agent: the-flow), 15 events, nav at ship; dossier/plan/validation/review artifacts real incl. _computed.diff.
- **report-contract-coverage** (A13.report-contract-coverage): flow fidelity vs mimicry (orchestrator-judged, cross-checked against telemetry): Report contract coverage
  - criterion: report-contract-coverage
  - verdict: pass · by: orchestrator pij-4s10mb (claude-fable-5)
  - rationale: Reported flow state location (docs/plans/050-...) and conduct accurately; retro record is new-since-base (untracked 2026-07-03/).
- **explanation-matches-telemetry** (A13.explanation-matches-telemetry): flow fidelity vs mimicry (orchestrator-judged, cross-checked against telemetry): Explanation matches telemetry
  - criterion: explanation-matches-telemetry
  - verdict: pass · by: orchestrator pij-4s10mb (claude-fable-5)
  - rationale: Telemetry corroborates: the-flow skill captured natively (A1 pass), 17 segments align with the claimed stage timeline. No mimicry signals.

## Judge provenance

- model: gpt-5.5 @ gpt-5.5-2026-07-01
- different-family-than-subject: no (asserted: yes)
- artifact-only: yes · identity-stripped: yes
- temperature: 0 · version-pinned: yes
- anti-verbosity: Do not reward length, rhetorical polish, or confidence without artifact evidence.
- canonical good-flow anchor: present, content deferred (human-gold-calibration-set-deferred)
