# Review packet — plan 050 phase-1 (CODE review, flow-pair)

You are the **reviewer** in a flow-pair fleet (orchestrator: pij-4s10mb; the coder was a different model). Review the uncommitted working-tree changes for plan 050. Repo root: `/Users/jordanknight/substrate/harness-engineering`.

## Scope — the diff under review (unstaged/staged working tree)
- `harness/cli/src/services/telemetry/`: `artifact-semantics.ts` (NEW), `events.ts`, `segment.ts`, `rollup.ts`, `capture-service.ts`, `segment.schema.json`, `otlp/logs.ts`, `otlp/semconv.ts`, `otlp/harness-otlp.schema.json`
- `harness/cli/test/services/telemetry/`: `artifact-semantics.test.ts` (NEW), `capture-service.test.ts`, `otlp/reconstruction.test.ts`
- `docs/how/telemetry.md`, `harness/cli/src/services/docs/docs-content.ts` (generated, staged)
- Ignore (NOT part of this review, other sessions' work): `docs/plans/041-*`, `docs/plans/048-*` dirty files.

## Contract to review against
1. `docs/plans/050-semantic-artifact-telemetry/semantic-artifact-telemetry-plan.md` — T001–T006, AC-01..07, Key Findings 05/06.
2. `docs/plans/050-semantic-artifact-telemetry/workshops/001-semantic-telemetry-elements.md` — authoritative: event shape, extractor contract, privacy contract, element inventory.
3. Coder-reported deviations to judge: (a) `plan_id` omit-when-absent instead of `string|null`; (b) `schema_version` stays 2.2; (c) plan-matcher regex fix `(?:^|/)` for repo-relative paths.

## Rubric
- **Dimension 0 (MANDATORY for CODE)**: the coder wrote its own tests — green ≠ good. Prove non-vacuity by mutation: run `just flow-pair-mutate <file> '<sed-expr>'` if available, else apply one mutation yourself (e.g. break the review `fixes` counter, or drop the rollup `artifact` exclusion), run the relevant vitest file, confirm it flips RED, then restore. Name the exact assertion that flipped. An approval without mutation evidence is invalid.
- **Correctness**: extractors pure + never throw (feed garbage in your head or via a scratch test); capture wiring bounded to changed set; guarded read (missing/binary/oversized/out-of-repo skipped).
- **Privacy (highest severity)**: could ANY field carry free text? Enums allowlisted with `other` fallback by construction; no artifact prose reaches counts/enums/attrs; OTLP attrs within the frozen allowlist.
- **Pipeline round-trip**: serializeEvent case, OTLP encode AND decode, reconstruction "every kind round-trips" genuinely includes `artifact` (not skipped/filtered).
- **KISS**: user mandate — flag over-engineering as a finding, not a nit.

## Verify, don't trust
Run yourself from repo root: `cd harness/cli && npx vitest run test/services/telemetry/artifact-semantics.test.ts test/services/telemetry/capture-service.test.ts test/services/telemetry/otlp/reconstruction.test.ts` (or the full telemetry dir). Read exit codes yourself.

## Output
Write `docs/plans/050-semantic-artifact-telemetry/reviews/review.phase-1.md`:
- `**Verdict**: APPROVE | APPROVE_WITH_NOTES | FIX_REQUIRED`
- Findings as `F<N> · <CRITICAL|HIGH|MED>` with file:line, claim, proof, smallest fix
- **Dim-0 evidence block**: the mutation applied, the assertion that flipped RED, restoration confirmed.
Then reply: `pij send pij-4s10mb "<verdict + findings one-liner + Dim-0 evidence>"`.

## Forbidden
Do NOT edit any source/test/docs file (read-only review; mutations must be reverted — leave the tree byte-identical to how you found it; verify with `git status` before reporting). Never touch `the-flow.json`/`the-flow.md`/plan/workshop files.
