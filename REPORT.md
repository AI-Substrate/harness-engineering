# Slow-test audit — what dominates, and what will hurt disproportionately on Windows

Branch `perf/slow-test-audit`, worktree `perf-slow-tests`, cut from `main` @ `ab1e7e75`.
Measured 2026-08-07 on Apple M4 Max, 16 cores, 137 GB RAM, node v24.7.0, vitest 4.1.10.

**Load caveat, stated up front:** this box was running ~10 agent seats during the
audit — `loadavg` was **121 on 16 cores**. Every wall-clock number here is a
*contended* number. That does not weaken the structural findings (spawn counts,
phase splits, critical path), but it inflates spread, and the spread is itself a
finding (§6).

---

## 1. Headline

**The problem is concentrated, not a long tail — and it is two different problems
stacked on top of each other.**

- **Concentration:** the top 5 of 342 files are **63.5%** of summed file time.
  9 files ≥ 3 s are **76.1%**. 325 files are under 1 s and together are 13.2%.
- **Critical path:** the suite's wall time *is* its longest file. Measured, by
  deletion:

  | run | wall |
  |---|---|
  | full suite (342 files) | **24.8 s** |
  | minus `exec-remote-telemetry-git.int.test.ts` (341 files) | **18.8 s** |
  | minus that + `pre-commit-hook` + `pty-input` (339 files) | **11.8 s** |

  Removing **3 files (0.9%)** halves the suite. Adding cores cannot help; the
  suite cannot finish faster than its slowest single file.

- **Two causes, different fixes:**
  - **Head (top 10 files):** 75.8 s of test bodies, **1 306 of the suite's 1 617
    spawns**. Spawn-bound → Windows `CreateProcess` penalty.
  - **Tail (332 files):** 45.4 s of *module import* against only 21.5 s of test
    bodies. For the **276 files that spawn nothing and write nothing, 86.3% of
    their cost is module import** — paid 342 separate times, once per isolated
    worker. Windows → NTFS metadata + Defender on module resolution, not CPU.

---

## 2. Measured primitive counts (whole suite)

Counted **dynamically, not by regex**: a `--require` preload patches
`child_process`, `fs`, `fs.promises`, `net`/`http`/`https` and `node-pty`, and
attributes every call to `__vitest_worker__.filepath`. See §8 for how the probe
was validated and where it is blind.

| primitive | count |
|---|---|
| child-process spawns **in test bodies** | **1 617** |
| ├─ real `git` | **1 524** (94%) |
| ├─ `node`/`npm`/`npx` | 32 |
| └─ other (`which`, `chmod`, `grep`, `python3`, `zsh`) | 61 |
| worker forks (`forks.js`, one Node process **per test file**) | **342** |
| `git` spawned by the vitest **main** process | 42 |
| **total process creations per suite run** | **≈ 2 001** |
| `mkdtemp` (temp dirs created) | 412 |
| file writes | 1 264 |
| `mkdir` | 849 |
| all mutating fs ops | 3 461 |
| fs reads — workers | 31 539 |
| fs reads — main process (vite transform/resolve) | 43 725 |
| loopback servers | 4 |
| socket connects | 24 |
| node-pty | **0** (see §5 — the PTY test is python3-based) |

Spawns are extremely concentrated:

- top **1** file = **44.0%** of all suite spawns
- top **3** files = **61.0%**
- top **5** files = **74.3%**
- top 10 files = 85.8%
- **304 of 342 files spawn nothing at all**

### Local per-primitive cost floor (measured on this box, under load)

| operation | local cost |
|---|---|
| `git --version` / `git rev-parse` spawn | **~7.0 ms** |
| `git init` of a fresh fixture repo | **~28 ms** |
| bare `node -e ''` startup | **~26 ms** |
| `node harness/cli/bin/harness.js --version` | **~320 ms** |
| `mkdtemp` + 10 writes + `rm -rf` | ~10 ms |

So 1 524 git spawns ≈ **10.7 s of pure spawn floor locally**, before any git does
any work. That is the number the Windows multiplier applies to.

---

## 3. The B list — disproportionately slow on Windows, ranked

Ranked by spawn-weighted risk, not local wall time.

### B1. `test/adapters/git/exec-remote-telemetry-git.int.test.ts` — **712 git spawns**

- **712 spawns, all real `git`** — 44% of every spawn the suite makes, in one file.
- 73 `mkdtemp`, 170 mutating fs ops, **3 loopback `net` servers** (it serves Git
  over a real socket), 91 tests, 2 570 lines.
- Local median **25.5 s**, spread **13.4 s (52%)** — min 22.2 s, max 35.5 s.
- Contains the suite's slowest single test at **5.9 s median (max 12.8 s)**.

This one file is simultaneously the #1 spawn source, the #1 wall-clock file, and
the suite's critical path. On Windows it pays the `CreateProcess` penalty 712
times, the NTFS/Defender penalty on 73 fresh temp trees, *and* the slower
loopback-socket penalty on 3 servers. It is the single highest-leverage target by
a wide margin.

**Recommendation:** shard it (31 `it`s across ≥4 files) so it stops being the
critical path, and amortise fixtures — 712 spawns for 91 tests is ~8 git calls
per test, much of it per-test repo construction that could be built once and
copied.

### B2. `test/integration/pre-commit-hook.test.ts` — **155 spawns for 15 tests**

- 142 `git` + 13 `chmod`, 13 `mkdtemp`, 139 fs ops.
- Local median **18.2 s**, spread 4.7 s (26%). ~1.2 s per test.
- Holds the #2 and #3 slowest individual tests (4.2 s and 3.7 s median).

~10 spawns per test, and `chmod` per fixture is a second Windows-hostile detail:
POSIX permission bits are emulated on Windows and hook executability behaves
differently. Second-biggest single win.

### B3. `test/adapters/git/exec-git-write.int.test.ts` — **119 git spawns**

Median 6.0 s, spread 15% (the most *stable* of the heavy files, so this is close
to its true cost). 119 spawns / 14 tests ≈ 8.5 git calls per test.

### B4. `test/adapters/git/cat-file-batch.int.test.ts` — **117 git spawns**

115 `git` + 2 `grep`, 8 `mkdtemp`, **166 fs ops** for only 8 tests. Median 6.9 s,
spread 60%. One test builds a 150-entry tree (1.7 s median) — that is 150 small
file creations, exactly the NTFS + Defender worst case.

### B5. `test/app.test.ts` — **99 spawns + 11 socket connects**

88 `git` + 11 `which`. `which` is notable: on Windows, PATH probing has to try
every `PATHEXT` extension, so `which`-style lookups are markedly worse than the
single `stat` they cost on POSIX. Median 3.3 s, and it is also the #2 file by
module-import cost (1.6 s).

### B6. `test/integration/dd-flow-gate.int.test.ts` — **17 spawns, but all full Node CLI processes**

Only 17 spawns, so it ranks low on raw count — and that is misleading. Every one
is a `node` process running the real CLI, measured locally at **~320 ms each**.
Median 3.05 s for 3 tests.

This is also where my probe is **blind**: git spawned *by* those child CLI
processes is a grandchild and is not counted. **This file, and the 8 files that
spawn `node`, are undercounted — never overcounted.** On Windows each entry is
`CreateProcess` + full Node startup + Defender scanning `node_modules`.

