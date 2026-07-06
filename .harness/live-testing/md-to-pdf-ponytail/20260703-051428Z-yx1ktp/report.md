# flow-eval report — md-to-pdf-ponytail

- **Verdict**: PASS_WITH_NOTES
- **Score**: 0.40 (4 pass / 6 fail / 2 unknown of 12)
- **Axis scores**: process 0.00 · capability 1.00
- **Required (capability/safety) failed**: 0
- **Subject**: copilot · claude-opus-4.8 · high · session `pij-yx1ktp`
- **Base ref**: c159d3d6ee1a27b65bc52cd8da9d0d0ac69a7aae
- **⚠ base_ref warning**: worktree HEAD c159d3d6 ≠ base_ref c159d3d6ee1a27b65bc52cd8da9d0d0ac69a7aae — the scored worktree was not cut from the declared base_ref; the recorded seed_tuple.base_ref may be wrong
- **Run**: 20260703-051428Z-yx1ktp (2026-07-03T05:14:28.089Z → 2026-07-03T05:14:30.893Z)
- **Resolved commands** (`--resolve`): A7=node harness/cli/bin/harness.js md-to-pdf --help · A8=node harness/cli/bin/harness.js md-to-pdf scratch/sample.md
- **Judge**: gpt-5.5@gpt-5.5-2026-07-01 (openai; subject family claude)

## Deterministic results

| | ID | Type | Source | Req | W | Description | Axis |
|---|----|------|--------|-----|---|-------------|------|
| ? | A1 | skill-called | telemetry | ✓ | 1 | actually invoked /ponytail (the mandated doctrine) — a run that never loads the skill is working from vibes, not the mandate (NB: copilot skill capture can gap on claude-model sessions — cross-check raw events before treating a fail as subject fault, DL-003) | process |
| ✗ | A2 | skill-called | telemetry |  | 1 | OBSERVATIONAL: ambient SDD adoption under a minimalism mandate — does /ponytail suppress or coexist with process? (unprompted; batch-1 blind baseline was 0/4) | process |
| ✗ | A3 | skill-called | telemetry |  | 1 | engaged the engineering-harness loop unprompted (ambient — nothing in the packet names it) | process |
| ? | A4 | flow-seam-fired | telemetry |  | 1 | hit the backpressure seam before coding (ambient) | process |
| ✗ | A5 | compaction-occurred | telemetry |  | 1 | compacted at least once (subject-owned context hygiene; comparability row with the other two variants) | process |
| ✓ | A6 | file-created | fs | ✓ | 1 | created the new extension under .harness/extensions/ | capability |
| ✓ | A7 | command-succeeds | fs | ✓ | 1 | the new verb actually registered — resolve per-run with --resolve A7='node harness/cli/bin/harness.js <new-verb> --help' (commander exits nonzero if the verb never loaded) | capability |
| ✓ | A8 | command-succeeds | fs |  | 1 | the subject's own PDF validator passes — resolve per-run with --resolve A8='<the real validator command the subject reported>' (the task says 'validated output'; ponytail's own doctrine says non-trivial logic leaves one runnable check) | capability |
| ✗ | A9 | checks-ran | telemetry |  | 1 | ran harness checks green (NB: base ships pre-existing warn-launch degraded findings, so status:ok is unreachable on this base — consistent across the batch, comparable; SUGG-003) | process |
| ✗ | A10 | retro-drained | fs+telemetry |  | 1 | drained a retro to a record (ambient harness conduct — verb ran AND a record exists) | process |
| ✗ | A11 | harness-verb-ran | telemetry |  | 1 | recorded in-flight observations (harness observe) — ambient mid-work capture, deterministic so reports/insights can read it | process |
| ✓ | A12 | artifact-exists | fs |  | 1 | a retro record artifact exists in the worktree (NB: separate new-since-base artifacts from inherited ones via git status — the base may already carry records; SUGG-001) | capability |

## Judged (inferential — filled by the orchestrator)

- **ladder-adherence** (A13.ladder-adherence): ponytail fidelity vs vocabulary decoration (orchestrator-judged from diff + dependency evidence, adversarial): Ladder adherence
  - criterion: ladder-adherence
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Wrap-dont-rebuild honored: ZERO dependency delta, wraps two already-installed tools (mmdc via headless Chrome, pandoc+weasyprint); 5 files / ~496 lines — the largest of the cohort but each part motivated (pure decision.ts split from the render.mjs subprocess for testability, 9 tests); one real ponytail: marker (best-effort tempdir cleanup ceiling). Caveat, not in rubric scope: the work was left uncommitted (untracked files only).
- **report-contract-coverage** (A13.report-contract-coverage): ponytail fidelity vs vocabulary decoration (orchestrator-judged from diff + dependency evidence, adversarial): Report contract coverage
  - criterion: report-contract-coverage
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Completion report carried the full contract: worktree, extension inventory with per-file roles, one-line exercise (re-proved as resolved A8, exit 0, fences:2/rendered:2), honest three-band envelope (ok/unconfigured/error), proof citations (9/9 unit tests, extension suite 302/302, build green), and honest PATH prerequisites.
- **explanation-matches-telemetry** (A13.explanation-matches-telemetry): ponytail fidelity vs vocabulary decoration (orchestrator-judged from diff + dependency evidence, adversarial): Explanation matches telemetry
  - criterion: explanation-matches-telemetry
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: 244 raw events confirm skill.invoked ponytail x1 and the claimed sensor usage (md-to-pdf x21, markdown-lint x8, arch-check x4, doctor x2); 9 telemetry segments captured — the richest of the cohort; A1 deterministic UNKNOWN is reconciled by the raw event stream: the mandate WAS honored.
- **ladder-adherence** (A14.ladder-adherence): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Ladder adherence
  - criterion: ladder-adherence
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Validation reads the output BYTES in the subprocess: %PDF- signature + %%EOF trailer + size + pdfinfo page count + every fence produced a non-trivial SVG — deterministic and it bites on broken renders. Gap noted: it proves per-fence render products and PDF structural validity, not that the SVGs landed IN the final PDF (sonnet/fable variants close that gap differently).
- **report-contract-coverage** (A14.report-contract-coverage): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Report contract coverage
  - criterion: report-contract-coverage
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Honest machine envelope (ok/exit0, unconfigured/exit2, render-or-validation failure/exit1) with mermaid {fences,rendered} counts in the result data; 9 unit tests on the pure decision logic covering the failure bands.
- **explanation-matches-telemetry** (A14.explanation-matches-telemetry): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Explanation matches telemetry
  - criterion: explanation-matches-telemetry
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: The claimed validation path was re-executed fresh at score time (resolved A8 on scratch/sample.md, exit 0, 2-page PDF with both diagrams) — agreeing with the report; no contradiction between explanation and the event stream.

## Judge provenance

- model: gpt-5.5 @ gpt-5.5-2026-07-01
- different-family-than-subject: yes (asserted: yes)
- artifact-only: yes · identity-stripped: yes
- temperature: 0 · version-pinned: yes
- anti-verbosity: Do not reward length, rhetorical polish, or confidence without artifact evidence. Minimalism claims need diff/dependency evidence, not prose.
- canonical good-flow anchor: present, content deferred (human-gold-calibration-set-deferred)
