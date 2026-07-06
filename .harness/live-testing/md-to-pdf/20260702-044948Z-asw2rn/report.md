# flow-eval report — md-to-pdf

- **Verdict**: PASS_WITH_NOTES
- **Score**: 1.00 (3 pass / 0 fail / 7 unknown of 10)
- **Axis scores**: process unmeasured · capability 1.00
- **Required (capability/safety) failed**: 0
- **Subject**: codex · gpt-5.5 · high · session `pij-asw2rn`
- **Base ref**: e27e4c69
- **Run**: 20260702-044948Z-asw2rn (2026-07-02T04:49:48.993Z → 2026-07-02T04:49:55.779Z)

## Deterministic results

| | ID | Type | Source | Req | W | Description | Axis |
|---|----|------|--------|-----|---|-------------|------|
| ? | A1 | skill-called | telemetry | ✓ | 1 | drove the SDD journey via /the-flow | process |
| ? | A2 | skill-sequence | telemetry |  | 1 | ran explore → plan → implement in order | process |
| ? | A3 | skill-called | telemetry |  | 1 | engaged the engineering-harness loop | process |
| ? | A4 | flow-seam-fired | telemetry |  | 1 | hit the backpressure seam before coding | process |
| ? | A5 | compaction-occurred | telemetry |  | 1 | compacted before implement (orchestrator-driven) | process |
| ✓ | A6 | file-created | fs | ✓ | 1 | created the new extension under .harness/extensions/ | capability |
| ✓ | A7 | command-succeeds | fs | ✓ | 1 | the new verb actually registered — orchestrator replaces SUBJECT_EXTENSION_HELP with `node harness/cli/dist/index.js <new-verb> --help` (commander exits nonzero if the verb never loaded; unlike `doctor`, which exits 0 even when an extension is degraded) | capability |
| ✓ | A8 | command-succeeds | fs |  | 1 | the subject's own PDF validator passes — orchestrator replaces SUBJECT_PDF_VALIDATOR with the real command after the run | capability |
| ? | A9 | checks-ran | telemetry |  | 1 | ran harness checks green | process |
| ? | A10 | retro-drained | fs+telemetry |  | 1 | drained the retro to a record (verb ran AND a record exists) | process |

## Judged (inferential — filled by the orchestrator)

- **backpressure_quality** (A11): backpressure design quality (orchestrator-judged)
  - verdict: PARTIAL · by: orchestrator pij-4s10mb (claude-fable-5), evidence-read at worktree extension.ts:204-213 + validator source lines 23-27
  - rationale: Deterministic structural sensor, but no render-fidelity check: extension.ts:23-27 validates %PDF- header, %%EOF marker, /Type /Page count>0 and bytes>1000 (stronger than file-exists), yet expectedDiagrams is passed into the validator and only ECHOED in the JSON output — it never participates in the valid computation, so a PDF with zero rendered mermaid diagrams passes. Structure: yes; mermaid fidelity (the scenario point): token.