### B7. The 342 worker forks — a config-level cost that hits every file

The suite creates **one fresh Node process per test file** (measured: 342
`forks.js` spawns). Locally that is ~26 ms of bare Node startup each; a vitest
worker loads far more than bare Node. On Windows this is 342 `CreateProcess`
calls before a single assertion runs, plus 342 re-resolutions of the module
graph. See §7 for what can and cannot be done about it.

### B8. The mid-tier git files — 29–46 spawns each

`git-read` (46), `update-banner` (45 + 5 `which`), `doctor` (36), `plan-semantics`
(29), `archive-move` (29), `dd-graph-map-live` (25), `dd-links-live` (20).
Individually unremarkable; collectively ~230 spawns. These matter on Windows in
aggregate but none is worth surgery on its own.

### B9. `test/services/telemetry/capture-reconcile.test.ts` — fs-hostile, spawn-free

**0 spawns but 828 fs ops and 51 `mkdtemp`** — the purest NTFS/Defender exposure
in the suite. Only 952 ms locally, so it is invisible on a Mac. Also 137% spread.
Same shape, smaller: `capture-stall-070.int` (159 ops / 12 tmpdirs),
`flow-dd-gate` (158 / 26), `dd-write-live` (133 / 12).

---

## 4. The tail — an import problem, not a test problem

This is the finding the packet predicted, and it is real.

| | test bodies | module import (collect) |
|---|---|---|
| top 10 files | 75.8 s | 5.8 s |
| tail 332 files | 21.5 s | **45.4 s** |
| 276 inert files (no spawn, no writes) | 4.6 s | **29.1 s (86.3%)** |

Per-file medians across the suite: **test body 9 ms, module import 81 ms** — the
median test file spends **9x longer importing than testing**.

Suite phase totals (median of 4 runs): `transform 21.8 s, import 50.7 s,
tests 119.5 s, setup 0 ms, environment 16 ms`. The main process alone performs
**43 725 file reads** doing transform and resolution.

On Windows, module resolution is a `stat`-storm on NTFS with Defender inspecting
every `node_modules` file touched (`node_modules` here is **338 MB**). This cost
is spread thinly across 300+ files, so it will never show up in a "slowest tests"
list — it will just make everything uniformly slower. **This is Cause B, not
Cause A**, and it is invisible to per-test timing.

---

## 5. The A list — just a slower box, or not slow on Windows at all

- **`test/sensors/tui/pty-input.test.ts` — 10.4 s locally, #3 by wall time, and it
  almost certainly costs ~0 on Windows.** It is guarded by
  `process.platform !== 'win32' && python3 -c 'import pty, termios' && zsh --version`.
  `termios`/`pty` are POSIX-only and `zsh` is not present, so `describePty`
  becomes `describe.skip`. Its local cost is dominated by a **full `tsc` compile
  in `beforeAll`**. Delete it from the Windows suspect list; it is a *local*
  problem only. (This also explains the measured `node-pty = 0`.)
- `test/services/flow/flow-renderer.test.ts` — 3.1 s, 58 tests, 3 node spawns.
  Mermaid parsing; CPU-bound, scales linearly. One line.
- `test/services/dd/plan/ready.test.ts`, `plan-semantics`, `doctor` — moderate
  mixed cost, mostly linear.
- **Coverage is not a suspect.** `vitest run --coverage` measured 25.3 s vs 24.8 s
  without — ~2%. v8 coverage is cheap here.

---

## 6. Load sensitivity is itself a finding

At loadavg 121/16, individual tests swung wildly across 4 runs — one test ranged
**121 ms → 6 555 ms (54x)**; the slowest test ranged 3.9 s → 12.8 s.

Files whose spread exceeds their own median:

| file | median | spread | spawns |
|---|---|---|---|
| `integration/post-commit-hook.test.ts` | 1 577 ms | 2 668 ms (169%) | 12 |
| `services/telemetry/publication-boundary.test.ts` | 1 038 ms | 1 694 ms (163%) | 13 |
| `services/telemetry/git-read.test.ts` | 1 873 ms | 2 794 ms (149%) | 46 |
| `services/telemetry/capture-reconcile.test.ts` | 952 ms | 1 303 ms (137%) | 0 |
| `services/flow/archive-move.test.ts` | 3 828 ms | 4 611 ms (120%) | 29 |
| `integration/update-banner.test.ts` | 1 612 ms | 1 814 ms (113%) | 45 |

A weaker box is *always* closer to contention than this one is, so it will sit at
the high end of these ranges rather than the median. This is a mechanism by which
a "2x slower CPU" produces much worse than 2x — and it concentrates in exactly
the spawn-heavy and tmpdir-heavy files.

---

## 7. Config findings

**`harness/cli/vitest.config.ts` declares no `poolOptions`, no `pool`, no
`maxForks`, no `fileParallelism`.** Everything runs on vitest defaults.

1. **Default `pool: 'forks'` + `isolate: true` ⇒ 342 Node processes.** Confirmed
   by measurement, not inference (342 `forks.js` spawns, ~342 distinct worker
   PIDs). This is the single largest structural Windows cost outside B1.

2. **`pool: 'threads'` — the obvious fix — is blocked, and I measured why.**
   `--pool=threads` produces **178 failures**; root cause is
   `TypeError: process.chdir() is not supported in workers`. `process.chdir` is
   used by **19 of 342 files, 51 call sites** (all of `test/acts/*`, plus
   `archive-move`, `ready`, `builder-rels`, `envelope-fact-address`,
   `exec-remote-telemetry-git`). Threads would replace 342 `CreateProcess` calls
   with 342 `CreateThread` calls — a very large Windows win — but it costs a
   refactor of those 19 files onto an explicit-cwd API.

3. **`--isolate=false` measured:** import 50.7 s → **38.8 s (−24%)**, but it
   **breaks 5 tests in 1 file**. Real but modest prize, real risk. Not free.

4. **`maxForks` defaults to core count.** On a weak box that is fewer forks, which
   is correct behaviour — so this is *not* the thrash risk the packet
   hypothesised. The memory shape is worth a look though: 342 sequential Node
   processes on a box with less RAM plus Defender scanning each one's module
   loads is a different pressure than on a 137 GB Mac.

5. **Tuning concurrency cannot help until B1 is split.** The suite is critical-path
   bound (§1): wall time ≈ longest file. More or fewer workers changes nothing
   while one file takes 25 s.

---

## 8. How this was measured, and where it is blind

**Measured (dynamic, verified):**
- 5 full suite runs (4 with `--reporter=json`, 1 with a probe preload), plus 3
  exclusion runs, 1 coverage run, 1 threads run, 1 `isolate=false` run.
  All 5 full runs: **342 files / 5 015 tests, green**.
- Per-file wall times: median/min/max/spread across 4 runs.
- Per-file phase split via a custom vitest-4 reporter reading
  `TestModule.diagnostic()` (`duration`, `collectDuration`, `prepareDuration`).
- Primitive counts via a `--require` preload patching node builtins.

