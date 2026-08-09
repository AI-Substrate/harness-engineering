# Backpressure Coverage — Flow reachability (081)

**Plan**: [plan.dd.md](../plan.dd.md) (dd-native)
**Basis (plan SHA-256)**: 4df59d8e761cc40d772c8f58f361ca3998b7843ced8fcd56de680b24f1e6cc0a
**Generated**: 2026-08-09
**Certainty**: Partial

> Advisory only. Never blocks, never gates, no scores.
> Selection, not enforcement. **The dd-native source of truth is
> [backpressure.dd.json](./backpressure.dd.json)** — its rows are linked from every
> acceptance criterion's `pressure` field in plan.dd.json; this markdown is the
> human-register rendering per the survey module's artifact contract.

## Existing Sensors (inventory)

| Sensor | Paved command | Dimension | Found in |
|---|---|---|---|
| vitest suite (423+ tests) | `just test` | behaviour | harness/cli |
| biome lint/format | `just fix` | maintainability | root |
| typecheck | `npx tsc --noEmit -p harness/cli/tsconfig.json` | maintainability | harness/cli |
| harness checks (11 sub-gates) | `node harness/cli/bin/harness.js checks` | behaviour | .harness/extensions/checks |
| plan/dd validate | `… plan validate <dir> --complete` | behaviour | harness/cli acts |

## Coverage Matrix (mirror of backpressure.dd.json#rows)

| Criterion | Phase | Mode | Tier | Selected proof |
|---|---|---|---|---|
| Bare flight-plan create, no skill (ac-0001) | 1 | BUILD | computational | BUILD→RUN: phase-1 vitest spec; then `just test` |
| RED on 098+099 shapes pre-impl, error/1 post (ac-0002) | 2 | BUILD | computational | BUILD→RUN: red-first specs; then `just test` |
| plan-ok + flow-missing → warning/0 (ac-0003) | 2 | BUILD | computational | BUILD→RUN: verdict spec; then `just test` |
| both-good → ok/0 (ac-0004) | 2 | BUILD | computational | BUILD→RUN: verdict spec; then `just test` |
| examined/excluded counts; 4 distinct flow-failure reasons (ac-0005) | 2 | BUILD | computational | BUILD→RUN: envelope specs; then `just test` |
| plan validate/ready parity + frozen surfaces (ac-0006) | 2 | EXTEND | computational | EXTEND→RUN: parity spec into existing suite; then `just test` |
| docs + all repo gates green (ac-0007) | 3 | EXISTS | computational | RUN: `node harness/cli/bin/harness.js checks` |
| contract + ermine handoff accepted (ac-0008) | 3 | ABSENT | human-judgement | — (residue: committed contract + pij spine receipt) |

## Certainty: Partial

Counts (behaviour/architecture rows): 1 RUN · 1 EXTEND · 5 BUILD · 1 ABSENT
Recommended next move (advisory): the BUILD gaps ARE the plan — phases 1–2 exist to build
these proofs red-first (TDD is the ruled testing strategy), so: start building, tests first.
No separate Phase 0 is needed: this plan's phase 1 *is* the sensor-building phase.

## Closing Verdict

How will we know this work is actually done? Mostly by commands, and that is by design —
this plan's whole product is a new deterministic check, so five of the eight promises are
proved by the very tests the plan builds first (they must be seen failing before the code
exists — if a check has never failed, it has only been demonstrated, not tested). One
promise — that we broke nothing for the neighbouring stream's surfaces — rides the existing
test suite, extended with a comparison against today's recorded behaviour. One promise —
the whole repo stays green including generated docs — already has its command today. The
last one, whether ermine accepts the handoff, is a human matter no command can judge; what
the machine can hold is that the contract file exists and the offer was recorded.

One thing I already did, automatically: wrote this survey as a deterministic document and
linked every acceptance criterion to its proof row, so the plan itself now carries how each
promise gets proved — whoever picks this up sees it, even after this conversation is gone.
One thing to know rather than approve: no Phase 0 is proposed, because building the missing
sensors IS phases 1 and 2 of the plan as written.

In summary: seven of eight promises end machine-checked (five by tests this plan builds
red-first, one by extending the existing suite, one by the repo's standing gate); the one
human judgement that remains is ermine's acceptance of the handoff, named in the plan. No
approval is requested — the survey confirms the plan as written already builds its own proof.
