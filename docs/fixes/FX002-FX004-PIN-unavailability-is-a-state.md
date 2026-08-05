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

## Ruling #2 (2026-08-05) — FX004's stated mechanism was WRONG. Corrected by the coder.

**The dossier above is wrong and stays wrong on the page, corrected here rather than
edited away** — the retraction is the evidence.

It claimed: *"Inside a repo — root checkout or linked worktree — it works. The
variable is inside-vs-outside a repo."* Four probes falsify that:

| cwd | result |
|---|---|
| `/tmp/fx004-norepo` (no repo) | `E108` — both faces reproduced |
| `<worktree>/harness/cli` (**inside** a harness repo) | **`E108`, identical** |
| `<worktree>/docs` (**inside** a harness repo) | **`E108`, identical** |
| `/tmp/fx004-fake` (**not a repo**, `.harness` symlinked in) | **WORKS** |

**The real discriminator**: `discovery.ts:63` joins `proc.cwd()` + `.harness/extensions`
and reads it. Discovery is **cwd-relative** — it never walks up to a repo root and
never consults git. `checks` is an extension verb, so the question is *"does
`<cwd>/.harness/extensions` hold ≥1 loadable extension?"* — **not** *"am I in a repo?"*
Git status is irrelevant in **both** directions.

**Why the wrong mechanism survived three tellings** — the shim, then cross-worktree,
then inside-vs-outside-a-repo. The two passing cases anyone tried (repo root, linked
worktree) hold `cwd-has-extensions` and `is-a-repo` **perfectly confounded**: the root
works *because* it is where `.harness/extensions` lives, not because it is a repo. The
dossier's own guard ("test inside AND outside") is **necessary but not sufficient** —
it cannot separate the two theories. Only inside-but-not-at-root (probes 2–3) and
outside-but-has-extensions (probe 4) break the confound.

### Rulings

- **Q1 — CONFIRMED, and the message must NOT claim "not in a harness repo."** That
  sentence is **false** from `<worktree>/harness/cli`: a user standing in a harness
  repo, told they are not in one. Replacing a wrong diagnostic with a differently
  wrong one is **this packet's own defect class, committed by the fix**. Assert only
  what is established — no loadable extensions under `<cwd>/.harness/extensions` —
  **name the cwd**, and offer the repo root as the likely **remedy**. The remedy may
  be a guess; the **assertion may not**.
- **Q2 — NEW CODE, not a reuse.** `E108` means *"you typed it wrong"*, and the entire
  defect is that they did not. FX001's failure was an **undeclared** closed set;
  adding to `error-codes.ts` is the declared registry, which is the opposite move.
  **Constraint the coder must check**: FX003 (already approved in this PR) pins
  refusal codes to `/^E\d{3}$/`. A new code outside that shape would be **silently
  discarded by the refusal lane we just fixed** — three digits, no exceptions.
- **Q3 — YES, probes 2/3 are REQUIRED controls.** They are the cases that
  discriminate the two theories and the ones a "not in a repo" message would lie to.
  A control set that omits them cannot see its own confound. Probe 4
  (outside-a-repo-but-works) is required too, for the same reason in the other
  direction.

**Credit where it belongs**: the coder was handed a mechanism stated as verified,
probed it anyway, and stopped rather than building on it. That is the behaviour this
whole packet is about.

## Ruling #3 (2026-08-05) — the discard, the remedy wording, and a labelling rule

### 1. Prove the `/^E\d{3}$/` discard — do not merely satisfy it

The new code must match the pattern, **and the discard must be demonstrated on a
known-bad**. Sit with why: this packet's thesis is *unavailability must announce
itself*, and **the fix's own error code can vanish into a sibling lane without a
word** if it fails that shape. Same defect, one layer over, inside the machinery we
are shipping to cure it.

That guard has only ever run against input satisfying it — **demonstrated, not
tested**, a distinction that has cost us twice tonight.

**Placement — two controls, not one, because they prove different things:**

- **In-fence, and the more valuable of the two**: a control in `harness/cli/test/**`
  asserting **every** code in the registry matches `/^E\d{3}$/`. This catches every
  *future* code, not just ours, and it lives where the registry lives.
- **The discard proof itself** needs a fixture in `.harness/extensions/flow-eval/**`,
  which is forbidden here — **routed to prime, not taken.** See the note below.

### 2. The remedy must not smuggle the dead mechanism back in

*"Try running from the repo root"* is a remedy sentence that still encodes *"the
problem is that you are not in the repo."* A user who follows it and succeeds learns
the **retracted theory**, with our name on it.

**But the corrected phrasing has a trap of its own.** *"The nearest directory that
has extensions is `<path>`"* requires **finding** that directory — i.e. walking up —
which is exactly what discovery deliberately does **not** do. A diagnostic may search
where the loader does not, but then:

- it must **actually find** the path before naming one — **never** assert a path it
  did not verify holds a loadable extension; and
- when no such directory exists, it says **that**, rather than falling back to a
  guess about the repo root.

