# Review packet — plan 051 phase 1 (CODE review, flow-pair)

You are the **reviewer** in a flow-pair fleet (orchestrator: pij-4s10mb; the coder was a different model — Opus 4.8). Review the uncommitted working-tree changes for plan 051. Repo root: `/Users/jordanknight/substrate/harness-engineering`.

## Scope — the diff under review (working tree)
- `harness/cli/src/services/telemetry/`: `fleet-evidence.ts` (NEW), `fleet-export.schema.json` (NEW), any touched `session-evidence.ts`
- `harness/cli/src/acts/telemetry.ts` (get-fleet wiring)
- `harness/cli/test/services/telemetry/fleet-evidence.test.ts` (NEW) + touched tests
- `.harness/extensions/flow-eval/` (scaffold `intent` field + fixtures)
- `docs/how/telemetry.md`, `docs-content.ts` (generated), `docs/plans/051-pij-fleet-session-eval/evidence/`, `tasks/phase-1/execution.log.md`
- Ignore (other sessions' work): `docs/plans/041-*`, `docs/plans/048-*` dirty files.
- Ignore (orchestrator-owned, NOT the coder's): `harness/cli/src/services/doctor/**`, `harness/cli/src/acts/doctor.ts`, `harness/cli/test/**/doctor*.test.ts`, `.harness/records/harness-change/2026-07-04/001-*` — a separate version-skew doctor layer landed in the same tree this session.

## Contract to review against
1. `docs/plans/051-pij-fleet-session-eval/pij-fleet-session-eval-plan.md` — T001–T006, AC-01..07, Key Findings 01–05.
2. `docs/plans/051-pij-fleet-session-eval/workshops/001-fleet-join-and-eval-design.md` — authoritative: D1–D5. Contract drift is a finding.
3. Coder-reported deviations (in its report / execution log) — judge each.

## Rubric
- **Dimension 0 (MANDATORY for CODE)**: coder wrote its own tests — green ≠ good. Apply one real mutation (e.g. make unmeasured copilot lanes zero-fill into totals, or break the orphan diff), run the relevant vitest file, confirm it flips RED, restore, and NAME the exact assertion that flipped. An approval without mutation evidence is invalid.
- **Honest totals (highest severity)**: `cost_measured:false` lanes must NEVER contribute 0 to sums or be silently dropped from lane lists; time must come from OTLP timestamps, not the event-index `window`.
- **Privacy**: fleet export schema closed (`additionalProperties:false`), ids/counts/enums only, negative-key test genuinely fails validation.
- **Reuse**: `getSessionEvidence` reused, not reimplemented (dossier F-05); acts stay thin, service pure (ports only).
- **Non-breaking**: existing scenarios load without `intent`; `telemetry get` behaviour unchanged.
- **KISS**: over-engineering is a finding, not a nit.

## Verify, don't trust
Run yourself from repo root: `cd harness/cli && npx vitest run test/services/telemetry/` — read exit codes yourself. Check the evidence file `docs/plans/051-pij-fleet-session-eval/evidence/fleet-050.json` reconciles with the workshop spike (78,814,658 measured grand-total; copilot lanes unmeasured).

## Output
Write `docs/plans/051-pij-fleet-session-eval/reviews/review.phase-1.md`:
- `**Verdict**: APPROVE | APPROVE_WITH_NOTES | FIX_REQUIRED`
- Findings `F<N> · <CRITICAL|HIGH|MED>` with file:line, claim, proof, smallest fix
- **Dim-0 evidence block**: mutation applied, assertion that flipped RED, restoration confirmed.
Then: `pij send pij-4s10mb "<verdict + one-liner + Dim-0 evidence>"`.

## Forbidden
Read-only review — no source/test/doc edits (mutations reverted; leave the tree byte-identical; verify with `git status` before reporting). Never touch `the-flow.json`/`the-flow.md`/plan/workshop files.
