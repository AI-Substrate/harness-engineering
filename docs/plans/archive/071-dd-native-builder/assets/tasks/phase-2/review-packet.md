# Phase-2 review packet — plan 071 dd-native builder

**For**: the phase-2 reviewer (gpt-5.6-terra, effort high)
**From**: pij-related-koala (orchestrator). Report verdict by pij send —
wire discipline, first line = verdict.

## Dispatch fields

- Coder report: `/tmp/pij-msgs/phase2-report.md` — read it IN FULL (its
  design-calls, honest-gaps, and dry-run-defects sections direct your
  attention).
- Commits under review (seven, interleaved with orchestrator docs commits —
  review THESE, not a range): `5feaac54`, `d47b7680`, `17a40749`,
  `3d7fe351`, `bd66fc17`, `7316d350`, `d80ed0ed`.
- Attribution baseline: `3ccc5531`. Warn trio there: arch-check 2,
  markdown-lint 196, windows-check 6 — verify the coder added ZERO (it
  self-caught a mid-flight +3 and fixed it in `d80ed0ed`; verify the fix is
  a real fix, not a scope-dodge).
- Fences: phase-2 `brief.md` + its Fence amendment 1
  (`.harness/extensions/flow-eval/resolvers.ts`, SessionEvidence decl only)
  + phase-1 amendment (`.dependency-cruiser.cjs` dd/flow rules).
  `docs/how/dd/README.md` churn is the ORCHESTRATOR's, not the coder's.
- Known flake: `exec-remote-telemetry-git.int.test.ts` (~50% under load) +
  git index.lock collisions from concurrent orchestrator git — rerun alone
  before attributing.

## Mission

Adversarial review of ph-7102 "Wire the flow — check-kind gate + dd-native
authoring" — 13 tasks (tk-7131..7135, tk-7141..7147, tk-7169) against ACs
ac-7109/7110/7111/7113/7115/7116/7117/7118. You are the cross-model check:
find what the coder missed.

## Read first (in order)

1. `../../../plan.dd.md` — phase-2 section, the ACs, Key Findings (F004/
   F007 sanitize, static-template, refusal-evidence triple loss).
2. `tasks.dd.md` (this folder) — 18 done_when assertions = the done bar.
3. `../../../backpressure.dd.md` — bp-7109..7118.
4. `brief.md` (this folder) + BOTH fence amendments.
5. The coder's report (in the dispatch pointer) + the seven diffs.

## Dim-0 — mutation gate (MANDATORY, first, blocking)

Controls must be tested, not demonstrated. Pick ≥3 new refusal/ERROR
classes (gate non-green refusal E440, unimplemented check E444, sanitize
drops of hand-edited check links, pre-JIT E441 target-invalid, refusal
E-code vocabulary enforcement, `--plan-dir` absolute-path refusal). Mutate
a good fixture into the bad shape (or verify the planted-bad is genuinely
bad), run, confirm it FIRES with the right code. Quote commands and codes.

## Dimensions (after Dim-0)

1. **Design-binding conformance** — one implementation of "green"
   (`readPlanCheck` seam — verify `plan validate` was truly refactored onto
   it, no second verdict derivation); findings quoted verbatim; `--force` =
   recorded defended override; check kind never echoed from the document;
   refusal codes enforced at capture/segment/publish and DROPPED not
   salvaged; `--plan-dir` absent = byte-identical (the control must
   actually pin bytes).
2. **The two dry-run defects** — `7316d350` claims the phase exit caught a
   plan-new path defect and a phase-1 `dd add --mint` shape defect. Verify
   both fixes are real AND that the pre-fix behavior actually failed (the
   coder claims pins were moved deliberately — check the movement is
   reasoned, not loosened).
3. **Surface discipline** — no new E-codes claimed (E440/E444 reuse):
   verify honest reuse, manifest rows where owed, `dd-surface.test.ts` pin
   deliberate.
4. **Architecture** — `dd/plan` third SDK barrel + dep-cruiser rules; no
   forbidden imports; seam test refuses module-path reach.
5. **Fence compliance** — seven diffs touch ONLY brief paths + the two
   amendments' grants. The resolvers.ts diff must be the SessionEvidence
   decl ONLY (one additive field, no behaviour).
6. **Test honesty** — 4137/4137 reproduces; the honest-gaps section
   (publish-boundary branch untested, bp-7116 coverage-not-sufficiency) is
   accurately scoped, not hiding something testable.

## Verify independently

Run `just test` + `harness checks` yourself; run the bp-7109..7118 probes;
quote counts. Never accept unreproduced numbers.

## Your fence

Read-only + running tests/probes. No commits, no edits, no push. Forbidden:
any the-flow files, `docs/plans/071-dd-native-builder/**` writes.

## Report shape

Line 1: `VERDICT: APPROVE` or `VERDICT: FIX`. Dim-0 evidence first, then
per-dimension one-liners, then numbered findings (file:line, severity,
expected, found). No prose padding.
