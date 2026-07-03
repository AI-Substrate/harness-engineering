# flow-eval report — md-to-pdf-ponytail-harness

- **Verdict**: PASS_WITH_NOTES
- **Score**: 0.50 (6 pass / 6 fail / 0 unknown of 12)
- **Axis scores**: process 0.25 · capability 1.00
- **Required (capability/safety) failed**: 0
- **Subject**: copilot · claude-opus-4.8 · high · session `pij-1emwcpt`
- **Base ref**: c159d3d6ee1a27b65bc52cd8da9d0d0ac69a7aae
- **⚠ base_ref warning**: worktree HEAD 96a81aad ≠ base_ref c159d3d6ee1a27b65bc52cd8da9d0d0ac69a7aae — the scored worktree was not cut from the declared base_ref; the recorded seed_tuple.base_ref may be wrong
- **Run**: 20260703-055516Z-emwcpt (2026-07-03T05:55:16.051Z → 2026-07-03T05:55:18.579Z)
- **Resolved commands** (`--resolve`): A7=node harness/cli/bin/harness.js md-to-pdf --help · A8=node harness/cli/bin/harness.js md-to-pdf .harness/extensions/md-to-pdf/fixtures/sample.md --out scratch/eval-x.pdf
- **Judge**: gpt-5.5@gpt-5.5-2026-07-01 (openai; subject family claude)

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
  - verdict: fail · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: The dual mandate eroded minimalism: +969 lines over 12 files INCLUDING two new npm devDependencies (marked, puppeteer — a 325-line lockfile delta), a 64-line docs/how/ page, and README edits — where installed capability demonstrably sufficed (its OWN batch-3 run wrapped mmdc+pandoc with zero deps, and two sibling runs used installed headless Chrome). The ladder rung is explicit: never add a new dependency for what installed tools solve. The devDep justification (extension unpublished) mitigates but does not clear it — this is the rubric PARTIAL/unforced-additions band, recorded honestly as fail on this criterion; the engineering itself is high quality.
- **report-contract-coverage** (A13.report-contract-coverage): ponytail fidelity vs vocabulary decoration (orchestrator-judged from diff + dependency evidence, adversarial): Report contract coverage
  - criterion: report-contract-coverage
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Contract complete: status, worktree, extension+commit, exercise with expected envelope values ({isPdf:true, pages:2, mermaidRendered:2}), the deterministic sensor named (just checks incl. a real-Chromium e2e), loop evidence volunteered (boot HEALTHY, retro path, MW-001 magic-wand), honest degraded-debt scoping.
- **explanation-matches-telemetry** (A13.explanation-matches-telemetry): ponytail fidelity vs vocabulary decoration (orchestrator-judged from diff + dependency evidence, adversarial): Explanation matches telemetry
  - criterion: explanation-matches-telemetry
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: 7 segments; raw events confirm skill.invoked ponytail AND eng-harness-flow, observe x8, record x4, doctor x6, md-to-pdf x11 — the claimed loop conduct all really ran; retro record with MW-001 exists on disk. A1/A3 deterministic fails remain capture-window artifacts.
- **ladder-adherence** (A14.ladder-adherence): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Ladder adherence
  - criterion: ladder-adherence
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Validation is real: parse != render honored (mermaid.parse is syntax-only, so it renders with actual Chromium and validates the PDF bytes before reporting ok), envelope carries {isPdf, pages, mermaidRendered}, and a real-Chromium e2e test renders 2 diagrams and asserts a valid %PDF. Strong backpressure — the mechanism cost that bought it is judged under A13, not here.
- **report-contract-coverage** (A14.report-contract-coverage): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Report contract coverage
  - criterion: report-contract-coverage
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Deterministic sensor is first-class (just checks green incl. the e2e), 10 unit tests across extension.test.ts + validate.test.ts, ok envelope with explicit fields; fixtures committed for reproducibility.
- **explanation-matches-telemetry** (A14.explanation-matches-telemetry): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Explanation matches telemetry
  - criterion: explanation-matches-telemetry
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Resolved A8 re-executed fresh at score time (exit 0 on its committed fixture); the claimed render pipeline and validation semantics match the code and the event stream; no contradiction found.

## Judge provenance

- model: gpt-5.5 @ gpt-5.5-2026-07-01
- different-family-than-subject: yes (asserted: yes)
- artifact-only: yes · identity-stripped: yes
- temperature: 0 · version-pinned: yes
- anti-verbosity: Do not reward length, rhetorical polish, or confidence without artifact evidence. Minimalism claims need diff/dependency evidence, not prose.
- canonical good-flow anchor: present, content deferred (human-gold-calibration-set-deferred)
