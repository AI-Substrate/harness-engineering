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
3. Resolve requested settings through `harness builder settings`. For `coders`, dispatch isolated units with shared interfaces that make independent work possible. Lead each briefing with owned paths, mapped read paths/owners, the job/interface and observable done conditions; then supply the canonical packet pointer/digest. For a new dispatch, receiving that work packet starts the unit without a separate release. The worker may run `harness builder self-check <packet> --sha256 <digest>` once for warning-only root/source/digest orientation; it writes no state and supplies no import prerequisite. Preserve historical receipts without replaying or reclassifying them. For `solo-pm`, keep implementation with the PM; never claim this substitutes for requested independent/cross-model review.
   For an already-running worker use `harness builder dispatch <plan> --unit <id> --workspace <existing-root> --parent <pm-id> --adopt-peer <peer-id>`, retaining kind/role controls. Bind the actual native peer without spawning, resetting or granting new work. Preserve original adopted ownership/authority, sealed source ancestry, progressed HEAD and WIP; seed only missing metadata. Binding does not attest provider identity or waive missing/mismatched evidence.
4. Execute the chosen testing approach, not an assumed TDD ceremony: TDD when selected; targeted behavior checks for a changed contract; actual CLI/UI/runtime smoke for experienced behavior. Deterministic injected fakes isolate external systems without pretending they were contacted. Every test defends an observable contract, transition, boundary or real error.
5. Use write/read maps as guidance for coders and PM, not mandatory source fences. Out-of-map edits need no approval or justification. A contract change that breaks frozen consumers still needs coordination and reviewed new bindings; never rewrite evidence or silently break another unit. Keep working source separate from canonical team state. Global/deployed changes, unrelated workspaces, changes on main, push/PR/merge and destructive actions require their own user authorization.
6. After each task, follow the progress module. Record actual command/cwd/exit/output/subject evidence and links; then the PM updates assertion state and task/AC receipts with `node_modules/.bin/ddocs`. Use `../backpressure-recipe.md`: assertion `pressure` and AC `proven_by` point to real records in `assets/backpressure.dd.json` and `assets/execution-log.dd.json`. Unrun tests and BUILD proposals remain unproven.
7. Workers commit the actual task changes, preserving unrelated work, and return `UnitDelivery` plus evidence/friction. The PM imports via `harness builder compose <plan> --import <deliveries.json>`; import enforces current packet/dispatch/allocation bindings, actual checkout/branch/commit, distinct peer attribution and sealed-source ancestry, not startup receipts or transport outcomes. Report the cause and correction for any integrity failure; never relabel evidence to bypass it. Then wire the explicit composition root, regenerate outputs and commit. `harness builder compose <plan> --verify <exact SHA>` exercises that committed artifact. Importing or passing isolated unit tests is not composition proof.
   Ownership-only guide findings and coder/PM map deviations produce visible `file`/`owning_unit`/`stage` warnings, not refusals. Include `composition.value.warnings` in independent review; genuine malformed data, filesystem/Git integrity and executable-check failures remain failures.
   If all supplied deliveries are already integrated, add `--already-integrated` to `compose --import`, never to `--verify`. Compare every unit's frozen map projection to current committed PM HEAD, using actual delivery-touched paths only when no concrete mapped paths exist; empty scope is missing proof. Equality includes modes, object types, Git object IDs and absence. Preserve original worker SHAs and do not reapply changes. Digest/tree mismatch remains a failure; map deviations warn. This receipt proves scoped tree equality, not product behavior, so committed `compose --verify` and independent review still follow.
   Verify seal digests against original committed blobs, not current PM working bytes. PM edits to baseline paths reach current composition checks; they do not require restoring historical source. Factual `implementation_summary` and state/proof progress are not product-intent changes. Keep genuine material-intent, seal-integrity and post-composition artifact-drift failures distinct.
8. Report every scoped criterion disposition and remaining risk. Independent composition review targets the exact verified SHA and current plan/guide basis. A changed artifact needs fresh proof/review. Stop at the phase boundary; the parent chooses and records the next lifecycle position.

Optional at any point: `harness builder on-track <plan> [--unit <id>] [--from <ref>] [--to <ref>] [--untracked]`. It uses the automatic comparison without readiness, seal, review or receipt prerequisites and writes nothing, even on main. Exit 0 is advisory: show `compared`, warnings, actionable issues and selected basis/full SHAs. A named unit compares all touched committed paths (including reverted writes); otherwise compare PM endpoint changes. Default includes tracked staged/unstaged work; explicitly add `--untracked` for new paths. Explicit `--to` is committed-only. `--from` chooses the basis; otherwise PM prefers imported integration, then sealed source, then HEAD; a unit uses sealed source or HEAD. Malformed basis evidence yields issues, not fallback; unavailable comparison returns `compared: false`.

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
