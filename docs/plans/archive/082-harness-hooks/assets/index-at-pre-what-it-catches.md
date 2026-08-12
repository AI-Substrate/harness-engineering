# What the index-at-PRE check is load-bearing for

**Status**: measurement, no production change · **Date**: 2026-08-10 · **Plan**: 082
**Code measured**: `s077/suite-portability` @ `08308536` (guard present), probed with the guard
removed in an isolated worktree · **git 2.51.0, macOS**

---

## Why this document exists

`index-was-not-clean` was removed on a good argument: the relay was adjudicating whether a commit
*deserved* attribution, which was never its question. It emits six events asserting only **that** a
commit happened — no sha, no line ranges, no authorship — so it cannot mis-attribute, only wrongly
assert that a commit occurred.

The argument stands. What was wrong was the believed **cost**, which was taken to be zero because a
Windows measurement showed no effect on attribution.

**That measurement could not have seen the cost.** Native Windows Cursor has no sandbox — Cursor
runs its Linux sandbox inside WSL2 — so every Windows run was the pass-through case, with nothing
at risk. The platform chosen to measure the change was the one platform on which the change could
not matter. The unit suite could see it, deterministically, in 9ms.

> **The lesson, stated first because it outlives the decision:** a measurement that returns "no
> effect" is only evidence if the measurement environment could have produced an effect. Ours could
> not, and nothing in the result said so. A null result carries the shape of its instrument, and
> that shape is invisible in the number.

---

## 1. What dies when the guard is removed — 16 rows, verbatim

Measured in an isolated worktree at `08308536` with only the three guard lines removed, rebuilt,
`HARNESS_TEST_SCOPE=all`:

```text
Test Files  2 failed (2)
     Tests  16 failed | 51 passed (67)
```

### `classify-head-transition.test.ts` — 9 failed of 35, in 9ms (unit, deterministic)

Under the describe **`the index at PRE is what catches the seven defeaters`**:

```text
× stays SILENT for merge --squash — one parent, reflog reads `commit: <msg>`, index already-staged
× stays SILENT for cherry-pick -n — one parent, reflog reads `commit: <msg>`, index already-staged
× stays SILENT for revert -n — one parent, reflog reads `commit: <msg>`, index already-staged
× stays SILENT for git apply — one parent, reflog reads `commit: <msg>`, index already-staged
× stays SILENT for checkout REF -- path — one parent, reflog reads `commit: <msg>`, index already-staged
× stays SILENT for restore --source — one parent, reflog reads `commit: <msg>`, index already-staged
× stays SILENT for read-tree -m -u — one parent, reflog reads `commit: <msg>`, index already-staged
× treats an UNREADABLE index exactly as it treats already-staged
× ABSTAINS when the command is unavailable — the other layers still decide
```

### `provocation.int.test.ts` — 7 failed of 32 (real git, isolated repos)

```text
× stays SILENT for 'MEASURED DEFEATER — merge --squash then commit'
× stays SILENT for 'MEASURED DEFEATER — cherry-pick -n then commit'
× stays SILENT for 'MEASURED DEFEATER — revert -n then commit'
× stays SILENT for 'MEASURED DEFEATER — git apply --index then commit'
× stays SILENT for 'MEASURED DEFEATER — checkout REF -- path then commit'
× stays SILENT for 'MEASURED DEFEATER — restore --source then commit'
× stays SILENT for 'MEASURED DEFEATER — read-tree -m -u then commit'
```

**These rows are the specification of what the check protects.** Each builds the state that defeats
the other discriminators and then asserts silence; each one that turns red is a transition on which
the runtime now emits.

---

## 2. Can any other layer catch them?

**No — not for the shape these rows describe.** Confirmed three independent ways.

### 2a. By construction, inside the rows themselves

The integration rows assert their own premise before asserting the outcome
(`indistinguishableFromAuthorship`):

```ts
expect(advanceFrom(prev)).toBe(1);                                    // one commit forward
expect(parentCount()).toBe(1);                                        // parent-count defeated
expect(git(['log', '-g', '-1', '--format=%gs'])).toBe(`commit: ${message}`);  // reflog defeated
```

Parent-count and reflog subject are not "believed dead" here — each row **measures them dead** on
real git before it looks at anything else.

### 2b. The command scan reaches a different shape, by design

The two layers are complementary and neither subsumes the other:

| where the import happened | index at PRE | command scan sees | who can catch it |
| --- | --- | --- | --- |
| **inside** the bracket (`git cherry-pick -n && git commit`) | clean | the import | command scan **only** |
| **before** the bracket (separate tool call) | already-staged | only `git commit` | index-at-PRE **only** |

