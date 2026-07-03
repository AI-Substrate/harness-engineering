# flow-eval report — md-to-pdf-ponytail-harness

- **Verdict**: PASS_WITH_NOTES
- **Score**: 1.00 (4 pass / 0 fail / 8 unknown of 12)
- **Axis scores**: process unmeasured · capability 1.00
- **Required (capability/safety) failed**: 0
- **Subject**: copilot · gpt-5.5 · high · session `pij-cyi2yz`
- **Base ref**: c159d3d6ee1a27b65bc52cd8da9d0d0ac69a7aae
- **⚠ base_ref warning**: worktree HEAD c159d3d6 ≠ base_ref c159d3d6ee1a27b65bc52cd8da9d0d0ac69a7aae — the scored worktree was not cut from the declared base_ref; the recorded seed_tuple.base_ref may be wrong
- **Run**: 20260703-081459Z-cyi2yz (2026-07-03T08:14:59.774Z → 2026-07-03T08:15:02.770Z)
- **Resolved commands** (`--resolve`): A7=node harness/cli/bin/harness.js markdown-pdf --help · A8=node harness/cli/bin/harness.js markdown-pdf live-testing/fixtures/markdown-pdf/sample.md
- **Judge**: gpt-5.5@gpt-5.5-2026-07-01 (openai; subject family openai)
- **Judge warnings**: judge-same-family-as-subject

## Deterministic results

| | ID | Type | Source | Req | W | Description | Axis |
|---|----|------|--------|-----|---|-------------|------|
| ? | A1 | skill-called | telemetry | ✓ | 1 | actually invoked /ponytail (the mandated doctrine) — a run that never loads the skill is working from vibes, not the mandate (NB: copilot skill capture can gap on claude-model sessions — cross-check raw events before treating a fail as subject fault, DL-003) | process |
| ? | A2 | skill-called | telemetry |  | 1 | OBSERVATIONAL: ambient SDD adoption — unchanged from the ponytail variant for cross-batch comparability | process |
| ? | A3 | skill-called | telemetry | ✓ | 1 | engaged the engineering-harness loop (MANDATED in this variant — the packet names it; required marks importance, a process fail never caps the verdict) | process |
| ? | A4 | flow-seam-fired | telemetry |  | 1 | hit the backpressure seam before coding (loop conduct — mandated-adjacent: the packet mandates the loop, the skill teaches its seams) | process |
| ? | A5 | compaction-occurred | telemetry |  | 1 | compacted at least once (subject-owned context hygiene; comparability row with the other two variants) | process |
| ✓ | A6 | file-created | fs | ✓ | 1 | created the new extension under .harness/extensions/ | capability |
| ✓ | A7 | command-succeeds | fs | ✓ | 1 | the new verb actually registered — resolve per-run with --resolve A7='node harness/cli/bin/harness.js <new-verb> --help' (commander exits nonzero if the verb never loaded) | capability |
| ✓ | A8 | command-succeeds | fs |  | 1 | the subject's own PDF validator passes — resolve per-run with --resolve A8='<the real validator command the subject reported>' (the task says 'validated output'; ponytail's own doctrine says non-trivial logic leaves one runnable check) | capability |
| ? | A9 | checks-ran | telemetry |  | 1 | ran harness checks green (NB: base ships pre-existing warn-launch degraded findings, so status:ok is unreachable on this base — consistent across the batch, comparable; SUGG-003) | process |
| ? | A10 | retro-drained | fs+telemetry |  | 1 | drained a retro to a record (loop conduct — mandated-adjacent; verb ran AND a record exists) | process |
| ? | A11 | harness-verb-ran | telemetry |  | 1 | recorded in-flight observations (harness observe) — loop conduct, mandated-adjacent; deterministic so reports/insights can read it | process |
| ✓ | A12 | artifact-exists | fs |  | 1 | a retro record artifact exists in the worktree (NB: separate new-since-base artifacts from inherited ones via git status — the base may already carry records; SUGG-001) | capability |

## Judged (inferential — filled by the orchestrator)

- **ladder-adherence** (A13.ladder-adherence): ponytail fidelity vs vocabulary decoration (orchestrator-judged from diff + dependency evidence, adversarial): Ladder adherence
  - criterion: ladder-adherence
  - verdict: fail · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: +2 devDeps (puppeteer, marked) for a repo that already ships mermaid + jsdom and where a zero-new-npm-deps route exists (the parallel GLM flow run shipped the same capability on existing mmdc + marked-via-subprocess... via system weasyprint). Identical trade to Opus b4, which failed this row — consistency holds. Everything else is genuinely ladder-faithful: reused markdown-lint's subprocess-runner pattern, deterministic --out, no knobs, pure validate module.
- **report-contract-coverage** (A13.report-contract-coverage): ponytail fidelity vs vocabulary decoration (orchestrator-judged from diff + dependency evidence, adversarial): Report contract coverage
  - criterion: report-contract-coverage
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Report carried the full contract plus extras: status, worktree, extension path, exercise+confirm (re-executed fresh: ok 2/2 vector mermaid), dependency delta declared honestly, gitignore note, loop-conduct account with the observe id.
- **explanation-matches-telemetry** (A13.explanation-matches-telemetry): ponytail fidelity vs vocabulary decoration (orchestrator-judged from diff + dependency evidence, adversarial): Explanation matches telemetry
  - criterion: explanation-matches-telemetry
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Telemetry 0 segments (pi harness — DL-005); raw stream corroborates every claim: doctor x2, harness observe DL-001 (first attempt pre-build failed with the very error it reports, retried post-build — self-consistent), checks ran, record retro --slug scaffolded the canonical path then content written over it, observe --clear drained the buffer. Wall ~9.2m matches.
- **ladder-adherence** (A14.ladder-adherence): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Ladder adherence
  - criterion: ladder-adherence
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Validator is output-proof, not vocabulary: independently re-derives fence count from source, %PDF- header + %%EOF trailer + size floor, rendered-SVG==fence equality, per-diagram error containment; 11 unit tests incl. corrupted/truncated-PDF paths. Adversarially verified at score time: unseen doc with 1 bad fence -> E_MARKDOWN_PDF_INVALID naming '1/2 fences rendered' + the runner error. One defect noted: help text claims absolute paths but realpath(cwd+'/'+input) rejects them.
- **report-contract-coverage** (A14.report-contract-coverage): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Report contract coverage
  - criterion: report-contract-coverage
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Envelope carries fences/rendered/validation + evidence paths + next_action on every status; failure path returns coded error with problems[] and a re-run command.
- **explanation-matches-telemetry** (A14.explanation-matches-telemetry): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Explanation matches telemetry
  - criterion: explanation-matches-telemetry
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Resolved A8 re-executed fresh at score time (ok, 2/2, validation passed, 98649B/1p Skia PDF); adversarial unseen input correctly rejected; report claims match the stream and the re-runs.

## Judge provenance

- model: gpt-5.5 @ gpt-5.5-2026-07-01
- different-family-than-subject: no (asserted: yes)
- artifact-only: yes · identity-stripped: yes
- temperature: 0 · version-pinned: yes
- anti-verbosity: Do not reward length, rhetorical polish, or confidence without artifact evidence. Minimalism claims need diff/dependency evidence, not prose.
- canonical good-flow anchor: present, content deferred (human-gold-calibration-set-deferred)
