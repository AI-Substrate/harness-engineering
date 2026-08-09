# Validation — phase-2/tasks.dd.json

- **Validated**: 2026-08-09T04:16:00Z
- **Target**: `docs/plans/080-dd-consume-upgrade/assets/tasks/phase-2/tasks.dd.json` (`adbd63781c8d0a2187d2ad245423275972e4bddf`, commit `b2794645`)
- **Contract sources**: phase-2 `context.md`; dated `prediction.md` at `51558dbc`; `plan.dd.json` AC-0002..AC-0005; `backpressure.dd.json`; workshop 001 D-3; installed `@ai-substrate/dd` at `a37a20ec`
- **Checks**: in-tree `dd validate` (0 errors/warnings); in-tree `plan validate` (0 errors/warnings); task/backpressure `dd build --check` (no drift); git prediction-order proof; installed package exports/declarations inspection; task-edge extraction
- **Verdict**: NEEDS ATTENTION
- **Thesis / proof**: partial — the dossier preserves an outcome-neutral trial and correct completion edges, but its acceptance assertions do not yet prove every sufficient verdict or enforce D-3 reliably; Implementation target -> incomplete Implementation evidence
- **Consumers**: phase-2 implementer and OQ-2 verdict consumer are blocked on 3 assertion fixes; `tk-0009 -> ac-0002` and `tk-000a -> ac-0004/ac-0005` are the only genuine `satisfies` edges, as required

## Findings

| Severity | Finding | Evidence | Status |
|---|---|---|---|
| HIGH | Final-sufficiency proof is prediction-biased: an at-risk primitive that flips to sufficient can pass with prose rather than test-first falsifier evidence. | `dw-000c` requires RED-before-implementation evidence only for “SUFFICIENT-predicted” primitives, excluding prediction rows 5–6; `dw-0012` then accepts a bare “named falsifier + RAN”. This conflicts with the plan testing strategy and phase deliverable requiring a failing falsifier for each primitive before it is called sufficient. | Open — require all nine falsifiers before implementation and link each final sufficient verdict to test id, RED commit, command, and result. |
| HIGH | The D-3 no-shim/no-redeclared-vocabulary assertion is not a sound runnable guard. | `dw-000f` gives no concrete grep expression and scopes only the new module: a later public import named `BUILTIN_RELS` would match, while renamed literals or a copied tuple in a helper file would evade it. `dw-0013` adds a tree-wide claim but no executable probe, and runs only on an insufficient verdict. | Open — add a deterministic repository check over the implementation's transitive local closure that permits public package imports but rejects local vocabulary declarations/copies and shims on every outcome. |
| HIGH | The linked pressure row directs the implementer to update the frozen digest even though phase 2 forbids changing the frozen fork. | `bp-000d` says the `FROZEN_DIGEST` pin is “updated DELIBERATELY”; phase-2 hard rule 1 requires `services/dd/plan/semantics.ts` to remain byte-pinned, and `dw-000e` requires the existing pin to stay green. | Open — rewrite `bp-000d` to require the frozen file/digest to remain unchanged and green while separately proving falsifier RED-to-GREEN chronology. |
