# 083 — Windows portability, and the two warn-launch gates

**Hand-authored. Not `harness dd build` output** — there is no `plan.dd.json` behind this file,
and it must not be renamed into `plan.dd.md`, which would make a generated-file claim that is
false. Worktree `s083-windows-portability`, branch `s083/windows-portability`, base `858f9a0c`.

Nothing here is committed yet. Jordan's standing instruction is that this work is reviewed
before anything lands.

## Why this plan exists separately from 077 and 082

Plan **077** shipped as PR #118 — it took the consumer's suite from 134 failing to 27 and is
merged. Plan **082** (`harness hooks`) is still open at `review-1`. Neither is the right home
for what follows, because what follows was **discovered by measuring, after both were written**:
running the suite at `HARNESS_TEST_SCOPE=all` on a real Windows VM surfaced a failure population
that no prior plan had scoped.

## The headline, and the honest uncertainty in it

On the Windows VM at `scope=all` — 393 files, 6038 collected — **112 failures**. Changing **one
product constant** and nothing else drops that to 37, of which 3 were induced by the probe
itself. So **112 − 34 = 78 failures trace to a single constant**, roughly two thirds.

**Reconciled 2026-08-11 — both numbers were right.** 78 rows *cleared*; 3 rows *appeared*; 81 is
every row the change *touched*. One seat counted movement, the other improvement. Say which you
mean: **"78 cleared, 81 touched."** All 3 appeared rows sit inside
`exec-remote-telemetry-git-null-device.test.ts` — the residual rises inside the family being
fixed, which is expected of the file that currently passes by never running the win32 branch.

**The open question was: what actually produced run 2?** No artifact recorded it, so the whole
112 → 37 attribution rested on one seat's account of its own session. That sentence above is only
worth anything if run 2 is run 1's tree plus the null-device patch and nothing else.

**Narrowed 2026-08-11, from disk state rather than testimony.** `pij-used-narwhal` enumerated the
18 modified files in wilson's `C:\082` working tree and found **exactly the three sites** —
product, `hermetic-git.ts`, `exec-remote-telemetry-git.int.test.ts` — present as modifications.
That is independent physical corroboration of the account, obtained without asking the seat that
gave it.

**It is not closed, and should not be written up as closed.** Roughly twelve *other* files
(`*.sh`, `*.py`, `harness.js`, `scripts/*`) were modified in that same working tree, and a file
list alone cannot show that none of them touched the run — `harness.js` in particular is the entry
point the dist-executing tests invoke. So the attribution is **strengthened, not established**.

**What closes it is the run now being set up, not more argument**: control and treatment on one
clean tree at `858f9a0c`, where the only modification is the coder's four files. Until that lands,
quote the 78 as *corroborated from two independent directions and pending a clean-tree
measurement* — never as settled.

## MEASURED — the fix clears 79 of 107 on Windows, zero new failures — 2026-08-11

```
control    858f9a0c : 393 files / 6038 collected / pass 5896 / FAIL 107 / skip 35
TREATMENT  2d93d3af : 393 files / 6039 collected / pass 5976 / FAIL  28 / skip 35
cleared 79 · still failing 28 · NEW SINCE CONTROL: 0 · exempt families 24 -> 2
```

Same machine, same clone, both built first, differing by exactly the 4-file commit. **The
prediction was ~78, derived from wilson's pair; 79 was measured against our own.** Those are
different baselines — the closeness is an observation, **not a confirmation**, and it is recorded
that way deliberately.

**The +1 in the denominator is attributed, not waved through.** Counting tests per file across
both runs, exactly one file changed: `exec-remote-telemetry-git-null-device.test.ts`, 5 → 6 —
one of the four files in the commit. The fix adds a test to its own test file. Verified
independently against `858f9a0c`. `dd-schema-fs` did **not** drop out: 393 files both runs, no
file lost tests, the symlink-EPERM collection hazard did not fire.

**The wallclock more than doubled** (74.5s → 163.4s; worker time 601s → 1570s) **and that is the
confound lifting** — rows that previously died fast on exit 128 now actually execute. A slower
suite here is evidence the fix works.

