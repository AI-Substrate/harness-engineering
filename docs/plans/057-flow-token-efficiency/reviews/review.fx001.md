# FX001 flow-friction fixes review

**Verdict**: `FIX_REQUIRED`  
**Boundary**: uncommitted worktree diff from `e420978c`  
**Findings**: 1 (`HIGH`)  
**Dim-0**: proven

## Dim-0 mutation evidence

Baseline:

```text
npx vitest run test/acts/flow-auto-render.test.ts test/acts/doctor.test.ts \
  test/services/doctor/doctor-service.test.ts --root harness/cli --coverage=false
3 files / 46 tests passed
```

### Auto-render guard

Temporarily removed the `autoRenderSibling(...)` call from the successful
`runMutation` path in `harness/cli/src/acts/flow.ts`.

```text
test/acts/flow-auto-render.test.ts
1 failed / 3 passed

a successful mutation refreshes the sibling render and preserves default stdout bytes
expected rendered sibling not to equal the pre-mutation bytes
```

This proves the structural-mutation test observes the production write path rather
than merely comparing renderer output to itself.

### Doctor quiet-payload guard

Temporarily leaked complete layer objects by changing quiet `layers` from
`{name,ok}` projections to `report.layers` in
`harness/cli/src/services/doctor/doctor-service.ts`.

```text
test/services/doctor/doctor-service.test.ts
1 failed

keeps the default JSON bytes unchanged and slims only the quiet extension payload
received unexpected "detail" in the quiet layer
```

The same test also pins the default envelope with an exact `JSON.stringify(...)`
byte comparison, not a key-set assertion.

### Restoration proof

After restoring both source mutations, the focused set passed 46/46. Source and
test SHA-256 values matched their pre-mutation values:

```text
82428e9e86cec6d7d409c300735ee6488e25501acf6137bff438445231de1c0a  flow.ts
40b6635c82b8337f753337256c6373b003b5315c1d65bcf936cc69954db71188  doctor-service.ts
df1777e494e4790bd4d899dc17bf22e202077cf96d3accd2ff34e51f7abeb644  flow-auto-render.test.ts
997d4857df300aac5588c051a3150efacee38be2065a3b9154560a92e83c70e7  doctor-service.test.ts
```

The before/after `git diff --stat` snapshots were byte-identical.

## Findings

| Severity | Finding | Evidence and required fix |
|---|---|---|
| HIGH | FX001-6 is marked complete although the required repo-doc sweep is not clean. | `docs/how/telemetry-fixtures.md:178` still instructs `cd harness/cli && npx vitest run ...`, the exact stale invocation FX001-6 says to remove from in-repo docs. This is a current user-facing guide, not historical execution evidence, so the original friction remains reachable. Replace it with the root-safe targeted command (or the canonical `just test` where a full suite is intended), rerun the scoped grep, and update the dossier/log evidence before keeping FX001-6 checked. |

## Per-task verdicts

| Task | Verdict | Evidence |
|---|---|---|
| FX001-1 | PASS | Forced generated-doc drift printed `check:docs FAIL - generated docs drifted; diff follows` and exited 1; the immediately restored run printed `check:docs OK - no drift` and exited 0. |
| FX001-2 | PASS | Root `npx vitest run --coverage=false --reporter=dot` resolved through the new root config and passed the same 180 files / 2,283 tests as `just test`; `justfile` remains unchanged and still runs from `harness/cli`. |
| FX001-3 | PASS | Quiet shape is slim layers plus `{name,status,verbs}` extensions; live `doctor --json --quiet` measured 1,356 bytes. Default JSON is exact-byte pinned and human rendering remains based on the full report. |
| FX001-4 | PASS | The tier rationale uses the established absolute GitHub `blob/main/...` reference shape. `rules-of-why.md` is present in this branch history and will resolve when that history lands on `main`; no `../../../harness-foundations` target remains in the subsection. |
| FX001-5 | PASS | `create`, append-only `event`, and every common structural mutation auto-render only after the JSON write succeeds. The catch writes a warning to stderr and then preserves the normal success envelope/exit. Read verbs do not call the helper; `render` remains read-only under `--check` and idempotent otherwise. The frozen `flow-quiet.test.ts` is absent from the diff. |
| FX001-6 | FAIL | The explicit doc-wide stale-invocation condition is false at `docs/how/telemetry-fixtures.md:178`; the `[x]` status and completion log overstate the result. |

## Validation

- `just test`: 180 files / 2,283 tests passed.
- Root `npx vitest run --coverage=false --reporter=dot`: 180 files / 2,283 tests passed.
- `node harness/cli/bin/harness.js checks`: exit 0; all hard gates passed.
- Pre-existing warn-tier only: architecture 2, Markdown 199.
- An initial concurrent launch of both full suites caused the same subprocess-heavy
  docs integration test to exceed its 5-second timeout in each run. The isolated
  test passed 2/2, then both full suites passed when rerun sequentially.

**Addendum (targeted re-check)**: `docs/how/telemetry-fixtures.md:178` is now root-safe and the scoped live-guide grep is clean; the HIGH is resolved and the verdict is updated to `APPROVE` with 0 findings.
