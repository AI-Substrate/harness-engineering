# post-flight

> Sub-skill — owns closeout artifacts and archival, not lifecycle position.

**Verb**: post-flight
**Purpose**: Close out completed work before optional shipping; preserve required evidence before any workspace can retire.
**Consumes**: plan, guide, final unit/composition/review evidence, task assertions, observations, telemetry and allocation records. Historical completed plans remain readable without new guide requirements.
**Flags**: `--plan "<plan path or folder>"`
**Produces**: `assets/post-flight.md`, archived canonical plan and preservation receipt outside retiring roots. Retirement is separate and ownership-checked.

## Procedure

1. Resolve `plan.dd.json` before historical `*-plan.md`/`*-spec.md`. An already archived plan is read-only on re-entry unless new factual evidence must be explicitly incorporated; do not silently regenerate its guide or reopen completed nodes.
2. Read all phase/task assertions, AC proof links, independent review verdict and exact composition artifact. Surface every open/blocked/deferred finding. The human may explicitly accept a limitation, but it stays named; never convert missing proof to a clean result.
3. Write the closeout note: what finished, exact tested/reviewed artifact SHA, proof pointers, open/deferred digest, remaining human calls, observations and the highest-leverage encodable improvement. Record factual completion through `node_modules/.bin/ddocs`, including the actual closeout work just done. Do not pre-check future closeout at an earlier review.
4. Verify pressure/proof links through `../backpressure-recipe.md`: `assets/backpressure.dd.json` is the survey source, AC `proven_by` points to actual execution evidence. Generated views and selected commands are not proof. Final progress must preserve material plan/guide/code bindings rather than triggering circular rebaselining.
5. For Builder-managed team work, load `../team-lifecycle.md` and use the deterministic close operation. Required evidence includes artifacts, WIP, reports, observations, telemetry and required Git refs. `--allocations` is a JSON array of `Stored<AllocationRecord>`; `--evidence` is a JSON array of `{path, category}`. The survivor must be outside every retiring root, with ownership authority likewise outside the removable workspace.

```bash
harness builder close "${PLAN}" --survivor "${SURVIVOR}" --allocations "${ALLOCATIONS}" --evidence "${EVIDENCE}"
```

6. Read the returned archive/preservation locations; do not guess relocated paths. Close archives and repairs canonical document/flow bindings. Do not run a second manual move. For a historical non-team Markdown plan only, retain its established whole-folder archival/read path; collision or missing target is a named refusal, never overwrite history.
7. Whole-plan completion is checked at **this stage's EXIT**, after closeout evidence exists. Run `harness plan validate <archived plan.dd.json> --complete`; zero errors and warnings are needed to claim a clean closeout. The parent alone moves the canonical flow through `harness builder advance`; this module never edits nav/status files. Lifecycle seam receipts belong to the parent and must be landed before relocation.
8. Retirement is explicitly separate:

```bash
harness builder tidy "${ALLOCATION}" --preservation "${PRESERVATION}"
```

It re-verifies ownership, runtime release, source drift and surviving bytes/refs immediately before removal. Idle is not closed. Externally/pij-owned allocations, live/unknown runtime, dirty/new WIP, survivor under a retiring root, missing evidence or altered preserved bytes must not be removed. Preserve buffered telemetry warnings; no claim of drained attribution without evidence.

## Exit

Report archive and surviving-evidence paths, tested/reviewed SHA, strict completion outcome, open findings and what was or was not retired. No push, PR or merge. Shipping is optional and can run later from the archive. Routing is the flow's job — run the parent flow bare to continue.
