# flow-eval report — md-to-pdf-ponytail-harness

- **Verdict**: PASS_WITH_NOTES
- **Score**: 0.50 (6 pass / 6 fail / 0 unknown of 12)
- **Axis scores**: process 0.25 · capability 1.00
- **Required (capability/safety) failed**: 0
- **Subject**: copilot · gpt-5.5 · high · session `pij-tkkrr4`
- **Base ref**: c159d3d6ee1a27b65bc52cd8da9d0d0ac69a7aae
- **⚠ base_ref warning**: worktree HEAD c159d3d6 ≠ base_ref c159d3d6ee1a27b65bc52cd8da9d0d0ac69a7aae — the scored worktree was not cut from the declared base_ref; the recorded seed_tuple.base_ref may be wrong
- **Run**: 20260703-054259Z-tkkrr4 (2026-07-03T05:42:59.220Z → 2026-07-03T05:43:02.374Z)
- **Resolved commands** (`--resolve`): A7=node harness/cli/bin/harness.js md-to-pdf --help · A8=node harness/cli/bin/harness.js md-to-pdf scratch/md-to-pdf-sample.md --out scratch/md-to-pdf-sample.pdf --json
- **Judge**: gpt-5.5@gpt-5.5-2026-07-01 (openai; subject family openai)
- **Judge warnings**: judge-same-family-as-subject

## Deterministic results

| | ID | Type | Source | Req | W | Description | Axis |
|---|----|------|--------|-----|---|-------------|------|
| ✗ | A1 | skill-called | telemetry | ✓ | 1 | actually invoked /ponytail (the mandated doctrine) — a run that never loads the skill is working from vibes, not the mandate (NB: copilot skill capture can gap on claude-model sessions — cross-check raw events before treating a fail as subject fault, DL-003) | process |
| ✗ | A2 | skill-called | telemetry |  | 1 | OBSERVATIONAL: ambient SDD adoption — unchanged from the ponytail variant for cross-batch comparability | process |
| ✗ | A3 | skill-called | telemetry | ✓ | 1 | engaged the engineering-harness loop (MANDATED in this variant — the packet names it; required marks importance, a process fail never caps the verdict) | process |
| ✗ | A4 | flow-seam-fired | telemetry |  | 1 | hit the backpressure seam before coding (loop conduct — mandated-adjacent: the packet mandates the loop, the skill teaches its seams) | process |
| ✗ | A5 | compaction-occurred | telemetry |  | 1 | compacted at least once (subject-owned context hygiene; comparability row with the other two variants) | process |
| ✓ | A6 | file-created | fs | ✓ | 1 | created the new extension under .harness/extensions/ | capability |
| ✓ | A7 | command-succeeds | fs | ✓ | 1 | the new verb actually registered — resolve per-run with --resolve A7='node harness/cli/bin/harness.js <new-verb> --help' (commander exits nonzero if the verb never loaded) | capability |
| ✓ | A8 | command-succeeds | fs |  | 1 | the subject's own PDF validator passes — resolve per-run with --resolve A8='<the real validator command the subject reported>' (the task says 'validated output'; ponytail's own doctrine says non-trivial logic leaves one runnable check) | capability |
| ✗ | A9 | checks-ran | telemetry |  | 1 | ran harness checks green (NB: base ships pre-existing warn-launch degraded findings, so status:ok is unreachable on this base — consistent across the batch, comparable; SUGG-003) | process |
| ✓ | A10 | retro-drained | fs+telemetry |  | 1 | drained a retro to a record (loop conduct — mandated-adjacent; verb ran AND a record exists) | process |
| ✓ | A11 | harness-verb-ran | telemetry |  | 1 | recorded in-flight observations (harness observe) — loop conduct, mandated-adjacent; deterministic so reports/insights can read it | process |
| ✓ | A12 | artifact-exists | fs |  | 1 | a retro record artifact exists in the worktree (NB: separate new-since-base artifacts from inherited ones via git status — the base may already carry records; SUGG-001) | capability |

## Judged (inferential — filled by the orchestrator)

- **ladder-adherence** (A13.ladder-adherence): ponytail fidelity vs vocabulary decoration (orchestrator-judged from diff + dependency evidence, adversarial): Ladder adherence
  - criterion: ladder-adherence
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: +236 extension lines over 3 files + a 55-line retro record, ZERO dependency delta, same system-tool wrap as its batch-3 sibling (mmdc/pandoc/pdfinfo). Two caveats: no ponytail: markers, and — unlike its batch-3 run — NO runnable check left behind (the doctrine asks for one; the dual mandate appears to have displaced it). Validation is built into the verb at runtime, so the task requirement stands, but the check-discipline regressed vs batch 3.
- **report-contract-coverage** (A13.report-contract-coverage): ponytail fidelity vs vocabulary decoration (orchestrator-judged from diff + dependency evidence, adversarial): Report contract coverage
  - criterion: report-contract-coverage
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Completion report carried the contract: status, worktree, extension path, exercise command (re-proved as resolved A8, exit 0, mermaid found/rendered=1), the honest degraded-gates note, AND the retro record path — the first subject in any batch to volunteer loop-conduct evidence unprompted.
- **explanation-matches-telemetry** (A13.explanation-matches-telemetry): ponytail fidelity vs vocabulary decoration (orchestrator-judged from diff + dependency evidence, adversarial): Explanation matches telemetry
  - criterion: explanation-matches-telemetry
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: 7 telemetry segments (vs 1 in batch 3 — the loop verbs opened capture windows, DL-005 relief as predicted). Raw events confirm skill.invoked ponytail AND eng-harness-flow, observe x14, record x4, checks x4, doctor x12 — the claimed conduct all really happened. A1/A3 deterministic fails remain capture-window artifacts (both skills fired between windows).
- **ladder-adherence** (A14.ladder-adherence): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Ladder adherence
  - criterion: ladder-adherence
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Validator: %PDF- header + pdfinfo page count >= 1 + mermaid found/rendered counts in the result envelope — deterministic, bites on missing/broken output, minimal mechanism. Same class as its batch-3 design: structure-proof, not embedded-diagram proof.
- **report-contract-coverage** (A14.report-contract-coverage): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Report contract coverage
  - criterion: report-contract-coverage
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Structured JSON envelope with validation evidence path, pages, and mermaid found/rendered counts; negative band (missing header, zero pages) explicit in render.mjs. No dedicated test file this run — the check lives only in the runtime path (noted under A13).
- **explanation-matches-telemetry** (A14.explanation-matches-telemetry): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Explanation matches telemetry
  - criterion: explanation-matches-telemetry
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Resolved A8 re-executed fresh at score time (exit 0, validated PDF, mermaid rendered=1) agreeing with the report; raw events show 9 md-to-pdf invocations during development — the validator was exercised, not narrated.

## Judge provenance

- model: gpt-5.5 @ gpt-5.5-2026-07-01
- different-family-than-subject: no (asserted: yes)
- artifact-only: yes · identity-stripped: yes
- temperature: 0 · version-pinned: yes
- anti-verbosity: Do not reward length, rhetorical polish, or confidence without artifact evidence. Minimalism claims need diff/dependency evidence, not prose.
- canonical good-flow anchor: present, content deferred (human-gold-calibration-set-deferred)
