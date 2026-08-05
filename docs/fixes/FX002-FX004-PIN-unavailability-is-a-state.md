# FX002 · FX004 · the 2.7 pin — an unavailability is a STATE, not a silence

**Mode**: standalone fix packet (three items, one theme) · **CS**: 3
**Branch**: `s065/fx003-flow-eval-instrument` — **these ride in PR #97**, by Jordan's
direct instruction ("fix them both in this pr, and also pin please").
**Ordinals**: FX002 and FX004 are prime-allocated. The 2.7 pin is Jordan's ruling,
relayed by prime, and rides here rather than taking FX005.

## Read this first — the three are one defect

Every item below is a system that **could not do something** and then **reported
something other than that**:

| | Could not | Reports instead |
|---|---|---|
| **FX002** | resolve the seat's identity (adopted seats have no `PIJ_SESSION_ID` in env) | a segment that captures fine and simply never joins — no error, no marker |
| **FX004** | register the `checks` subcommand (no repo context) | `E108: Expected 0 arguments but got 1` — a **syntax error** for a diagnosable state |
| **pin** | read a record below the pin | `decodeSegment` → `null`, **byte-identical to malformed, truncated, or absent** |

This is the same class FX001 and FX003 have already cost us four review rounds:
a lookup reporting an absence it had not established. **The fix in all three cases is
a named, countable outcome — never a wider silence.**

## FX002 — an adopted seat has no identity, so the exemplar is unscorable

**Mechanism.** `CURRENT_CAPTURED_ENV_KEYS` (`segment.ts:52`) captures
`PIJ_SESSION_ID` and friends **from the environment**. A seat that is *adopted* —
an existing terminal that registers itself rather than being spawned by pij — never
had those variables set, so it captures none of them. The join key is absent, and
the fleet join fails at the root.

**Consequence, stated plainly**: the seats doing the most interesting work are
usually adopted, including our own orchestrator seats. We built an instrument that
can measure every seat except the exemplar.

**What already exists and should be used, not rebuilt.**
`services/telemetry/pij-registry.ts` already reads `~/.pij/<id>.json` descriptors
**read-only and fail-safe** (never mutates, never throws; an absent or corrupt
registry resolves to unavailable/partial). It already lifts `pij_id`,
`harness_session_id`, `spawned_by`. That is the substrate — do not write a second
reader.

**The hard constraint — do NOT fabricate an id.** If identity cannot be resolved,
the segment must carry an explicit *unresolved* marker that a consumer can count.
A guessed or synthesised id is worse than an absent one: it produces a join that
looks successful and is wrong, and per this repo's own hard-won ranking, **a false
green is worse than a false red because nothing ever contests it.**

**Ambiguity is real and must resolve honestly.** Several seats share a repo, so a
cwd match alone can name the wrong seat. Whatever discriminator you choose
(pid/ppid, descriptor liveness, cwd, or a combination), an **ambiguous** match is an
unresolved identity — not a best guess. Say so in the marker.

## FX004 — E108 reports "you typed it wrong" for "you are not in a harness repo"

**Mechanism** (established by prime, reproduced): the subcommand set is built from
repo context. Outside a harness repo, `checks` is never registered, so it parses as
a stray positional to the bare `harness` command → `E108: Expected 0 arguments but
got 1: checks`. Inside a repo — root checkout **or** linked worktree — it works.
The variable is inside-vs-outside a repo. It is **not** the shim and **not**
cross-worktree invocation; both were guesses of mine, and both were wrong.

**The fix is a message, not a parser change.** Detect the missing repo context and
say so, with the actual next action.

**Second face, same defect — do not miss it.** `harness checks --help` from outside
a repo prints the **top-level** usage instead of erroring. A near-miss invocation
returns a passing-looking result for a failing case, which is how prime nearly read
the bug as working. Fix both or the diagnostic is still lying, just more quietly.

## The 2.7 pin — Jordan's ruling, with the loss made loud

**Decision (Jordan, relayed by prime): pin at 2.7.** Prime recommended 2.6 and was
overruled. This is not a negotiation and does not reopen.

**Current state, verified**: `SEGMENT_SCHEMA_VERSION = '2.7'` already
(`segment.ts:50`), but `decodeSegment` **accepts 2.4 / 2.5 / 2.6 / 2.7**
(`segment.ts:826-829`), with further per-field version gates further down. The pin
narrows the accept set.

**THE RIDER IS THE WORK — and I found its mechanism, so build to this, not to the
prose.** `decodeSegment` returns **`null`** for every refusal. There is no reason
channel at all: a below-pin record, a corrupt record, and a truncated record are the
same `null` to every caller. Narrowing the version set without adding that channel
would make 2.6 records disappear into the same silence as garbage — **tonight's
defect, built on purpose, with a version number on it.**

So the requirement is:

- A record below the pin is an **explicit, named, countable** outcome — *"record at
  2.6, below the 2.7 pin, not read"* — surfaced in the envelope.
- It must **never** fold into absent, empty, unknown, or a bare `null`.
- If someone later asks *"where did the 2.6 evidence go?"*, the answer must be **in
  the output**, not in a message or a commit body.
- Distinguish below-pin from **malformed**. They are different facts and they must
  not share a counter.