**Probe validation (per the standing instruction — a surprising negative was
checked, and the probe was wrong twice):**
1. First I verified a CJS-preload patch is visible to ESM *named* imports
   (`import { execSync } from 'node:child_process'`) — it is, when patched before
   the ESM facade is created.
2. First full run returned **`__unattributed__` for everything and zero git**.
   That was a probe bug, not a finding: vitest **kills** pool workers, so
   `process.on('exit')` never fires in them. Fixed by flushing at every test-file
   boundary, every 200 events, and on signals.
3. `currentFile()` then returned an *object* — vitest 4 changed
   `ctx.files[0]` from a string to `{filepath,...}`. Fixed by normalising.
4. Validated against a known file: `cat-file-batch.int.test.ts` → 117 spawns
   (115 `git`, 2 `grep`), 8 tmpdirs, 150 writes. Consistent with reading the file.
5. `node-pty = 0` was checked rather than believed → the PTY test uses python3
   `pty.openpty()`, and is Windows-skipped (§5). The negative was correct.

**Inferred, not measured — flagged as such:**
- The **~10x `CreateProcess` vs `fork`/`exec`** ratio, the NTFS-vs-APFS metadata
  gap, and Defender's per-file scan cost are platform characteristics I did not
  measure. Every Windows statement here is *"N of these, and each is
  categorically more expensive there"* — deliberately **no extrapolated Windows
  seconds**.

**Blind spots, stated as unestablished:**
- **Grandchild processes are not counted.** `git` spawned by a spawned
  `node harness.js` is invisible. The 8 files spawning `node` (B6 chiefly) are
  **undercounted**; the true suite spawn total is above 2 001.
- **I did not measure the composite gate.** The packet's ~1 m 27 s local vs ~13 min
  Windows is `harness checks`; I measured `vitest run` at ~25 s. Safe components
  I did time — biome 1.2 s, `tsc --noEmit` 1.7 s, markdown-lint 2.2 s — total ~5 s,
  so **roughly 55 s of the local gate is neither tests nor those three**. That
  remainder (build/emit, docs/flows/telemetry drift guards, arch/skills/windows
  checks) is **unmeasured and could be a large share of the Windows 13 minutes.**
  I avoided running `harness checks` because it pushes telemetry refs on exit and
  the packet forbids pushing. **This is the biggest open gap in the audit.**
- **The suspected flake was not reproduced.** The packet flagged
  `exec-remote-telemetry-git.int.test.ts` for 4 tests that fail locally from a
  teardown race. Across 5 full runs it was **green every time** (91/91). Its 52%
  spread is consistent with a teardown/contention sensitivity, but I did not
  observe a failure and cannot confirm the mechanism.
- All numbers come from one contended machine. Absolute values would be lower on
  an idle box; the ratios and counts would not change.

---

## 9. Recommendations, ordered by expected Windows saving

1. **Split and de-fixture `exec-remote-telemetry-git.int.test.ts` (B1).** 712 git
   spawns — 44% of the suite's total — plus 73 temp trees and 3 loopback servers
   in one file that is also the critical path. Sharding alone converts a 25 s
   serial bottleneck into parallel work; amortising per-test repo construction
   attacks the spawn count itself. Nothing else comes close.
2. **Amortise fixtures in `pre-commit-hook.test.ts` (B2).** 155 spawns for 15
   tests. Build the fixture repo once per describe, not per test.
3. **Attack `git init`-per-test across the suite.** 412 `mkdtemp` and ~28 ms per
   fresh repo locally. Create one template repo and *copy* it — one directory copy
   instead of a process spawn plus a directory tree of tiny files, on the
   filesystem where both are most expensive.
4. **Stop shelling out to the CLI where the process boundary is not the thing
   under test (B6).** 17 × ~320 ms in `dd-flow-gate` alone, and its grandchild git
   calls are unmeasured on top. Call in-process; keep one or two genuine
   end-to-end spawns for the boundary itself.
5. **Remove `process.chdir` from the 19 files (51 sites) to unlock
   `pool: 'threads'`.** This is the structural fix for the tail (§4) and for the
   342 worker forks (B7) — it is the only change here that helps all 342 files at
   once on Windows. Largest total win, largest effort; sequence it after 1–2.
6. **Do not bother tuning `maxForks`/concurrency yet**, and do not adopt
   `--isolate=false` (−24% import for 5 broken tests) until the critical path is
   gone. Both are dominated by items 1–2.
7. **Close the gate gap before trusting any of this as the Windows explanation.**
   ~55 s of the local 1 m 27 s gate is outside the test suite and entirely
   unmeasured. If that portion is spawn- or `node_modules`-heavy, it could be a
   bigger share of the Windows 13 minutes than the tests are.

---

### Artifacts

Raw data in `scratch/perf/` (gitignored): `run{1..4}.json` (vitest JSON),
`phase4.json` (per-file phase split), `probe-full/` (395 per-process counter
dumps), `merged.json` (joined dataset), `probe.cjs` (the instrumentation),
`agg.mjs` / `merge.mjs` (analysis), `spawnbench.mjs` (cost floor).

---
---

# Part 2 — the composite gate (`harness checks`), not just `vitest run`

Part 1 closed with "BIGGEST GAP — I measured `vitest run` (~25 s), NOT the
composite gate." This part closes it. Same box, same commit (`ab1e7e75`), same
discipline: medians of ≥3 runs, primitive counts measured not inferred, no
Windows second extrapolated anywhere.

**The headline is a correction to the premise.** The composite gate is **43.4 s
warm on this box (45.7 s if you take the composite at its own word), not 87 s** —
and the ~41-44 s difference is *not* the build, *not*
a cold cache, and *not* anything I can find in the gate. It is named and given a
number in §11.

## 10. The phase list, taken from the code

Enumerated mechanically from `.harness/extensions/checks/extension.ts` rather
than by watching output scroll, so a silent phase cannot be missing from the
table. **14 gates, run strictly sequentially** (each `await`ed in turn; there is
no `Promise.all` anywhere in the verb). `just checks` (`justfile:242`) prepends
`npm run build`, which is 4 more sequential Node invocations
(`gen:docs` → `gen:flows` → `gen:dd-docs` → `tsc -p`) — **18 phases in total**.

Note the composite's `durationMs` starts *after* the `vitest.config.ts`
existence probe and covers all 14 gates, so it is directly comparable to the sum
of the phases.

## 11. Phase timings, and the arithmetic reconciled

Median of 3 clean (uninstrumented) runs, each phase invoked with the exact argv
and cwd the composite uses. `[B]` = part of `npm run build`, i.e. `just checks`
only.

