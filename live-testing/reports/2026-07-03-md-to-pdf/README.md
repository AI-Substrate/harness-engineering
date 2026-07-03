# Eval collation — md→PDF scenario · 2026-07-03

Four batches on the same task (validated markdown→PDF harness
extension with rendered mermaid). Batch 1 = fully blind (ambient adoption,
base `v0.6.0`); batch 2 = `/the-flow` mandated (fidelity + stage economics,
base `c159d3d6`); batch 3 = `/ponytail full` mandated (disciplined minimalism,
same base as batch 2).

## Read first

- `001-blind-eval-report.html` — **batch-1 report** (blind): verdicts, gait chart, insights.
- `002-flow-eval-analysis.html` — **batch-2 report** (flow-mandated): stage economics,
  the price of process (×2.4–3.4 credits), conduct matrix, instrument findings.
- `003-pony-eval-report.html` — **batch-3 report** (ponytail-mandated): the cost
  triangle across all three doctrines (×0.40–0.86 of blind credits), the
  harness-usage watch (loop died 0/4, sensors survived model-dependently),
  validator quality spread, DL-005.
- `004-ponytail-harness-report.html` — **batch-4 report** (ponytail + explicit
  harness carve-out, 3 Copilot subjects): loop restored 3/3 at ×1.6–1.9,
  mandates compete for budget (gpt dropped its test, opus added deps).
- `005-rollup-report.html` — **THE SHAREABLE ROLLUP**: one task, four
  doctrines, 15 runs — grand cost table, conduct matrix, five findings,
  methodology + honest limits.

> Tracked copy of the analysis write-ups (001–005). The full collation —
> run-report snapshots, per-subject extension sources, preserved records —
> lives in the (gitignored) working folder `scratch/evals/2026-07-03-md-to-pdf/`;
> the committed sources of truth are `.harness/live-testing/<scenario>/` (run
> reports + ledgers) and `live-testing/scenarios/` (scenarios).

## Contents (of the scratch collation)

- `run-reports/batch1-md-to-pdf/` — scored run reports + append-only ledger
  (6 runs incl. 1 superseded). Snapshot of `.harness/live-testing/md-to-pdf/`
  (that tree is the committed source of truth; this copy is for browsing).
- `run-reports/batch2-md-to-pdf-flow/` — 4 runs, judged fields filled 6/6.
  Snapshot of `.harness/live-testing/md-to-pdf-flow/`.
- `run-reports/batch3-md-to-pdf-ponytail/` — 4 runs, judged 6/6.
  Snapshot of `.harness/live-testing/md-to-pdf-ponytail/`.
- `artifacts/pony-<subject>-extension/` — each batch-3 subject's extension
  source (opus's was never committed; preserved from its working tree).
- `artifacts/<subject>-050-plan/` — each batch-2 subject's flight plan +
  stage artifacts (the-flow.json, dossier, plan, validations, reviews, ship),
  preserved before worktree teardown.
- `artifacts/<subject>-extension/` — each subject's md→PDF extension source.
- `insights/` — batch-1 reporting-pipeline outputs: per-model session exports,
  the 4-column report board (`reports/index.html`), WS001 insights
  (`insights-out/index.html`).

## Method / provenance

- How the eval works: `docs/how/flow-conformance-eval.md` (+ the plain-language
  `flow-conformance-eval-explainer.html` beside it).
- Scenarios: `live-testing/scenarios/md-to-pdf{,-flow}/`.
- Telemetry: `refs/harness-telemetry/2026/07/03/*` (all 8 subject sessions +
  orchestrator).
- Orchestrator session: `pij-4s10mb` (Claude Fable 5), 2026-07-03.
