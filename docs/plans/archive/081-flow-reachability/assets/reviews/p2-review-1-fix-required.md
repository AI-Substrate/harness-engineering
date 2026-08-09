FIX_REQUIRED

Dim-0 mutation evidence

- Mutation: `harness/cli/src/services/flow/reachability.ts:323`; changed the verdict guard from `!plan.clause.validates` to `plan.clause.validates`.
- RED representative:

```text
FAIL  test/services/flow/reachability.test.ts > ac-0004 — both good: plan validates AND the flight plan reads back > is ok, with both clauses positive and nothing excluded
AssertionError: expected 'error' to be 'ok' // Object.is equality

Expected: "ok"
Received: "error"

 ❯ test/services/flow/reachability.test.ts:115:25
```

- RED tail:

```text
 Test Files  1 failed (1)
      Tests  16 failed | 3 passed (19)
   Start at  13:18:47
   Duration  592ms (transform 435ms, setup 0ms, import 487ms, tests 9ms, environment 0ms)
```

- Restored the guard and reran both targeted files GREEN: 2 files, 30 tests passed.

Findings

1. HIGH — `harness/cli/src/services/flow/reachability.ts:147-153,206-225`
   - Claim: a failed child that prints any parseable JSON object can be accepted as a validating plan.
   - Proof: `parseEnvelope` accepts `{}` as an envelope; with no status and no error count, line 225 computes `validates=true`, while non-timeout `result.code` is ignored. A temporary reviewer probe scripted exit 127 + stdout `{}` + a good flow and expected error; it returned `ok`:

```text
FAIL ... a parseable non-envelope from a failed child is an ERROR, never a silent pass
AssertionError: expected 'ok' to be 'error' // Object.is equality
Expected: "error"
Received: "ok"
 Test Files  1 failed (1)
      Tests  1 failed | 19 skipped (20)
```

   - Smallest fix: reject nonzero child exits (except only deliberately supported status/exit combinations) and validate the envelope discriminator/required shape before reading counts. Add the failed-child + `{}` regression test.

2. BLOCKER — frozen-surface gate
   - Claim: the packet makes any `docs/plans/**` hit automatic `FIX_REQUIRED`.
   - Proof: reviewer rerun of `git diff --name-only -- ... docs/plans` returned:

```text
docs/plans/081-flow-reachability/friction-log.md
docs/plans/081-flow-reachability/plan.dd.json
docs/plans/081-flow-reachability/plan.dd.md
docs/plans/081-flow-reachability/the-flow.json
docs/plans/081-flow-reachability/the-flow.md
```

   - Smallest fix: separate/land the PM-owned plan metadata changes so the phase-2 review diff has no frozen-path hits, then rerun this gate.

Other mandatory dimensions

- Contract fidelity: PASS for verdict composition, four distinct E301/E308/E300/E306 reasons, both-artifact examined/excluded arrays, default `<planDir>/the-flow.json`, override resolution, and the missing-flow bare create line.
- Seam separability: PASS. Imports are adapters/output/shared/flow-service only; no acts, commander, registration, or envelope formatter; returns typed data.
- RED-first honesty: PASS. The coder report has an import-level RED followed by a behavioural stub RED (27 failed / 3 passed) with Vitest-formatted failure detail and a pre-final line number; it reads as observed output, not reconstructed prose.

Reviewer gates

```text
✓ test/services/flow/reachability.test.ts (19 tests)
✓ test/services/flow/reachability-real-cli.test.ts (11 tests)
Test Files  2 passed (2)
Tests  30 passed (30)
Duration  4.90s
```

`git diff --check` on the scoped implementation/tests passed. Registration/commander search returned no matches.