| Phase | Median | Min | Max | Share of gate |
|---|---:|---:|---:|---:|
| **tests** (`vitest run --coverage`) | **28,514 ms** | 24,627 | 34,558 | **70.4 %** |
| check:flows | 2,371 ms | 2,145 | 2,812 | 5.9 % |
| build:tsc `[B]` | 2,216 ms | 2,085 | 2,649 | — |
| root-invocation-smoke | 2,212 ms | 1,625 | 2,943 | 5.5 % |
| typecheck | 1,660 ms | 1,624 | 1,818 | 4.1 % |
| markdown-lint | 1,475 ms | 1,336 | 3,650 | 3.6 % |
| arch-check | 1,128 ms | 1,072 | 1,143 | 2.8 % |
| biome | 711 ms | 700 | 1,177 | 1.8 % |
| check:telemetry-fixtures | 640 ms | 631 | 719 | 1.6 % |
| dd doctor | 501 ms | 452 | 558 | 1.2 % |
| windows-check | 380 ms | 340 | 469 | 0.9 % |
| skills-check | 317 ms | 279 | 323 | 0.8 % |
| build:gen:dd-docs `[B]` | 276 ms | 190 | 672 | — |
| check:docs | 260 ms | 244 | 270 | 0.6 % |
| build:gen:docs `[B]` | 247 ms | 223 | 439 | — |
| build:gen:flows `[B]` | 195 ms | 168 | 517 | — |
| check:dd-docs | 182 ms | 180 | 210 | 0.4 % |
| check:doctrine-parity | 153 ms | 149 | 171 | 0.4 % |

### The reconciliation

| Quantity | Value | Source |
|---|---:|---|
| Sum of the 14 gate phase medians | 40,504 ms | measured, this table |
| `harness checks` composite `durationMs` | 42,780 ms | the envelope's own field |
| Composite envelope overhead | **+2,276 ms (5.6 %)** | difference |
| `npm run build`, warm | 2,934 ms | measured |
| `npm run build`, **cold** (dist + caches removed) | **4,611 ms** | measured |
| **`just checks`, warm** — from phase medians | **43,438 ms** | build(warm) + Σ medians |
| **`just checks`, warm** — from the composite's own `durationMs` | **45,714 ms** | build(warm) + `durationMs` |
| **`just checks`, cold** | **47,391 ms** | build(cold) + `durationMs` |
| **Reported figure (Jordan, `just checks`)** | **~87,000 ms** | *reported, not measured* |
| **Unexplained residual** | **~41.3–43.6 s — 47–50 % of the reported figure** | difference |

(The two warm figures differ only by the 2,276 ms envelope overhead, depending on
whether you sum the phases or trust the composite's self-report. Both are given
rather than picking the flattering one; the residual is quoted as the range they
imply.)

**The phases add up; the reported total does not.** The 14 gates plus the
composite's own overhead account for the 42.8 s the gate reports about itself,
to within 5.6 %. What does *not* reconcile is the reported ~87 s, and per the
packet I am naming the residual rather than rounding it away: **~41.3–43.6 s, about half the
reported figure, is not accounted for by any phase I can measure.**

The 87 s is a *reported* figure, not one the spawner measured, so part of the gap
may be provenance rather than physics. Candidates I tested and **eliminated**:

- **The build.** Confirmed at source (`justfile:242`, `package.json`), and it is
  real — but it is **2.9 s warm / 4.6 s cold**, not 44 s. Eliminated.
- **Cold vs warm.** Measured both, never averaged (§12). The whole cold penalty
  is ~1.7 s, all of it in `tsc`. Eliminated.
- **Cold vitest cache.** `node_modules/.vite` is 32 KB (a deps-optimizer cache,
  not a transform cache). Tests cold 32,809 ms vs warm 29,232 ms — *inside* the
  1.40× spread the same phase shows run-to-run under load. Eliminated as a
  distinct effect.

Candidates I could **not** eliminate, in order of my confidence:

1. **Machine contention.** Load average was 90–120 on 16 cores throughout — this
   box is shared with other agents. The `tests` phase alone measured
   **24,627 → 34,558 ms across 6 samples of identical work: a 1.40× spread from
   contention alone**, same box, same commit, same hour. A 43 s → 87 s gate is
   2.0×, which contention of the kind I directly observed can plausibly produce.
   This is a finding, not an excuse: **a gate whose wall time moves 1.4× on
   identical input is not measuring the work, it is measuring the neighbours** —
   and it means part of the Windows 13 min may also be contention and AV, not CPU.
2. **Pre-#104 telemetry.** #104 (capture off by default) merged ~1 h before the
   packet. If the ~87 s predates it, the gate was then also capturing and
   **pushing** telemetry refs on exit. I measured the network floor for one
   remote operation against this origin at **~0.89 s** (`git ls-remote`, median
   of 3), so a push path is worth seconds, not milliseconds. **I could not test
   this**: enabling capture would push, which is forbidden. Flagged, unresolved.

## 12. Cold vs warm, reported as two numbers

Never averaged, per the packet.

| Phase | Warm | Cold | Δ |
|---|---:|---:|---:|
| build:gen:docs | 247 ms | 328 ms | +81 |
| build:gen:flows | 195 ms | 172 ms | −23 |
| build:gen:dd-docs | 276 ms | 213 ms | −63 |
| **build:tsc** | **2,216 ms** | **3,898 ms** | **+1,682** |
| **build total** | **2,934 ms** | **4,611 ms** | **+1,677** |
| tests | 29,232 ms | 32,809 ms | +3,577 *(within noise)* |

Only `tsc` has a genuine cold penalty (+76 %). The three codegen scripts are
cold-insensitive — their cost is Node startup, not work.

**`tsc` is cold on every run anyway.** `harness/cli/tsconfig.json` sets **no
`incremental`**, and there is no `.tsbuildinfo` anywhere in the tree. Every build
is a full compile that **writes 882 files / 7.4 MB into `dist/`**. The
warm-vs-cold difference is only whether those 882 files are overwrites or
creations — on NTFS with Defender, both are scanned.

## 13. Primitive counts per phase — the Windows-hostility ranking

Same instrument as Part 1, re-pointed: `PROBE_OUT_DIR` is set per phase, and
because `NODE_OPTIONS` is inherited by every Node descendant, summing a phase's
directory gives **whole-process-tree** counts. This incidentally fixes Part 1's
grandchild blind spot for the gate.

| Phase | Procs probed | Spawns | of which `git` | Mutating fs ops | Writes | Reads |
|---|---:|---:|---:|---:|---:|---:|
| **tests** | 395 | **2,003** | **1,565** | 5,872 | 2,405 | 77,366 |
| **markdown-lint** | 4 | **267** | **265** | 1 | 0 | 3,480 |
| check:flows | 11 | 10 | 1 | 14 | 1 | 2,336 |
| root-invocation-smoke | 3 | 6 | 4 | 492 | 244 | 1,553 |
| check:telemetry-fixtures | 5 | 4 | 0 | 69 | 31 | 549 |
| build:gen:* (each) | 3 | 3 | 0 | 4–5 | 1 | ~110 |
| check:docs / check:dd-docs | 3 | 3 | 0 | 4 | 1 | ~115 |
| biome | 2 | 2 | 0 | 3 | 0 | 586 |
| windows-check | 1 | 2 | 2 | 1 | 0 | 379 |
| arch-check | 2 | 1 | 0 | 1 | 0 | 1,091 |
| typecheck | 2 | 1 | 0 | 3 | 0 | 1,287 |
| build:tsc | 2 | 1 | 0 | 3 | 0 | 1,287 |
| check:doctrine-parity | 2 | 1 | 0 | 4 | 0 | 108 |
| dd doctor | 1 | 1 | 1 | 2 | 0 | 499 |
| skills-check | 1 | 0 | 0 | 1 | 0 | 361 |

