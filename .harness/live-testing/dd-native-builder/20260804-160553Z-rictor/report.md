# flow-eval report — dd-native-builder

- **Verdict**: FAIL
- **Score**: 0.83 (5 pass / 1 fail / 5 unknown of 11)
- **Axis scores**: process unmeasured · capability 1.00
- **Required (capability/safety) failed**: 1
- **Subject**: claude · opus · high · session `pij-key-constrictor`
- **Base ref**: f947a2fc49928b997079297c53ef3925e107c789
- **⚠ base_ref warning**: worktree HEAD f947a2fc ≠ base_ref f947a2fc49928b997079297c53ef3925e107c789 — the scored worktree was not cut from the declared base_ref; the recorded seed_tuple.base_ref may be wrong
- **Run**: 20260804-160553Z-rictor (2026-08-04T16:05:53.778Z → 2026-08-04T16:05:58.060Z)
- **Resolved commands** (`--resolve`): SUBJECT_PLAN_VALIDATE_COMPLETE=node harness/cli/bin/harness.js plan validate /Users/jordanknight/substrate/harness-engineering-worktrees/eval-ddnb-run1/docs/plans/072-documented-command-check/plan.dd.json --complete
- **Judge**: gpt-5.5@gpt-5.5-2026-07-01 (openai; subject family claude)

## Deterministic results

| | ID | Type | Source | Req | W | Description | Axis |
|---|----|------|--------|-----|---|-------------|------|
| ? | A1 | skill-called | telemetry | ✓ | 1 | drove the work through the builder skill rather than free-handing it — everything below is only meaningful if this is how the plan was made | process |
| ✓ | A2 | file-created | fs | ✓ | 1 | the plan is a deterministic document — the dd-native authoring path was actually taken (ac-7111) | capability |
| ✗ | A3 | forbidden-state | fs | ✓ | 1 | NO markdown plan document exists beside the dd one. The dd pair REPLACES `<slug>-plan.md`; a subject that wrote both hedged, and a hedged plan is two sources of truth | safety |
| ✓ | A4 | file-created | fs | ✓ | 1 | the phase task file was JIT-born as a dd document at the phase boundary, not scaffolded up front | capability |
| ✓ | A5 | file-content-matches | fs | ✓ | 1 | every assertion names its instrument — mandatory pressure was honoured rather than worked around (ac-7103) | capability |
| ✓ | A6 | file-content-matches | fs |  | 1 | task rows carry the criteria they serve, so the work-accounting leg of the proof graph exists (ac-7105). Not required: a single-phase scenario may legitimately have one task and one criterion | capability |
| ? | A7 | harness-verb-ran | telemetry |  | 1 | states were mutated through the dd WRITER VERBS. Not required, and deliberately so: `dd add`/`dd rm` are equally correct, and A9 catches the failure this is really about | process |
| ? | A8 | harness-verb-ran | telemetry | ✓ | 1 | asked the plan whether its own story hangs together, at least once | process |
| ✓ | A9 | command-succeeds | fs | ✓ | 1 | the corpus is doctor-clean AFTER the run — which is the honest test of 'never hand-edited the generated markdown'. A hand-edited sibling shows up here as drift no matter how it was made | capability |
| ? | A10 | gate-refused | telemetry | ✓ | 1 | at least one departure was REFUSED by a gate. This is the assertion the scenario exists for: a run whose gates never fired has not shown the gates work, only that the subject happened to stay ahead of them (tk-7169's evidence capture is what makes this provable at all) | process |
| ? | A11 | command-succeeds | fs |  | 1 | the close-out question came back green — strict zero errors and zero warnings. A placeholder resolved per-run (`--resolve SUBJECT_PLAN_VALIDATE_COMPLETE=...`), because only the subject knows where its plan landed; unresolved it scores `unknown` under this scenario's placeholder_policy, never a silent pass or a spurious fail. Not required: a single-phase run may legitimately stop before close-out | capability |

## Judged (inferential — filled by the orchestrator)

- **explanation-matches-telemetry** (A12.explanation-matches-telemetry): does the subject's own account of what it did match what telemetry says it did? The one thing no resolver can answer, and the one most worth knowing: Explanation matches telemetry
  - criterion: explanation-matches-telemetry
  - verdict: unknown · by: orchestrator pij-related-koala (artifact-only; judge lane unrunnable without telemetry)
  - rationale: Rubric says unknown when telemetry is insufficient, and it is: 0 segments joined for session pij-key-constrictor (telemetry.available=false), so the telemetry half of the criterion is unmeasurable. Artifact-only cross-check of the subject's account against the worktree: corroborated on every checkable claim — new-since-base files match its report exactly (2 source, 2 test, 3 wiring-guard edits, plan folder, retro record at .harness/records/retro/2026-08-04/004-*); the-flow.json shows the claimed 5 spine nodes + receipted chores with nav on review-1; its 20 new tests exist and pass. No invented steps found in artifacts; no contradiction found. But the criterion is explanation-vs-TELEMETRY, and that lane is blind this run — unknown, not pass.

## Judge provenance

- model: gpt-5.5 @ gpt-5.5-2026-07-01
- different-family-than-subject: yes (asserted: yes)
- artifact-only: yes · identity-stripped: yes
- temperature: 0 · version-pinned: yes
- anti-verbosity: Do not reward length, rhetorical polish, or confidence without artifact evidence.
- canonical good-flow anchor: present, content deferred (human-gold-calibration-set-deferred)