**A pre-registered expectation did not materialise, and the miss is recorded.** We expected the
residual to *rise* inside the null-device family as the confound lifted. It did not:
`exec-remote-telemetry-git-null-device.test.ts` is 6 tests, **zero failures**, where wilson's
run-2 probe had 3. His was a hand-applied patch; this is the authored fix, and on this evidence it
is **cleaner than the probe was**. An expectation that fails to happen is worth as much as one
that holds, and would otherwise vanish quietly.

**Validity window — the measurement is bound to its pair.** `107 → 28` holds for
`858f9a0c..2d93d3af` specifically. A rebase onto `main` changes the tree and would invalidate the
**control**, not the fix — the delta would have to be re-established on the new base. That is the
one-tree design working as intended, not a weakness in it.

**Do not rebase this branch onto `main` yet.** Verified 2026-08-11: `858f9a0c` pins mermaid
`11.16.0`; `origin/main` pins `11.16.1` (PR #163, which cleared 5 real advisories and was
correctly merged). The Microsoft proxy feed this host uses has **not synced 11.16.1**, so `npm ci`
on `main` fails E404 here — a **registry-sync gap on one host**, not a corrupt lockfile and not an
unpublished package. Our lockfile is clean and needs no workaround. If anyone hits this, the
sanctioned fix is a **working-copy pin only**: regenerating the lockfile would silently revert
five security advisories for everyone, including CI, to route around a local feed gap.

## MEASURED — hooks clears 17 more: 28 → 11 — 2026-08-11

```
control  2d93d3af : 393 files / 6039 collected / pass 5976 / FAIL 28 / skip 35
HOOKS    fd55fd4a : 394 files / 6047 collected / pass 5999 / FAIL 11 / skip 37
cleared 17 · NEW SINCE CONTROL: 0 · wallclock 163.4s -> 123s
```

The previous treatment run **is** this run's control — one commit apart, same machine, same clone.
**Both pre-registered predictions confirmed.**

**Prediction 1 — "28 → 11 or thereabouts": measured exactly 11**, and every named component held.
All six `composition-boundaries` rows cleared; both `config-writer` rows left the failing set; the
binary-path family cleared (4). Beyond the prediction: `install-strategy-a` 2, `verbs-e2e` 2, and
`exec-remote-telemetry-git.int` 1 — so one of the two exempt timing residues cleared as a side
effect.

**Prediction 2 — "skips rise by 2, and that is correct": measured 35 → 37**, and the two new skips
are exactly `config-writer`'s symlink rows. **That answers a question about the fixture we could
not otherwise have asked: the VM is not elevated and not in Developer Mode** — the rows skipped
rather than passed. Consistent with the unelevated hardlink probe earlier the same day.

**The skip message is the shape to copy.** It reaches the JSON reporter carried in the test name:

> `[SKIPPED - this process cannot create a symlink (Windows EPERM without elevation or Developer
> Mode); the property is NOT proven on this host]`

**The test declares what it did not prove, on the host where it did not prove it.** That is the
exact inverse of every defect in this plan — it cannot be mistaken for a pass by anyone reading
the JSON.

**Denominator +8 / files +1, attributed precisely**: `agent-matrix.test.ts` 24 → 28, and the new
`config-paths.test.ts` 0 → 4. Net +8 exactly, both files inside the commit. **No file lost tests**,
so no collection error and `dd-schema-fs` did not drop out.

**Build freshness verified the corrected way** — per-file, not the directory mtime that misled the
previous run: all three product outputs stamped 10:37:33 against a suite start of 10:37:35.

**Wallclock fell 163.4s → 123s.** Not predicted, and recorded as an observation without an
explanation attached.

### Where the whole plan now stands

```
wilson (dirty tree, other machine)   112   <- not ours, see "a sha is not a tree"
our clean baseline                   107
after the null device                 28   (-79)
after the hooks boundary fix          11   (-17)
```

**96 of 107 cleared, from two commits touching six product files.**

Residual 11: `node-fs` 3, `fake-fs` 2 (**= 5, scope item 4, against a predicted 6**),
`backup-restore` 3, `doctor` 2, `composed-command` 1 (the last exempt timing row — a 30s wall on
subprocess spawn cost, not a correctness defect).

## MEASURED — 11 → 2, and the day-one trap finally caught — 2026-08-11

