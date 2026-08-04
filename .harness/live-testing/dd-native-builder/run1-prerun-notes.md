# dd-native-builder run 1 — pre-run instrument notes (fold into report)

## Ambiguous-tooling window (before subject packet delivery; resolved nil)

The eval worktree's `just build` silently relinked the machine-global
`harness` binary to the eval tree (third occurrence of this recipe defect
tonight — it fires on any fresh worktree). Window, from log mtimes:

- stolen:   ≤ 2026-08-05T01:22:07+1000 (eval build completion)
- restored:   2026-08-05T01:22:39+1000 (s065 rebuild; verified by resolved
  path: command -v harness → s065-deterministic-documents)

Exposure bounded by mechanism, not observation (prime's analysis):
`.githooks/post-commit:31-32` resolves its OWN repo root, so hook-driven
telemetry capture/flush never touches the global link — evidence integrity
unaffected. Residual exposure = a bare `harness` typed interactively inside
the ≤60s window; the only candidate seats (clam, sore-horse) were parked.
The SUBJECT was not yet spawned (spawn 01:24+); its entire session is
outside the window.

Also material to reading this run: the eval measures the BRANCH build
(base f947a2fc on s065/deterministic-documents), not shipped behaviour —
deliberate, confirmed with prime.

## Post-run instrument findings (2026-08-05, orchestrator)

1. HEADLINE: the subject never saw the dd-native builder. /builder resolved
   to the ~/.agents deployed copy (dated Jul 15, pre-dd); the worktree has
   no project-level builder skill. The base-ref pin covers CLI code but not
   the SKILL surface. The run therefore measured the July builder's flow —
   competently driven (markdown plan, receipted flow state, honest refusal
   handling) — and could not measure dd-native discoverability at all.
2. A2/A4/A5/A6 PASSED as false positives: their fs globs matched the 14
   inherited plan.dd.json corpora shipped in base (exemplar + docs), not
   subject work. The subject authored ZERO dd documents. A3's required FAIL
   is the one true deterministic signal (a markdown plan exists).
3. Telemetry lane blind: 0 segments joined for the session; A1/A7/A8/A10
   unknown. Judged lane filled artifact-only: verdict unknown per rubric
   (account corroborated by worktree artifacts on every checkable claim).
4. Verdict FAIL stands and is HONEST at the headline level — the dd-native
   flow was not driven — but for the wrong mechanical reasons in the
   capability lane. Read this run as an instrument-topology finding, not a
   builder-discoverability measurement. Re-run requires: skill-surface
   pinning + new-since-base assertion scoping + sync/score order pinned.