**Design latitude**: how the reason reaches callers is yours — a discriminated
result, an out-param, a counter on the envelope. What is not negotiable is that
every current caller of `decodeSegment` either surfaces the reason or is explicitly
recorded as one that discards it (and why that is safe there).

## Ruling #1 (2026-08-05, prime via pij-related-koala) — a channel nobody reads is not a channel

Two additions to the pin, both about the same hazard: **a fix that is real in the
decoder and invisible at the surface, which would review as done.**

**1. AUDIT THE CALLERS, NOT JUST THE DECODER.** Every caller of `decodeSegment`
today branches on `null` and has only ever had one thing to say about it. Adding a
reason to the return value does **not** make those callers say it — they will keep
collapsing every refusal into their existing "not present" path, and the channel
will exist while the output is unchanged. **Enumerate every caller** and show each
one either propagating the reason or **explicitly declining to, with a line saying
why that is safe there.** An unenumerated caller is an unfinished fix.

**2. THE FIX'S OWN ERROR PATH.** Whatever carries the reason must not itself
collapse to `null` on the way out. If the reason-bearing path can `catch → null`,
it has re-created the exact thing it replaced. We have already shipped one fix that
reproduced its own defect in its failure branch; that is why this is a stated
acceptance condition and not a review nicety.

Both get controls, like everything else here.

## Controls — planted-bad, every one must FIRE pre-fix

Same discipline as FX001/FX003: **Dim-0 mutation gate first and blocking**. A control
that cannot fail is worse than useless in a fix whose entire subject is honest
reporting.

- **FX002**: a segment captured with no `PIJ_SESSION_ID` in env ⇒ an explicit
  unresolved-identity marker (pre-fix: silently absent). **Guard**: a normally
  spawned seat still resolves its real id, unchanged. **Guard**: an *ambiguous*
  descriptor match resolves unresolved, **not** a guess.
- **FX004**: `harness checks` from outside a repo ⇒ a no-repo-context message, not
  `E108` (pre-fix: E108). **Guard**: inside a repo, root checkout AND linked
  worktree, still work — the discriminator must be inside-vs-outside, and a control
  that only tests one side cannot see that. **And**: `harness checks --help` from
  outside a repo ⇒ not a silent top-level-usage fallback (pre-fix: silent fallback).
- **Pin**: a 2.6 record ⇒ named below-pin outcome, countable, distinct from malformed
  (pre-fix: `null`, indistinguishable). **Guard**: a 2.7 record still decodes.
  **Guard**: a genuinely malformed record still refuses, and reports *malformed* —
  not below-pin.
- **Pin · Ruling #1.1 (surface)**: the below-pin reason is visible **at the output of
  at least one real caller**, not only at `decodeSegment`'s return. A control that
  exercises the decoder alone cannot see a caller that swallows the reason — the same
  shape as FX003's R1-M9, where a validator nothing called proved nothing.
- **Pin · Ruling #1.2 (own error path)**: the reason-bearing path, when it *itself*
  fails, does not collapse to a bare `null`. Plant the failure and show the outcome
  is still named.

## The prior APPROVE and certification are VOID — do not inherit them

**PR #97's APPROVE was earned against `7e5180fc`. It does not cover the new tree.**
Prime's board certification of that head is likewise void from the next push. Both
were statements about a specific tree, and neither transfers to a different one.

The reviewer **re-reads the final head** — it does not diff against its own earlier
verdict, and it does not treat the visible green checkmark on the PR page as
standing work. This is the discipline #95 was held to: a certification holds *to the
merge*, or it was never a certification. Three fixes landing on top of an approved
head is precisely the situation where a stale APPROVE gets quietly honoured because
it is still on screen.

## Fence — WIDENED for this packet, by the fence issuer, in writing

**Prime's words, verbatim**: *"FX003's fence is extended to `harness/cli/src/**` for
the duration of the FX002 + FX004/E108 + 2.7-pin packet on `#97`, and it reverts to
the original narrow fence the moment `#97` merges or is closed."*

Cause and expiry in one sentence, deliberately. A human instruction that requires
forbidden paths does not lift a fence — the **issuer** does, and it did. Nothing
inside `harness/cli/src/**` needs to be asked again on this packet; anything
**outside** it still goes back to prime.

- **Allowed**: `harness/cli/src/**`, `harness/cli/test/**`, `docs/fixes/FX002-*`,
  `docs/fixes/FX004-*`, this file.
- **Still forbidden**: `docs/plans/**`, any the-flow file
  (`.the-flow-state.json` / `the-flow.json` / `the-flow.md`), `.harness/live-testing/**`
  ledgers and run dirs (those are RESULTS, never inputs), **any push** (the
  orchestrator pushes), and the flow-eval extension files already approved in this PR
  — **do not touch `.harness/extensions/flow-eval/**`; that scope has been reviewed
  and signed off, and re-opening it re-opens the approval.**

## A standing warning specific to this branch

**PR #97 is already APPROVED and green at `7e5180fc`.** Every commit here moves that
head and re-opens the review. That is Jordan's explicit call, but it means: no
drive-by edits, no opportunistic cleanups, nothing outside the three items above.
Anything extra costs the whole PR another review round.

## Review

Cross-model, same discipline: **Dim-0 mutation gate first and blocking**, then fix
verification, then no-regression (full suite + `harness checks` warn trio
byte-identical to the dispatch baseline: **arch 2 / markdown 196 / windows 6**).