```
control  fd55fd4a : 394 files / 6047 collected / pass 5999 / FAIL 11 / skip 37
SYMLINK  ba1aeda0 : 395 files / 6055 collected / pass 6018 / FAIL  2 / skip 35
cleared 10 · still failing 1 · NEW 1
```

**Plan total: 107 → 28 → 11 → 2, across three commits touching seven product files.**

Skips fell 37 → 35 exactly as predicted (down is correct — the two `config-writer` skips were
converted to degrade). Collected rose to 6055/395 exactly as predicted, attributed with no file
losing tests.

**Degrade-instead-of-skip confirmed on an unelevated box**, seven rows, with the proof in the
machine-readable name:

> `PASSED  NodeFs confined copy REFUSES an out-of-tree SOURCE — the SYMLINK escape is not proven
> here [DEGRADED — no symlink privilege on this host]`

Passed, not skipped, not failed, reason carried in the JSON.

**The "11 → 1" prediction missed: it is 2, and the extra is an arrival, not a survivor.**
`exec-remote-telemetry-git.int` timed out at 30039ms — one of the three declared exempt timing
families, oscillating 14 → 1 → 0 → 1 across runs, in a file this commit does not touch. Both
remaining failures are **the same 30s wall** in the two files already identified as spawn-cost
bound. The number was wrong; the character of the miss is exactly what was predicted for the
survivor.

### `dd-schema-fs.test.ts` has never collected — on any run, including wilson's

The hazard pre-registered on day one **fired in all six runs and nothing caught it**:

```
Failed Suites 1 … Error: EPERM: operation not permitted, symlink   (setup hook, line 40)
```

Unelevated Windows cannot create the symlink, so **the whole file never collects** — its tests are
not passed, not failed, not skipped: **absent**, while every reported number stays self-consistent.

**Why the denominator guard was blind, and it is this plan's own defect class turned inward.** The
guard compares collected totals **between two runs**. A file absent from **both sides cancels out
of the subtraction**. It can only see a denominator that *moves*; it is structurally incapable of
seeing a hole that *persists*. In the VM lane's own words: **"I built a RELATIVE check for an
ABSOLUTE problem."** It printed "denominator STABLE" and "+8 attributed" four times and was correct
every time **about the wrong quantity**.

That is the same shape as `check:dd-docs` comparing the generator to itself, and as
`toBe(nullDeviceForPlatform())` comparing the product to itself. **Three instances, one rule: a
comparison between two things that share a flaw cannot report the flaw.**

**The signal was in the output every run**: `Test Files 3 failed` beside `Tests 2 failed`. **A file
failing with no test failing means the file never ran.** Two fields already printed, never
reconciled against each other.

**What it invalidates: nothing.** The file is absent on both sides of all four comparisons and
constant across every run including wilson's, so `107 → 28 → 11 → 2` stands. **What it does mean:**
every collected total in this plan is over a suite with **one file permanently missing on this
host** — proportions sound, denominator with a known hole.

**The fix is an absolute check**: assert `Failed Suites == 0`, or compare the collected file count
against the repo's actual `*.test.ts` count. Never only run-to-run deltas.

**And `dd-schema-fs` itself is now cheap to fix** — `test/support/symlink-capability.ts` landed in
this very commit and its collection-time death is precisely what `trySymlink` prevents. **Expect
the failure count to RISE when it lands**: a file that has never collected on Windows may carry
failures nobody has ever seen. That is a gain, not a regression.

## Found and NOT fixed — carried forward deliberately

Reported by `pij-defeated-peacock` while fixing the hooks cluster; each is outside that packet and
none is one of the 17.

1. **`doctor/collector/backup.ts` ~line 168 — `rel.startsWith('/')` to decide "is this absolute".**
   A **logical** Windows absolute is `C:/…`, which does **not** start with `/`. So an env-override
   config living off-home (e.g. `CLAUDE_CONFIG_DIR=D:\cfg`) gets joined **onto** home:
   `${home}/D:/cfg/settings.json`. Pre-existing, unrelated to the boundary fix, reachable only via
   an off-home override on Windows. **This is the same defect family as the one just fixed** — a
   POSIX-shaped assumption about what an absolute path looks like — which is worth noting, because
   it means the family is not exhausted.