The `tests` whole-tree figure of **2,003 spawns cross-validates Part 1's
independently-derived 2,001** (1,617 test-body + 342 forks + 42 in main). Two
different attribution methods agreeing to 0.1 % is the strongest evidence in
either report that the instrument is sound.

### G1 — `markdown-lint` spawns 264 `git` processes to lint 131 files

The single most Windows-hostile thing in the gate outside the test suite, and it
is **invisible in local wall time** (1.5 s, 3.6 % of the gate — you would never
look at it).

Root cause, read from source rather than guessed —
`node_modules/remark-validate-links/lib/find-repo.node.js`:

```js
const result = await exec('git remote -v', {cwd: base})       // line 34
const {stdout} = await exec('git rev-parse --show-cdup', {cwd: base})  // line 53
```

Two `git` invocations **per file**, with no cache anywhere in the module
(`grep -n "cache\|memo"` → nothing). 131 markdown files × 2 = 262, +2 = the 264
measured. It rediscovers the same repository root 131 times.

Two multipliers make this worse than the count suggests:

- These are **`exec`, not `execFile`** — verified by reading the call, quoted
  above. `exec` goes through a shell, so each one is **two** OS process
  creations: `/bin/sh` + `git` here, **`cmd.exe` + `git.exe` on Windows**. The
  264 call sites are **~528 actual process creations**.
- Applying Part 1's measured local floor of **~7.0 ms per `git` spawn**:
  264 × 7.0 ms ≈ **1.8 s**, which *meets or exceeds* the phase's entire 1.5 s
  median. **Essentially 100 % of `markdown-lint`'s cost is process creation, and
  none of it is markdown linting.** On a platform where process creation is the
  expensive primitive, this phase does nothing else.

### G2 — `root-invocation-smoke` boots a second full vitest to run one file

2,212 ms (5.5 %) and 244 file writes to execute `test/acts/dd.test.ts` — a file
the `tests` phase **already ran** moments earlier. Its purpose (per the extension's
own comment) is to prove the repo-root vitest invocation resolves at all, which is
a legitimate goal; the cost is that proving it currently means a second vitest
boot. On Windows this pays the whole vitest startup — process spawn plus
`node_modules` resolution across 338 MB — twice per gate.

### G3 — two large file-write sources the probe cannot see

Both found by being surprised at a zero and checking the instrument, per the
standing instruction:

- **`build:tsc` reported 0 writes** while producing 882 files. TypeScript writes
  through `ts.sys.writeFile`, which uses `openSync`/`writeSync`/`closeSync`
  (3 `openSync` sites in `typescript.js`); my probe patches `writeFileSync` and
  the `fs.promises` family, **not the fd-level API**. Confirmed by direct check.
- **Coverage output is likewise invisible** — istanbul's HTML reporter writes via
  streams.

Counted on disk instead, which is better evidence than the probe would have been:

| Artifact | Files per run | Size |
|---|---:|---:|
| `harness/cli/dist/` (every `tsc`) | **882** | 7.4 MB |
| `harness/cli/coverage/` (every gate) | **354** (346 HTML) | 12 MB |

### G4 — the gate's vitest **does** differ from Part 1's, and it costs 353 file writes

The packet asked directly. The gate runs `vitest run --coverage`; Part 1 timed
bare `vitest run`. In **time** the difference is negligible (Part 1 measured
25.3 s vs 24.8 s, ~2 %), but in **Windows-relevant primitives** it is not:

`vitest.config.ts` sets `coverage.reporter: ['text-summary', 'lcov']`, and `lcov`
emits **lcov.info plus a full HTML report** — 346 HTML files nobody reads, since
CI consumes only `lcov.info`. Measured directly:

| Reporter | Files written | Wall |
|---|---:|---:|
| `lcov` (current) | **354** | 24,421 ms |
| `lcovonly` | **1** | 28,818 ms |

The wall times are load noise and should be ignored (they invert). The file
counts are the finding: **353 file creations per gate run, for output nothing
consumes** — the exact NTFS-metadata + Defender shape characterised in Part 1,
and free on APFS, which is why it has never been noticed.

### G5 — `npm run` / `npx` wrapper tax, paid 10 times

Measured, median of 3: `npm run check:docs` **223 ms** vs the identical work
invoked directly as `node scripts/gen-docs.mjs --check` **122 ms** → **~100 ms of
pure npm wrapper per gate**. `npx tsc --version` costs **~250 ms** before tsc does
anything.

Six gates use `npm run`, four use `npx` — ~1.6 s of the local gate is wrapper
startup. On Windows this is worse in kind, not just degree: `npm`/`npx` resolve
through `npm.cmd`, so each is `cmd.exe` → `node` → the real tool, adding a
CreateProcess per gate on the platform where CreateProcess is the expensive thing.

### G6 — platform-guarded phases (the `pty-input` check, repeated for the gate)

Part 1's most useful negative was that `pty-input.test.ts` skips entirely on
win32, so its local cost is not Windows cost. Looking for the same shape here:
**no gate phase is guarded off on Windows, and none is Windows-only.** All 14 run
everywhere. `windows-check` is *about* Windows hazards but is a static scan that
runs on every platform (2 git spawns, 380 ms) — it is not Windows-only, and it is
cheap. No A/B reclassification is needed for any gate phase.

## 14. Re-ranked recommendations — tests and gate together

The gate work **did not displace** Part 1's ranking; it confirmed it and added
one new entry. **The `tests` phase is 70.4 % of the gate**, so the test-suite
findings own the gate almost entirely.

**Direct answer to the ranking question — no, the build does not outrank
splitting `exec-remote-telemetry-git`, and it is not close:**

| | `npm run build` (all 4 phases) | `exec-remote-telemetry-git.int.test.ts` (1 file) |
|---|---:|---:|
| Wall cost | 2.9 s warm / 4.6 s cold | **6.0 s** (measured by deletion, Part 1 §1) |
| Share of the warm gate | 6.8 % | **13.8 %** |
| Process spawns | 4 | **712** |
| File writes | 882 (tsc) | 150+ |

One test file costs **~2× the entire build** in wall time and **178× more process
creations**. The build is real and worth 1–2 easy seconds; it is not the story.

Full list, ordered by expected Windows saving (ratios and primitive counts only —
**no Windows seconds are extrapolated anywhere in either part**):

1. **Split `exec-remote-telemetry-git.int.test.ts`** (Part 1 B1). 712 git spawns
   in one file; deleting it cut the suite 24.8 s → 18.8 s. Unchanged at #1, now
   with the gate context that this single file is 13.8 % of the whole gate.
2. **`pre-commit-hook.test.ts`** (Part 1 B2). 155 spawns for 15 tests.
3. **NEW — cache the repo root in `markdown-lint`'s link check (G1).** 264
   shelled `git` calls → **~528 Windows process creations**, ~100 % of the
   phase's cost, to answer the same question 131 times. Highest
   spawn-per-local-second ratio in the entire gate. Fix upstream in
   `remark-validate-links`, or pre-resolve the repo root and pass it in. *Cheap
   to fix, and its local cost of 1.5 s hides how badly it scales on Windows —
   this is the clearest example in the repo of a Windows problem that local
   timing cannot see.*
