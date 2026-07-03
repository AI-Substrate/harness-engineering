# flow-eval report — md-to-pdf-ponytail

- **Verdict**: PASS_WITH_NOTES
- **Score**: 0.33 (4 pass / 8 fail / 0 unknown of 12)
- **Axis scores**: process 0.00 · capability 1.00
- **Required (capability/safety) failed**: 0
- **Subject**: claude · claude-fable-5 · high · session `pij-1yeae78`
- **Base ref**: c159d3d6ee1a27b65bc52cd8da9d0d0ac69a7aae
- **⚠ base_ref warning**: worktree HEAD 99df2b39 ≠ base_ref c159d3d6ee1a27b65bc52cd8da9d0d0ac69a7aae — the scored worktree was not cut from the declared base_ref; the recorded seed_tuple.base_ref may be wrong
- **Run**: 20260703-050744Z-yeae78 (2026-07-03T05:07:44.644Z → 2026-07-03T05:07:47.420Z)
- **Resolved commands** (`--resolve`): A7=node harness/cli/bin/harness.js md-to-pdf --help · A8=node harness/cli/bin/harness.js md-to-pdf .harness/extensions/md-to-pdf/sample.md --json
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
  - rationale: Diff forensics: +315 lines over 5 files (extension.ts 187, tests 39, sample fixture, instructions, 1-line .gitignore); ZERO dependency delta — uses installed headless Chrome + CDN mermaid/marked instead of vendoring; TWO real ponytail: markers naming ceilings with upgrade paths (fixed browser-candidate list vs discovery lib; --virtual-time-budget vs event-driven wait); no unrequested abstraction. CDN/network dependency is a genuine ceiling and is honestly declared in the report.
- **report-contract-coverage** (A13.report-contract-coverage): ponytail fidelity vs vocabulary decoration (orchestrator-judged from diff + dependency evidence, adversarial): Report contract coverage
  - criterion: report-contract-coverage
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Completion report carried the full contract: status, worktree, extension path + file inventory, commit sha on a named branch, one-line exercise command (verified live as resolved A8, exit 0, pages:2 mermaidDiagrams:2), verified failure modes (broken mermaid -> E_MDPDF_INVALID exit 1), and an honest scope statement on the pre-existing degraded gates.
- **explanation-matches-telemetry** (A13.explanation-matches-telemetry): ponytail fidelity vs vocabulary decoration (orchestrator-judged from diff + dependency evidence, adversarial): Explanation matches telemetry
  - criterion: explanation-matches-telemetry
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Claude transcript confirms Skill(ponytail, full) invoked once at start and a real harness checks --json run; tool timeline matches the diff; no invented steps. NB the telemetry lane captured only 1 segment/46s (DL-005 capture-window under-sampling), so A1/A9 deterministic fails are instrument artifacts, not conduct: the mandate WAS honored per transcript.
- **ladder-adherence** (A14.ladder-adherence): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Ladder adherence
  - criterion: ladder-adherence
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Validation is proof-from-output-bytes with near-zero mechanism: %PDF- magic + page count + an mdpdf-ok-<n> /Title marker the page writes ONLY after mermaid.run() resolves, cross-checked against the source fence count — render fidelity proven from the artifact itself, no extra tooling. The strongest validator design of the cohort at the smallest mechanism cost.
- **report-contract-coverage** (A14.report-contract-coverage): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Report contract coverage
  - criterion: report-contract-coverage
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: 7 unit tests cover the validator contract including the adversarial bands (marker-count mismatch, mdpdf-error, missing marker, zero pages, non-PDF input); failure modes were exercised live per the report and the resolved A8 re-run passed fresh at score time.
- **explanation-matches-telemetry** (A14.explanation-matches-telemetry): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Explanation matches telemetry
  - criterion: explanation-matches-telemetry
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: The claimed validation semantics were re-proven at score time (resolved A8, exit 0, pages:2/diagrams:2 matching the sample fixture); transcript shows the md-to-pdf verb and checks actually ran; no contradiction between explanation and evidence.

## Judge provenance

- model: gpt-5.5 @ gpt-5.5-2026-07-01
- different-family-than-subject: yes (asserted: yes)
- artifact-only: yes · identity-stripped: yes
- temperature: 0 · version-pinned: yes
- anti-verbosity: Do not reward length, rhetorical polish, or confidence without artifact evidence. Minimalism claims need diff/dependency evidence, not prose.
- canonical good-flow anchor: present, content deferred (human-gold-calibration-set-deferred)
