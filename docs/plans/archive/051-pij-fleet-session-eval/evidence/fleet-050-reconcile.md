# fleet-050 retrospective — reconcile note (T005 · AC-06)

**Command** (zero live cost — reads already-captured history):

```
node harness/cli/dist/index.js telemetry get-fleet pij-4s10mb --json \
  > docs/plans/051-pij-fleet-session-eval/evidence/fleet-050.json
```

Roster-scoped variant (D1 diff demonstration):

```
node harness/cli/dist/index.js telemetry get-fleet pij-4s10mb \
  --roster .flow-pair/runs/2026-07-04-051-fleet-session-eval/run.json --json \
  > docs/plans/051-pij-fleet-session-eval/evidence/fleet-050-roster-scoped.json
```

## Reconcile vs the workshop/dossier spike

| Claim (dossier F-06 / workshop spike) | get-fleet (050-core lanes) | Match |
|---|---|---|
| children | 13 | 13 | ✅ |
| `cost.grand_total` over measured (claude) lanes | **78,814,658** | **78,814,658** | ✅ exact |
| `cost.output` over measured lanes | 852,398 | 852,398 | ✅ exact |
| measured claude lanes | 4 | 4 | ✅ |
| copilot lanes unmeasured (`tokens: null`, F-07) | 9, excluded (never zero-filled) | 9 | ✅ |

The 4 measured claude lanes (`pij-i13g2o` 35,232,032 · `pij-1s7r0mw` 24,408,986 · `pij-1t3oakg` 18,967,436 · `pij-1q4bt7w` 206,204) sum to **78,814,658** — the spike figure to the token. The 9 copilot lanes are `cost_measured: false` and are excluded from `totals.cost` (counted in `unmeasured_lanes`), so fleet cost is an honest **lower bound**.

## The one discrepancy vs the spike, explained

The **live** env-tree `get-fleet pij-4s10mb` returns **14** lanes / 102 segments, not 13/99. The 14th lane is **`pij-g7t974`** — *this very plan-051 coder session*, a copilot child spawned under the same orchestrator (`pij-4s10mb`). It is `cost_measured: false` (copilot-null) so it adds **0** to `grand_total` (which stays exactly 78,814,658) and +1 to `unmeasured_lanes`. Segment/lane counts drift upward as the 051 run keeps capturing telemetry; the committed `fleet-050.json` is a **snapshot**, and the measured claude totals are frozen (the 050 run is finished).

This is not noise — it is a **live proof of two contract properties at once**:

1. **The join reflects reality in real time** — a child that captured telemetry *minutes ago* joins the fleet with no extra wiring.
2. **D1 conflation is real, and the roster resolves it by SCOPING (not just labelling).** A parent pij id spans the orchestrator's whole life, so the env-tree superset over `pij-4s10mb` mixes the 050 run and the 051 run. The **roster-scoped** run (F1 fix) does more than annotate — it *scopes membership*: with the 051 `run.json` roster, `scope: roster`, `sessions` contains **only** the rostered children present in the env tree (here `pij-g7t974 → role: coder`), and **all totals are computed from those lanes alone**. The 13 050-era children are env-tree children absent from the 051 roster, so they land in `unrostered` (ids only — **not** in `sessions`, **not** in `totals`), and the rostered members with no env-tree capture (`pij-106t2i1` reviewer, `pij-wolk0r` validator) land in `orphans`.

## Roster scope vs env-tree scope — the numbers (F1)

| Field | `fleet-050.json` (env-tree superset) | `fleet-050-roster-scoped.json` (051 run scope) |
|---|---|---|
| `scope` | `env-tree` | `roster` |
| `sessions` | 14 lanes (13× 050-era + `pij-g7t974`) | **1 lane** — `pij-g7t974` (coder) only |
| `totals.cost.grand_total` | **78,814,658** (4 measured claude lanes) | **0** — the sole rostered lane is copilot (`tokens: null`, F-07) → `unmeasured_lanes: 1` |
| `unrostered` | `[]` | the **13** 050-era children (diff only — excluded from totals) |
| `orphans` | `[]` | `[pij-106t2i1, pij-wolk0r]` (rostered, never captured) |

The roster-scoped `grand_total: 0` is **honest, not a regression**: the 051 fleet's only captured child is a copilot lane, and copilot lanes carry `tokens: null` (F-07), so the roster-scoped cost is legitimately an unmeasured lower bound of **0** — the 78,814,658 belongs to the *050* run and is correctly **excluded** from the labelled 051 roster scope. Before the fix, that 78,814,658 leaked into the roster-scoped totals even though those lanes were reported as `unrostered` — the exact contamination F1 flagged.

## Time dimension (AC-03)

`totals.time` is non-null: `wall_clock_s ≈ 36,607` (union of lane spans) and `active_s ≈ 37,377` (sum), from `event_stream[].t` ISO timestamps (not the event-index `window`, F-08). Parallelism (active/wall) ≈ 1.02 — the 050 fleet ran largely sequentially, which is honest for that run.

## Provenance

`fleet-050.json` validates clean (0 violations) against the closed `fleet-export.schema.json` (AC-07), so the committed evidence is itself a schema-conformance witness.