4. **NEW — switch `coverage.reporter` from `lcov` to `lcovonly` (G4).** One line
   in `vitest.config.ts`; **353 fewer file creations per gate run**; CI consumes
   only `lcov.info`, so nothing is lost. Lowest-effort item on this list.
5. **NEW — enable `incremental` in `harness/cli/tsconfig.json` (§12).** `tsc` is
   a full 882-file compile on every run; cold is +76 %. Also removes the build's
   cold penalty entirely.
6. **NEW — make `root-invocation-smoke` cheaper (G2).** A second vitest boot
   (2.2 s, 5.5 %) to re-run a file the gate already ran. The goal is sound; the
   implementation pays full vitest startup twice.
7. **Remove `process.chdir` from the 19 files / 51 sites to unlock
   `pool: 'threads'`** (Part 1 §9.5). Still the largest structural win and still
   the largest effort.
8. **NEW — parallelise the 13 non-test gates.** They are strictly sequential and
   sum to ~12 s locally; all but `check:flows` are read-only. This is the one
   recommendation that *shrinks* with a weaker box's core count, so sequence it
   last and expect less from it on Jordan's machine than here.
9. **Drop the `npm run`/`npx` wrappers for the 10 gates that use them (G5).**
   ~100–250 ms each locally; an extra `cmd.exe` per gate on Windows.

## 15. What Part 2 is blind to

- **The residual is the big one.** ~41.3–43.6 s — about half the reported figure — is
  unexplained (§11). I eliminated the build and cold-cache hypotheses with
  measurements; contention and pre-#104 telemetry remain open, and the second of
  those I was **structurally unable to test** without pushing.
- **Every timing here was taken at load average 90–120 on 16 cores.** The same
  phase varied 1.40× across identical runs. Medians and the ratios/counts are
  sound; individual wall times should not be quoted to two significant figures.
- **The probe misses fd-level and stream writes** (G3) — so every `writes` column
  in §13 is a **lower bound**. Direction is safe: never an over-count. The two
  large cases are counted on disk instead.
- **The probe only sees Node processes.** `git` invoked from a shell script the
  probe never loaded into is missed; `biome` is a native Rust binary and is
  therefore a black box here (its 0.7 s is CPU, and Rust is fast on every
  platform — it is A-list).
- **`markdown-lint` exits 2 under instrumentation** but 0 clean. I re-ran it
  isolated and got byte-identical counts (267/265/264) both times and full
  duration, so the counts are trustworthy; the exit code is an artifact of the
  probe's `NODE_OPTIONS` reaching a child. Called out rather than hidden.
- **Still no Windows measurement.** Everything about Windows in both parts is a
  ratio applied to a measured local primitive count. The 10× CreateProcess
  figure, NTFS metadata cost and Defender scanning remain **inferred**.

### Verification performed before running anything

The telemetry-push blocker was verified, not assumed:
`CAPTURE_DEFAULT_ENABLED = false` in `capture-gate.ts`, and the push path gated
at `sync-service.ts:562` (`if (!isCaptureEnabled(deps.env)) return empty`).
Empirically: `git ls-remote origin 'refs/harness-telemetry/*'` returned
**128 refs before and 128 after** a full throwaway `harness checks`, with a
byte-identical diff; `.harness/temp/telemetry/` was never created. All runs also
set `HARNESS_NO_TELEMETRY=1`. **Nothing was pushed and nothing was committed.**

The codegen scripts (`gen:docs`, `gen:flows`, `gen:dd-docs`) ran ~6 times each
during this work and are **fully idempotent** — `git status --short` shows only
the three untracked `.md` files throughout. `dist/` was deleted for the cold
measurement and restored to its original 882 files by the cold build itself.

### Part 2 artifacts

`scratch/perf2/` (gitignored): `phases.mjs` (the phase runner, argv lifted
verbatim from `extension.ts`), `aggprobe.mjs` (whole-tree count aggregation),
`phases-{r1,r2,r3,p1,cold1,cold2,warm2}.json` (timings),
`probe/{p1,p2}/<phase>/` (per-process counter dumps),
`checks-run0.json` (the composite envelope).

---
---

# Part 3 — testing the capture hypothesis, and promoting G1

Part 2 left one residual (~41–43 s, about half the reported figure) and two open
candidates. This part tests the stronger of the two — that Jordan's 1 m 27 s was
measured **before** #104, with telemetry capture **enabled**, while every run in
Part 2 had it disabled — and promotes the clearest Windows-hostile finding in the
gate to its own section.

## 16. Capture-on is NOT the residual

**Result first: enabling capture costs ~1 s on a ~43 s gate. It does not explain
the residual, and #104 did not halve the gate.** The residual survives, and §11's
open question stays open.

### How this was measured without pushing

Enabling capture re-arms the auto-push, so the first job was finding a way to pay
the capture cost without paying — or performing — the push. Read from source
(`housekeeping.ts:98–140`), the gate's push is guarded twice, not once:

```js
if (!isCaptureEnabled(deps.env)) return;                                  // line 104
…
if (env.command === 'checks' && deps.env.get(TELEMETRY_AUTOSYNC_OFF_ENV) !== '1') {
  const r = syncTelemetry({ … });                                          // line 120
```

`TELEMETRY_AUTOSYNC_OFF_ENV` is **`HARNESS_NO_TELEMETRY_AUTOSYNC`**
(`housekeeping.ts:45`) — a *narrow* opt-out that disables only `checks`'s
auto-sync and leaves capture running. So the experiment ran with
`HARNESS_TELEMETRY_CAPTURE=1 HARNESS_NO_TELEMETRY_AUTOSYNC=1`: exactly one
variable changed from the Part 2 baseline, and the push path structurally
unreachable.

**Three independent nets, because one code-read is not proof:**

1. **A push detector added to the probe**, flagging any `git … push` spawn — and
   **positive-controlled first**, because a detector that always reads zero is
   worthless. A deliberate `git push` to an invalid remote (no network) fired it:
   `GIT_PUSH_ATTEMPT = 1`. Only then was a zero reading meaningful.
2. **`git ls-remote` before and after**, as in Part 2.
3. **`git status` and a local-ref count** after every run.

### What the detector caught, and why it is not a telemetry push

The instrumented capture-on run flagged **21 push attempts** — a number worth
stopping on rather than waving through. All 21 are **test-suite fixtures**, not
the gate publishing anything:

- 12 target a remote literally named **`origin-test`** (a fixture remote).
- 9 target `origin` **inside throwaway temp repos** whose "origin" is a local bare
  directory — with fixture session names (`mSessA`, `mSessB`, `sessNoVerify`,
  `sessA`) and fixture dates (2026/03, 06, 07).
- **None carries today's date**, which a real capture of this session would.

These are `exec-remote-telemetry-git.int.test.ts` (the B1 file) doing what it
exists to do, and they occur in *every* run including the capture-off baseline.
The decisive evidence is external: **128 remote refs before, 128 after, diff
byte-identical, and 0 local `refs/harness-telemetry/*` created.**

### Validity check: capture actually ran

