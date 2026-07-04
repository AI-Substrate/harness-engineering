# Review — 052 Phase 1

**Verdict**: FIX_REQUIRED

## Findings

### F1 · MAJOR · malformed side-channel ledgers become orphans instead of unmeasured lanes

**File**: `harness/cli/src/services/telemetry/fleet-evidence.ts:433-454`, `harness/cli/src/services/telemetry/fleet-evidence.ts:559-573`

**Claim**: The Phase 1 honesty invariant says a shape-mismatched side-channel should degrade the rostered lane to `cost_measured:false`, never disappear from lane accounting. The pure readers do degrade malformed shapes to `measured:false` (`copilot-ledger.test.ts:64-67`, `codex-ledger.test.ts:60-65`), but fleet wiring converts that state into `return null` (`buildLedgerLane` lines 435 and 454). `enrichOrphans` then keeps the roster member in `orphans` instead of adding a lane (`lines 572-573`), so `sessions[]` and `totals.cost.unmeasured_lanes` omit a known rostered member with a malformed ledger.

**Proof**: A rostered Copilot/Codex member with a descriptor and no live/ref telemetry but a malformed shutdown/rollout file follows: reader returns `measured:false` → `buildLedgerLane(...)` returns `null` → `remaining.push(pijId)` → totals are recomputed without that member. That contradicts the documented surface in `docs/how/telemetry.md:278-281` ("stays `cost_measured:false` ... counted in `unmeasured_lanes`") and the packet's mandatory honesty check.

**Smallest fix**: Distinguish "source unavailable/no descriptor/no side-channel path" from "source present but malformed/unmeasured". For the latter, produce a roster-scoped lane with `source:"ledger"`, `cost_measured:false`, `tokens:{grand_total:0,output:0}`, no billing, and empty evidence; add a fleet-level negative test proving `sessions[]` contains it and `unmeasured_lanes` increments.

## Dimension notes

- **D0 test quality / mutation gate**: PASS. I manually mutated `harness/cli/test/services/telemetry/fixtures/lane-sources/copilot/coder-34524328.events.jsonl` so the coder fixture's top-level `totalNanoAiu` was `0`. `cd harness/cli && npx vitest run test/services/telemetry/fleet-golden-051.test.ts --coverage=false` failed non-vacuously at `fleet-golden-051.test.ts:174`: expected `1742858875000`, received `0`. After restoring the fixture, the same targeted test passed 9/9. This proves the golden AIC number is parsed through `extractCopilotLedger`/`getFleetEvidence`, not compared to itself.
- **Honesty invariants**: FAIL due F1. Reader-unit negatives exist and are live, but fleet-level degradation does not produce an unmeasured lane.
- **Privacy / counts-only fixtures**: PASS. The 11 lane-source fixtures are scrubbed to ids/counts/placeholders; `fixture-privacy-scan.test.ts:259-279` recursively scans `fixtures/lane-sources`.
- **Closed schema**: PASS. `fleet-export.schema.json` remains closed (`additionalProperties:false` on fixed objects), and `fleet-golden-051.test.ts:219-230` proves an unenumerated `billing.leaked_usd` key is rejected.
- **T001 adapter fix**: PASS. Copilot `create`/`edit` paths are captured without bodies (`copilot-adapter.ts:276-282`, `358-370`) and serialized through the shared repo-relative/out-of-repo basename confinement in `segment.ts:250-258`.
- **T002 classifier**: PASS. Packet files match no extractor and the real review still extracts `FIX_REQUIRED` with `{findings_critical:1}` (`artifact-semantics.test.ts:102-124`).
- **Lane discipline**: PASS. The commit touches telemetry src/tests, `telemetry get-fleet` act wiring, generated docs content, `docs/how/telemetry.md`, and the 052 task/evidence files only.
- **Arch-check degrade**: ACCEPT AS WARN-ONLY NOTE. The new warning is `ref-source.ts -> adapters/git/git-write-port.ts` for value-importing `TELEMETRY_REF_GLOB`; there is already the same warn-only pattern in `sync-service.ts`. It is not a blocker here, but the constant should eventually move to a neutral shared module if the rule is promoted.

## Checks observed

- `harness checks`: exit 0, status `degraded` (`tests`, `biome`, `typecheck`, `check:docs`, `check:flows`, `check:telemetry-fixtures`, `check:doctrine-parity`, `skills-check`, `windows-check` ok; `arch-check` and `markdown-lint` warn-only degraded).
- Targeted restored mutation check: `cd harness/cli && npx vitest run test/services/telemetry/fleet-golden-051.test.ts --coverage=false` passed 9/9.
