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

39 measured against the 40 they counted. I have not tried to reconcile the last
one and will not guess at it — their re-run resolves it exactly.

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

### A second, independent defect in the same file — fixed

`runHook()` built `PATH` with a **hardcoded `':'`**. On Windows that produces one
unparseable PATH string, so the `node` shim would not have resolved **even under a
fully capable git-bash**. Now `path.delimiter`. Nobody reported this one; it was
sitting behind the 127 and would have surfaced as the next "why is it still red".

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

---

## tk-0104 — declare the real-`git daemon` cluster on win32 · `[x]` · **SCOPE NARROWED**

**Deviation from the brief, flagged rather than worked around.** The task said
*"skip `exec-remote-telemetry-git` on win32"*. I scoped the skip to the
**daemon-driving describe** (18 cases) instead of the **file** (91 cases).

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

---

## tk-0105 — re-measure and report · see the phase summary below

---

## Discoveries & Learnings

| # | Tag | What |
|---|---|---|
| D1 | **Noteworthy** | tk-0102's "one line, ~40 failures" was **80% of the class**. Two further helpers in the same file had the identical defect and were invisible to the consumer's grouped signatures. Found by running a negative control, not by reading. |
| D2 | **Noteworthy** | tk-0102's fix **breaks a legitimate control** at `nudge.test.ts:~1605` — one that was itself host-dependent, asserting the POSIX outcome while depending on the host being POSIX. Repaired to assert per-host rather than deleted. |
| D3 | **Noteworthy** | tk-0104 **narrowed** from "skip the file" (91) to "skip the daemon cluster" (18). Over-declaring is as dishonest as over-claiming. PM's call to widen. |
| D4 | **Noteworthy** | A second, unreported Windows defect in `post-commit-hook.test.ts`: `PATH` built with a hardcoded `':'`. It would have kept the file red even under a fully capable git-bash, and was hidden behind the exit-127. |
| D5 | **Noteworthy** | Three files' `vi.setConfig({ testTimeout: 20_000 })` became **downgrades** under the new 30s global floor — silently re-creating the bug in the three slowest files. Removed; their measurements kept as docs. |
| D6 | **Deferred** | The `platform` fallback in `nudge.ts` is only *reachable* via the composition root now, so a future helper that forgets `platform` will again read the host. Nothing enforces injection. A lint/arch rule would; not in this round's scope. |
| D7 | **Deferred** | 2 cases of real coverage given up on win32: 18 daemon cases declared vs 16 they measured failing. |
| D8 | **Noteworthy** | The platform simulation (`process.platform` redefined at setup) is a cheap and genuinely useful instrument for platform-BRANCH defects, and it is **not in the repo**. Worth encoding as a harness affordance so the next person does not rebuild it — see the harness note below. |

### Harness note (invariant #14 — pay the difficulty forward)

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

**Suite denominator changes**: +7 cases (`external-binary.test.ts`), so their 5096
becomes 5103.

### Local gate (measured, macOS)

`just checks` — **every hard gate ok**: `tests:ok biome:ok typecheck:ok
check:docs:ok check:flows:ok check:telemetry-fixtures:ok check:doctrine-parity:ok
check:dd-docs:ok root-invocation-smoke:ok dd doctor:ok skills-check:ok`.
Three warn-launch degradeds (`arch-check`, `markdown-lint`, `windows-check`) are
pre-existing; `windows-check`'s 6 findings are all in `.harness/extensions/html-snap/`,
none in any file this phase touched.

### What a reviewer should look at first

1. **tk-0104's narrowing** (D3) — a deliberate deviation from the written task.
2. **The repaired control** in `nudge.test.ts` (D2) — the only place a test's
   assertion semantics changed rather than its inputs.
3. **The global-vs-win32 timeout choice** (tk-0101) — it affects every test on
   every platform, and it is the one change here that is not test-local.