A cost measurement of a feature that silently no-ops is a false negative, so this
was checked rather than assumed. Capture wrote **8 files** into
`.harness/temp/telemetry/`, in a lane keyed by this session's real id
(`d854c5fd-…`). Capture genuinely did its work; the small number that follows is
a real measurement, not a no-op.

### The A/B

Runs were **interleaved** (off, on, off, on, off, on) rather than batched,
because Part 2 established that this box drifts under load — interleaving cancels
drift that consecutive blocks would bake in. Figures are the composite's own
`durationMs`. `npm run build` is excluded because it never invokes `harness`, so
capture cannot affect it; this isolates the single changed variable.

| Pair | capture OFF | capture ON | Δ |
|---|---:|---:|---:|
| 1 | 43,226 ms | 44,669 ms | +1,443 |
| 2 | 45,155 ms | 44,597 ms | **−558** |
| 3 | 40,017 ms | 42,036 ms | +2,019 |
| **Mean** | **42,799 ms** | **43,767 ms** | **+968 ms** |
| Median | 43,226 ms | 44,597 ms | +1,443 ms |

**Capture costs ~0.97 s — 2.3 % of the gate.** One pair came out *negative*,
which is the honest way of saying the effect is close to this box's noise floor:
the capture-off runs alone spanned 40.0–45.2 s (1.13×) within a single
interleaved sitting.

### The push, kept separate and bounded

Capture cost is measured; push cost is **not**, and cannot be without pushing. It
can, however, be **bounded by counting the operations**, which is what the packet
asked for:

`syncTelemetry` pushes **once per session directory holding new segments**
(`sync-service.ts:730` inside the per-session loop; the other two sites at 751 and
1204 are the same flush path). A `harness checks` run captures for **one**
session — its own — so a captured run performs **1 push operation**, plus a
possible one-off ref migration that is a no-op in steady state.

| | Value |
|---|---:|
| Measured network floor, one remote op against this origin | **0.89 s** |
| Push ops needed to explain a 43 s residual | **~48** |
| Push ops a captured `checks` run actually performs | **1** |

**Push cannot be the answer regardless of how slow a push is.** Even a
pathologically slow single push would have to take 43 seconds by itself. Combined,
capture + one push accounts for roughly **2 s of a ~43 s residual.**

### Verdict

**The capture hypothesis is dead, and the residual survives.** I am not closing it
by narrowing: after Part 2 eliminated the build (2.9 s), cold caches (1.7 s) and
the vite cache, and Part 3 eliminates capture (~1.0 s) and bounds push (1 op),
the ~41–43 s gap between the measured gate and the *reported* 1 m 27 s **remains
unexplained**.

What that leaves, in order of my confidence:

1. **Machine contention** — now the leading candidate by elimination rather than
   by evidence, which is a weaker position than it sounds. Supporting data: the
   `tests` phase varied **1.40×** across 6 samples of identical work, and the
   capture-off composite varied **1.13×** within one interleaved sitting, at load
   90–120 on 16 cores.
2. **Provenance** — the 1 m 27 s is a *reported* figure, taken on an unknown date
   under unknown load and possibly with a different definition of the gate
   (e.g. including `npm ci`, a cold clone, or a `just` recipe I have not seen).

**The single measurement that would settle it** costs Jordan about a minute:
re-run `just checks` on current `main` on the Mac and read the composite's own
`durationMs` out of the envelope. If it reports ~43 s, the 1 m 27 s was
environmental and the Windows analysis should be re-based on the phase table in
§11. If it reports ~87 s, there is a phase-invisible cost on his machine that
none of my instruments can see from here, and *that* becomes the top question.

**Explicitly not what the numbers show:** "you are already fixed, pull main" would
have been the headline if capture had accounted for the residual. It does not, so
that recommendation is **not** made. #104 is a correctness and privacy win; it is
worth ~1 s of gate time, and no more.

## 17. G1 promoted — `markdown-lint` spawns 264 `git` processes to lint 131 files

This is the single clearest Windows-hostile item in the gate, and it is the
best illustration of why ranking by local wall time finds the wrong targets.

**At 1,475 ms it is 3.6 % of the gate — 6th on the timing table, the kind of row
you skip.** By the primitive that actually costs money on Windows it is **2nd out
of 18**, behind only the entire test suite.

### What it does

| Measure | Value |
|---|---:|
| Markdown files examined | 131 |
| `git` invocations | **264** |
| Actual OS process creations (each is shelled) | **~528** |
| Local spawn floor at Part 1's measured ~7.0 ms/git spawn | **~1.8 s** |
| Measured median wall for the whole phase | **1,475 ms** |
| Share of phase that is process creation | **~100 %** |

The spawn floor alone (~1.8 s) **meets or exceeds the phase's entire measured
median**. Within the precision this box allows, **essentially all of
`markdown-lint`'s cost is creating processes, and none of it is linting
markdown.**

### Root cause, read from source

`node_modules/remark-validate-links/lib/find-repo.node.js`:

```js
const result = await exec('git remote -v', {cwd: base})               // line 34
const {stdout} = await exec('git rev-parse --show-cdup', {cwd: base}) // line 53
```

Two `git` calls **per file**, with **no cache anywhere in the module**
(`grep -n "cache\|memo"` returns nothing). 131 files × 2 = 262, +2 = the 264
measured. It rediscovers the same repository root 131 times — and the answer is
identical every time, because it is the same repository.

### The two multipliers that make Windows worse than 264 suggests

1. **`exec`, not `execFile`** — verified by reading the calls above. `exec` routes
   through a shell, so each is **two** process creations: `/bin/sh` + `git` here,
   **`cmd.exe` + `git.exe`** on Windows. 264 call sites → **~528 OS processes**.
2. **Process creation is the expensive primitive on Windows.** Part 1's inferred
   ~10× `CreateProcess`-vs-`fork` ratio applies to *every one* of those 528, and
   each `git.exe` start is additionally a Defender-scannable image load.

### Why local timing could never have found this

On APFS with `fork`/`exec`, 528 process creations cost ~1.5 s and disappear into
the noise of a 43 s gate. The cost does not scale with the work (131 files is not
a lot of markdown); it scales with **the number of times the tool asks the OS for
a new process**, which is precisely the axis a Mac is cheap on and Windows is
expensive on. **This is the class of finding the spawn-weighted ranking method
exists to produce**, and it is invisible to every "slowest phase" list.

### Fix

Cheapest high-value change in the report. In order of preference:

1. Pre-resolve the repository root once and pass it to the plugin via
   `repository` in `.remarkrc.json`, so `find-repo` never runs — a config change,
   no upstream dependency.
2. Failing that, memoise `find-repo.node.js` per `base` upstream; the answer is
   constant for the whole run.
3. At minimum, switch the two `exec` calls to `execFile`, halving the OS process
   count on Windows for free.

## 18. Ranking after Part 3

Part 3 changes **one** thing in §14's ordering: **G1 moves up to #3 overall and
becomes the top recommendation that is both cheap and Windows-specific.** Nothing
else moves — capture was not the residual, so no "pull main" shortcut exists.

