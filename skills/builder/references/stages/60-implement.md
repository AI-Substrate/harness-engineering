# implement

> Sub-skill — owns implementation and its evidence, not flow position.

**Verb**: implement
**Purpose**: Implement exactly one approved phase/subtask using the reviewed guide and selected proof; deliver a genuinely exercised composed artifact.
**Consumes**: product plan, reviewed `assets/impl-guide.dd.json`, `assets/backpressure.dd.json`, phase tasks and explicit implementation authorization. Completed historical plans retain their original read path.
**Flags**: `--plan "<path>"` · `--phase "<Phase N: Title>"` · `[--subtask "<ORD-slug>"]`
**Produces**: source, applicable behavioral checks, committed deliveries, composition evidence and execution receipts. Canonical plan/task/guide/receipt writes belong to the PM; workers return evidence, not cursor changes.
**Delegates**: progress, the per-task recording protocol.

## Procedure

1. Read product ACs, the guide's contracts/waves/ownership, the selected proof approach and actual task assertions. No code before architectural uncertainty that prevents independent work is resolved. Domain mode stays opt-in; when enabled enforce placement/dependency direction and update affected domain contracts/composition documents.
2. For new team work, load `../team-lifecycle.md`. Before workers, the PM implements and commits the baseline contract unit, executes its declared checks, records independent decomposition review and seals with `harness builder contracts <plan> --seal --review <receipt>`. `harness builder ready <plan> --unit <id>` must actually report ready. A checked guide is not a sealed code baseline.
3. Resolve requested settings through `harness builder settings`. For `coders`, dispatch isolated units using frozen contracts, not sibling implementations. Follow the two exact `AckReceipt` identities in `../team-lifecycle.md`, both ingested through `harness builder ack <plan> --receipt <path>`:
   - Pre-work: `ack-<unit_id>-<full-current-source-sha>`, nonce `packet.nonce`; observe the pristine source and native relative packet/canary/root/runtime before explicit release.
   - After seeing the exact release: natively re-read packet/canary and refresh observations; emit a new `ack-<unit_id>-<full-current-source-sha>-release` with nonce from the retained `release.message_id`, actual creation time and a new private path. Send path/SHA-256, then follow the already-granted scope without waiting for a second grant. Unsupported runtime fields stay absent with gaps; the explicit 5000 ms peer-clock skew limits in the lifecycle contract are not permission to backdate a receipt.
   - The PM ingests the fresh confirmation before importing queued deliveries. Confirmation records receipt of the release; it grants/sends nothing. Do not repeat pristine-HEAD checks after authorized work, retry the initial ack to promote queued delivery, or replay completed work merely to confirm its retained release. For `solo-pm`, keep implementation with the PM; never claim this substitutes for requested independent/cross-model review.
4. Execute the chosen testing approach, not an assumed TDD ceremony: TDD when selected; targeted behavior checks for a changed contract; actual CLI/UI/runtime smoke for experienced behavior. Deterministic injected fakes isolate external systems without pretending they were contacted. Every test defends an observable contract, transition, boundary or real error.
5. Follow the declared write fence. A new dependency or contract change that breaks frozen consumers returns to the PM for review/rebaseline; do not silently adjust siblings or edit deployed skills/settings. Keep working source separate from canonical team state.
6. After each task, follow the progress module. Record actual command/cwd/exit/output/subject evidence and links; then the PM updates assertion state and task/AC receipts with `node_modules/.bin/ddocs`. Use `../backpressure-recipe.md`: assertion `pressure` and AC `proven_by` point to real records in `assets/backpressure.dd.json` and `assets/execution-log.dd.json`. Unrun tests and BUILD proposals remain unproven.
7. Workers commit only their source/test fence and return `UnitDelivery` plus evidence/friction. Once release delivery is confirmed through the existing ack command, the PM imports via `harness builder compose <plan> --import <deliveries.json>`, wires the explicit composition root, regenerates owned outputs and commits. Then `harness builder compose <plan> --verify <exact SHA>` exercises that committed artifact. Importing or passing isolated unit tests is not composition proof.
   PM integration edits outside its guide map produce file/owning-unit warnings, not refusals. No amendment or justification is needed. Include `composition.value.warnings` in the independent review inputs; genuine integrity and check failures remain failures.
8. Report every scoped criterion disposition and remaining risk. Independent composition review targets the exact verified SHA and current plan/guide basis. A changed artifact needs fresh proof/review. Stop at the phase boundary; the parent chooses and records the next lifecycle position.

## Progress and friction

Task truth lives at `assets/tasks/phase-N/tasks.dd.json`, not a manually edited table. Leave unproven assertions unchecked or blocked; `in_progress` is narrative/execution context, not a fabricated DD terminal state. Record failure receipts as failures. `checked|human-skipped|na` are gate-terminal; only a human may authorize a skip.

```bash
TASKS="${PLAN_DIR}/assets/tasks/phase-N/tasks.dd.json"
node_modules/.bin/ddocs set "${TASKS}#done_when/tk-XXXX/dw-XXXX/state" checked
node_modules/.bin/ddocs set "${TASKS}#tasks/tk-XXXX/receipt" "<real evidence pointer>"
harness plan validate "${PLAN_DIR}/plan.dd.json" --address "${TASKS}#tasks"
```

Set checked only after the corresponding assertion has been exercised. The PM maintains derived task/phase accounting; a worker with a read-only canonical fence reports the evidence instead of executing these writes. Generated `.dd.md` siblings are never edited.

Capture hard environment walls/proof gaps when they bite (`harness observe`, or the packet's allowed friction report); fix a small owned root cause, otherwise name the next action. Preserve `Deferred` and `Noteworthy` discoveries for review/ship. The second objective is an encoded improvement candidate, not unrelated scope expansion.

## Exit

Return committed source paths/exports, actual checks and results, AC dispositions, composition SHA, open findings, friction and one encodable improvement. Do not claim full delivery from a compiling scaffold or replace requested independent review with self-review. Routing is the flow's job — run the parent flow bare to continue.
