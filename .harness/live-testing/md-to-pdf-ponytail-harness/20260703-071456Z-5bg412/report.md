# flow-eval report — md-to-pdf-ponytail-harness

- **Verdict**: PASS_WITH_NOTES
- **Score**: 0.50 (6 pass / 6 fail / 0 unknown of 12)
- **Axis scores**: process 0.25 · capability 1.00
- **Required (capability/safety) failed**: 0
- **Subject**: claude · claude-fable-5 · high · session `pij-5bg412`
- **Base ref**: c159d3d6ee1a27b65bc52cd8da9d0d0ac69a7aae
- **⚠ base_ref warning**: worktree HEAD 16482f04 ≠ base_ref c159d3d6ee1a27b65bc52cd8da9d0d0ac69a7aae — the scored worktree was not cut from the declared base_ref; the recorded seed_tuple.base_ref may be wrong
- **Run**: 20260703-071456Z-5bg412 (2026-07-03T07:14:56.205Z → 2026-07-03T07:15:03.773Z)
- **Resolved commands** (`--resolve`): A7=node harness/cli/bin/harness.js md-to-pdf --help · A8=node harness/cli/bin/harness.js md-to-pdf docs/guide/03-the-harness-loop.md --json
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
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Task diff is lean where it counts: extension 231 lines + 147-line test (10 tests incl. a real-browser e2e), reuses the repo's own vendored mermaid.min.js + a DISCOVERED local Chrome/Edge (no puppeteer, no mermaid-cli); the only package.json change pins marked, which was already resolved in the dependency tree (1-line lockfile delta — promoting a transitive dep to explicit, the opposite of Opus's 325-line puppeteer addition); one real ponytail: marker naming the probe-list ceiling. The other +500 lines are mandated harness conduct (loop flight plan, records, backpressure doc, spec) plus an improve-stage boot fix — not task inflation.
- **report-contract-coverage** (A13.report-contract-coverage): ponytail fidelity vs vocabulary decoration (orchestrator-judged from diff + dependency evidence, adversarial): Report contract coverage
  - criterion: report-contract-coverage
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Contract complete and then some: worktree+branch+commit, extension path, exercise command with expected envelope semantics AND a test-suite alternative proof path, three failure paths exercised live, honest degraded-gate scoping, and explicit flagging that it took recommended defaults at two advisory gates per the pause-routing rule — the only subject to invoke that protocol clause.
- **explanation-matches-telemetry** (A13.explanation-matches-telemetry): ponytail fidelity vs vocabulary decoration (orchestrator-judged from diff + dependency evidence, adversarial): Explanation matches telemetry
  - criterion: explanation-matches-telemetry
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: 16 telemetry segments (richest of the batch — its heavy harness-verb usage opened many windows); transcript confirms exactly one Skill(ponytail) and one Skill(eng-harness-flow) invocation; the tracked .harness/loop.flow.json spine (boot→backpressure→observe→drain-gate→retro-drain→retro-harvest→improve) matches the claimed loop narrative; retro + harness-change records exist on disk. A1/A3 deterministic fails remain capture-lane artifacts.
- **ladder-adherence** (A14.ladder-adherence): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Ladder adherence
  - criterion: ladder-adherence
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Validation refuses ok until a post-JS DOM svg tally proves every mermaid fence rendered AND the PDF passes structural validation (header/trailer/page count) — deterministic, bites on broken renders, built from discovered local tooling. Slightly weaker output-proof than its own b3 design (DOM-render proof + PDF structure, vs the b3 /Title marker read back from the PDF bytes) but with a stronger test harness around it (10 tests incl. browser e2e).
- **report-contract-coverage** (A14.report-contract-coverage): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Report contract coverage
  - criterion: report-contract-coverage
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: ok/error envelopes with mermaid fences==rendered and pages>=1 fields; 3 failure paths (bad mermaid, missing input, missing browser) exercised live with honest envelopes; 10-test proof path documented in the completion report.
- **explanation-matches-telemetry** (A14.explanation-matches-telemetry): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Explanation matches telemetry
  - criterion: explanation-matches-telemetry
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Resolved A8 re-executed fresh at score time on a repo doc (exit 0, ok envelope) — the validator passed on real input; the claimed improve-stage encoding is verifiable on disk (boot extension +13 lines with 46-line test + harness-change record 001-boot-unbuilt-preflight.md); no contradiction between explanation and evidence.

## Judge provenance

- model: gpt-5.5 @ gpt-5.5-2026-07-01
- different-family-than-subject: yes (asserted: yes)
- artifact-only: yes · identity-stripped: yes
- temperature: 0 · version-pinned: yes
- anti-verbosity: Do not reward length, rhetorical polish, or confidence without artifact evidence. Minimalism claims need diff/dependency evidence, not prose.
- canonical good-flow anchor: present, content deferred (human-gold-calibration-set-deferred)
