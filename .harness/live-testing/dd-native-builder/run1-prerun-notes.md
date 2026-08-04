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
