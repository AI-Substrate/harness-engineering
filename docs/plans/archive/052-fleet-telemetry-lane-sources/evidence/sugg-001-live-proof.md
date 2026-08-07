# SUGG-001 live proof — ledger join survives `pij close`

**Date**: 2026-07-05 · **Commit under test**: `7c4a7fe3` (descriptor-independent roster fallback)
**Why**: the unit tests proved the logic; this is the end-to-end confirmation on a real
torn-down fleet with real vendor shutdown ledgers — the thing the 052 run itself could
not produce (it tore down before snapshotting, with a pre-fix pijId-only roster).

## Setup

- Orchestrator: `pij-4s10mb` (this claude session).
- Two spawned peers, **copilot / gpt-5.5**: `pij-xxwxl2` (coder role), `pij-dulfq7` (reviewer role).
- Each ran one tiny real turn (a one-line haiku) → non-zero AIC, so the `session.shutdown`
  ledger carries cost. Pane footers showed 11.5 AIC (A) / 33.5 AIC (B).
- A **fresh** `run.json` roster was written carrying each peer's `harnessSessionId`
  (from the descriptor's `plannedHarnessSessionId`, which matched the live
  `~/.copilot/session-state/<uuid>/` dir).

## Teardown, then snapshot (the exact failure scenario)

1. `pij close` both peers → **descriptors deleted** from `~/.pij` (confirmed absent),
   panes killed, `session.shutdown` written (2 shutdown events per `events.jsonl`).
2. `harness telemetry sync` (flush the orchestrator's own buffer).
3. `harness telemetry get-fleet pij-4s10mb --roster <run.json> --json`.

## Result — 3/3 measured, 0 orphans

```
status: ok | scope: roster
orphans: []
  pij-4s10mb   orchestrator  source=ref     cost_measured=True
  pij-dulfq7   reviewer      source=ledger  cost_measured=True  AIC=33.5
  pij-xxwxl2   coder         source=ledger  cost_measured=True  AIC=11.5
measured_lanes: 3 | unmeasured_lanes: 0
```

Both copilot lanes resolved `source: ledger`, `cost_measured: true` **entirely through
the `run.json` `harnessSessionId` fallback** — their pij descriptors no longer existed.
Recovered AIC matches the live pane readouts. Pre-fix, both would have been `orphans`.

## Side observation (pij lane, not this repo)

The peers' descriptors stayed `lifecycle: pending` and never promoted
`plannedHarnessSessionId` → `harnessSessionId`, so pij 031's `pij sessions --json`
reported the join id as `null` despite the copilot sessions being genuinely bound and
running. The authoritative id was read from `plannedHarnessSessionId` instead (what
flow-pair captures from the bind message anyway). Worth a note to the pij owner: the
copilot bind-confirmation lag makes `pij sessions --json` unreliable as a *live* join
source until the descriptor promotes.
