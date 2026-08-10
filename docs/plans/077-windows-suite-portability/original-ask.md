# Original ask — windows-suite-portability (#108)

**Captured**: 2026-08-08 · **By**: `pij-respectable-clam` (PM) · **Prime**: `pij-massive-meadowlark`

## The frame — read this before anything else

> **Jordan, 2026-08-08**: *"our entire focus is this work right now… unblocking that other agent.
> it is shipping a version of harness in to production."*

**The #108 reporter is not a bug reporter. It is a downstream consumer shipping harness to
production, and it is blocked.** Everything about how this plan runs follows from that:

- **The delivery model is an iteration loop**, not a backlog: we fix → PR → they merge into their
  codebase → they run → they report → repeat. PR #118 is the branch they pull; it stays **open**
  and accumulates commits rather than merging and refiling.
- **Turnaround beats scope.** Ship what they can consume now. Finish families across several
  rounds rather than assembling one comprehensive change.
- **They rank the work, not us.** Size is not the same as blocking — the largest failing file may
  be irrelevant to what they ship.

This is deliberately a *documentation* plan rather than a specification-first one. Jordan:
*"even if we don't properly follow the plan formats, just need to document what we're doing
properly."* The acceptance criteria here describe work whose scope is set by someone outside the
fleet, arriving in rounds.

## What they reported

Issue #108 — https://github.com/AI-Substrate/harness-engineering/issues/108 — found while porting
#104/#105/#106 into a downstream fork, verified against a pristine upstream checkout.

Their original six items were **two product defects** (`displayAddress` and `itemKey` in
`dd/plan/index-plan.ts`, both returning confident wrong answers on Windows) plus test-portability
failures. A later full-suite run on pristine `cfa501a6` revealed the real scope:

```
Test Files  32 failed | 310 passed | 2 skipped (344)
     Tests  134 failed | 4912 passed |  50 skipped (5096)
```

Same 5096 denominator as our macOS run, which passes 5096/5096.

## The four classes

Prime split #108 on the principle that **two of the classes are not Windows bugs at all** — a
`windows-latest` leg would surface them as Windows failures, which is the right symptom with the
wrong diagnosis attached, and someone would then fix the wrong thing or platform-guard a real bug.

| class | what | owner |
|---|---|---|
| **1** | path separators / absoluteness | `pij-spiritual-turkey` |
| **2** | symlink privilege | `pij-spiritual-turkey` |
| **3** | undeclared external binaries — **not a Windows bug** | this plan |
| **4** | load-sensitive contention — **not a Windows bug** | this plan (coordinate with `pij-tiny-bug` / #109) |

## What has already shipped

- **#116** (turkey, merged) — closed both product defects. Measured effect on their box:
  `ready.test.ts` **17 → 0**.
- **#118** (this plan, open) — class 3. Confirmed effect: their 3 `plan-review` jq failures become
  3 loud named skips.

## Scope fence

Worktree `s077-suite-portability`, branch `s077/suite-portability`, cut at `cfa501a6`.
Classes 1 and 2 are turkey's ground and are **not touched here** — though by prime's ruling
turkey's work lands **on this branch**, so the consumer has one surface to pull. Prime hands
turkey that ruling; this seat does not go recruiting its commits.

## Deliberately not in scope

- **Arming a `windows-latest` CI leg.** Approved by prime with conditions (same PR as the fixes,
  lands green, no continue-on-error), but bound to turkey's PR. And see the finding below — its
  billing has to change before it ships.
- **`services/doctor/collector/nudge.test.ts`** — 40 failures, the single largest file and 30% of
  all their Windows failures, in no class and no brief. Recorded and routed to Jordan; explicitly
  **not** absorbed here.
