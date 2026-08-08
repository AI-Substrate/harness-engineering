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
