# CODER PACKET — the last 11. Three groups, and one of them corrects my own earlier steer

**Continuation packet for `pij-defeated-peacock`** — you fixed the hooks boundary family; two of
these three groups are downstream of that work, and one of them is a bug **you** found.

**Repo root**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s083-windows-portability`
**Branch**: `s083/windows-portability` @ `a0448d9c`. **DO NOT COMMIT.** Working tree only.

## Where we are

Measured on a real Windows VM, one variable per commit: **107 → 28 → 11.** These are the 11,
extracted mechanically from `scratch/win/results/vitest-results-hooks.json`.

## Group 1 — symlink EPERM, 5 rows — AND I GOT THE PATTERN WRONG LAST TIME

```
adapters/fs/node-fs.test.ts   3   EPERM: operation not permitted, symlink …
adapters/fs/fake-fs.test.ts   2   EPERM: operation not permitted, symlink …
```

All five create a real symlink **in setup** to prove the product **refuses** it — CWE-59 exfil
guard, ancestor-symlink rejection, per-component symlink rejection. An unelevated Windows process
cannot create one. The VM is confirmed unelevated and not in Developer Mode.

**Read `node-fs.test.ts:217-247` before you write anything.** It argues *against* `skipIf`, and its
argument is better than the instruction I gave you last time:

> *"A `skipIf` would have bought the same silence in a different coat: green here, mute there. So
> the case DETECTS whether it could stage, and reports what it actually proved: the full property
> where the swap is real, and the weaker property that still holds where it is not. `reason` is
> never the only signal — **the attacker's bytes being absent is the property that matters**, and
> that is asserted on every path."*

**That is the pattern to use here — degrade, do not skip.** A skipped security guard proves
nothing on the platform where it skipped; a degraded one still asserts the property that matters.
These are **exfiltration guards**, so "unproven on Windows" is a materially worse outcome than for
an ordinary test.

**Three consequences, and I want your judgement on each rather than compliance:**

1. **`fake-fs.test.ts` imports real `symlinkSync` from `node:fs` (line 7; used at 576, 674) — in
   the test file for a FAKE fs.** If `FakeFs` can model a symlink, these two rows need no privilege
   at all and the full property is provable on every OS with no skip and no degradation. **Check
   that first** — it may be a test-design defect rather than a platform problem, and it is the
   cleanest possible outcome. If the fake genuinely cannot model it, say why.
2. **Revisit the two `config-writer` skips you added last commit.** You followed my packet and
   flagged that `node-fs` disagreed — you were right and I was wrong. If those two rows can degrade
   instead of skip, convert them: skips go back 37 → 35 and Windows proves *something* rather than
   nothing. If they genuinely cannot (a rename-destroys-symlink hazard may be all-or-nothing), say
   so explicitly — that is a real answer, not a failure.
3. **The capability probe now exists in three or four places.** You recommended a shared helper and
   did not build it because I said not to speculate. **Build it now** if the sites agree on what
   they need — and it must resolve the skip-vs-degrade question explicitly, in one place, rather
   than leaving two conventions in the tree.

## Group 2 — backup-restore, 3 rows — probably the family you already named

```
backup-restore.int.test.ts  3
  - capture, MUTATE, restore — byte-identical (dw-0001, dw-0002)
        expected [ Array(1) ] to include 'C:\Users\JORDAN~1\…'
  - a path with __ IN ITS OWN NAME round-trips (dw-0003)
        expected [] to include 'C:\Users\JORDAN~1\…'
  - restoring a file that did NOT exist means DELETING it (dw-0004)
        expected [ Array(1) ] to deeply equal [ Array(1) ]
```

**Start with the defect you already found and did not fix**: `backup.ts` ~line 168 uses
`rel.startsWith('/')` to decide whether a config path is absolute — and a **logical** Windows
absolute is `C:/…`, which does not start with `/`. You flagged it as reachable via an off-home
override. **These three rows may be the same root cause reached by an ordinary path**, which would
make it one fix rather than three.

If it is, say so and fix it once. If it is not, diagnose properly before touching anything.

## Group 3 — doctor, 2 rows — genuinely separate, diagnose before fixing

```
acts/doctor.test.ts:134   expected [ 13 layers ] to deeply equal [ 12 layers ]
acts/doctor.test.ts:239   the INJECTED probe answers the ingress — expected [] to deeply equal [ Array(1) ]
```

Not obviously path shape. The first is **an extra layer appearing on Windows** — that is a
behavioural difference worth understanding rather than an assertion to relax. **Do not "fix" it by
loosening the expected list** until you know what the thirteenth layer is and whether it should be
there. The second is an injected probe not firing, which is the same *shape* as the
composition-boundaries bug you already solved (a fixture that never matched, so it never injected)
— worth checking whether it is that mechanism again.

## Group 4 — `composed-command`, 1 row — NOT YOURS

`STACK_TRACE_ERROR` — the 30s wall. You measured it at ~3.35s on macOS for ~20 real CLI subprocess
spawns; Windows spawn cost is multiples of that. **Budget, not correctness. Leave it.** Raising the
timeout is a decision for the humans, not a fix to slip into this commit.

## Verification — unchanged, and it still governs

**These tests pass on your Mac.** Prefer the route that needs no VM: a logical path is
platform-independent, so drive a Windows-shaped `home` from macOS and assert literals — that is why
your last fix needed no platform branch. For the symlink group, exercise the degraded path by
forcing the capability probe to report no privilege. Anything you cannot verify either way, label
**`EXPECTED-UNVERIFIED`** and I will route it to the VM lane.

**If your change would still pass when reverted, it is not a test.** Run the revert, per group.

## Allowed paths

`harness/cli/src/services/doctor/**` · `harness/cli/src/adapters/fs/**` ·
`harness/cli/test/adapters/fs/**` · `harness/cli/test/services/doctor/**` ·
`harness/cli/test/acts/doctor.test.ts` · `harness/cli/test/services/hooks/config-writer.test.ts`
(for consequence 2 only) · a new shared test helper if you build one — name it in your report.

## Forbidden

`.the-flow-state.json` · `the-flow.json` · `the-flow.md` · `docs/plans/**` · `government/**` ·
`.github/workflows/**` · `src/adapters/git/**`.

## Done-report

Same shape as last time, plus: **`skipDelta`** (I expect this to go *down* or stay flat, not up —
if it rises, explain why degradation was impossible), and **`sharedHelper`** (built / not built /
why).
