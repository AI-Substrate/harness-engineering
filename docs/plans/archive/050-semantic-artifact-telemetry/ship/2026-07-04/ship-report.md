# Ship report — 050 semantic-artifact-telemetry
**Date**: 2026-07-04 · **Branch**: feat/041-flow-conformance-eval · **Mode**: branch-ship (no PR — rides the shared eval branch per user directive)

## What shipped
- `artifact` event kind + 10-extractor registry (`artifact-semantics.ts`), change-triggered in the telemetry capture window; full serializer + OTLP round-trip; closed schema-enumerated key unions; rollup-excluded.
- Commits: cf28e3aa (implementation, flow-pair built + reviewed) · 13c085eb (retro drain + flow state).

## Checks
| Check | Status |
|---|---|
| harness checks (hard gates) | green (exit 0) |
| artifact-semantics tests | green (55) |
| reconstruction round-trip | green |
| capture integration | green |
| orchestrator re-run (73 tests) | green |

Pre-existing warn-launch degradeds (arch-check, markdown-lint) unchanged — not from this work.

## Review
flow-pair: opus-4.8 coder (xhigh) + gpt-5.5 reviewer (xhigh); FIX_REQUIRED (F1 regex, F2 open key maps, F3 inventory gaps) → fix round → narrow re-review **APPROVE** with Dim-0 mutation evidence; orchestrator sanity pass re-verified.

## Post-ship evidence
First-light showcase: `scratch/evals/2026-07-04-artifact-semantics/001-artifact-semantics-showcase.html` (312 artifacts extracted; known gap DL-001 recorded).
