# Plan 057 T+3 Week Telemetry Tripwire

**Purpose**: Re-enter after deployment, pull wild telemetry, and compare capture health separately from directional token economics. The `tripwire-review` excursion already sits off `ship`; do not add another node.

## Re-entry procedure

Run from the repository root. Keep generated evidence in `scratch/`; the committed baseline remains `baseline/`.

```bash
MONTH=2026-07
OUT="scratch/057-tripwire/${MONTH}"

git fetch origin '+refs/harness-telemetry/*:refs/harness-telemetry/*'
mkdir -p "$OUT/reports"

harness telemetry sweep --month "$MONTH" --out "$OUT/sweep" --no-html
for session in "$OUT"/sweep/sessions/*.session.json; do
  id="$(basename "$session" .session.json)"
  harness telemetry report "$session" --no-html --out "$OUT/reports/$id.report.json"
done
harness telemetry insights "$OUT/reports" --out "$OUT/insights"
```

Record the ref count and artifact paths with the review:

```bash
git for-each-ref --format='%(refname)' refs/harness-telemetry/ | wc -l
jq '{scope, flow_stage: .rollups.flow_stage, provenance: {
  flow_stage_mechanism: .provenance.flow_stage_mechanism,
  token_coverage: .provenance.token_coverage
}}' "$OUT/sweep/$MONTH.report.json"
jq '.sections[] | select(.id == "stage_economics")' "$OUT/insights/insights.json"
```

## Evidence class A — capture health (deterministic)

Compare the wild report with `baseline/sweep-2026-07/2026-07.report.json`.

| Signal | Read from | Interpretation |
|---|---|---|
| Mechanism counts | `provenance.flow_stage_mechanism` | `flow_log` or `flow` windows show real stage markers; `unlabeled` is declared absence |
| Marker density | `(flow + flow_log) / scope.session_count` | Window density per session; compare directionally with the baseline value, not as an event count |
| Token coverage | `provenance.token_coverage` | Measured vs unmeasured sessions; never treat unmeasured as zero |
| Stage presence | `rollups.flow_stage.entries` | Multiple semantic stages show that capture spans more than one journey step |

Capture health is about whether the measurement substrate worked. Report the raw counts and ratios; do not infer productivity from them.

## Evidence class B — directional outcome (non-normalized)

Compare `insights/insights.json` section `stage_economics` and the aggregate `rollups.flow_stage.entries` with the baseline.

| Comparison | Read |
|---|---|
| Stage windows | `values.windows` / `flow_stage.entries[].count` |
| Active time | `values.active_s` / `flow_stage.entries[].time_s` |
| Fresh sent/received | `values.sent`, `values.received` / entry token fields |
| Stage mix | semantic `research`, `plan`, `implement`, `review`, `ship` rows |

These deltas are **non-normalized**: task size, model, cache state, journey shape, and the three plan-057 interventions are confounded. State “directionally higher/lower” with the observed values; do not claim causation or a productivity rate.

## Delegation interpretation

Delegation impact remains unmeasured or low-confidence unless the side channels are joined:

- Native Agent-tool work reports `subagent_tokens` / `grand_total`; it is separate from parent `tokens.total` and stage rows.
- pij peers are separate sessions; join the fleet with `harness telemetry get-fleet <root-pij-id> --json` (or the roster-scoped form when the orchestrator supplies the ledger path).
- A delegation-heavy session and a flat session are not commensurate from parent turn totals alone.

## Decision table

Verdict each evidence class independently, then write one combined note.

| Capture-health verdict | Condition |
|---|---|
| **Worked** | Real `flow`/`flow_log` windows exist, multiple stages render, and token coverage is declared |
| **Partial** | Markers exist but stage spread or measured token coverage remains thin |
| **Regressed** | New wild sessions are predominantly unlabeled, expected stage rows disappear, or coverage worsens materially |

| Directional-outcome verdict | Condition |
|---|---|
| **Worked** | Stage-economics values move in the intended direction across comparable work, with confounders stated |
| **Partial** | Values are mixed, sample size is thin, or delegation prevents a commensurate comparison |
| **Regressed** | Comparable work moves materially against the intended direction and capture health is sound |

If capture health is Partial or Regressed, do not use outcome deltas as evidence of the intervention. If capture health Worked but outcome is Partial, preserve the measurement and revisit after another wild cohort.
