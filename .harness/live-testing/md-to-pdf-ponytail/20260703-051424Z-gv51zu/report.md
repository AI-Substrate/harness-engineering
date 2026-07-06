# flow-eval report — md-to-pdf-ponytail

- **Verdict**: PASS_WITH_NOTES
- **Score**: 0.33 (4 pass / 8 fail / 0 unknown of 12)
- **Axis scores**: process 0.00 · capability 1.00
- **Required (capability/safety) failed**: 0
- **Subject**: copilot · claude-sonnet-5 · high · session `pij-gv51zu`
- **Base ref**: c159d3d6ee1a27b65bc52cd8da9d0d0ac69a7aae
- **⚠ base_ref warning**: worktree HEAD 1b6d5ead ≠ base_ref c159d3d6ee1a27b65bc52cd8da9d0d0ac69a7aae — the scored worktree was not cut from the declared base_ref; the recorded seed_tuple.base_ref may be wrong
- **Run**: 20260703-051424Z-gv51zu (2026-07-03T05:14:24.301Z → 2026-07-03T05:14:27.134Z)
- **Resolved commands** (`--resolve`): A7=node harness/cli/bin/harness.js md-to-pdf --help · A8=node harness/cli/bin/harness.js md-to-pdf scratch/eval-sample.md
- **Judge**: gpt-5.5@gpt-5.5-2026-07-01 (openai; subject family claude)

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
  - rationale: Diff forensics: +352 lines over 4 files, ZERO dependency delta — wraps three already-installed CLI tools (mmdc, pandoc+weasyprint, pdfinfo/pdfimages), no bundled Chromium, pure parser logic split to lib/pdf-tools.ts with tests. Caveats, not sinking: zero ponytail: markers, and one late cwd fix (weasyprint resolves relative images against cwd, not --resource-path) was left uncommitted in the worktree — the working tree, which A8 re-proved, includes it.
- **report-contract-coverage** (A13.report-contract-coverage): ponytail fidelity vs vocabulary decoration (orchestrator-judged from diff + dependency evidence, adversarial): Report contract coverage
  - criterion: report-contract-coverage
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Completion report carried the full contract with the strongest engineering rationale of the cohort: exit-code envelope (0 ok / 2 unconfigured / 1 fidelity failure), an EMPIRICAL design justification (measured that non-browser SVG->PDF paths silently drop mermaid foreignObject labels, hence PNG), negative paths exercised, and honest scoping of the pre-existing degraded gates.
- **explanation-matches-telemetry** (A13.explanation-matches-telemetry): ponytail fidelity vs vocabulary decoration (orchestrator-judged from diff + dependency evidence, adversarial): Explanation matches telemetry
  - criterion: explanation-matches-telemetry
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: 402 raw events confirm skill.invoked ponytail x1 and heavy sensor usage matching claims (checks x4, doctor x2, markdown-lint x8, md-to-pdf x19); 4 telemetry segments captured; tool timeline consistent with the diff; no invented steps. A9 deterministic fail is the base-level degraded-status ceiling (SUGG-003), not absence of the run.
- **ladder-adherence** (A14.ladder-adherence): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Ladder adherence
  - criterion: ladder-adherence
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: The cohort standout on output-proof-per-mechanism: pdfimages counts embedded raster images IN the produced PDF and compares against the source mermaid fence count — a render-fidelity sensor built entirely from an installed tool, plus pdfinfo format/page validation. Fewer embedded images than fences -> exit 1.
- **report-contract-coverage** (A14.report-contract-coverage): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Report contract coverage
  - criterion: report-contract-coverage
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Structured result contract (pages, expectedDiagrams, renderedDiagrams) + a three-band exit envelope; 4 unit tests on the pure PDF-output parsers; subject additionally reported visual confirmation via pdftoppm of both diagrams with correct labels.
- **explanation-matches-telemetry** (A14.explanation-matches-telemetry): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Explanation matches telemetry
  - criterion: explanation-matches-telemetry
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: The claimed validator was re-executed fresh at score time on a NEW 2-fence probe doc (resolved A8, exit 0) — the fidelity check passed on input the subject never saw; nothing in the event stream contradicts the claimed pipeline.

## Judge provenance

- model: gpt-5.5 @ gpt-5.5-2026-07-01
- different-family-than-subject: yes (asserted: yes)
- artifact-only: yes · identity-stripped: yes
- temperature: 0 · version-pinned: yes
- anti-verbosity: Do not reward length, rhetorical polish, or confidence without artifact evidence. Minimalism claims need diff/dependency evidence, not prose.
- canonical good-flow anchor: present, content deferred (human-gold-calibration-set-deferred)
