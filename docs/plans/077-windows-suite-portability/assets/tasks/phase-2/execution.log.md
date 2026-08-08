# Execution log — Phase 2: Round one (plan 077 · #108)

**Seat**: `pij-marked-owl` (round-one coder) · **PM**: `pij-respectable-clam`
**Branch**: `s077/suite-portability` (PR #118, stays open) · **Base at start**: `bfd0ec47`

## The honesty constraint, stated once and applied throughout

**No Windows machine was available to this seat.** Every claim below is labelled
with how it was obtained:

- **measured** — observed on this macOS host, or under a deliberate simulation
  whose limits are stated.
- **expected, unverified on win32** — reasoned from the consumer's own
  measurements in #108. Their re-run is the proof; nothing here is a substitute
  for it.

**The simulation, and what it is worth.** For `nudge` and the daemon skip I ran
the suite under a temporary vitest setup file that redefines `process.platform`
to `'win32'` before any test module imports, so module-level constants
(`IS_WIN32`) and `process.platform` branches read `win32`. That is a **faithful
simulation of platform-BRANCHING and nothing else** — the filesystem, path
separators, process semantics and shell are still macOS. It is therefore strong
evidence for tk-0102 and tk-0104 (both are pure platform-branch defects) and
**no evidence at all** for anything path- or shell-shaped. The temporary config
and setup file were deleted after use; they are not in the diff.

---

## tk-0101 — raise the 5000ms test timeout · `[x]` · THE INSTRUMENT

**Choice: a GLOBAL raise to 30s (`testTimeout` + `hookTimeout`), not win32-only.**

`harness/cli/vitest.config.ts` now sets `testTimeout: 30_000, hookTimeout: 30_000`.

Why global. The property that blows the 5s budget is *"this suite spawns
processes constantly"* — real git, loopback daemons, real hooks — not *"this
suite is on Windows"*. Two of the three files that had already raised their own
budget say so in their own words, from their own measurements: `git-read.test.ts`
records a child with p50 73ms and **max 1202ms** under load, and
`exec-remote-telemetry-git.int.test.ts` records cases measured at **4–6s** under
full-suite contention on Linux. So the same defect is live on a loaded Linux dev
box and a shared CI runner (#109 is measuring exactly that). A win32-only raise
would have left it in place here while encoding "Windows is the weird one" —
the right symptom with the wrong diagnosis attached, which is the specific error
this plan's split exists to prevent.

**A floor, so it cannot be silently undercut.** Three files set
`vi.setConfig({ testTimeout: 20_000, hookTimeout: 30_000 })`. Against a 30s
global those are **downgrades** — they would have re-created the exact bug this
task removes, in the three slowest files in the suite. Each `vi.setConfig` call
was removed and its docblock kept and updated, so the *measurement* that
justified the budget survives while the *number* defers to the global floor. The
now-unused `vi` imports went with them (`git-read.test.ts` still uses `vi` for
spies and keeps its import).

**Cost, stated rather than glossed:** a genuinely hung test now takes 30s to fail
instead of 5s. That is the correct trade — a hang still fails, whereas a too-tight
budget fails cases whose assertions were never in doubt and hides the ones that
were.

### Evidence (measured, on macOS)

| control | command | result |
|---|---|---|
| **Positive** — a 7s case, impossible under the old default | `vitest run <7s case>` | ✅ passed in 7003ms |
| **Negative-A** — the same case forced back to the old budget | `vitest run <7s case> --testTimeout=5000` | ❌ `Test timed out in 5000ms` |
| **Negative-B** — the new floor must still BITE | `vitest run <35s case>` | ❌ `Test timed out in 30000ms` |

Negative-B is the one that matters: a raise that stopped reporting timeouts at all
would have replaced a noisy instrument with a broken one. Both temporary control
files were deleted.

**Expected effect on their box — expected, unverified on win32.** They measured
**46 of 151** FAIL lines on `s077` as `Test timed out in 5000ms` (37 of 144 on
`cfa501a6`). Those become passes to the extent they were budget-bound, which is
what the 32%-slower-run evidence indicates — but "up to 46" is the honest ceiling,
not a promise: any case that is genuinely hung will still fail, and should.

---

## tk-0102 — inject `platform` in `nudge.test.ts` · `[x]` · and it was NOT one line

**What the task said**: add `platform: 'linux'` to the shared `deps()` helper at
~line 92; ~40 failures, one line. **What was actually required**: that line, plus
two more helpers with the identical defect, plus a repair to a control the fix
would otherwise have broken. `nudge.ts` was **not** touched — the guard is
correct and the composition root passes `platform` explicitly, exactly as the
brief said.

### 1. The shared helper (the consumer's root-cause, confirmed)

`deps()` never set `platform`, so `isWin32()` (`nudge.ts:711`) fell back to the
module constant `IS_WIN32` and read the **host**. Injected `platform: 'linux'`.

### 2. Two MORE helpers had the same defect — found by control, not by reading

With the shared helper fixed, the simulated-win32 run still failed **8** cases.
Two local `nudgeDeps()` helpers — one in the *R2: the buffer is machine-global*
describe (~line 801), one in *R4: location cannot prove provenance* (~line 1079) —
build their deps from scratch and likewise omitted `platform`. Both now inject it.

This is the reason the negative control was run at all rather than assumed: the
one-line fix was **80% of the class, not 100%**, and reading alone would not have
told me which. The consumer's grouped signatures could not distinguish the three
helpers, so their 40 was always going to be an approximation.

### 3. The control that the fix would have broken — repaired, not deleted

`'omitting the platform keeps the POSIX behaviour these suites already prove'`
(~line 1605) asserts `deps().platform` is `undefined` and then asserts the POSIX
outcome. It is a **real** test of a **real** fallback — and it was **itself
host-dependent**, asserting the POSIX result while silently depending on the host
being POSIX. On the consumer's box it produced the tell that root-caused the
entire class: `expected 'unsupported-platform' not to be 'unsupported-platform'`.

Deleting it would have removed genuine coverage of the fallback; leaving it would
have left a test that fails on Windows for being right. It now **destructures the
injected `platform` away** — making the omission explicit, which is the property
under test — and asserts the outcome **each host implies**, with both arms
asserting. It proves the fallback on Windows instead of failing over it.

### Evidence (measured, under the platform simulation)

| condition | result |
|---|---|
| Real host (darwin), before and after | ✅ **62 / 62** |
| Simulated win32, **without** the injection *(the consumer's condition)* | ❌ **39 failed / 23 passed** |
| Simulated win32, **with** the shared helper only | ❌ **8 failed / 54 passed** |
| Simulated win32, **with all three helpers** | ✅ **62 / 62** |

39 measured against the 40 they counted. **Left deliberately unreconciled** — but
the likely shape is worth naming, because it changes who should chase it: this is
almost certainly a **counting question, not a coverage question**. A predicate or
denominator mismatch between their grouping and mine (their FAIL-line grouping vs
my per-case count; a case counted under a neighbouring signature; a hook-level
failure counted as a case) explains a one-off far more economically than a 40th
case that three helper fixes and a simulated-win32 run all failed to touch. This
repo has been bitten by exactly that shape before. The next reader should treat
the gap as arithmetic to be reconciled against their re-run, **not** as a missing
case to hunt — and if their re-run still shows one red case in `nudge`, that
assumption is wrong and it becomes a real finding.

---

## tk-0103 — the capability defect WE shipped in #118 · `[x]`

Ours, found by them, and the lesson is theirs: **presence is not the property
that matters — capability is.** A presence-only guard is worse than no guard,
because the declaration makes the gap look handled and the red gets read as
noise.

### The fix: run the mechanism, don't ask after the name

`test/support/external-binary.ts` gains **`canRunShellScript(shell)`**, which
proves in ONE spawn against a real temp tree the two properties the fixtures
actually depend on:

1. **a script at a NATIVE path runs** — WSL bash eats the backslashes in a
   Windows temp path and exits 127;
2. **a shimmed executable on PATH resolves** — their `which node` inside that
   same WSL bash also failed, so even a correctly-passed path would have died at
   the hook's `node "$bin"` line.

Both in one probe, so it cannot drift from the thing it certifies. It never
throws: any failure reads as "not capable", which is honest — the probe cannot
tell "shell is broken" from "host is unusual", and for skip purposes need not.

`hasBinary()` is **kept, not replaced**, and its doc now says what it is for:
presence is the whole question for a self-contained filter like `jq` (a `jq` that
starts is a `jq` that filters), and the wrong question for anything that
interprets its arguments. `post-commit-hook.test.ts` switched to the capability
probe; `plan-review.test.ts` (jq) correctly stays on presence.

### A second, independent defect in the same file — **FIXED in this round**, and swept

`runHook()` built `PATH` with a **hardcoded `':'`**. On Windows that produces one
unparseable PATH string, so the `node` shim would not have resolved **even under a
fully capable git-bash**. Now `path.delimiter`. Nobody reported this one; it was
sitting behind the 127 and would have surfaced as the next "why is it still red".

**Status, stated explicitly because "found" and "fixed" are the exact pair this
thread keeps getting caught by** (it is the same shape as the `bash` declaration
that looked handled and was not):

- **FIXED**, not merely found. The change is in commit `e825bf99`, in the diff of
  `post-commit-hook.test.ts` — `-  PATH: \`…}:\${process.env.PATH…\`` /
  `+  PATH: \`…}\${delimiter}\${process.env.PATH…\``.
- **Swept as a CLASS, not as an instance.** Grepped `harness/cli/src`,
  `harness/cli/test` and `.harness/extensions` for a `PATH` assembled around
  `process.env.PATH`: **four** sites, of which this was the **only** one that
  joined with a literal `':'`. The other three are the new probe (already uses
  `delimiter`) and two straight pass-throughs in
  `exec-remote-telemetry-git.int.test.ts` (`PATH: process.env.PATH`) that
  concatenate nothing and are correct as they stand.
- **NOT guarded — see D9.** The sweep was a one-off grep by a human, and nothing
  deterministic stops the pattern coming back.

### The wording distinguishes absent from incapable

New `incapableBinaryReason()`, deliberately not confusable with
`missingBinaryReason()`, because the two send a reader to different places:
*"not installed"* is fixed by installing something, *"installed and wrong"* is
fixed by putting a different one earlier on PATH. Being told "not found" about a
binary `which` reports is how an hour disappears. The message names the
capability, names the known cause (WSL bash), says the fix is **PATH order, not
an install**, and says what stopped being checked.

### Evidence — a PERMANENT regression control, not a throwaway

New file `test/support/external-binary.test.ts` (7 cases) builds shells that are
deliberately **present-but-incapable** and asserts the two probes **disagree**:

| case | measured |
|---|---|
| `hasBinary(liar)` — the OLD probe passes a shell that exits 127 *(the shipped defect, reproduced)* | ✅ `true` |
| `canRunShellScript(liar)` — the new probe catches it | ✅ `false` |
| `canRunShellScript(honest)` — still says YES to a working shell *(not merely strict)* | ✅ `true` |
| `blind` shell — runs the script but with PATH emptied | ✅ present, **not** capable |
| absent shell | ✅ incapable, no exception |
| probe leaves no temp dirs behind | ✅ none |
| the two reason strings are not confusable | ✅ |

The first case is non-vacuous by construction: if it ever goes false, the second
proves nothing, because the probes would agree for the boring reason. `7/7`
passing; `post-commit-hook.test.ts` still `4/4` on a real bash (positive control —
the probe does not skip a host that works).

**Expected effect on their box — expected, unverified on win32.** Their 7
failures (4 × `expected 127 to be +0`, 3 × `EPERM` in teardown) become **4 named
skips**, and the 3 EPERM teardown errors disappear with them, since `beforeEach`/
`afterEach` do not run for a skipped describe. If they put git-for-Windows' bash
ahead of `C:\Windows\system32` on PATH, the probe should pass and all 4 cases
should RUN — which is the outcome worth having, and the message now tells them
that is the lever.

### ROUND 2 — the same defect, one level deeper, found by review (terra)

**The fix above was itself incomplete, and its incompleteness was silent.** Terra
found it before the consumer did. Recorded in full because two levels of one
defect have now shipped and the pattern is the finding:

The probe proved native-path execution and shim-on-PATH resolution. But
`runHook()` runs the **real** hook, and the hook reaches `git` **first**:

```sh
repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
bin="$repo_root/harness/cli/bin/harness.js"
[ -f "$bin" ] || exit 0
node "$bin" telemetry sync …
```

Both bail-outs are **`exit 0`**. So a shell that passes a git-blind probe but
cannot resolve `git` — or cannot make a **git-produced** path survive `[ -f … ]`,
which is exactly what a `C:/…` path does to WSL bash — runs the hook to a
**successful exit that did nothing**. The describe runs, `expect(runHook({}))
.toBe(0)` **passes**, and the case fails on the missing marker.

**Level 1 failed loudly with 127. Level 2 fails silently at `exit 0`** — and the
red then looks like a hook defect rather than an unusable shell. A guard that
half-answers is the same mistake as a guard that answers the wrong question, and
it was living inside the fix for the first one.

**The fix.** `probeShell(shell, { requires })` now proves, in one spawn against a
real temp git repo, **every** resolution property the fixture reaches before its
observable: a script at a native path; each required command resolving, running,
and its output **capturable through command substitution**; a **git-produced path
surviving `[ -f … ]`**; and the shim resolving off the prepended PATH — with a
single observable that only appears if all of them succeeded. It also returns
**which step failed**, so the skip message names it instead of saying "incapable".

**Why the probe still refuses to run the hook.** Executing `.githooks/post-commit`
itself would be drift-proof, and was rejected on purpose: a probe that runs the
**subject** cannot tell "this environment cannot run it" from "this hook is
broken", so a genuine hook defect would be reported as an environment gap and the
suite would **skip itself green**. The probe therefore mirrors the hook's
*mechanisms*, never its *logic*. That choice was the PM's stated fork ("either the
probe exercises every property, or the describe guards them separately") — the
probe was chosen over separate per-dependency guards because separate guards
multiply the skip surface while still requiring the same enumeration, and one
place deciding is one place to correct.

**The cost of that choice is drift**, and it is now guarded rather than hoped
about — see the drift control below.

### Round-2 evidence (measured)

| control | measured |
|---|---|
| **The false positive, reproduced** — a `git-blind` shell (runs scripts, resolves the shim, cannot see `git`) is **ACCEPTED** by the old git-blind probe | ✅ `true` |
| **The consequence, demonstrated** — the REAL tracked hook under that shell exits **0** and writes **no marker** | ✅ exit `0`, marker absent |
| **The new probe REJECTS it**, and names the failing step | ✅ `capable: false`, failure names the command |
| **Not merely stricter** — a shell that CAN see git still passes `requires: ['git']` | ✅ `true` |
| **Drift guard** — every external command in the tracked hook is one the probe accounts for | ✅ passes; **and fails naming `jq`** when a `jq` line is added to the hook |
| post-commit-hook on a real bash (positive control) | ✅ `4 / 4` |

The first two rows are what make the third non-vacuous. Without them this would be
a test that a stricter probe is stricter — which is exactly the reassurance that
let level 2 ship.

### ROUND 3 — stop fixing levels, change the entity being enumerated

Terra found **L3**; I reproduced **L4** before shipping. At that point the pattern
mattered more than either instance:

| level | the guard proved | what it missed | found by |
|---|---|---|---|
| L1 | `bash` is PRESENT | WSL bash mangles a native path → exit 127 | the consumer |
| L2 | native path + a generic shim | the hook resolves `git` FIRST | review (terra) |
| L3 | + `git` resolution | the hook invokes `node`, which a shell FUNCTION can shadow | review (terra) |
| L4 | + `node` unshadowed | the hook branches on ENV VARS a startup file can re-export | **reproduced before shipping** |

**The PM proposed enumerating the hook's COMMANDS as the terminating entity. That
was right in form and wrong in content, and I said so before building** — with a
reproduction rather than an argument:

```
startup.sh:  export HARNESS_NO_TELEMETRY=1
run the REAL hook with HARNESS_NO_TELEMETRY='' passed by the caller
→ exit=0, marker ABSENT
```

The caller explicitly set the variable; the startup file re-exported it; the hook
took its first silent exit. **Nothing there is a command.** L1–L3 all happened to
land in the command half of the hook, so "enumerate commands" explained every
level already hit and none of the ones not yet hit — the signature of a frame
fitted to past data.

**The right entity is the hook's SILENT-SUCCESS PATHS**, of which commands are 2
of 5. Still finite, still an entity enumeration, still terminates.

**And the unification underneath both L3 and L4**: `BASH_ENV` does not shadow
*commands*, it shadows **the caller's intent** — a function shadows a command, an
export shadows a variable, one mechanism with two faces. Chasing the faces costs
one round each, forever; proving that *what the caller passed survives into the
script* closes both at once.

#### The count is COUNTED, not read

The enumeration is load-bearing, so it is mechanical and re-runnable:

```sh
grep -nE '\b(exit|return|trap|exec)\b|\|\||&&|set[[:space:]]+-' .githooks/post-commit
```

```
21:set -uo pipefail
28:[ "${HARNESS_NO_TELEMETRY:-}" = "1" ] && exit 0
29:[ "${HARNESS_NO_TELEMETRY_AUTOSYNC:-}" = "1" ] && exit 0
31:repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
33:[ -f "$bin" ] || exit 0   # dist not built / not the harness repo → nothing to do
36:node "$bin" telemetry sync >/dev/null 2>&1 || true
37:exit 0
```

**Five** silent-success paths (28, 29, 31, 33, 36). Line 37 is the normal
terminus, reached only after the work is done, and is excluded. What the output
also shows is what is **absent**: no `trap`, no `return`, no `exec`, and
`set -uo pipefail` carries **no `-e`** — so there is no implicit exit-on-error
path, and `set -u` aborts *loudly* (non-zero), which is not this class. A test
pins the number and fails if a sixth appears.

#### What shipped

- **One `ShellContract`**, `POST_COMMIT_HOOK_CONTRACT`, declaring commands *with
  their invocation shape and provider*, the env guards, the git path test, and
  the silent-path count. **The probe drives off it and the drift guard checks the
  tracked hook against it** — so the two cannot disagree. They did disagree
  before: `node` was in the drift guard's accounted-for set while the probe never
  exercised it, which is precisely how L3 shipped.
- **Shims are named for the command** (`node`, not a generic probe shim), because
  shadowing is name-specific — a generic shim proves nothing about `node`.
- **Exit 0 is not the pass condition.** Every level of this defect exited 0. The
  per-command observables are; a shadowed command returns success having run
  nothing, and its token is the only thing separating the two outcomes.
- The contract parameter is **non-optional**, so a blind probe is not writable.

#### The claim I had to withdraw — measured, not assumed

I told the PM the non-optional parameter would make a contractless probe **fail to
compile**. **That was wrong, and I found it by testing it rather than asserting
it.** `harness/cli/tsconfig.json` has `include: ["src"]`, so **test files are
never typechecked**: a deliberate `const x: number = "s"` added to a test file
passed the gate as `typecheck: ok`. The guarantee was editor-time only — a
guarantee that *reads as enforced and is not*, which is the exact defect class
this task exists to close. Closed with a **runtime precondition that throws**,
plus a control proving it fires. Logged as D13, including the repo-wide residue:
every type-level guarantee living in `test/` is editor-time only here.

#### Round-3 evidence (measured)

| control | measured |
|---|---|
| **L3 false positive** — a `node`-shadowing shell is ACCEPTED by the git-only contract | ✅ `true` |
| **L3 consequence** — the REAL hook under it exits **0** with **no marker** | ✅ |
| **L3 rejected**, naming `node` as shadowed | ✅ |
| **L4 false positive** — an env-re-exporting shell is ACCEPTED by the git-only contract | ✅ `true` |
| **L4 consequence** — the REAL hook under it exits **0** with **no marker** | ✅ |
| **L4 rejected**, naming the caller's value as overridden | ✅ |
| **Not merely stricter** — an unshadowed shell passes the FULL contract *and* the real hook writes its marker | ✅ |
| **Contractless probe throws** rather than guessing | ✅ |
| Drift guard: **new command** added to the hook | ✅ fails naming `jq` |
| Drift guard: **new env branch** added | ✅ fails naming `HARNESS_NEW_OPTOUT` |
| Drift guard: **new silent exit** added | ✅ fails `expected 6 to be 5` |
| Drift guard: **`trap` introduced** | ✅ fails |

Every mutation was applied to the real tracked hook and reverted; all four guards
bite and each one *names the cause* rather than merely going red.

### A defect I introduced in the round-2 control, and fixed at root


The first version of the "probe leaves nothing behind" case listed the **shared**
`os.tmpdir()` for `harness-shell-probe-*`. It passed alone and went **red in the
full suite**, because a second vitest worker's concurrent probe appeared in the
listing — a correct leak check over the **wrong namespace**. That is the identical
defect `exec-remote-telemetry-git.int.test.ts` documents at length, reproduced by
someone who had read that comment an hour earlier. Fixed at root, not retried: the
case now redirects `TMPDIR`/`TMP`/`TEMP` to a private dir for the duration of the
probe, so the listing contains this probe's output and nothing else. Verified
still non-vacuous by disabling the probe's cleanup and watching it fail.

---

## tk-0104 — declare the real-`git daemon` cluster on win32 · `[x]` · **SCOPE NARROWED**

**Deviation from the brief, flagged rather than worked around** — and
subsequently **RULED ON by the PM (`pij-respectable-clam`): keep the narrow
scope.** The task said *"skip `exec-remote-telemetry-git` on win32"*. I scoped the
skip to the **daemon-driving describe** (18 cases) instead of the **file** (91
cases). The PM's ruling, recorded here because it changes this from an open
deviation into a decision: *"Skipping 91 to quiet 16 makes the instrument
blinder, not the signal cleaner… my brief said 'skip the file' because I was
reading their 16 as a target rather than as a symptom."*

The daemon appears in exactly one describe — *"real network-served Git"*. The
other 73 cases are in-process credential discovery, lease handling and config
shaping; they pass on Windows today and are exactly where a Windows product
defect would show up. Skipping them to silence 16 failures would declare 73
things unproven that ARE proven — which is the same error as claiming them
proven, in the opposite direction, and it makes the gap **less** legible rather
than more. **The daemon is the part that cannot run there, so the daemon is the
part that gets declared.** If the PM wants the whole file, say so and I will
widen it — but I am not making the number rounder at the cost of the signal.

The skip text names the transport, names the cause (the daemon holds handles past
SIGTERM, so teardown races the next generation), says why it is not
reimplementable (a faked transport asserts that our fake agrees with our code),
and lists the three specific claims that stop being checked on win32 — while
saying plainly that Linux CI proves all three on every push, so the *claim* is
covered and only its *Windows behaviour* is unmeasured.

### Evidence (measured)

| condition | result |
|---|---|
| Real host (darwin) | ✅ **91 / 91** — nothing lost here |
| Simulated win32 | ✅ **73 passed / 18 skipped** — skip bites, scoped exactly as intended, reason printed |

**Note on the count**: 18 cases are declared; they measured 16 failing. The extra
two were presumably passing on their box. That is 2 cases of coverage genuinely
given up, and it is stated rather than absorbed into a fixed-failures number.
Stating that cost is what makes the narrowing a decision rather than a preference.

**Status: SETTLED.** PM ruling received and recorded above — the narrow scope
stands, and the brief's "skip the file" wording is superseded.

---

## tk-0105 — re-measure and report · see the phase summary below

---

## Discoveries & Learnings

| # | Tag | What |
|---|---|---|
| D1 | **Noteworthy** | tk-0102's "one line, ~40 failures" was **80% of the class**. Two further helpers in the same file had the identical defect and were invisible to the consumer's grouped signatures. Found by running a negative control, not by reading. |
| D2 | **Noteworthy** | tk-0102's fix **breaks a legitimate control** at `nudge.test.ts:~1605` — one that was itself host-dependent, asserting the POSIX outcome while depending on the host being POSIX. Repaired to assert per-host rather than deleted. |
| D3 | **Noteworthy** | tk-0104 **narrowed** from "skip the file" (91) to "skip the daemon cluster" (18). Over-declaring is as dishonest as over-claiming. PM's call to widen. |
| D4 | **Noteworthy** | A second, unreported Windows defect in `post-commit-hook.test.ts`: `PATH` built with a hardcoded `':'`. It would have kept the file red even under a fully capable git-bash, and was hidden behind the exit-127. **FIXED this round** (`e825bf99`) and swept as a class: 4 PATH-assembly sites repo-wide, this was the only literal-`':'` join. |
| D5 | **Noteworthy** | Three files' `vi.setConfig({ testTimeout: 20_000 })` became **downgrades** under the new 30s global floor — silently re-creating the bug in the three slowest files. Removed; their measurements kept as docs. |
| D6 | **Deferred** | The `platform` fallback in `nudge.ts` is only *reachable* via the composition root now, so a future helper that forgets `platform` will again read the host. Nothing enforces injection. A lint/arch rule would; not in this round's scope. |
| D7 | **Deferred** | 2 cases of real coverage given up on win32: 18 daemon cases declared vs 16 they measured failing. |
| D8 | **Noteworthy** | The platform simulation (`process.platform` redefined at setup) is a cheap and genuinely useful instrument for platform-BRANCH defects, and it is **not in the repo**. Worth encoding as a harness affordance so the next person does not rebuild it — see the harness note below. |
| D9 | **Deferred** | **D4's class is fixed but UNGUARDED.** `windows-check` scans `.harness/extensions/**` only — `harness/cli/test/**` and `src/**` are explicitly out of its scope — and it has **no PATH-delimiter rule** in WIN001–WIN008 at all. So a reintroduced `':'` PATH join is silently green in both directions: wrong layer, and no rule even if the layer were right. Its own briefing names this failure mode ("a missing rule stays silently green"). A WIN009 rule plus a scope extension would close it; not this round. |
| D10 | **Noteworthy** | **The tk-0103 fix was itself incomplete, and silently so** — found by review (terra), not by a run. A probe proving only the LAST link of a resolution chain accepts a shell that makes the hook `exit 0` having done nothing. Level 1 failed loudly (127); level 2 failed silently. The general lesson: when a guard's subject bails out with a SUCCESS code, a partial guard converts a skip into a false pass, so the guard must cover every property reached *before the observable*, not merely the property that failed last time. |
| D11 | **Deferred** | The probe deliberately does **not** run the hook (a probe that executes its subject reports a broken subject as an environment gap and skips itself green), so it can drift from the hook. Mitigated by a control that reads the tracked hook and fails naming any external command the probe does not account for — verified by adding `jq` to the hook and watching it fail. **Mitigated, not eliminated**: the scan is textual, so an obscure invocation shape could still slip past. |
| D12 | **Noteworthy** | **A comment is a reminder, and reminders do not survive contact with a different file.** The round-2 leak control listed the SHARED `os.tmpdir()` and went red only under full-suite parallelism — the exact "correct leak check over the WRONG namespace" defect that `exec-remote-telemetry-git.int.test.ts` documents in a long, well-written comment I had read an hour earlier, in another file, while working on this very task. The prose did not transfer; nothing was reachable at the point of use. **GENERAL RULE**: knowledge that must be applied at a point of use has to be reachable there **as a tool** — a shared helper, a fixture, a lint rule, a default — not as prose in a neighbouring file. Prose scales with the reader's attention; a helper scales with reuse. This is encode-don't-remind one level over: the earlier author DID encode the lesson, but encoded it as an **explanation** rather than as an **affordance**, so the next person had to re-derive it by failing. The fix that would have carried it: a shared private-temp-namespace helper in `test/support/`, which is now the obvious candidate for a later round. |
| D13 | **Deferred** | **The "fails to compile" guarantee is editor-only, and I claimed it before measuring.** The contract parameter is non-optional, which should make a blind probe uncompilable — but `harness/cli/tsconfig.json` sets `include: ["src"]`, so **test files are never typechecked**. Measured, not assumed: a deliberate `const x: number = "s"` added to a test file passed the gate as `typecheck: ok` (biome caught that particular line, but biome has no type information and would not catch a missing argument). Closed with a **runtime** precondition that throws, plus a control that proves it fires. The residual gap is repo-wide and out of scope here: **no test file in this repo is typechecked by the gate**, so every type-level guarantee that lives in `test/` is editor-time only. Two files in `src/` already document this boundary. |

### Harness note (invariant #14 — pay the difficulty forward)

**Twice this round the durable fix was an AFFORDANCE and what we had was PROSE** —
D6 (platform injection is a convention; nothing enforces it) and D12 (a
private-namespace idiom documented in one file, re-broken in another). Both are
the same shape: **a rule that lives in a comment is a rule the next file does not
inherit.** Two independent instances in one round is a pattern rather than a
coincidence, which is why it is stated here and not only in the ledger.

The gap this round kept hitting: **there is no way to run this suite as another
platform.** I rebuilt a throwaway `process.platform` override three times. A
tracked `vitest --config vitest.win32.config.ts` (or a `just test-as-win32`
recipe) would have made tk-0102's hidden helpers visible in the first minute
instead of the tenth, and would let anyone check a platform-branch fix without
owning a Windows box. It does **not** substitute for a real Windows run — it
proves branching only — and its doc must say so, or it becomes the next
presence-vs-capability mistake. Recommended for a later round; deliberately not
smuggled into this one.

---

## Phase summary — the three columns

**Never a total that mixes them.** All win32 figures are *expected, unverified on
win32*; the measured column states what was actually observed and where.

| | count | basis |
|---|---:|---|
| **FAILURES FIXED** (become passes) | **39–40** *(nudge)* **+ up to 46** *(timeouts)* **+ 3** *(EPERM teardown)* | nudge: 39 measured under platform simulation, 40 by their count. Timeouts: their own 46 FAIL lines; "up to", because a genuine hang still fails. EPERM: teardown errors that stop occurring once the describe is skipped. |
| **FAILURES DECLARED** (become named skips) | **16** *(daemon)* **+ 4** *(post-commit-hook)* | Loud skips naming what stopped being checked. **This is coverage we do not have**, not coverage we gained. 18 cases skipped for 16 failures — 2 were passing. |
| **SKIPS RECOVERED** (become real coverage) | **0** | Nothing previously skipped was restored this round. |

**Trajectory**: their ~140 → **~35–40** if the timeout class behaves as their own
measurement indicates. The brief predicted ~40. I am not claiming the number —
their re-run is the measurement, and the timeout component is the wide part of the
error bar.

**Suite denominator changes**: +19 cases (`external-binary.test.ts`, including the
round-2 and round-3 controls), so their 5096 becomes **5115**.

### Local gate (measured, macOS)

`just checks` — **every hard gate ok**: `tests:ok biome:ok typecheck:ok
check:docs:ok check:flows:ok check:telemetry-fixtures:ok check:doctrine-parity:ok
check:dd-docs:ok root-invocation-smoke:ok dd doctor:ok skills-check:ok`.
Three warn-launch degradeds (`arch-check`, `markdown-lint`, `windows-check`) are
pre-existing; `windows-check`'s 6 findings are all in `.harness/extensions/html-snap/`,
none in any file this phase touched.

**Full suite: 5115/5115, three consecutive clean runs** — run repeatedly on
purpose, because the round-2 control that had to be repaired (D12) failed only
under full-suite parallelism and passed in isolation. A single green run would
have been an honest report of an unreliable measurement.

### What a reviewer should look at first

1. **tk-0104's narrowing** (D3) — a deliberate deviation from the written task,
   since **ruled on and upheld** by the PM. Reviewable as a decision with its
   cost stated (2 cases given up), not as an open question.
2. **The repaired control** in `nudge.test.ts` (D2) — the only place a test's
   assertion semantics changed rather than its inputs.
3. **The global-vs-win32 timeout choice** (tk-0101) — it affects every test on
   every platform, and it is the one change here that is not test-local.
4. **D9** — the PATH-delimiter class is fixed but has no deterministic guard, in
   a repo whose whole thesis is that back-pressure beats vigilance.
