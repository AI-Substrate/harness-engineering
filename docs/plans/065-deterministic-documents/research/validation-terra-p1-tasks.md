# FROZEN — verbatim provenance capture (GPT-5.6 Terra xhigh, validate-v2). Never updated; superseded silently.

# Validation - Phase 1 dd-core tasks dossier

- **Validated**: 2026-08-03
- **Target**: `docs/plans/065-deterministic-documents/tasks/phase-1-dd-core-foundations/tasks.md` (untracked worktree artifact)
- **Contract sources**: `deterministic-documents-plan.md` v1.1.0; `workshop-notes.md` D1-D16; workshops 001-003; `backpressure-coverage.md`
- **Checks**: task/plan/AC and workshop cross-reference review; next-phase traversal (Phase 2 dossier absent, so the plan's Phase 2 table is the consumer contract); pre-implementation path inspection; targeted git history
- **Verdict**: NEEDS ATTENTION
- **Thesis / proof**: Partial. The dossier names the right P1 scope and boundaries, but several load-bearing contracts remain too vague to freeze or verify safely.
- **Consumers**: P2 and the P3/P4 fan-out are not yet safely served: resolver, act/error, and validate-walk seams need their final contracts before work begins.

## Validation Contract

- **Purpose / promise**: Give P1 implementers a buildable, testable dd-core foundation that P2 can extend and P3/P4 can use without shared-file renegotiation.
- **Proof target**: Implementation readiness, backed by named fixtures, slice commands, and architecture checks.
- **Constraints**: dd-core remains ports-free; P2 owns real schema resolution; P3/P4 fill bodies only; W8 default depth is 3; direct validation never uses sweep exclusions.
- **History**: `tasks.md` is untracked, so it has no file history. The READY plan commit `5443baf7` and approved workshops are **Authoritative**; no other material historical evidence applies.

## Findings

| Severity | Finding | Evidence | Impact | Smallest fix |
|---|---|---|---|---|
| HIGH | The T006/T007 freeze is not enumerable, and it does not define how P1's live `dd validate` operates before P2 provides the real `SchemaResolver`. | T006 gives only E4xx ranges; T007 gives only "`dd schema list` etc." and "`dd validate <fixture> --json` emits correct envelope/exit." T004 limits its fixture-backed resolver to P1 tests and assigns the real resolver to P2. The plan requires final stubs and final error names so P2-P4 "fill bodies only." | An implementer can either invent command/error contracts or add resolver behavior in P1, breaking the intended P2 and P3/P4 fences. | Add a frozen T006/T007 surface manifest: every command's positional/option shape, placeholder status/exit behavior, named E400-E449 allocation, and the explicit resolver-less P1 `validate` result plus P2 handoff. If that P1 behavior is not chosen, defer the live validate body to P2. |
| HIGH | T005 does not define or prove the multi-hop semantics promised by `--depth 0/1..N` and default 3. | Its `>=1` wording gives the same one-hop behavior for every nonzero value, and its Done-When proves only cyclic termination and exclusion. AC-01/W8 require outbound resolution, basis freshness, and neighbors' depth-0 health; the plan requires P4 doctor to reuse this engine at radius infinity. | A one-hop implementation can pass T005 while default 3 is ineffective; P4 must then reimplement or alter the supposedly frozen walk. | Specify the remaining-depth transition for depths 1, 2, and 3+, visited-set behavior, finding ownership, and the injected loader/basis seams. Add fixtures asserting stale basis, broken neighbor health, exact owner, and termination. |
| HIGH | The sweep opt-out portion of T005's exclusion contract is an unnamed product decision. | The dossier, plan AC-15, and coverage artifact all say "an explicit opt-out key," but none names its key, location, value, or permitted scope. Workshops 001-003 do not settle it. | P1 must invent a persistent document contract, producing incompatible sweep behavior and a non-reproducible AC-15 test. | Record a ruling before T005 that names the opt-out field and its semantics, then add direct-versus-sweep fixtures. Alternatively, explicitly defer only the opt-out half rather than silently choosing it. |
| MEDIUM | T001 omits fixtures for every WARN-class path rule although T004 claims severity conformance to workshop 001. | Workshop 001 classifies absolute paths, non-POSIX/relative-path violations, outside-or-untracked targets, and missing targets as WARN. T001 enumerates only ERROR-like subjects, and "malformed addresses" does not exercise valid-but-WARN paths. | WARN/ERROR classification is unproven before P4 maps WARN to `degraded`/exit 0 and ERROR to `error`, risking a false-red checks gate. | Add at least one fixture for each workshop-001 WARN path category and assert WARN severity separately from ERROR failure behavior. |
| MEDIUM | The Architecture Map schedules T009 too late for its declared consumers. | The diagram has only `T009 -> T003`, but T002 requires the references-ledger name "per T009"; T010 uses the default gate-terminal constants; and T009 says its constants are consumed by T002-T004. | Following the DAG builds T002 and T010 before their required names/constants are decided, causing rework or an ad-hoc second ruling. | Add `T009 -> T002` and `T009 -> T010` (and retain T009 before any other stated consumer). |

**Open decisions**: the opt-out key's document contract and the intended P1 runtime posture for `dd validate` without P2's resolver. These require an explicit ruling; no mechanical repair was applied.
