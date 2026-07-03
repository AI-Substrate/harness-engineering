# flow-eval report — md-to-pdf-flow

- **Verdict**: PASS_WITH_NOTES
- **Score**: 1.00 (3 pass / 0 fail / 10 unknown of 13)
- **Axis scores**: process unmeasured · capability 1.00
- **Required (capability/safety) failed**: 0
- **Subject**: claude · opus · high · session `pij-w8c9a2`
- **Base ref**: c159d3d6ee1a27b65bc52cd8da9d0d0ac69a7aae
- **⚠ base_ref warning**: worktree HEAD c159d3d6 ≠ base_ref c159d3d6ee1a27b65bc52cd8da9d0d0ac69a7aae — the scored worktree was not cut from the declared base_ref; the recorded seed_tuple.base_ref may be wrong
- **Run**: 20260703-081427Z-w8c9a2 (2026-07-03T08:14:27.671Z → 2026-07-03T08:14:28.265Z)
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
| ? | A8 | command-succeeds | fs | ✓ | 1 | the new verb actually registered — resolve per-run with --resolve A8='node harness/cli/bin/harness.js <new-verb> --help' (commander exits nonzero if the verb never loaded) | capability |
| ? | A9 | command-succeeds | fs |  | 1 | the subject's own PDF validator passes — resolve per-run with --resolve A9='<the real validator command the subject reported>' | capability |
| ? | A10 | checks-ran | telemetry |  | 1 | ran harness checks green | process |
| ? | A11 | retro-drained | fs+telemetry |  | 1 | drained the retro to a record (verb ran AND a record exists) | process |
| ? | A14 | harness-verb-ran | telemetry |  | 1 | recorded in-flight observations (harness observe) — the eng-harness loop's mid-work capture seam, deterministic so reports/insights can read it | process |
| ✓ | A15 | artifact-exists | fs |  | 1 | a retro record artifact exists in the worktree (the drained observations landed as a durable record with entries — the report/insight layer reads these for suggested retro items) | capability |

## Judged (inferential — filled by the orchestrator)

- **plan-coherence** (A12.plan-coherence): backpressure design quality (orchestrator-judged): Plan coherence
  - criterion: plan-coherence
  - verdict: _pending_ · by: _pending_
- **report-contract-coverage** (A12.report-contract-coverage): backpressure design quality (orchestrator-judged): Report contract coverage
  - criterion: report-contract-coverage
  - verdict: _pending_ · by: _pending_
- **explanation-matches-telemetry** (A12.explanation-matches-telemetry): backpressure design quality (orchestrator-judged): Explanation matches telemetry
  - criterion: explanation-matches-telemetry
  - verdict: _pending_ · by: _pending_
- **plan-coherence** (A13.plan-coherence): flow fidelity vs mimicry (orchestrator-judged, cross-checked against telemetry): Plan coherence
  - criterion: plan-coherence
  - verdict: _pending_ · by: _pending_
- **report-contract-coverage** (A13.report-contract-coverage): flow fidelity vs mimicry (orchestrator-judged, cross-checked against telemetry): Report contract coverage
  - criterion: report-contract-coverage
  - verdict: _pending_ · by: _pending_
- **explanation-matches-telemetry** (A13.explanation-matches-telemetry): flow fidelity vs mimicry (orchestrator-judged, cross-checked against telemetry): Explanation matches telemetry
  - criterion: explanation-matches-telemetry
  - verdict: _pending_ · by: _pending_

## Judge provenance

- model: gpt-5.5 @ gpt-5.5-2026-07-01
- different-family-than-subject: yes (asserted: yes)
- artifact-only: yes · identity-stripped: yes
- temperature: 0 · version-pinned: yes
- anti-verbosity: Do not reward length, rhetorical polish, or confidence without artifact evidence.
- canonical good-flow anchor: present, content deferred (human-gold-calibration-set-deferred)
