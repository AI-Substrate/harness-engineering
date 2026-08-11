# CODER PACKET — the hooks cluster. 17 of 28 remaining Windows failures, ~3 root causes

**Model**: claude-opus-5, effort high, harness copilot
**Repo root**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s083-windows-portability`
**Branch**: `s083/windows-portability` @ `2d93d3af`

**DO NOT COMMIT.** Leave your work in the working tree. Never `git add -A`, never `git stash`,
explicit pathspecs only. Do not touch any path outside the allow-list.

---

## Where these numbers come from — and why they are trustworthy

A clean control and treatment were run on a real Windows VM, same machine, same clone, minutes
apart, differing by exactly one commit. **107 → 28 failures, 79 cleared, zero new.** These 17 are
what remains in `services/hooks/`, extracted mechanically from the treatment run's raw vitest
JSON — not transcribed, not remembered.

Raw evidence: `scratch/win/results/vitest-results-treatment.json` + `vitest-console-treatment.log`.

**These tests PASS on your Mac.** That is the whole problem and it governs how you work — see
§ Verification before you write anything.

## The 17, grouped by root cause rather than by file

### Group A — path shape: logical vs native separators (7 rows)

```
legacy-command-form  2   expected 'C:/Users/…' to be 'C:\Users\…'
install-strategy-a   2   expected 'C:\Users\…' to be 'C:\Users\…'   (differs beyond the truncation)
verbs-e2e            2   expected [Array(1)] to include 'C:\Users\…'
binary-path          1   expected false to be true  (quoted/recoverable binary path)
```

The product emits **forward slashes** where the test compares against a **native** path built with
`path.join`/`os.tmpdir()`. Both strings name the same file; only the shape differs.

`.github/workflows/windows.yml` describes this exact class from the previous round: *"Every one was
a logical-vs-native path-shape mismatch at a comparison, which no per-line lint can see."*

**The judgement call is which side is wrong, and it is not automatic.** A forward-slash logical
path is legitimate — Windows APIs accept it, and normalising everything to backslash can break a
string that is later embedded in a shell command or a JSON config. So decide per site: is this
value a **path being compared**, or a **path being written into someone else's file**? Comparisons
should normalise both sides; emitted values must keep the shape the consumer expects.
**Say which you chose and why, per site.** A blanket `.replace(/\//g, '\\')` is the wrong answer.

### Group B — symlink EPERM (2 rows) — NOT a product defect

```
config-writer  2   Error: EPERM: operation not permitted, symlink 'C:\…\dotfiles\hooks.json' -> …
```

Both tests **create a symlink as part of their setup**. An unelevated Windows process cannot do
that. The product is not implicated; the *test* requires a privilege the platform does not grant.

**Do not weaken these tests to make them pass, and do not delete them.** The behaviour they guard
is real — one of them is explicitly *"the RENAME-based atomic write DESTROYS the symlink — the
hazard, executable"*, which is a genuine hazard proof worth keeping.

**Guard on capability**, the way this repo already does elsewhere: probe whether a symlink can be
created, and skip with a stated reason if not. Then **two things must follow**:

1. The skip is **reported**, not silent. `windows.yml` pins the skip count and raises a visible
   annotation on any change, precisely so "we stopped looking" cannot wear a green. **A rise in
   that pin is the correct, honest outcome here** — flag it in your report so whoever moves the
   pin does it deliberately and in its own change.
2. Note in your report that this is the **same class** as `dd-schema-fs.test.ts`, which may die at
   *collection* on symlink EPERM. If you find a shared helper is the right answer, say so; do not
   build one speculatively.

### Group C — windsurf composition and rollback (6 rows)

```
composition-boundaries  6
  - reports and commits at the SAME UNIT — a failed agent leaves no installed file
        expected [] to include 'windsurf'
  - never reports windsurf as INSTALLED when one of its two files failed
        expected [ { agent: 'windsurf', … }, … ] to deeply equal []
  - RECORDS and NAMES a file it could not roll back — never silently held
        expected '' to contain 'C:\Users\…'
  - leaves the PEER's committed entry in place when its own second file fails
        expected [Function] to throw an error
  - the PROVENANCE compensation obeys the same rule — pinned after a mutant survived
        expected 'install provenance could not be writt…' not to contain 'rolled back'
  - REFUSES to restore — and says so — when the file moved under it
        expected [] to deeply equal [ Array(1) ]
```

**This group is genuinely unexplained and is the one to think hardest about.** It is not obviously
path shape: `expected [Function] to throw an error` means an operation that fails on POSIX
**succeeds** on Windows, and `expected '' to contain …` means an error message was never produced
at all. These are **behavioural divergences in failure paths**, and failure paths are where
fault-injection tests usually depend on fs semantics that differ by platform (rename-over-open-file,
delete-while-held, error codes).

**Diagnose before you fix.** Report what the mechanism is; if two of the six share one cause, say
so. Do not fix six things separately if there is one cause.

### Group D — residue (2 rows), most likely not yours

```
composed-command  1   Error: STACK_TRACE_ERROR      <- the known timing family, 8 -> 1
command-runs      1   expected { …(2) } to deeply equal { …(2) }
```

`composed-command` is the residue of a timing family that fell 8 → 1 when the null-device confound
lifted. **Look, then most likely leave it** — report rather than fix if it is a 30s-wall timeout.

## Verification — read this twice, it is the trap

**Every one of these 17 tests passes on macOS.** You cannot prove a fix by running them here, and a
green local run is not evidence. This is the same defect shape the null-device fix just removed
from this codebase: *a test that passes by not being run on the platform that matters.*

Two legitimate routes, in order of preference:

1. **Make the platform injectable and drive win32 from here.** The null-device fix did exactly
   this — it kept a `_platform` parameter deliberately so a Mac can exercise the win32 branch and
   assert a literal. Where a seam already exists, use it. Where you can create one cheaply and
   honestly, do. `fileURLToPath(url, { windows: true })` and `path.win32` are real tools.
2. **Hand it to the VM lane.** `pij-used-narwhal` owns the Windows box; it packages, builds, runs
   at `HARNESS_TEST_SCOPE=all`, and relays. Ask through the PM (`pij-respectable-clam`). **Do not
   try to reach the VM yourself.**

**Anything you cannot verify by either route, label `EXPECTED-UNVERIFIED` in your report.** An
unlabelled guess is worse than an admitted gap.

**If your new test would still pass when someone reverts your change, it is not a test.** State how
you proved each one fails against the old behaviour, and actually run it — do not reason about it.

## Allowed paths

- `harness/cli/src/services/hooks/**`
- `harness/cli/test/services/hooks/**`
- shared path/fs helpers **only if** a fix genuinely belongs there — report each one you touch
- callers that break solely because you renamed something (report each)

## Forbidden paths

`.the-flow-state.json` · `the-flow.json` · `the-flow.md` · `docs/plans/**` (this packet lives
there; you do not write there) · `government/**` · `docs/plans/archive/**` ·
`.github/workflows/**` · anything under `harness/cli/src/adapters/git/` (the null-device work is
landed and is not yours).

## Done-report

```json
{ "outcome": "COMPLETE | PARTIAL | BLOCKED",
  "groups": { "A_path_shape": "...", "B_symlink_eperm": "...", "C_composition": "...", "D_residue": "..." },
  "rootCauses": "how many distinct causes you actually found, and which rows share each",
  "filesChanged": ["..."],
  "verification": "per group: injected-win32 / VM-run / EXPECTED-UNVERIFIED",
  "revertProof": "the command and its output, per group",
  "skipPinDelta": "if you added a capability guard, how many skips it adds",
  "notes": "anything you found and did NOT fix" }
```

**Find a defect outside this packet → report it, do not fix it.** Context if you want it:
`docs/plans/083-windows-portability/windows-portability-plan.md`.
