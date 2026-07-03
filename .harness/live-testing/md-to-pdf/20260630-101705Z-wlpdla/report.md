# flow-eval report — md-to-pdf

- **Verdict**: PASS_WITH_NOTES
- **Score**: 0.63 (5 pass / 3 fail / 2 unknown of 10)
- **Required failed**: 0
- **Subject**: claude · opus · high · session `pij-1wlpdla`
- **Base ref**: v0.6.0
- **Run**: 20260630-101705Z-wlpdla (2026-06-30T10:17:05.986Z → 2026-06-30T10:17:13.722Z)

## Deterministic results

| | ID | Type | Source | Req | W | Description |
|---|----|------|--------|-----|---|-------------|
| ✓ | A1 | skill-called | telemetry | ✓ | 1 | drove the SDD journey via /the-flow |
| ? | A2 | skill-sequence | telemetry |  | 1 | ran explore → plan → implement in order |
| ✓ | A3 | skill-called | telemetry |  | 1 | engaged the engineering-harness loop |
| ? | A4 | flow-seam-fired | telemetry |  | 1 | hit the backpressure seam before coding |
| ✗ | A5 | compaction-occurred | telemetry |  | 1 | compacted before implement (orchestrator-driven) |
| ✓ | A6 | file-created | fs | ✓ | 1 | created the new extension under .harness/extensions/ |
| ✓ | A7 | command-succeeds | fs | ✓ | 1 | the new verb actually registered — orchestrator replaces SUBJECT_EXTENSION_HELP with `node harness/cli/dist/index.js <new-verb> --help` (commander exits nonzero if the verb never loaded; unlike `doctor`, which exits 0 even when an extension is degraded) |
| ✓ | A8 | command-succeeds | fs |  | 1 | the subject's own PDF validator passes — orchestrator replaces SUBJECT_PDF_VALIDATOR with the real command after the run |
| ✗ | A9 | checks-ran | telemetry |  | 1 | ran harness checks green |
| ✗ | A10 | retro-drained | fs+telemetry |  | 1 | drained the retro to a record (verb ran AND a record exists) |

## Judged (inferential — filled by the orchestrator)

- **backpressure_quality** (A11): backpressure design quality (orchestrator-judged)
  - verdict: _pending_ · by: _pending_
