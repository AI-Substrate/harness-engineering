# Validation packet — plan 051 (for the codex validator peer)

You are an independent VALIDATOR (orchestrator: pij-4s10mb). Repo root: `/Users/jordanknight/substrate/harness-engineering`. You are read-only — write ONLY the output file named below. Never touch `the-flow.json`/`the-flow.md` or any source file.

## Target
`docs/plans/051-pij-fleet-session-eval/pij-fleet-session-eval-plan.md` — validate per the /validate-v2 method (adaptive): derive the Validation Contract, verify claims at source, try to DISPROVE findings before keeping them.

## Authoritative inputs (read in this order)
1. The plan (target).
2. `docs/plans/051-pij-fleet-session-eval/workshops/001-fleet-join-and-eval-design.md` — AUTHORITATIVE design (D1–D5); the plan must not contradict it.
3. `docs/plans/051-pij-fleet-session-eval/research-dossier.md` — evidence base (F-01..F-11, H-01..H-03).

## Verify-at-source spot checks (do these yourself, cite line numbers)
- F-05 claim: `harness/cli/src/services/telemetry/session-evidence.ts` — single-session join at `PIJ_SESSION_ID` (~line 110, 306); confirm no existing fleet/cohort merge anywhere (grep report.ts/rollup.ts/insights.ts).
- F-07 claim: sample a copilot-child segment under `.harness/temp/telemetry/` and confirm `tokens: null`.
- F-08 claim: segment `window` is event-index (`{"since":...,"from":N,"to":M}`), not wall-clock.
- AC-02 arithmetic: does the ~78.8M spike total in the workshop § Spike match the dossier F-06?
- Constitution gates: `docs/project-rules/constitution.md` + `architecture.md` — does the planned service/act split comply (G2/G3 PASS honest)?
- G4 claim "no docs/adr/ directory" — verify.

## Judge
- Thesis: does this plan actually deliver "a fleet measurable as one unit" or just plumbing?
- Proof: are the ACs testable as written? Any AC that can't fail is a finding.
- KISS mandate (user): over-engineering is a finding, not a nit.
- Contract fidelity: D1–D5 vs the task table — any drift is a finding.

## Output
Write `docs/plans/051-pij-fleet-session-eval/validations/pij-fleet-session-eval-plan-validation.md`:
- Verdict line: `✅ VALIDATED` or `❌ NEEDS ATTENTION — <C>/<H>/<M>`
- Findings table (severity / claim / proof with file:line / impact / smallest fix)
- One-line thesis judgment.
Then: `pij send pij-4s10mb "<verdict + findings one-liner>"`.
