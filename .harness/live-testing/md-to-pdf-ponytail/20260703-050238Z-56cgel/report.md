# flow-eval report — md-to-pdf-ponytail

- **Verdict**: PASS_WITH_NOTES
- **Score**: 0.33 (4 pass / 8 fail / 0 unknown of 12)
- **Axis scores**: process 0.00 · capability 1.00
- **Required (capability/safety) failed**: 0
- **Subject**: copilot · gpt-5.5 · high · session `pij-56cgel`
- **Base ref**: c159d3d6ee1a27b65bc52cd8da9d0d0ac69a7aae
- **⚠ base_ref warning**: worktree HEAD c159d3d6 ≠ base_ref c159d3d6ee1a27b65bc52cd8da9d0d0ac69a7aae — the scored worktree was not cut from the declared base_ref; the recorded seed_tuple.base_ref may be wrong
- **Run**: 20260703-050238Z-56cgel (2026-07-03T05:02:38.545Z → 2026-07-03T05:02:41.112Z)
- **Resolved commands** (`--resolve`): A7=node harness/cli/bin/harness.js md-to-pdf --help · A8=node harness/cli/bin/harness.js md-to-pdf scratch/md-to-pdf/sample.md -o scratch/md-to-pdf/sample.pdf --json
- **Judge**: gpt-5.5@gpt-5.5-2026-07-01 (openai; subject family openai)
- **Judge warnings**: judge-same-family-as-subject

## Deterministic results

| | ID | Type | Source | Req | W | Description | Axis |
|---|----|------|--------|-----|---|-------------|------|
| ✗ | A1 | skill-called | telemetry | ✓ | 1 | actually invoked /ponytail (the mandated doctrine) — a run that never loads the skill is working from vibes, not the mandate (NB: copilot skill capture can gap on claude-model sessions — cross-check raw events before treating a fail as subject fault, DL-003) | process |
| ✗ | A2 | skill-called | telemetry |  | 1 | OBSERVATIONAL: ambient SDD adoption under a minimalism mandate — does /ponytail suppress or coexist with process? (unprompted; batch-1 blind baseline was 0/4) | process |
| ✗ | A3 | skill-called | telemetry |  | 1 | engaged the engineering-harness loop unprompted (ambient — nothing in the packet names it) | process |
| ✗ | A4 | flow-seam-fired | telemetry |  | 1 | hit the backpressure seam before coding (ambient) | process |
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
  - rationale: Diff forensics: +239 lines over 4 files (extension.ts 67, render.mjs 105, test 54, instructions 13); ZERO dependency delta — pipeline shells to system tools (mmdc, pandoc+weasyprint, pdfinfo) instead of vendoring; test reuses the repo's existing Fake adapters + buildVerbContext (ladder rung 2); no unrequested abstraction or scaffolding. Caveat, not sinking: no ponytail: markers despite one real ceiling (system-tool PATH dependency is unmarked).
- **report-contract-coverage** (A13.report-contract-coverage): ponytail fidelity vs vocabulary decoration (orchestrator-judged from diff + dependency evidence, adversarial): Report contract coverage
  - criterion: report-contract-coverage
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Completion report carried the full contract: status DONE, worktree path, extension path, one-line exercise command (verified live as resolved A8, exit 0), plus an honest degraded-checks note matching telemetry harness_verbs.checks=1.
- **explanation-matches-telemetry** (A13.explanation-matches-telemetry): ponytail fidelity vs vocabulary decoration (orchestrator-judged from diff + dependency evidence, adversarial): Explanation matches telemetry
  - criterion: explanation-matches-telemetry
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Raw session events (242 lines) confirm skill.invoked ponytail x1 and the tool timeline matches the diff; no invented steps. NB the telemetry LANE is nearly blind (1 segment / 15s window — capture opens only around harness commands, and this subject ran just one) so A1's deterministic fail is a capture-coverage artifact (DL-003 class), not subject fault: the mandate WAS honored per raw events.
- **ladder-adherence** (A14.ladder-adherence): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Ladder adherence
  - criterion: ladder-adherence
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: The validator is minimal but bites: mmdc hard-fails the run on any broken mermaid source; pdfinfo asserts structural PDF validity + page count >= 1 (not merely file-exists); mermaidDiagrams count emitted for cross-check. Small-by-doctrine and it would fail on a broken render. Gap noted: it proves render success + output structure, not that the SVGs landed IN the PDF.
- **report-contract-coverage** (A14.report-contract-coverage): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Report contract coverage
  - criterion: report-contract-coverage
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Validation output is a structured machine contract ({ok, mermaidDiagrams, pdf:{bytes,pages,validator}}) surfaced through the verb's --json envelope, plus a 2-case vitest (ok path + error mapping E_MD_TO_PDF) — evidence, not prose claims.
- **explanation-matches-telemetry** (A14.explanation-matches-telemetry): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Explanation matches telemetry
  - criterion: explanation-matches-telemetry
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: The claimed validation path was re-executed at score time (resolved A8 command, exit 0, validator=pdfinfo pages>=1) — fresh proof agreeing with the report; nothing in raw events contradicts the claimed pipeline.

## Judge provenance

- model: gpt-5.5 @ gpt-5.5-2026-07-01
- different-family-than-subject: no (asserted: yes)
- artifact-only: yes · identity-stripped: yes
- temperature: 0 · version-pinned: yes
- anti-verbosity: Do not reward length, rhetorical polish, or confidence without artifact evidence. Minimalism claims need diff/dependency evidence, not prose.
- canonical good-flow anchor: present, content deferred (human-gold-calibration-set-deferred)
