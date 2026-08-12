# CODER PACKET — the null device. One constant, ~78 of 112 Windows failures

**Model**: claude-opus-5, effort high, harness copilot
**Repo root**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s083-windows-portability`
**Branch**: `s083/windows-portability` @ `858f9a0c` (current `main`)

**DO NOT COMMIT.** The product owner's standing instruction on this branch: everything is
reviewed before anything lands. Leave your work in the working tree. Do not `git add -A`, do not
`git stash`, do not touch any path outside the allow-list below.

---

## Mission

`GIT_CONFIG_GLOBAL` is set to a Windows null device, and **Git for Windows refuses to run at
all** — every telemetry git call exits 128, which makes `ExecRemoteTelemetryGit` inoperative on
Windows. Fix the constant, fix its siblings, and make the test able to catch it.

Measured on the target box (git 2.55.0.windows.3), four verbs × three values, with a positive
control:

```
GIT_CONFIG_GLOBAL=NUL        -> exit 128  "fatal: unable to access 'NUL': Invalid argument"
GIT_CONFIG_GLOBAL=\\.\nul    -> exit 128  same
GIT_CONFIG_GLOBAL=/dev/null  -> exit 0, isolated, works
```

## The fix is `/dev/null` on every platform — and read the next paragraph before you doubt it

git's own `Documentation/git.adoc`, under `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM`:

> *"Can be set to `/dev/null` to skip reading configuration files of the respective level."*

It is a **documented contract of the variable**, not an accident of a missing file.

**A previous brief from me told a coder the opposite** — that `/dev/null` works on Windows only
because git treats a missing file as no config, and pushed toward a guaranteed-empty temp file.
**That steer was wrong and is withdrawn.** Do not build a temp file. It would add fs I/O, a
lifecycle, cleanup-on-crash, an injected seam and a new failure mode (tmpdir unwritable) inside
the security-critical isolation path — a subsystem replacing a constant, for less certainty than
the documented value already gives.

Two places in this tree already use literal `/dev/null` on both platforms, each with that
reasoning in a comment: `test/adapters/git/exec-git-write.int.test.ts:167` and
`src/services/flow/archive-move.test.ts:65`. **The product is the outlier, not `/dev/null`.**

## What to change

**1. The constant** — `src/adapters/git/exec-remote-telemetry-git.ts:123-124`:

```js
export function nullDeviceForPlatform(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'NUL' : devNull;
}
```

Both arms are wrong on Windows: `'NUL'` here, and `os.devNull` (`\\.\nul`) is what `main`
emitted before the merge. **Both measure exit 128.** Anyone who greps `main` for `NUL`, finds
nothing, and concludes the report was overblown has disproved nothing — say so if you touch the
docs.

**Rename the function.** It no longer returns a null *device*, and the old name is half the
reason this went wrong. Something like `gitConfigNullPath` — your call, but justify it.

**2. The two siblings that emit the rejected value.** A product-only fix leaves both behind, and
leaving a sibling behind is the defect shape this plan keeps re-hitting:

- `test/support/hermetic-git.ts:85` — `GIT_CONFIG_GLOBAL: win32 ? 'NUL' : devNull`
- `test/adapters/git/exec-remote-telemetry-git.int.test.ts:199` — `win32 ? 'NUL' : '/dev/null'`

**3. The doc comment that laundered a third party's measurement into fact.**
`exec-remote-telemetry-git.ts` around line 100 carries a table attributed to *"the downstream
consumer of #108, with a positive control"* asserting `NUL → exit 0 ISOLATED`. Product code was
built on it and nobody re-measured, because a positive control had already been cited. Replace it
with our own measurement above, attributed to us, dated, and naming the git version — the version
is load-bearing.

## The test problem — this is the part that matters most

`test/adapters/git/exec-remote-telemetry-git-null-device.test.ts:48` asserts *"maps win32 to NUL
and every other platform to os.devNull"* — **and it passes**, because on Linux and macOS the
win32 branch is never executed. **Our own suite defends the broken constant.**

There is a second, subtler one at `exec-remote-telemetry-git.int.test.ts:1554`:

```js
expect(network?.env?.GIT_CONFIG_GLOBAL).toBe(nullDeviceForPlatform());
```

That compares the product against **itself**. It cannot fail for any value the function returns,
so it will follow your change silently and prove nothing. A derived expectation cannot detect
drift in the thing it derives from.

**Both must end up asserting a literal, and exercising the win32 branch on every platform** — the
platform is already an injectable parameter, so there is no excuse for a Linux-only path. If your
new test would still pass when someone reverts your change, it is not a test. State explicitly in
your report how you verified it fails against the old constant; **actually run it against the old
value**, don't reason about it.

## Allowed paths

- `harness/cli/src/adapters/git/exec-remote-telemetry-git.ts`
- `harness/cli/test/adapters/git/exec-remote-telemetry-git-null-device.test.ts`
- `harness/cli/test/adapters/git/exec-remote-telemetry-git.int.test.ts`
- `harness/cli/test/support/hermetic-git.ts`
- callers that break only because you renamed the function (report each one)

## Forbidden paths

`.the-flow-state.json` · `the-flow.json` · `the-flow.md` · `docs/plans/**` (the packet lives
there; you do not write there) · `government/**` · anything under `docs/plans/archive/**`.
Do not touch `src/acts/flow.ts` — `docRepoRoot()` is a separate defect and a separate stream.

## Verification

Local (Mac) first: `cd harness/cli && npx vitest run <the files you touched>`, then the wider
suite. **A green row means nothing unless the build is newer than the edit** — this suite mixes
src-importing and dist-executing tests, so run `just build` before any dist-executing test.

**Windows is not yours to run.** `pij-used-narwhal` owns the VM lane: it packages, deploys, runs
the suite on the Windows VM, reads the failures and relays them back to you. Ask it through the
PM (`pij-respectable-clam`) when you want a Windows run; do not try to reach the VM yourself.

Expect roughly **78–81 of 112** failures to clear. Do not quote a precise figure — the measuring
seat's prose said 81 and the run arithmetic says 78, and nobody has reconciled them. Recompute
from `assets/windows/vm-082/vitest-results.json` if you need a number.

## Done-report

```json
{ "outcome": "COMPLETE | PARTIAL | BLOCKED",
  "summary": "what changed and why the rename is what it is",
  "filesChanged": ["..."],
  "gatesClean": true,
  "revertProof": "how you proved the new test FAILS against the old constant — the command and its output",
  "notes": "callers you had to touch, anything you found and did NOT fix"
}
```

Find a defect outside this packet → **report it, do not fix it.** Full context if you want it:
`docs/plans/083-windows-portability/assets/windows/WINDOWS-ISSUES.md` (defect 1) and
`PLANS-SALVAGE.md` (why my earlier steer was wrong).