Otherwise the fix's own message asserts something it did not establish — for the
third time on this defect.

### 3. Labelling rule — an inherited mechanism is a HYPOTHESIS

Standing, and adopted because the transmission path is now visible: prime published
a mechanism as established, **I wrote it into this dossier as established**, and from
that moment it read as settled to everyone downstream. Neither of us marked it as
inherited.

> **A mechanism you did not establish yourself is a hypothesis — however confidently
> it was handed to you, and whoever handed it to you.** Cheapest probe first, before
> any code rests on it.

**In this dossier and every future one**: a mechanism claim is labelled
**ESTABLISHED (probe cited)** or **INHERITED — UNVERIFIED**. One word, at the point
of writing. The FX004 mechanism above should have carried the second label and did
not.

## Ruling #4 (2026-08-05) — the inertness proof needs a positive control

The discard fixture lives in the **live** extension tree (`.harness/extensions/` is
what this repo loads; it dogfoods its own harness), so its inertness must be proven.
The proof as first stated — *"doctor's loaded-extension list byte-identical before
and after"* — is a **null result**, and a null result cannot distinguish **"nothing
loaded"** from **"the probe was never looking."**

Discovery is **cwd-relative** (the finding this whole packet rests on). A list that
was empty, mis-keyed, or read from the wrong cwd would be byte-identical before and
after **for reasons having nothing to do with the fixture** — proving the probe is
stable, not that the tree is inert.

**Required, and it costs one line**: confirm the *before* list actually contains
`flow-eval`'s `entryPath`. Then the instrument is known to be populated, correctly
keyed, and reading the intended cwd — so an unchanged list afterwards means
something. **A probe that cannot report the opposite is not a probe.**

**ESTABLISHED (probe cited)** — the boundary this rests on: `discovery.ts:62-100`
iterates only top-level subdirs of `.harness/extensions/` and resolves one entry each
(`manifest → extension.ts → extension.js → index.ts → index.js`); a live
`doctor --json` keys loaded extensions by that `entryPath`; `flow-eval/` already
carries eight `*.test.ts` files and a `fixtures/` dir, none loaded. A **new subdir**
is the dangerous shape and is forbidden.

## Ruling #5 (2026-08-05) — the pin is PRODUCTION POLICY, not amputation

**The pin stays 2.7. Jordan's ruling is unchanged — his own criterion selects how it
is implemented.**

He said: *"I don't care about old stuff unless it means we are not getting good
coverage from now."* **ESTABLISHED (probe cited)** — the real-capture corpus:

| harness | real captured session | version |
|---|---|---|
| claude | `2026-06-25-static-site` | **2.4** |
| copilot-cli | `2026-06-24-checks-run` | **2.4** |
| copilot-vscode | `2026-06-25-real` | **2.4** |
| cursor | `2026-06-25-checks-walkthrough` | **2.4** |
| cursor | `2026-08-03-applypatch-textstat` | 2.7 |

The only current-format capture is **cursor**. A hard pin therefore costs **three of
four shipping harnesses their real-data read-back** — present and future coverage,
not history. His criterion is met, so it decides: **option C.**

**Also decided: the coder's option B was incomplete as framed.** It left ~200 lines
of legacy decoder unreachable-but-present. Unreachable code no test exercises is rot
that breaks silently — this packet's own defect class. The honest version of B was
**B′: delete the branches outright.** That option is not taken, but it is recorded so
the choice is between two complete positions rather than one complete and one
half-done.

### The shape

- `decodeSegmentDetailed(value, { pin = SEGMENT_SCHEMA_PIN })`. **Production passes
  nothing** and therefore reads 2.7 only; below-pin is named and countable exactly as
  the rider requires.
- The frozen-corpus read-back tests decode at an **explicitly declared** legacy pin,
  so 2.4 readability stays proven and the legacy/intermediate branches stay alive
  **and exercised**.
- **REQUIRED CONTROL — the knob must be provably test-only**: an in-fence test
  asserting **no `src/` call site passes a non-default pin.** Without it this is the
  A3 two-doors failure; with it, the knob demonstrably exists only for the corpus.
- **The blast radius is larger than this dossier first stated**, and that was my
  understatement: the pin drops **1.1 and 2.0–2.3** as well as 2.4–2.6. Corrected
  here rather than left to surface in review.

### Logged separately, not blocking

Mint fresh **2.7** real captures for claude, copilot-cli and copilot-vscode. Worth
doing on its own merits. When they exist, the legacy read path becomes genuinely
unnecessary and deleting it is an evidence-backed decision rather than an accepted
loss. **Cannot be faked** — these are real scrubbed captures and regeneration is
deliberately disabled.

### Worth recording: the rider paid for itself before shipping

This collision was findable **because** the packet was building a reason channel and
had to enumerate what gets refused and why. A silent pin would have dropped three
harnesses' fixtures into the same `null` as garbage, and nobody would have noticed
until someone went looking for data that had quietly stopped existing. That is the
argument for loud refusal, demonstrated on the packet that implements it, pre-merge.

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
