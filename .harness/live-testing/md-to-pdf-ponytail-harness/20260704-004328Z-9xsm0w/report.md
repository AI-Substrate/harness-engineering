# flow-eval report — md-to-pdf-ponytail-harness

- **Verdict**: PASS_WITH_NOTES
- **Score**: 1.00 (4 pass / 0 fail / 8 unknown of 12)
- **Axis scores**: process unmeasured · capability 1.00
- **Required (capability/safety) failed**: 0
- **Subject**: copilot · claude-sonnet-5 · high · session `pij-19xsm0w`
- **Base ref**: c159d3d6ee1a27b65bc52cd8da9d0d0ac69a7aae
- **⚠ base_ref warning**: worktree HEAD f126d803 ≠ base_ref c159d3d6ee1a27b65bc52cd8da9d0d0ac69a7aae — the scored worktree was not cut from the declared base_ref; the recorded seed_tuple.base_ref may be wrong
- **Run**: 20260704-004328Z-9xsm0w (2026-07-04T00:43:28.573Z → 2026-07-04T00:43:30.831Z)
- **Resolved commands** (`--resolve`): A7=node harness/cli/bin/harness.js md-to-pdf --help · A8=node harness/cli/bin/harness.js md-to-pdf scratch/probe-good.md --out scratch/probe-good.pdf
- **Judge**: gpt-5.5@gpt-5.5-2026-07-01 (openai; subject family claude)

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
  - rationale: +1124 lines over 10 files is lean, BUT +2 devDeps (marked ^18.0.5, puppeteer ^25.3.0, package.json devDependencies) — the SAME dependency trade that failed this lane for opus-4.8 b4 and glm-5.2 b4 (consistency rule: identical trades, identical verdicts). The zero-dep rung was proven reachable on this exact task by sonnet-5's own prior b4 run (4ayv7i: mmdc/weasyprint wrapped as system tools, ZERO dep delta). Mitigating, recorded not exculpating: the subject spiked jsdom first and documented WHY it is unusable (no getBBox/CSS layout for mermaid.run), so the trade is reasoned, and rendering fidelity is genuinely higher — but the ladder's lower rung (wrap installed tools; mermaid+jsdom were already installed, mmdc path existed) was skipped, not exhausted.
- **report-contract-coverage** (A13.report-contract-coverage): ponytail fidelity vs vocabulary decoration (orchestrator-judged from diff + dependency evidence, adversarial): Report contract coverage
  - criterion: report-contract-coverage
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Completion report carried the full contract: DONE status, worktree path, extension path, one-line exercise command, validation semantics (per-diagram render-fidelity from actual SVG), loop-conduct summary (boot/doctor, DL-001 backpressure gap capture, retro drained + committed, harness-change record), plus an unprompted transparency disclosure (found live-testing/scenarios/md-to-pdf/ in the base — shared exposure across all same-base b2-b4 subjects, comparability unaffected).
- **explanation-matches-telemetry** (A13.explanation-matches-telemetry): ponytail fidelity vs vocabulary decoration (orchestrator-judged from diff + dependency evidence, adversarial): Explanation matches telemetry
  - criterion: explanation-matches-telemetry
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: 9 segments; raw copilot events (670 lines) verify EVERY claimed conduct element: doctor x6, boot x6, checks x4, observe x8, record x10, retro x2, md-to-pdf x14, instructions x7 (self-briefed), and both /ponytail and /eng-harness-flow present. Retro record 2026-07-04/001-md-to-pdf.md carries the claimed DL-001 (backpressure SPEC_FILE precondition gap) + MW-001; harness-change record resolves DL-001. No claim without an event; no event contradicting a claim.
- **ladder-adherence** (A14.ladder-adherence): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Ladder adherence
  - criterion: ladder-adherence
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Real backpressure, not token gesture: validation is two-layer — PDF byte structure (%PDF- header, %%EOF trailer, page count) AND per-diagram render fidelity read from the actual laid-out SVG DOM (rendered/hasError via .error-icon/.error-text/Syntax-error markers, nodeCount) — not file-size proxies. Degraded envelope names the failing fence index with a next_action. jsdom spiked and rejected with a recorded reason before reaching for Chromium.
- **report-contract-coverage** (A14.report-contract-coverage): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Report contract coverage
  - criterion: report-contract-coverage
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Envelope semantics complete and honest: ok (probe-good: bytes 18783, pages 1, mermaid 1/1 rendered, nodeCount 19) vs degraded (probe-bad: failed:1, per-diagram hasError:true, next_action naming fence #1, PDF still written and said so). 10 tests including 2 real end-to-end Chromium renders; help text documents the validation contract.
- **explanation-matches-telemetry** (A14.explanation-matches-telemetry): backpressure design quality (orchestrator-judged; same field as the other variants so the three cohorts compare — here it also tests whether minimalism erodes verification): Explanation matches telemetry
  - criterion: explanation-matches-telemetry
  - verdict: pass · by: orchestrator pij-4s10mb (Claude Fable 5), evidence-first per runbook
  - rationale: Resolved A8 re-executed fresh at score time on a NEW unseen probe doc (exit 0, ok envelope, 1/1 mermaid rendered); a deliberately-broken fence probe returned degraded with failed:1 and per-diagram hasError — the validator discriminates on unseen input in both directions. md-to-pdf x14 in raw events matches the iterative build-verify story; 10/10 extension tests green re-run by the orchestrator in the worktree.

## Judge provenance

- model: gpt-5.5 @ gpt-5.5-2026-07-01
- different-family-than-subject: yes (asserted: yes)
- artifact-only: yes · identity-stripped: yes
- temperature: 0 · version-pinned: yes
- anti-verbosity: Do not reward length, rhetorical polish, or confidence without artifact evidence. Minimalism claims need diff/dependency evidence, not prose.
- canonical good-flow anchor: present, content deferred (human-gold-calibration-set-deferred)