| # | Item | Why it ranks here |
|---|---|---|
| 1 | Split `exec-remote-telemetry-git.int.test.ts` | 712 git spawns; 13.8 % of the gate in one file; −6.0 s by deletion |
| 2 | `pre-commit-hook.test.ts` | 155 spawns for 15 tests |
| **3** | **G1 — cache the repo root in `markdown-lint` (§17)** | **~528 Windows process creations; ~100 % of the phase; cheapest fix on the list** |
| 4 | `coverage.reporter` → `lcovonly` | 353 fewer file creations/run; one line |
| 5 | `tsconfig` `incremental` | 882-file full compile every run |
| 6 | `root-invocation-smoke` | second full vitest boot, 5.5 % |
| 7 | Remove `process.chdir` → unlock `pool: 'threads'` | largest structural win, largest effort |
| 8 | Parallelise the 13 non-test gates | ~12 s sequential; but this one *shrinks* on a weaker box |
| 9 | Drop `npm run`/`npx` wrappers | ~100–250 ms each; an extra `cmd.exe` per gate on Windows |
| — | ~~"Pull main; #104 already fixed it"~~ | **Tested and rejected: capture is worth ~1 s, not 43 s (§16)** |

## 19. Part 3 fence

- **Nothing pushed.** 128 remote refs before and after, byte-identical diff; 0
  local `refs/harness-telemetry/*` created; push detector positive-controlled
  first, then read 0 real telemetry pushes (21 flagged, all test fixtures, §16).
- **Nothing committed.** HEAD still `ab1e7e75`; `git status --short` shows only
  the three untracked `.md` files.
- **Local state restored.** Capture-on legitimately wrote a telemetry buffer
  (allowed — a local write, not a push), but it left `.harness/temp/telemetry/`
  primed with unpushed segments for this session, which a later `post-commit`
  hook or `telemetry sync` would have published. That is a side effect I created,
  so I removed it: `.harness/temp/` is back to containing only its `.gitignore`,
  exactly as found.
- **Blind spots unchanged**, plus one new: the capture A/B is a ~1 s effect
  measured on a box whose noise floor is ~±2 s. The *direction* is uncertain
  (one pair was negative); what is certain is the **order of magnitude** — capture
  is a single-digit-percent cost, not a doubling. That is all the conclusion needs.

### Part 3 artifacts

`scratch/perf2/probe-push.cjs` (probe + positive-controlled push detector),
`/tmp/capdry/` (436 per-process dumps from the instrumented capture-on run),
`/tmp/refs-cap-{before,after}.txt` (the ls-remote evidence).

---

## 20. Splitting the suite into fast/slow — measured, not implemented

Asked whether the heavy files could be marked slow and skipped by default. The
answer is yes, and **the seam already exists in the repo's own layout** — no new
tagging vocabulary is needed. Measured directly (2 runs, uninstrumented):

| Suite | Files | Tests | Wall |
|---|---:|---:|---:|
| Full | 342 | 5,015 | 24.8–28.5 s |
| Excluding `*.int.test.ts`, `test/integration/**`, `**/tui/**` | 320 | **4,782** | **8,923 / 10,175 ms** |

**Dropping 4.6 % of the tests removes 72 % of summed file time and 75 % of all
process spawns (1,220 of 1,617).** That ratio is the whole case: the excluded set
is almost exactly the set that spawns `git`, which is the primitive that scales
badly on Windows — so the Windows saving should exceed the ~3× seen here.

| Candidate seam | Files | Summed time | Share | Spawns |
|---|---:|---:|---:|---:|
| `*.int.test.ts` (existing convention) | 9 | 42.0 s | 39.8 % | 966 |
| `test/integration/**` | 9 | 26.5 s | 25.1 % | 262 |
| **All three seams combined** | **22** | **75.9 s** | **72.0 %** | **1,220** |
| Remaining (stays in the fast set) | 320 | 29.6 s | 28.0 % | 397 |

### Two cautions that should govern the design

1. **Do not put the default skip in `harness checks`.** The verb's own
   documentation states it is "the SAME command CI runs … so local and CI can't
   drift." A default skip there reintroduces precisely that drift, silently, and
   contradicts the gate's stated "honest, never fakes green" posture. The pain is
   in the inner loop; that is where the fast path belongs. If a skip must ever
   reach the gate, it should surface as a visible envelope notice, never silence.
2. **The excluded 233 tests are the riskiest ones for the platform in question** —
   the git adapters and hook integration tests, i.e. the code most likely to fail
   on Windows specifically. A fast default is only safe if that set still runs
   somewhere deterministic (CI, or a pre-push path).

### The floor this hits

After exclusion the new critical path is `archive-move.test.ts` at 3.8 s, over a
module-import floor of roughly 4 s. **Excluding further files buys very little**;
past ~9 s the remaining cost is the 342 forked worker processes and their repeated
module imports, not the file list. Fast/slow splitting is a good inner-loop
mitigation and is *not* a substitute for items 1–3 and 7 of the ranking.

**Status: IMPLEMENTED.** This section originally ended *"measured and reported
only — not implemented. No test or source file was modified."* That was true when
written and was superseded on 2026-08-08, when the split was built and measured;
the line is corrected here rather than left to rot, because a record whose world
moved while the record did not is the same defect this report spends §16 warning
about.

What landed, and what it measured (same box, load 7–22 before / 8–14 after):

| | before | after | gain |
|---|---:|---:|---:|
| `just test` | 22,487 ms | **9,601 ms** | **2.34×** |
| `harness checks` | 31,462 ms | **19,165 ms** | **1.64×** |
| `just fft` (full inner loop) | — | **12 s** | — |

- `HARNESS_TEST_SCOPE` (`fast`\|`all`\|`slow`) drives `SLOW_TESTS` in
  `harness/cli/vitest.config.ts` — 12 files, each carrying its measured median.
  An env var rather than vitest `projects`/`--project` because `harness checks`
  spawns vitest itself: an env var is inherited by every invocation path, so the
  default cannot be true locally and false in the gate. An unrecognised value
  fails loudly instead of silently selecting a smaller suite.
- Scope arithmetic is exact — fast 331 files / 4,760 tests, slow 12 / 258,
  all 343 / 5,018 (331+12=343, 4,760+258=5,018). Nothing is lost or
  double-counted.
- **CI sets `HARNESS_TEST_SCOPE=all`**, and that line is load-bearing: the 12
  skipped files are the git adapters, the pre/post-commit hooks and the telemetry
  push path — the code most likely to break on Windows. Without it they would run
  nowhere.
- **A reduced scope always declares itself** — a stderr banner on every fast run,
  plus a `note` on the `tests` gate for JSON consumers who never see stderr.
- `test/architecture/fast-scope-guard.test.ts` fails if a `SLOW_TESTS` entry stops
  existing (a stale entry excludes nothing, so the fast scope silently grows
  back). It asserts composition, not wall-clock: a duration threshold on a box
  that moved 1.40× under load would be a flake generator.

**No files were renamed.** A `*.slow.test.ts` convention would auto-scale, but a
sweep found 11 of the 12 named across ~60 tracked documents — plan execution
logs, retro records, a live plan-073 review, and one archived dd `address` field.
Where a path is an identity, a move returns a wrong answer rather than an error,
so the explicit list plus the guard was preferred over stranding that
traceability.
