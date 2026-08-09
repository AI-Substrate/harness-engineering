# Phase 1 platform findings — what is MEASURED, and what is not

**Written**: 2026-08-10 · **By**: `pij-cautious-firefly` (Phase 1 coder) · **Plan**: 082

This file exists because "we will hand Windows to the remote agent" is a promise, and a promise
without an artifact is how a gap becomes a surprise at review. Everything below is either a
measurement with its invocation pasted, or an explicit statement that no measurement was taken.

---

## Summary

| platform | the runtime (guard + intercept + verb) | the live-daemon note (ac-0001 / ac-0002) |
|---|---|---|
| **macOS** (arm64, this machine) | **MEASURED** — all rows green | **MEASURED** against a live git-ai 1.6.21 daemon |
| **Linux** (Ubuntu plucky, aarch64, OrbStack) | **MEASURED** — all rows green | **SKIPPED** — no daemon in the VM (the skip path itself is proven) |
| **Windows** | **UNVERIFIED** — no instrument | **UNVERIFIED** |

---

## macOS — measured

Host: Darwin arm64. `git-ai bg run` live at the pinned **1.6.21**, both sockets present at
`~/.git-ai/internal/daemon/`.

```
cd harness/cli && HARNESS_TEST_SCOPE=all npx vitest run test/services/hooks/
```

All hooks suites green, including the 32-row provocation suite against real git and the paired
live-daemon note fixture (positive MEASURED — see the execution log for the note verbatim).

## Linux — measured

The plan's own Key Finding says the unsandboxed-hook-runner premise was measured on macOS **only**
and that "the entire design rests on this". So the runtime was run on Linux.

Host: `Linux 7.0.14-orbstack aarch64`, Ubuntu plucky, **node v22.23.2**, **git 2.48.1**.

macOS-built `node_modules` cannot be reused — rolldown's native binding is per-platform and fails
to load — so the tree was copied into the VM and its dependencies installed there. Invocation,
verbatim:

```
orb -m ubuntu bash -lc '
  SRC=<worktree>; DST=$HOME/082-linux
  tar --exclude=node_modules --exclude=.git --exclude=dist -cf - . | (cd "$DST" && tar -xf -)
  cd "$DST" && npm ci
'
orb -m ubuntu bash -lc '
  cd $HOME/082-linux/harness/cli && HARNESS_TEST_SCOPE=all npx vitest run test/services/hooks/
'
```

Result:

```
 ✓ test/services/hooks/classify-head-transition.test.ts (35 tests)
 ✓ test/services/hooks/scan-command.test.ts            (36 tests)
 ✓ test/services/hooks/trace2-tickler.test.ts          (12 tests)
 ✓ test/services/hooks/live-daemon-note.int.test.ts     (2 tests)
 ✓ test/services/hooks/hook-state.test.ts              (14 tests)
 ✓ test/services/hooks/provocation.int.test.ts         (32 tests)
 ✓ test/services/hooks/hooks-verb.int.test.ts           (7 tests)

 Test Files  7 passed (7)
      Tests  138 passed (138)
```

**What this establishes**: the guard, the intercept, the state store's atomic write and `O_EXCL`
claim, the command scan, and the `harness hooks fire` verb all behave identically on Linux. The
provocation suite's 32 real-git rows — every class (a) row, all seven measured defeaters, the
concurrency row and the known-blind rows — are green on Linux too, so the guard's correctness is
not a macOS artefact.

**What this does NOT establish**: the live-daemon note. There is no git-ai daemon in the VM, so the
fixture recorded **SKIPPED** and said so:

```
live-daemon note fixture — POSITIVE SKIPPED: no af_unix collector socket
  (trace2.eventTarget=unset). ac-0001/ac-0002 are UNVERIFIED in this environment.
```

That is a useful second result in itself: it proves the SKIPPED path behaves correctly on a machine
with no daemon, which is **exactly the CI condition**. CI will record a skip, not a false pass.

---

## MEASURED: an over-emit does NOT fabricate agent authorship

This was the plan's biggest open question — *what does an over-emitted commit actually cost?* — and
it was answered accidentally, by a flake.

The live-daemon fixture initially asserted that the note attributed `a.txt:1-3` to the **agent
session**. It passed, then failed intermittently. The cause was not timing: for the **same commit
shape**, this machine's daemon writes **two different notes**, and both are real:

```
a.txt
  s_ed609d39de2442::t_eb4de9492947b2 1-3     <- AGENT  (session::turn, body has "sessions")
```

```
a.txt
  h_9e71e8b09f7cf2 1-3                        <- HUMAN  (no "::",     body has "humans")
```

Observed across five consecutive runs: **agent ×1, human ×4.**

**What this establishes.** Our six events tell the daemon *a commit happened here*; they do **not**
determine who the lines are attributed to. That is git-ai's own computation over the checkpoint
records **its** hooks wrote, and in a throwaway repository with no agent checkpoints covering those
lines it falls back to **human**. So an over-emit does **not** invent agent authorship out of
nothing — the observed failure direction is a note attributed to the **human**, not a false claim
that the agent wrote someone else's code.

That is a *measurement*, and it is narrower than either previous guess. It is **not** a claim that
a false agent attribution is impossible: it was not observed here, in a repository with no agent
checkpoint records. A repository where the agent HAS recent checkpoints is a different case and
remains unmeasured.

**Consequence for the fixture**: it now asserts only what our emit actually causes — a note exists,
anchored to this sha (`base_commit_sha`), with an `authorship/` schema, naming this file and this
line range with an actor id cross-referenced against the note's own body. Which KIND of actor is
**recorded and reported**, never required. Asserting agent attribution would have been asserting a
property of someone else's system that we do not control, which is exactly why it flaked.

---

## Windows — UNVERIFIED, and here is precisely what needs doing

Handed to the remote agent on **#108**. Nothing below is a claim; it is a work list.

**Why it cannot be inferred from the macOS/Linux results.** The whole emit path changes shape:

1. **The ingress is a NAMED PIPE, not an `af_unix` socket.** git-ai derives
   `\\.\pipe\git-ai-<digest>-trace2` on win32. `Trace2Tickler` reads git's global
   `trace2.eventTarget` and deliberately returns `null` for anything that is not `af_unix:` — so on
   Windows **the tickler will refuse to emit and journal
   `no af_unix trace2 ingress configured`**. That is honest (it claims no delivery it did not make)
   but it means the feature is **inert on Windows today**. A named-pipe write path is required, and
   `SocketRelayPort` does not currently provide one.
2. **`createExclusive` (`O_EXCL`) semantics.** `openSync(path, 'wx')` maps to `CREATE_NEW` on
   Windows and should hold, but it is unverified here — and it is the mechanism the whole
   concurrency guarantee rests on.
3. **Path handling in the state store.** Keys are built with `/` separators
   (`${stateDir}/${hash}.json`). Node accepts this on Windows, but the prune's
   `listRegularFilesNoFollow` + name-prefix matching should be confirmed against a real
   Windows path.
4. **The provocation suite's git invocations.** `git apply`, `read-tree -m -u` and `restore
   --source` are exercised through real git; line endings (`core.autocrlf`) may alter the patch
   rows specifically.

**The one-line ask for #108:**

```
cd harness/cli && $env:HARNESS_TEST_SCOPE='all'; npx vitest run test/services/hooks/
```

…and report (a) which rows fail, (b) whether the live-daemon fixture SKIPs or finds a pipe, and
(c) the value of `git config --global --get trace2.eventTarget` on that host.

**Until that report lands, Windows stays UNVERIFIED and the emit path there is believed inert.**
Do not describe this feature as cross-platform.
