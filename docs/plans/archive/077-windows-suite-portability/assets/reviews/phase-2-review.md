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

## Re-review — CHANGES

**Reviewer**: `pij-brave-flute` (terra)
**Commit reviewed**: `4297c100`
**Scope**: complete `s077/suite-portability` branch against current base
`44308756`

### P1 — The silent-success guard accepts a sourced helper that can add exits

The count guard recognizes only direct `&& exit 0`, `|| exit 0`, and `|| true`
in `.githooks/post-commit`.  Its command scan treats `source` as a builtin, and
the "absence" assertions reject only `trap` and `set -e`.  Consequently this
valid shell change remains green:

```sh
source ./silent-helper.sh
```

The count remains five, `source` is not unaccounted, and neither absence
assertion fires.  A helper can then introduce `return 0`, an `exit 0`, or a
swallowed failure outside the tracked text.  That contradicts the contract's
claim to fail on a sixth silent-success path.  The same blind spot applies to
an invoked subshell or externally defined function.

This is separate from accepted D11: it is not the textual external-command
scan.  It is the silent-exit enumerator itself accepting a construct that moves
silent-success behavior out of the file it counts.  Reject source/dot/function
and subshell forms explicitly, or make the enumeration include their reachable
content.

### P1 — The flow-eval SessionEvidence lock-step is editor-only

`test/extensions/flow-eval/session-evidence-lockstep.test.ts` says its mutual
`CliEvidence`/`ExtEvidence` assignments "fail to compile" when either
declaration loses `duration_s` or `harness_session_id`.  `harness/cli/tsconfig.json`
includes only `src`, so this test is never typechecked; Vitest transpiles it and
the runtime property reads still pass.  Thus either declaration can drift while
the claimed lock-step control stays green.

Add a runtime schema/key-set parity control over the two evidence boundaries, or
downgrade this file's claim to editor-time assistance.  The extension's payload
parser is useful validation, but it is not mutual declaration parity.

### P2 — The public verb-conformance example overstates its enforcement

`test/services/extensions/contract.test.ts` says `tsc --noEmit` type-checks its
example objects and that contract drift therefore breaks the build.  The same
`include: ["src"]` excludes this test.  Its runtime assertions exercise the
current example, but a new required structural member unused by the example can
drift without a type gate.  Add runtime shape validation for the public example
or describe the example's static conformance as editor-only.

### Confirmed

- L3 and L4 use the correct entity: caller intent across both command and
  environment shadowing.  The four negative-control rows are non-vacuous, and
  the clean-shell positive proves both a full contract pass and a real marker.
- The contractless-probe runtime precondition closes the specific non-optional
  parameter claim; it is not being re-reported as type-only.
- The D13 audit found source-backed enforcement for `DD_ISSUE_CODES`,
  `DD_REMEDIES`, ingress policy, and the core adapter seam; their test-local
  type annotations are supplemented by runtime checks or `src` typechecking.
- Targeted shell, hook, lock-step, and verb-contract suites pass **28/28**.
- No native-Windows outcome is claimed by this review.

## Final re-review — CHANGES

**Reviewer**: `pij-brave-flute` (terra)
**Commit reviewed**: `fffa5048`
**Scope**: the seven-way no-delegation guard only

### P1 — Command substitution delegates to a local file without matching scope

The scope guard rejects `./script` only at a line head or after `;`, `&`, or
`|`, and recognizes an explicit subshell only at command position.  It accepts:

```sh
result="$(./silent-helper.sh)"
```

That executes another file, but it matches none of the seven scope patterns.
The external-command scan also stays green: its command-substitution matcher
expects a letter immediately after `$(`, while this form begins with `.`.

The exact current matchers were run against that mutation: **0** scope matches,
**0** unaccounted commands.  Thus this is a control that does not fail when its
file-scope claim is violated, and it meets the dispatch's explicit criterion for
another round.

The `set -e` split was not reviewed: the unguarded eighth delegation construct
is already a blocking result, so the stated termination condition does not
permit spending this round on the secondary question.

## Final-pass review — CHANGES

**Reviewer**: `pij-brave-flute` (terra)
**Commit reviewed**: `1627f298`
**Scope**: claim-to-capability alignment of the downgraded scope guard

### P1 — The enumerated subshell form is still not position-independent

The downgrade says every enumerated form is position-independent and explicitly
names a departure in a conditional as covered.  The subshell pattern is still
anchored to the start of a line or after `;`, `&`, or `|`:

```ts
/(?:^|[;&|]\s*)\(/
```

It therefore accepts this valid Bash:

```sh
if ( : ); then :; fi
```

The exact current matchers produce **0** scope matches and **0** unaccounted
commands (`if` is a builtin).  The same omission occurs for a subshell nested
inside command substitution.  This is not a ninth form or an undocumented
limitation: it is the already-enumerated **explicit subshell** form in an
expression context the documentation says the pattern covers.

Confirmed separately: `result="$(./silent-helper.sh)"` now reaches both intended
controls — the position-independent `./` scope pattern and the widened
command-substitution scanner.  No pattern was appended for that case.

The secondary `set -e` / `trap` ownership split was not reviewed, because this
P1 is a claim that still outruns the guard and meets the dispatch threshold for
another round.