2. **`hooks-verbs.ts` — unused import (`writeThroughSymlink`).** Biome warns. Pre-existing.

**Recommendation made, deliberately not built**: the symlink capability probe now exists in
**three** places (`node-fs.test.ts` had one, `config-writer.test.ts` now has one, and
`dd-schema-fs.test.ts` is the third site — the one that can die at *collection* on symlink EPERM).
A shared test helper is warranted. It was not built because the packet said not to build
speculatively; **the third site is the reason to revisit that**, since a collection-time death is
invisible in a way the other two are not.

Note `node-fs.test.ts:217-247` argues *against* `skipIf` and prefers naming the row per
capability. The hooks fix followed the packet (skip + stated reason) but put the reason **in the
test name**, so it is reported rather than silent — which honours both. Whoever builds the shared
helper should resolve that difference explicitly rather than picking one silently.

### The residual 28 — over half of it belongs to another plan

| area | rows | whose scope |
|---|---:|---|
| `services/hooks/` | **16** | **plan 082 (`harness hooks`), open at review-1** |
| `adapters/fs/` (`node-fs` 3, `fake-fs` 2) | 5 | plan 083 scope item 4 |
| `doctor` / `backup-restore` | 5 | unassigned |
| `exec-remote-telemetry-git.int`, `composed-command` | 2 | the exempt timing families |

**16 of 28 sit in `services/hooks/`** — not this plan's work, and already covered by an open plan.
The exempt timing families fell 24 → 2 and are reported separately rather than suppressed, per the
standing rule that an exemption must be visible as a number that can move.

## Our baseline is 107, and 112 must not be quoted as ours — 2026-08-11

A clean control was run on the tree the fix lands on: **393 files / 6038 collected / 107 failed**,
built first, `git status` recorded before and after, results hashed. **That is the number the fix
is scored against.** 112 is wilson's machine and moment; it is not wrong, it is *someone else's
measurement*, and the two have different provenance.

**The tree-equivalence claim is now measured, not argued.** Clean `695a3056` versus clean
`858f9a0c`, same machine, same clone, minutes apart, both built first:

```
393 files / 6038 collected   BOTH
FAIL 107 / pass 5896 / skip 35   BOTH
cleared 0 · NEW 0 · set differences outside timing families: 0
exempt families 24 = 14/8/2, delta +0
```

**The failing sets are identical by test identity** — the same rows, not merely the same count.
The docs-and-`justfile`-only diff has zero effect on this suite. The earlier claim that the two
trees were equivalent was **incomplete when it was made** (a suite can depend on repo content and
machine state outside `harness/cli`); it has now been settled the right way, by measurement,
because a pre-registered trigger fired and was honoured instead of argued away.

### A sha is not a tree — the finding worth keeping

The 5-row gap between wilson's 112 and our 107 is **not** explained by the tree. The remaining
candidate was his uncommitted working state — and that arm **cannot be evidenced, only inferred**:

- The 18 modified files were observed at **~08:0x on 2026-08-11**.
- Wilson's run 1 was **2026-08-10T22:03** — about ten hours earlier.
- Those 18 **include the three null-device sites**, which were patched *for run 2*, i.e. **after
  run 1**. So the observed state demonstrably post-dates the baseline it is being used to explain.

**Nobody captured the working tree at the moment the baseline was taken.** The dirt hypothesis is
the only arm left standing, which is **not** the same as being supported — and it is recorded here
as an inference about a state that was never recorded, not promoted to a cause.

**The general lesson, which outlives this plan: a commit sha does not identify what was measured.**
A baseline's provenance is the sha **plus** the working tree, and only one of those gets written
down by default. This is exactly why 107 is quotable and 112 is not: 107 has a recorded,
hash-verified, clean-tree provenance; 112 has a sha and a memory.

**Consequence that must be actioned, not just noted**: `.github/workflows/windows.yml:154` on
`main` states *"at `all` the same sha produces 112 failures — 81 of them one product defect."*
Both figures are wilson's, both now carry the provenance defect above, and the file is on the
default branch where it reads as settled fact. **It needs correcting to the measured numbers once
the treatment run lands.**

**None of this is a regression from #118** — the constant is on `main` independently.

