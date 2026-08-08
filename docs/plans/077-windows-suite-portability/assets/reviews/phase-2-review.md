# Phase 2 round-one review — CHANGES

**Reviewer**: `pij-brave-flute` (terra)  
**Commit reviewed**: `e825bf99`  
**Scope**: tk-0101 through tk-0105

## Finding

### P1 — The capability probe can pass while the hook fixture still fails

`canRunShellScript()` executes only a generated script which resolves a generated
`harness-probe-shim` from `PATH`
(`harness/cli/test/support/external-binary.ts`).  The tracked hook also needs to
resolve and run `git` before it reaches the shim:

```sh
repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
node "$bin" telemetry sync >/dev/null 2>&1 || true
```

Therefore a shell that can execute the native-path probe and resolve its shim,
but cannot resolve or run `git` in the fixture environment, returns `true` from
`canRunShellScript('bash')`.  The `post-commit-hook` describe then runs, the
hook exits successfully at `git rev-parse`, and the default-flush assertion fails
because no marker is written.  This is the same presence-versus-required-
capability gap one level deeper, and contradicts the helper's claim that it
proves the properties the fixtures depend on.

The probe must exercise every command-resolution property required before the
fixture's observable assertion, or the describe must guard those dependencies
separately with a named, honest skip.  A regression control should make the
current false-positive shape fail.

## Review evidence

- The permanent tk-0103 controls and the post-commit suite pass locally:
  **11/11**.
- Simulated-win32 `nudge.test.ts` passes **62/62**.  This repeated the
  negative-control method and found no fourth un-injected `NudgeDeps` helper.
- Simulated-win32 `exec-remote-telemetry-git.int.test.ts` yields exactly
  **73 passed / 18 skipped**, with the required named skip.  The narrow
  tk-0104 scope is correct: it preserves the 73 non-daemon cases that can
  expose Windows defects.
- The repaired nudge fallback control asserts both host outcomes; it was not
  weakened.  The timeout remains bounded at 30 seconds.

## Confidence boundary

The simulations prove platform-branch behavior only.  They do not verify a
native Windows filesystem, shell, PATH, or process outcome.  No additional
Windows outcome is claimed by this review.

## Re-review — CHANGES

**Reviewer**: `pij-brave-flute` (terra)
**Commit reviewed**: `f777e24c`
**Scope**: complete `s077/suite-portability` branch against current base
`44308756`, including merge commit `f777e24c`

### P1 — The probe verifies a generic shim, not the hook's `node` invocation

`probeShell('bash', { requires: ['git'] })` now correctly proves the native
script path, `git` command substitution, a Git-produced path's file test, and
the generic `harness-probe-shim`.  The hook, however, invokes **`node "$bin"
telemetry sync`**.  `node` is merely listed in the textual drift guard's
`ACCOUNTED_FOR` set; the probe never resolves or runs a shim named `node`.

That leaves another successful-no-op shape.  A shell startup environment can
define a `node` function that returns zero without executing the PATH shim.
The generic shim still resolves, so the current probe returns capable; `git` and
`[ -f "$bin" ]` succeed; then the hook's shadowed `node` returns zero and no
marker is written.  The test reports a hook failure, not an environment gap.

This was reproduced on the current tree with a review-only negative control:
`BASH_ENV` defined a zero-returning `node` function, `probeShell(...,
{ requires: ['git'] })` returned `true`, and the tracked-hook shape exited zero
with no marker.  The probe should exercise a shim named `node` with the
argument shape the fixture uses.  That remains a mechanism probe, not execution
of the hook subject, so it preserves the deliberate anti-self-skip boundary.

### Re-review confirmations

- The `git`-blind false positive is now properly controlled: old probe accepts,
  real hook exits zero without a marker, new probe rejects with an actionable
  failure, and a Git-seeing shell passes.
- Rejecting a real-hook probe is correct.  It would conflate a broken subject
  with an incapable environment and skip a genuine hook defect green.
- The drift guard recognizes the current direct command substitution and
  line-head invocation.  It is intentionally textual: a variable-expanded
  command or command in a here-document can evade it; a literal `alias` line
  fails conservatively as an unaccounted `alias`.  The current hook uses none
  of the blind forms, so this is an accepted future-drift limitation, not a
  second finding.
- D12's leak check now lists only a private temporary namespace.  No equivalent
  shared-temp listing remains in the touched probe test; the existing
  `exec-remote-telemetry-git` listings run inside that file's private `TMPDIR`
  namespace.
- The `#120` merge contains only the expected agent guidance, skill, docs
  manifest, and generated docs-content changes; its docs and skill tests pass.

### Evidence

- Capability, hook, and daemon suites: **107/107**.
- Merged docs and skill surfaces: **53/53**.
- Review-only node-shadow discriminator: **1/1** (reproduced P1; removed after
  the run).

No native-Windows outcome is claimed by this re-review.