`commandImportsContent` recognises all seven verbs (`merge`, `cherry-pick`, `revert`, `apply`,
`read-tree`, plus qualified `checkout … --`, `restore --source`), so **in-bracket all seven remain
caught with the guard gone**. The failing rows are the *other* column: the import happened in an
earlier tool call, the bracket's command is `git commit`, and the scan correctly reports
`authors-only`.

That column is not exotic. It is the shape the Windows run-8 evidence describes: the agent staged
with `git add -A` in one tool call and committed in the next.

### 2c. `.git` state — phase 1's verdict CONFIRMED against today's git

Measured directly: perform each defeater, then inspect `.git` and the index at the moment PRE would
observe them (git 2.51.0).

| defeater | `.git` state at PRE | index at PRE |
| --- | --- | --- |
| `merge --squash` | `SQUASH_MSG` | **DIRTY** |
| `cherry-pick -n` | `MERGE_MSG` | **DIRTY** |
| `revert -n` | `MERGE_MSG`, `REVERT_HEAD` | **DIRTY** |
| `git apply --index` | *(none)* | **DIRTY** |
| `checkout REF -- path` | *(none)* | **DIRTY** |
| `restore --source` | *(none)* | **DIRTY** |
| `read-tree -m -u` | *(none)* | **DIRTY** |

**`.git` state catches at most 3 of 7 and leaves no trace for 4 of 7. The index catches 7 of 7.**
Phase 1's "measured dead" is confirmed, and now with the per-defeater detail that makes it
actionable: a `.git`-state substitute is not a weaker version of the index check, it is blind to
the majority of the set. `MERGE_MSG` is also written by an ordinary merge, so two of those three
hits are not even specific.

---

## 3. What the guard is load-bearing for, precisely

- **All seven defeaters, in the across-tool-call shape only.** In-bracket, the command scan holds.
- **`indexAtPre: 'unknown'`** — a read we could not make. Without the guard an unreadable index
  emits; the removed line was the only place that treated *cannot tell* as *not evidence*.
- **The abstain contract** — `commandScan: 'unavailable'` deliberately does not decide, on the
  reasoning that a client sending no command must not switch the feature off. That abstention is
  only safe because a later check still decides. Remove the index check and "abstain" silently
  becomes "emit": the row asserting both halves is the one that fails.

## 4. What it is NOT load-bearing for

Stated so a future narrowing has somewhere to start:

- **Not** the in-bracket import (command scan).
- **Not** merges, amends, cherry-pick *without* `-n`, rebases, resets or checkouts that move HEAD —
  parent-count and reflog reach all of those, and they keep passing with the guard removed.
- **Not** correctness of line-level attribution, which is git-ai's and computed from its own
  checkpoint records. The cost of an over-emit remains **unmeasured**, and this document does not
  upgrade it. What is now measured is the *frequency and identity* of the over-emits, not their
  consequence.

---

## 5. A measurement hazard found while measuring this

My first run of `provocation.int.test.ts` reported **32/32 passing with the guard removed**. That
result was false. The integration tests execute the **built** `dist/`, and `dist` still contained
the guard — so the row that should have failed was exercising the old code. The unit tests import
`src` directly and failed immediately, which is the only reason the discrepancy surfaced.

Two things follow, both cheap:

1. **A suite that spans `src`-importing and `dist`-executing tests can report two different
   revisions of the same function in one run.** A green integration row means nothing until the
   build is known to be newer than the edit.
2. **The tree moved under the measurement.** The guard was reverted in the worktree I was probing
   while I was probing it, so early and late readings described different code. The isolated
   worktree used for the numbers above exists because of that: measurements of a shared tree are
   not reproducible, and nothing in the output says which revision produced them.

---

## 6. The honest options

1. **Keep the guard** (current state at `08308536`). Cost: the false-negative direction — an agent
   that stages in one tool call and commits in the next produces no note. Windows run 8 records
   git-ai attributing that commit anyway, and wrongly, so our silence removed us from a note that
   was written regardless.
2. **Remove it and say so in the code.** Then the runtime emits on all seven in the across-tool-call
   shape, and the seven rows must be rewritten to assert emission — as a recorded decision, not a
   test update. The consequence of an over-emit is still unmeasured, so this option trades a known
   false negative for an unquantified false positive.
3. **Narrow it.** The measurement supports a narrowing the original binary check could not express:
   the index is only load-bearing when the command scan **abstained or found nothing**. Applying it
   only in that case keeps all seven caught and stops it overriding a scan that already looked and
   was satisfied. This is a smaller claim than the one that was removed, and it is the only option
   here that no measurement in this document argues against.

Options 2 and 3 both need the over-emit consequence measured before either can be called cheap.