## Scope

| # | Area | Source |
|---|---|---|
| 1 | The null-device constant (~78 failures) | `assets/windows/WINDOWS-ISSUES.md` defect 1 |
| 2 | `docRepoRoot()` returning `"."` on Windows | defect 2 |
| 3 | 13 path-shaped assertions + the `embedBinaryPath`/`extract` asymmetry | `assets/windows/BRIEF-S2-paths.md` |
| 4 | 6 windsurf fake-fs rows + 3 timing rows + the collection-failure denominator | `assets/windows/BRIEF-S3-tests.md` |
| 5 | `arch-check` — 2 violations, one shape | folded in 2026-08-11 |
| 6 | `windows-check` — 7 hazards, 3 rule classes, 2 files | folded in 2026-08-11 |
| 7 | The docs drift gate compares the generator against itself, so platform divergence from HEAD is invisible to it | `assets/windows/FINDING-npm-ci-dirties-the-tree-on-windows.md` |

**Three gate findings sit alongside the scope table**, because each is about an instrument rather
than a defect, and together they are the most reusable thing this plan has produced:

- **`windows-check` cannot see the CLI.** It scans only `.harness/extensions/`, never
  `harness/cli`, where all 112 failures live — so a green reads as covering a population it never
  looks at (`assets/windows/FINDING-windows-check-cannot-see-the-cli.md`).
- **The docs drift gate compares the generator to itself**, in two independent places — the unit
  test overwrites the committed baseline before asserting on it, and the real check diffs
  pre-write against post-write rather than against `HEAD`. Neither can detect that the generator's
  output has diverged from the committed bytes.
- **`nullDeviceForPlatform()` was asserted against itself** — the original defect, and the shape
  the other two turned out to share.

All three are the same failure: **an instrument that passes by not looking**, which is
indistinguishable from one that passes by finding nothing. Scope item 7 is a real portability
finding, but on our ARM64 VM only — CI runs x64 and is unaffected. **The durable item there is
the blind gate, not the biome regression**, which upstream will fix without us.

## Two traps already paid for, written down so they are not re-hit

**My `/dev/null` steer was wrong.** I briefed a coder that `/dev/null` works on Windows only by
ENOENT accident and pushed toward a temp file. git's own documentation names it: *"Can be set to
`/dev/null` to skip reading configuration files of the respective level."* Two places in our tree
already rely on it on both platforms. **The product is the outlier, not `/dev/null`.** Do not
re-issue the original steer — it would have built a subsystem to replace a constant.
Full account: `assets/windows/PLANS-SALVAGE.md`.

**`arch-check`'s 2 violations are not a dependency-injection leak.** Both services still receive
their ports through `deps`; what they import from `git-write-port.ts` is a string constant and a
pure naming function. The real defect is that the port module owns the telemetry ref-naming
vocabulary, which is not adapter detail — so every legitimate use trips a rule written about
something else. Move the vocabulary to a neutral module. **Do not weaken the rule** — the check's
own `next_action` warns against exactly that.

## Sequencing constraint

**Do not promote either gate from warn-launch to error in the same PR that fixes it.** Land the
fixes, confirm the checks read clean on `main`, promote separately. A gate that has never been
observed refusing is not a verified gate, and promoting it in the same change makes its first red
also its first run.

## Verification, and what a green will not cover

The suite mixes src-importing and dist-executing tests, so a green row means nothing unless the
build is newer than the edit. The Windows VM is **not a clean fixture** — git-ai is installed on
it. `dd-schema-fs.test.ts` may still fail at *collection* on symlink EPERM, contributing zero rows
while every count stays self-consistent.

The `harness` global resolves into the **root checkout**, never this worktree. Invoke this
worktree's build explicitly — `node <worktree>/harness/cli/bin/harness.js <verb>` — and never
link the global from here (`just verify-global-link` fails loudly if you do).

## Artifacts

`assets/windows/` — the full dossier. `WINDOWS-ISSUES.md` (550 lines, per-test listing generated
mechanically from raw vitest JSON, not transcribed) is the entry point. `vm-082/` holds ~4.9 MB of
raw JSON and console logs; **decide before committing** whether that belongs in git or stays
local evidence.
