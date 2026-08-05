# FX002 · FX004 · the read pin — execution log

**Branch**: `s065/fx003-flow-eval-instrument` (rides PR #97) · **Coder**: `pij-alright-muskox`
**Dossier**: [`FX002-FX004-PIN-unavailability-is-a-state.md`](./FX002-FX004-PIN-unavailability-is-a-state.md)

Labelling convention adopted from **Ruling #3.3**: every mechanism claim below is marked
**ESTABLISHED** (probe cited) or **INHERITED — UNVERIFIED**. Nothing is asserted because
it was handed over confidently.

> **R2 — THE PIN VALUE WAS REVERSED TO THE FLOOR** (Jordan). The log below is kept as a
> record rather than rewritten, because the reasoning that produced Option C is still the
> reasoning that makes the reversal safe. Where a section describes the 2.7 policy it is
> marked **SUPERSEDED** and the current state is in
> [The pin reversal](#the-pin-reversal-r2--the-pin-is-a-floor-set-to-the-floor).

## Baseline (before any change)

`node harness/cli/bin/harness.js checks` — all hard gates ok, warn trio
**arch 2 / markdown 196 / windows 6**. Matches the dispatch baseline exactly.
**R2 final**: identical — all hard gates ok, **arch 2 / markdown 196 / windows 6**.

## Status summary

| Item | State |
|---|---|
| **FX004** | **complete** — both faces fixed, 7 mutations fire, guards both directions |
| **FX002** | **complete** — read-time resolution, 5 mutations fire, never fabricates |
| **Pin** | **complete — value reversed to the FLOOR** (R2); the reason channel, total decoder, caller audit and per-reason tallies all stand |
| Pin-knob control | **rewritten FOUR times** — to the INVERTED hazard (R2), to a SCOPE THAT FOLLOWS THE PIN (R3), **superseded as the primary guarantee** (R4: the door was SEALED, not policed), and finally **narrowed to what it proves** (R5). Proven by ten planted mutations |
| Pin door | **SEALED (R4, ruling #11)** — `pin` removed from `CombineSessionOpts`; the below-pin surfacing lives behind a named test-only seam. The seal **holds**: a `pin` on the bag is inert |
| Pin CLAIM | **NARROWED (R5, ruling #12)** — reflection reaches the seam, so the reachability claim is withdrawn. The claim is now what the scans establish, with the gap named in the same sentence and **asserted as a live test**. **R6 (ruling #13): the narrowing is now CARRIED OUT** — the third claim site (`segment.ts`) is declared, and titles are read from the runner so a computed one cannot evade the check |
| Registry-shape control (#3.1) | **already existed** — reported, not duplicated |
| Discard proof | **complete** — fires, and proven inert in the live tree |

## FX004 — the mechanism in the dossier was wrong, and I probed before building

**ESTABLISHED.** Four probes, all `node harness/cli/bin/harness.js`:

| # | cwd | result |
|---|---|---|
| 1 | `/tmp/fx004-norepo` (no repo, no `.harness`) | `checks` → E108; `checks --help` → **top-level usage, exit 0** |
| 2 | `<worktree>/harness/cli` (**inside** a harness repo) | `checks` → E108 |
| 3 | `<worktree>/docs` (**inside** a harness repo) | `checks` → E108 |
| 4 | `/tmp/fx004-fake` — **not a repo**, `.harness` symlinked in | `checks --help` → **works** |

Verbatim pre-fix output, probe 1:

```text
error: too many arguments. Expected 0 arguments but got 1: checks.
{"command":"harness","status":"error","error":{"code":"E108",
 "message":"error: too many arguments. Expected 0 arguments but got 1: checks."},
 "next_action":"Run `harness help` for usage."}
```

```text
$ harness checks --help          # second face, pre-fix
Usage: harness [options] [command]
The agent-friendly front door to this repo's engineering harness.
… exit 0
```

The dossier's stated variable — inside-vs-outside a repo — is **contradicted**: probes 2/3
fail *inside* a repo, probe 4 succeeds *outside* one. The real discriminator is
`<cwd>/.harness/extensions/` holding a loadable extension (`discovery.ts:63`, cwd-relative,
never walks up). Git is irrelevant in both directions.

The wrong theory survived three tellings because every case anyone tried held
*is-a-repo* and *cwd-has-extensions* **together** — the repo root is where
`.harness/extensions` lives. The dossier's own guard (inside vs outside) could not
break that confound. Probes 2/3 break it one way; probe 4 the other.

**The fix.** A **pre-parse** guard (`app.ts` · `noExtensionContextEnvelope`). Pre-parse
is load-bearing: `checks --help` never reaches an error path at all, so mapping
commander's error after the fact would fix one face and leave the other lying more
quietly. New code **E149** (`EXTENSION_CONTEXT_ABSENT`) — E108 means "you typed it
wrong" and the entire defect is that they did not. `E149` matches `/^E\d{3}$/`, which
FX003 requires (see the discard proof below).

The message asserts only what was established, and **never says "not in a harness
repo"** — that sentence is false from `<worktree>/harness/cli`. Per **Ruling #3.2** the
remedy is *found and verified* (`findExtensionAncestor` walks up and confirms via
`discoverExtensionsAt` before naming a directory), and when there is none it **says so**
rather than falling back to a guess:

```text
No extensions are loadable from …/harness/cli — `checks` is not a core command, and no
extension verbs are registered. Extensions are discovered only in
`<cwd>/.harness/extensions/`, which is not searched upward. A directory above this one
does hold loadable extensions: …/fx003-flow-eval-instrument — run the command from there.
next_action: cd …/fx003-flow-eval-instrument && harness checks
```

**Guards, verified live**: at the repo root `checks --help` still prints the verb help;
a genuine typo (`harness bogusverb`) still returns **E108**; probe 4 still works; bare
`harness`, `--version`, `help`, `doctor` are never intercepted.

## FX002 — an adopted seat's identity, resolved without ever fabricating one

**ESTABLISHED**: `selectCapturedEnv` (`capture-service.ts:204`) reads
`CURRENT_CAPTURED_ENV_KEYS` **from the environment**, so an adopted seat — which never
had `PIJ_SESSION_ID` set — captures none, and the join key is absent with no error and
no marker.

**Design decision, stated because the dossier reads capture-time.** The marker resolves
at **READ** time, not capture time. A capture-time marker needs a new `Segment` field;
this repo's convention bumps `SEGMENT_SCHEMA_VERSION` when the field set moves (the 2.7
note in `segment.ts`), so the marker would make new records **2.8** — and a **2.7 read
pin would refuse every segment this build writes**. The instrument would stop reading
its own output: the packet's defect class, produced by the interaction of two of its own
items. Read-time resolution also works **retroactively** on adopted-seat segments already
captured (exactly the exemplar we cannot score) and reuses the existing `pij-registry`
substrate rather than writing a second reader.

`pij-identity.ts` resolves `env → registry → unresolved`, where unresolved carries a
reason: `registry_unavailable`, `no_descriptor_match`, or `ambiguous` (with candidates).

**A real finding, and why the resolver does not use the obvious index**:
`pij-registry.ts:117` builds `by_harness_session` **first-wins** (`!…has(id)`), so a
genuine collision is *invisible* through it. Ambiguity is the thing FX002 must see, so
`descriptorsClaiming` scans `by_pij` instead. The registry is **not modified** — other
consumers keep the behaviour they were written against.

`pij_session_id` is filled **only** from a genuinely resolved identity; every unresolved
shape leaves it `null` and carries no `pij_id`.

## The 2.7 pin — built, gated, and BLOCKED on a product ruling

**Built** (`segment.ts`): `SEGMENT_SCHEMA_PIN = '2.7'` (deliberately separate from
`SEGMENT_SCHEMA_VERSION`: one says what we WRITE, the other what we READ, and collapsing
them hides the moment they differ); a **declared** `KNOWN_SCHEMA_VERSIONS` closed set;
and `decodeSegmentDetailed` returning a discriminated result with three reasons.

The third reason is not decoration: a **2.8** record is *above* the pin, so calling it
`below_pin` would assert a relation this build cannot establish — the same defect, in the
fix. It resolves `unsupported_version`.

`decodeSegmentDetailed` is **total** and contains no `catch → null` (**Ruling #1.2**).

### Caller audit (Ruling #1.1) — every caller enumerated

`decodeSegment` had exactly **two** call sites:

| # | Caller | Disposition |
|---|---|---|
| 1a | `ref-source.ts` · `segmentsFromBlobs` | **PROPAGATES** — per-reason tally → `RefSegmentsRead.refused` |
| 1b | `ref-source.ts` · `tokensFromBlobs` | **DECLINES, stated in-code** — it answers "how many tokens did this ref commit"; a refused record contributes none whatever the reason, and the same blobs are counted by 1a, so propagating here would double-report |
| 2 | `session-export.ts` · `readSessionSeqs` | **PROPAGATES** → `summary.segments_refused` |

`decodeLooseSegment`'s own `catch` now **names** `malformed` instead of returning `null`
— the precise hazard Ruling #1.2 warns about, in the function that supplies every other
check its input. `RefSegmentsRead.skipped` survives as a **derived sum** computed at one
site, so it can never disagree with the tally it summarises (the FX003 · D2 lesson).

`summary.segments_refused` is **always present**: an all-zero tally is the positive claim
"I refused nothing", which an omitted field cannot make.

### The collision — why the pin is not landed

**ESTABLISHED.** Applying the pin fails **11 tests in 4 files**, every one tracing to the
real-capture corpus: 4 of its 5 instances are **schema_version 2.4**
(claude, cursor-checks-walkthrough, copilot-cli, copilot-vscode); the fifth is 2.7 and
passes. Under a 2.7 pin the four are `below_pin` and **not read**.

This is not test rot — the freeze is deliberate, documented, and **enforced in code**:

- `otlp-golden.ts:209-218` — *"The committed real-corpus goldens are permanently frozen
  Segment-2.4 / OTLP v0.1 compatibility evidence"*, and `REGEN_GOLDEN` **throws**:
  `legacy telemetry goldens are frozen; regeneration is disabled`.
- `real-capture.e2e.test.ts:119,245,370` — *"matches the frozen Segment-2.4 golden"*.
- `docs/plans/066-…-plan.md:69` — the 2026-08-03 instance was minted at the CURRENT
  schema *"tighter than the frozen 2.4/v0.1 corpus"*: an old tier and a current tier, on
  purpose.

The corpus exists to prove this build can still **read** a 2.4 record; the pin abolishes
that. Both cannot stand. Rewriting the goldens' `schema_version` was **disqualified** —
it would assert a 2.4 capture was a 2.7 capture, i.e. falsifying recorded evidence.

Precisely which proof dies: `real-capture.e2e.test.ts` still **passes** (it compares
producer *output* to the golden and never decodes it). What breaks is every test that
**reads a golden back in**. The pin kills the read-back compatibility proof only.

**Blast-radius correction, on the record**: the dossier said the pin narrows
2.4/2.5/2.6/2.7. `decodeSegment` **also** accepted `1.1` and `2.0–2.3`
(`segment.ts:830-836`). The narrowing is larger than stated.

### Resolution — Option C (Ruling #5) — **SUPERSEDED BY R2**

> Kept as the record of how the dial was built. The dial survives R2 unchanged; only its
> **value** moved. See [The pin reversal](#the-pin-reversal-r2--the-pin-is-a-floor-set-to-the-floor).

Jordan's own criterion selected it: he does not care about old records **unless it costs
coverage from now on**. It does — the four frozen 2.4 captures are the **only** real
captured sessions for **claude, copilot-cli and copilot-vscode**, so a hard pin costs
three of four shipping harnesses their real-data read-back. Present and future coverage,
not history.

**Built**: `decodeSegmentDetailed(value, { pin = SEGMENT_SCHEMA_PIN })`. Production
passes nothing and reads 2.7 only; `below_pin` stays named and countable. The
corpus read-back tests declare `LEGACY_READ_PIN` at their assertion site, so 2.4
readability stays **proven** and the pre-2.7 decoder branches stay alive **and
exercised** rather than becoming unreachable rot.

The pin is a **FLOOR**, not an equality — which is what makes `below_pin` the honest
name, and what lets one knob serve a corpus spanning 1.1 → 2.6. **This is the property
that made R2 a one-constant change rather than a redesign.**

**The mitigation is load-bearing, not a nicety** — I named the two-doors risk myself and
own it: `test/services/telemetry/pin-knob-src-usage.test.ts` asserts **no `src/` call
site passes a non-default pin**, that the default really *is* `SEGMENT_SCHEMA_PIN`, and
that the knob is not inert. Without it this is the A3 failure; with it, the knob provably
exists for the corpus alone. **The reviewer found this control blind to the dynamic
pass-through, and was right — see [the control rewrite](#the-pin-knob-control-rewritten-to-the-inverted-hazard).**

**On Option B**: prime ruled it incomplete *as framed* — leaving ~200 lines unreachable
is rot that breaks silently, this packet's own defect class. The honest B was B′
(delete outright). Not taken, but recorded, so the choice was between two complete
positions. My discomfort with B was right and I had under-weighted it. **R2 retires the
question entirely**: at a floor pin those branches are not conditionally-revivable
legacy, they are the *production read path* for 59% of published sessions.

**Synthetic fixtures vs recorded evidence** — a distinction I applied deliberately. The
frozen 2.4/1.1 **recorded** corpus decoded under a declared legacy pin (never altered).
Hand-built **synthetic** act fixtures (`2.2`/`2.6` in `acts/telemetry.test.ts`,
`git-read.test.ts`) were moved to the current schema instead: they are test
constructions, not evidence, and the alternative was putting the pin knob on a
production act. Two of them also carried non-vocabulary harness ids
(`temp-harness`) that only the laxer pre-2.4 branch accepted.
**R2 REVERTED ALL OF THIS COLLATERAL** — see the consequence table below.

## The pin reversal (R2) — the pin is a FLOOR set to the floor

**Jordan's ruling**: `SEGMENT_SCHEMA_PIN` moves to the **oldest version in
`KNOWN_SCHEMA_VERSIONS`**, so production refuses nothing it could have read. Verbatim
rationale: *"there was no stated reason"* for 2.7. Set against nothing: 68 of 116
published sessions (59%, ~19.5k documents) default-refused, the frozen-corpus collision,
and a knowingly-widened reader divergence.

**Implemented as a derivation, not a literal**:

```ts
export const KNOWN_SCHEMA_VERSIONS: readonly string[] = ['1.1', '2.0', /* … */ '2.7'];
export const SEGMENT_SCHEMA_PIN: string = KNOWN_SCHEMA_VERSIONS[0] as string;
```

Deriving it matters: a second hand-written `'1.1'` would be a second source of truth for
"where the floor is", and the constant would silently stop meaning *the floor* the moment
an older version were declared. `KNOWN_SCHEMA_VERSIONS` is now **exported** so the policy
can be asserted against the set rather than against a copied literal.

**What did NOT change, and this is the point**: the reason channel (`below_pin` /
`unsupported_version` / `malformed` instead of a bare `null`), the total decoder with no
`catch → null`, the caller audit, the per-reason tallies, and the floor semantics. The
dial was always the valuable part; R2 moved the value.

### The five consequences — checked, not assumed

| # | Consequence | Result |
|---|---|---|
| 1 | `LEGACY_READ_PIN` should become unused | **Confirmed unused; removed.** Both declarations and all 3 call sites are gone from `session-export.test.ts` / `report.test.ts`. The frozen corpus now decodes through the **production** path with no test-only policy in between — strictly stronger evidence than before. |
| 2 | `below_pin` becomes unreachable in production | **Confirmed, and kept reachable + tested via the knob.** Controls did not go inert — they were re-pointed at an explicitly declared `RAISED_PIN`, and each is paired with a guard asserting the *same record* is READ at the production pin, so a control cannot quietly become a test of nothing. Mutation count **20 → 22, all fire**. |
| 3 | `pin-knob-src-usage.test.ts` must still be meaningful | **Rewritten to the inverted hazard (R2), then re-scoped entirely (R3)** — the R2 rewrite was still blind one hop out. See below. Proven by four planted `src/` mutations, now permanent gate entries PIN-M7/M8/M9/M10. |
| 4 | The reader divergence should collapse | **Confirmed collapsed — and better than "collapsed".** See below. |
| 5 | The 11 corpus failures resolve without the workaround | **Confirmed.** Full telemetry suite green (1653 tests) with the legacy-pin plumbing deleted, not merely defaulted. |

**Consequence 4 in full (ESTABLISHED — I re-read both accept sets).** Reader A
(`decodeSegment`) accepts nine versions again: 1.1, 2.0–2.3, 2.4–2.7. Reader B
(`validSegment`, `published-telemetry.ts:906`) is unchanged at four: 2.4–2.7. So **A is a
strict superset of B once more — exactly the pre-packet state.** The inversion this
packet introduced is not merely mitigated, it is *undone*: the packet now moves the
divergence **not at all**. The residual disagreement (A broader on five dead versions
1.1/2.0–2.3) predates the packet, is the harmless direction, and is untouched.
`telemetry get`/`report` and `telemetry pull` now agree on every version either can
actually meet in the field. **Ruling #9's "we chose to widen a known divergence" no
longer describes this packet** — R2 retracts the widening, and the reviewer should be
told that explicitly, because the previous report surfaced it as a deliberate decision.

**Collateral reverted.** The synthetic act fixtures moved to 2.7 under the old pin
(`acts/telemetry.test.ts`, `git-read.test.ts`) are **reverted to their original 2.2/2.6
shapes** — including the `temp-harness` → `acme-harness-*` renames those moves forced.
The diff shrinks, but that is not the reason: the comments justifying those moves
asserted a rationale that no longer holds (*"a production act must not be handed a
below-pin record to read"*), and a comment stating a retracted reason is this packet's
own defect class committed in prose. Reverting also **restores version diversity through
a production act** — 2.2 and 2.6 records now flow through `telemetry session save` for
real, which is coverage the 2.7 pin had taken away.

## The pin-knob control, rewritten to the INVERTED hazard

**The reviewer's MAJOR was correct**: the old control scanned for *literal* pin values
and was blind to the dynamic `{ pin: opts.pin }` pass-through at `session-export.ts:597`,
so it could not establish the test-only policy it claimed.

**But fixing it to prove the old claim would have proved nothing.** The old control
existed to protect a STRICT 2.7 production policy from being silently opted out of. At a
floor pin there is no strict policy to protect — opting out of a floor does nothing,
because nothing is below the floor. The hazard **inverted**:

| | Old hazard (2.7 pin) | **Live hazard (floor pin)** |
|---|---|---|
| Direction | a `src/` caller making production **more permissive** than declared | a `src/` caller passing a **higher** pin, making production **stricter** than declared |
| Effect | reads data the policy declined | **refuses live data the policy says we read**, with nothing naming the decision |

`session-export.ts:597` is precisely that shape — it forwards a caller-supplied pin with
no floor. So the control now asserts **the live hazard**, in four parts:

1. **Every `src/` site supplying a read policy is DECLARED.** A real balanced-paren
   argument scan (not a regex guess) collects every `decodeSegment(…)` /
   `decodeSegmentDetailed(…)` call under `src/` carrying a second argument, as
   `path:expression`, and compares it **exact-match** against a declared allowlist. A new
   site *or a changed expression* fails until someone re-declares it deliberately.
2. **Every `src/` `pin:` property is DECLARED and ORIGINATES nothing** — each expression
   must be a plain member path (`opts.pin`), never a literal, template, call or
   conditional. This is the half the reviewer found missing.
3. **The declared default IS the floor** — `SEGMENT_SCHEMA_PIN === KNOWN_SCHEMA_VERSIONS[0]`,
   and no known version resolves `below_pin` under it. The allowlist proves nobody raises
   the pin; this proves what the pin they cannot raise actually *is*. An unraised wrong
   default is still a wrong policy.
4. **Behavioural, at a real caller** — a 2.4 record is read, counted and refused by
   nothing through `combineSession`, with no pin passed anywhere.

**On deleting the parameter instead of policing it** — the rule offered (*"a parameter
nobody in production should ever set is better deleted than policed"*) is fair and I
considered it seriously. **I did not take it, and here is the argument.** At a floor pin
`below_pin` is unreachable in production, so this parameter is the **only** path by which
the below-pin *surfacing* stays exercised: the envelope field, the histogram exclusion,
the per-reason separation. Delete it and `below_pin` degrades to a decoder-only artifact
whose plumbing through a real caller nothing proves — which is Ruling #1.1's own failure
mode (*a channel nobody reads is not a channel*) and the vacuity this packet exists to
kill. The parameter earns its keep by being the only door to a reachable-but-unreached
state. It is kept, declared, and policed.

### The planted-mutation proof

*A control that cannot fail is not a control.* Both plants were applied to `src/`, run,
and reverted; `git diff` was empty on both sides. Verbatim output:

**Plant 1 — a production lane silently raising the pin** (`ref-source.ts:74`,
`decodeSegmentDetailed(parsed)` → `decodeSegmentDetailed(parsed, { pin: '2.7' })`):

```text
× CONTROL: every src/ site that supplies a read policy is DECLARED 21ms
× CONTROL: every src/ `pin:` property is DECLARED — and none of them originates a value 12ms

- Expected
+ Received
  [
+   "services/telemetry/ref-source.ts:{ pin: '2.7' }",
    "services/telemetry/segment.ts:options",
    "services/telemetry/session-export.ts:decodeOptions",
  ]
```

**Plant 2 — an IDENTIFIER, not a literal** (`session-export.ts:597`, `{ pin: opts.pin }`
→ `{ pin: SEGMENT_SCHEMA_VERSION }`). **This is the exact evasion the old literal-only
scan would have waved straight through**, which is why it is the more important of the
two:

```text
× CONTROL: every src/ `pin:` property is DECLARED — and none of them originates a value 16ms

- Expected
+ Received
  [
-   "services/telemetry/session-export.ts:opts.pin",
+   "services/telemetry/session-export.ts:SEGMENT_SCHEMA_VERSION",
  ]
```

Both are now permanent gate entries (**PIN-M7**, **PIN-M8**), so the proof does not
depend on my having run it once by hand.

## R3 — the SAME control failed a THIRD time, and the defect was the SCOPE

**The reviewer planted `{ pin: '2.7' }` at `acts/telemetry.ts:1276` and the R2 control
passed 6/6.** It was right to. The mechanism, verified here:

```ts
if (!/decodeSegment|SegmentDecodeOptions/.test(raw)) continue;
```

`acts/telemetry.ts` contains **neither string** — confirmed by `grep -c`, which returns
`0`. So the whole file was skipped. It calls `combineSession`, and `combineSession`
accepts and forwards a pin. **A file can reach the read policy without ever naming the
decoder.**

And the comment above that line stated the false premise out loud — *"scoped to files
that touch the segment decoder, because only those can reach the read policy"*. That
narrowing was wrong, and because a reason was written down it read as *considered*
rather than assumed, so the next reader stops there. **That comment is deleted.** A
retracted reason left standing is this packet's defect class in prose, and it is the
second one I have removed this round.

### Three failures, one shape

| # | What the control did | What it missed |
|---|---|---|
| 1 | counted pin **keys** | the dynamic pass-through |
| 2 | rewritten for the inverted hazard | `session-export.ts`'s own `{ pin: opts.pin }` |
| 3 | covered that site | **the CALLERS of the function that contains it** |

Every time, the scope was drawn around **where I was looking**, and the hazard lived one
hop outside it. That is not three bugs; it is one bug re-committed at increasing radius.

### The fix is a change of PRINCIPLE, not of pattern

I did **not** add `combineSession` to the regex. That fixes hop 2 and goes blind at hop
3, with nothing to say so — a fourth instance of the same defect, pre-installed.

**The hazard does not sit at the decoder. It sits anywhere a pin can ORIGINATE and flow
to one, however many hops away.** So the scan no longer has a notion of hops:

> **Origination scanning is hop-count-INDEPENDENT by construction.** Whatever the chain
> length, the value must be **written** somewhere, and in TypeScript that means the
> identifier `pin` appears at the origin. Enumerating hops is what kept being wrong, so
> the redesign removes the need to enumerate.

The scan now covers **every file under `src/`, with no content filter at all**, for the
identifier `pin` in code. Comments, string literals and regex literals are tokenized
out, so help text like `'--pin <version>'` is inert **by construction** rather than by an
allowlist entry someone has to trust. The price is an **11-entry hand-declared
allowlist** — including `acts/update.ts`'s unrelated `--pin` registry flag, listed by
line rather than exempted by file, *because a file-level exemption is the same move that
failed three times*: a scope narrowed by a judgement about what a file "is about".

The claim the allowlist makes is only the one the mechanism can keep — **that every place
the identifier appears has been looked at**. It is explicitly *not* a reachability proof
that `update`'s pin cannot reach a decoder. Overclaiming there would be the packet's own
defect class again.

### The scope itself is now controlled — always-on, not a one-time plant

The scans take a `Map<path, source>`, so a test can feed them synthetic files. Three
permanent fixtures, run on every suite execution:

1. **the reviewer's exact plant** — a violation in a file naming nothing about the
   decoder **must** be reported;
2. **a THIRD-HOP chain** — origin → forwarder → `combineSession` → decoder — where the
   origin, the new forwarder's parameter declaration, *and* its forward are all reported;
3. **a GUARD** — a file where `pin` appears only in prose, help text and comments is
   **not** reported. Without this the allowlist fills with noise, and an allowlist nobody
   can read is one nobody checks.

*A scan that cannot report the opposite is not a probe*, so the opposite is planted
permanently rather than by hand once.

### The tokenizer nearly reproduced the defect one level down

To scan identifiers I had to tokenize out string literals. **My first tokenizer handled
strings but not regex literals**, mistook `/["']/` for a division, and silently swallowed
the remainder of **six real files** — `command-signature.ts` lost **316 of its 355
lines**. A pin inside any of them would simply not have been found, and the scan would
have reported *"all 11 declared, green"* while looking at almost nothing.

I caught it only because I asserted a **line-count invariant** — tokenizing must preserve
every file's line count exactly. That invariant is now a **fail-closed control that runs
before any allowlist is consulted**: if the tokenizer ever falls out of step with the
language, the suite says so instead of going quietly blind. Currently **252/252 files in
sync**.

Worth stating plainly: the instrument I built to catch silent blindness was itself
silently blind, and only a probe that could return the contrary answer found it. That is
the fourth time tonight that pattern has paid.

### The planted-mutation proof (R3)

Both plants applied to real `src/`, run, reverted; `git status` clean on both sides.

**PIN-M9 — the reviewer's exact plant**, `{ pin: '2.7' }` at `acts/telemetry.ts`
(`grep -c 'decodeSegment\|SegmentDecodeOptions'` → `0`). Old control **6/6 PASS**. New
control **2 of 9 FAIL**:

```text
AssertionError: expected [ …(12) ] to deeply equal [ …(11) ]
+   "acts/telemetry.ts:exp = combineSession(sessionId, { fs: deps.fs, proc: deps.proc, env: deps.env }, { pin: });"
```

Note the literal `'2.7'` is tokenized away, leaving `{ pin: }` — an **empty** expression,
which fails the origin rule's member-path shape. So `pin: '2.7'` is caught as an
**origination** even though the literal itself is stripped.

**PIN-M10 — a THIRD HOP**, cross-file: origin in `acts/telemetry.ts` → a new forwarder in
`session-export.ts` → `combineSession` → decoder. Caught at **all three** points:

```text
+   "acts/telemetry.ts:exp = exportForReport(sessionId, { fs: deps.fs, proc: deps.proc, env: deps.env }, { pin: });"
+   "services/telemetry/export-bridge.ts:o: { pin?: string },"
+   "services/telemetry/export-bridge.ts:return combineSession(sessionId, deps, { pin: o.pin, root: });"
```

**The gate itself had to change to express this.** The runner only supported a single
file replacement, but the third-hop hazard is **cross-file by nature** — an origin in one
file, a forwarder in another. A gate that can only edit one file cannot express the
defect it is meant to catch, so `/tmp/packet-mut.py` now accepts a list of edits applied
and reverted as one unit. Disclosed rather than worked around by shrinking the mutation
to fit the tool.

## R4 — the scan was right and the CLAIM was wrong; the door is SEALED, not policed

**The reviewer did not argue the hole — it BUILT one.** It added

```ts
combineSession(sessionId, deps, { ...JSON.parse(config) })
```

to production source and `pin-knob-src-usage.test.ts` stayed **9/9 GREEN**. No `pin`
identifier, no `pin:` property, no direct decoder call: all three static scans defeated
at once, and **none of them defective**.

That distinction decides the fix. The scans do exactly what they say — they find every
place `pin` is **written** in `src/`. The file's prose asserted something stronger:
that *no production path can raise the pin*. A value arriving through `any` needs no
token at all, so text scanning can establish the first claim and can never establish the
second. Boundary 9 had named this case; its stated mitigation only detected a **new type
entry point**, and this was a new **filling of the existing one**.

Two honest end states existed — close the hole and keep the claim, or keep the hole and
weaken every claim to what the scan proves. Keeping both the hole and the strong claim
would have been **this packet's own defect class, committed in the packet's own prose**.
Ruled (ruling #11) and taken: **close it**.

### The seal, and why the SHAPE of the door is the whole argument

`pin` is **removed from `CombineSessionOpts`**. The below-pin surfacing moves behind
`combineSessionAtPinForTests(sessionId, deps, opts, readPin)` — a named export taking
the pin as a **positional argument**. Both entry points delegate to a private
`combineSessionAtPin`; production's only door passes `undefined`.

The change is not "a better hiding place". It is a change of **kind**:

| | Before | After |
|---|---|---|
| How the door opens | a FIELD on a bag production already constructs | an IDENTIFIER a caller must WRITE |
| Can data open it? | **yes** — `{ ...JSON.parse(cfg) }`, no token anywhere | **no** — `JSON.parse` returns values, never bindings |
| What a scan can prove | "nobody wrote a pin" (weaker than the claim) | "nobody named the seam" (exactly the claim) |

So the scans stop being load-bearing and become **confirming**. That is the point of
sealing over policing: no scan can be defeated, because no scan is what holds.

### What sealing did NOT buy — the ruling's suggested proof does not hold

The ruling asked me to cite a compiler error: *"the proof is that the planted source no
longer compiles"*. **It still compiles.** I planted the reviewer's exact line in real
`src/acts/telemetry.ts` and ran `npx tsc --noEmit -p tsconfig.json` → **exit 0**.
Spreading `any` into an object literal yields `any`, and excess-property checking does
not apply to `any`, so removing the field produces no diagnostic at the call site.

What removal produces is **inertness**: no code reads `opts.pin` any more, so the bag can
carry the key and change nothing. Inertness is only observable by **running** it — hence
the seal's control is behavioural, not a type error. Stated here rather than quietly
substituted, because a ruling's predicted evidence that does not materialise is exactly
the kind of thing that gets rounded to "done" in a report.

### The two new controls, and their pre-fix output

**PIN-M11 — the sealed hole, re-armed.** `pin?: string` restored to `CombineSessionOpts`
and read back into the decode options. The SEAL control replays the reviewer's exact
construction and fails:

```text
FAIL  CONTROL: the SEAL — a `pin` on the production options bag changes NOTHING
AssertionError: expected { below_pin: 1, …(2) } to deeply equal { below_pin: +0, …(2) }

  {
-   "below_pin": 0,
+   "below_pin": 1,
    "malformed": 0,
    "unsupported_version": 0,
  }
```

`below_pin: 1` is the reviewer's evasion **working** — a 2.4 record refused by a policy
nothing in `src/` ever named. Post-seal the same construction reads the record. The
control also asserts the bag genuinely carries `pin: '2.7'` at runtime, so it cannot pass
by the key having quietly gone missing.

**PIN-M12 — a production lane CALLS the seam.** Planted in `acts/telemetry.ts`, the file
that names neither the decoder nor a pin — the same blind spot that hid the R3 plant:

```text
FAIL  CONTROL: the one remaining door is an IDENTIFIER, and no src/ file names it
AssertionError: expected [ 'acts/telemetry.ts' ] to deeply equal []
+   "acts/telemetry.ts",
```

Its guard (a synthetic `Map`) plants a seam call in a file mentioning nothing about
telemetry and a second file mentioning nothing at all, and asserts only the first is
reported — so the scan cannot pass by reporting everything or nothing.

### The gate runner had a silent defect, found while adding these

Adding two same-file edits exposed a bug in `/tmp/packet-mut.py`'s multi-edit loop: it
re-read the **pristine** original for each edit, so for two edits to one file **only the
last survived**. PIN-M10 (added in R3) had been applying its call-site edit and silently
dropping its import edit — it still fired, so nothing said so. **A gate quietly applying
less than it claims is this packet's defect class living in the instrument**, and it was
invisible for exactly the reason the packet is about: the observable outcome (FIRES) is
identical either way. Fixed to compose edits; the whole gate re-run afterwards.

Consequence, recorded rather than smoothed over: **PIN-M9 dropped 3 failures → 2** and
**PIN-M10 5 → 2**. Not a control going blind — the seal makes a planted `{ pin: … }`
**inert at runtime**, so the behavioural assertion it used to trip no longer trips. The
scans still catch both plants, which is the honest residue: after the seal, a written pin
is a **hygiene** violation rather than a live hazard.

### R4 interaction pass (ruling #6, re-run because an item changed)

| # | Question | Finding |
|---|---|---|
| L1 | Does the seal break the floor pin (R2)? | No. The floor is `SEGMENT_SCHEMA_PIN` in the decoder; the seal removes a *caller-side* override only. The floor controls are untouched and still pass. |
| L2 | Does it make `below_pin` unreachable — the vacuity R2 warned about? | No, and this was the reason deletion was rejected in R2. The seam preserves the end-to-end surfacing at a real caller: `GUARD: the knob is NOT inert` still drives `combineSessionAtPinForTests` and still sees `below_pin: 1` in the **envelope**, not just the decoder. |
| L3 | Does it touch the reader divergence (ruling #9, retracted in R2)? | No. `validSegment` was never routed through `combineSession`; the accept sets are unchanged. The retraction stands. |
| L4 | Does it interact with FX002's read-time resolution? | No shared surface. FX002 resolves identity from the pij registry; the pin governs which `schema_version` decodes. Verified by the gate: all FX002 mutations still fire at unchanged counts. |
| L5 | Does removing a production type break any other caller? | Four `combineSession` call sites in `src/` (`acts/telemetry.ts` ×3, `published-telemetry.ts` ×1) — **none passed a pin**; `tsc --noEmit` clean; full suite green. The blast radius was real and empty. |

## R5 — the SEAL held; the CLAIM around it did not. The claim is now NARROW

Ruling #12. The reviewer refuted the seal's argument the same way it refuted the last
one — by **building** it, not by arguing it:

```js
Reflect.get(module, config.seam)
```

with the seam's **name** and the pin both arriving from JSON. No `pin` token, no seam
token, all **11** pin controls green, and a 2.4 record reached `below_pin: 1`.

The R4 claim was *"an identifier cannot arrive as data, because `JSON.parse` returns
values and never bindings"*. **Under reflection the name is data too.** That claim is
false and is withdrawn.

### The preferred fix was attempted first, and it does not hold

Ruling #12 preferred making the seam **unnameable** — export it under a `Symbol`, which
`JSON.parse` cannot produce. I built that shape and probed it rather than reasoning
about it. Verbatim, `/tmp/symprobe/`:

```text
reviewer construction   -> UNRESOLVED (defeated)
two-hop construction    -> READ AT PIN 2.7
enumeration construction-> READ AT PIN 2.7
```

- **Hop 1** `Reflect.get(m, cfg.seam)` — defeated, exactly as the ruling predicted.
- **Hop 2** the test has to index the symbol, so the symbol must be exported under
  *some* string name; `Reflect.get(Reflect.get(m, cfg.bag), Reflect.get(m, cfg.key))`
  reaches it with nothing but strings out of the same JSON.
- **Hop 0** `Object.getOwnPropertySymbols(bag)[0]` reaches it using **no name at all** —
  strictly easier than the construction being defended against.

The general fact underneath: **tests and production share one module graph, and
reflection is total over it.** Anything a test can reach, `src/` can reach. A `Symbol`
buys one hop, which is the instance again — the precise error of the previous four
rounds. Per the ruling's binding stop condition (*"if it does not hold on first attempt,
take the narrowed claim and stop"*), I took the narrowed claim. **I did not split the
difference: no Symbol was added.** Adopting a change that defeats one construction while
the claim still has to be narrowed would buy a stronger-looking file and no stronger
guarantee.

### What actually happened: the THREAT MODEL drifted, and only the prose moved

This is the finding, and the ruling named it before I did. The control was built to
catch a developer **accidentally** raising the pin. By round five it was being asked to
withstand **deliberately obfuscated access** — JSON-parsed config, dynamic import,
reflected export. Nobody writes that by mistake.

Both are legitimate. They are not the same concern. And across R3→R4 the **mechanism
never over-reached** — every scan did exactly what it said. **The prose ratcheted**,
from "nobody wrote a pin" up to a blanket promise about what production could reach,
with nothing anywhere comparing the two.

So the defect was never in the scan. It was **an instrument whose coverage claim is
broader than its coverage** — this packet's entire thesis, committed in the packet's own
control. That is the third time this class has shown up *inside our own evidence* (after
the `0`-vs-not-probeable collision tally and the retracted-reason comment in R3).

### The claim, and where it now lives

> No production call site raises the read pin, and none can do so without writing the
> seam's name in source. **Deliberate dynamic dispatch is out of scope and unchecked.**

Carried **verbatim** in both claim sites — `src/services/telemetry/session-export.ts`
(the seam's doc block) and `test/services/telemetry/pin-knob-src-usage.test.ts` (the
header) — and enforced by a control, not by care.
*(**Superseded in R6**: there were **three** claim sites, not two. `segment.ts` carried
the withdrawn wording and was not on the list. See R6 finding 1.)*

**No fifth scan was written.** A scanner aimed at reflection would be the fourth-wrong
thing done a fifth time, and the sixth construction would defeat it.

### The two new controls

**1. `CONTROL: the CLAIM and the SCAN'S COVERAGE agree, gap named in the same breath`.**
Both claim sites must carry `NARROWED_CLAIM` verbatim, and neither may carry any wording
retracted in rounds #11 or #12. Three planted guards prove it fires: a site with no claim,
a site that re-broadens in prose, and a site that re-broadens **in a test title**.

Two design points that were not obvious and cost a debug cycle each:

- **It scans comment prose *and* `describe`/`it` titles — not the whole file.**
  *(**Superseded in R6**: the title half read titles out of SOURCE, so it only ever saw
  the ones written as literals. Titles are now read from the runner. The prose half and
  the reasoning below stand unchanged.)* The
  ratchet's furthest reach *was a title*: this suite was literally named with the
  unrestricted claim, which is the one line every failure report prints. A whole-file
  scan is simpler and wrong: the retracted wordings are listed in-file as string
  literals, and **a file must be able to name what it withdrew without that counting as
  it saying so.** Comment extraction reuses `codeOnly`'s tokenizer via a sink rather than
  adding a second scanner — a second scanner would be a second answer to "what is a
  comment here".
- **A scanner that reads its own test data measures itself.** Two self-reference bugs
  fired during development: my own doc block *quoting* the retracted title tripped the
  ban, and a fabricated guard fixture was picked up as a real title of this file. Both
  were caught by the control, which is the control working. The fixture is now assembled
  with the file's existing `join('')` idiom so it cannot self-match.

**2. `KNOWN GAP, ASSERTED: dynamic dispatch DOES reach the seam — the claim says so`.**
The reviewer's construction is replayed and asserted to **succeed** (`below_pin: 1`),
while `seamCallSites` — correctly, per its stated scope — reports nothing. A gap that is
tested cannot be closed by accident or quietly forgotten: the day someone closes it,
**this test fails** and forces the claim above to be widened deliberately, in writing, by
whoever earned it.

### Pre-fix output, verbatim

Both claim sites reverted to their pre-R5 wording (the suite title restored, the claim
stripped from the seam's doc block):

```text
 FAIL  test/services/telemetry/pin-knob-src-usage.test.ts > no production path can raise the read pin (load-bearing) > CONTROL: the CLAIM and the SCAN'S COVERAGE agree, gap named in the same breath
AssertionError: expected [ …(2) ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "src/services/telemetry/session-export.ts: claim missing",
+   "test/services/telemetry/pin-knob-src-usage.test.ts: retracted claim \"no production path can raise\"",
+ ]
```

Note the failure header itself: the retracted claim is printed in the suite name on the
same line as the failure. That is the artifact the title-scanning half exists for.

### `SegmentDecodeOptions` — same shape one layer in, and **left**

Per ruling #12: not sealed. Sealing it would remove the knob the below-pin machinery is
tested through, and we are not trading real coverage for a claim we have just agreed to
state honestly. **The narrowed claim applies there too, and the gap is unclosed there for
the same reason**: `pin` is a field on the decoder's own options bag, so it can be filled
by data, and the decoder itself can be reflected out of its module. Its two `src/` call
sites are declared and its scope is `services/telemetry`, which is why it stays.

### R5 interaction pass (ruling #6, re-run because an item changed)

| # | Question | Finding |
|---|---|---|
| M1 | Does narrowing the claim change any **behaviour**? | No. R5 edits prose, one `describe` title, and adds two tests. `src/` behaviour is byte-unchanged apart from a doc block; `tsc --noEmit` clean. |
| M2 | Does asserting the gap (`KNOWN GAP`) contradict the seal (R4)? | No, and this was the sharpest question. The seal's *behavioural* claim — a `pin` on `CombineSessionOpts` is INERT — is untouched and still proven by `CONTROL: the SEAL`. Only the *reachability* claim was withdrawn. Both tests now pass side by side, which is the honest picture: the field is dead, the export is reachable. |
| M3 | Does it weaken FX002 or FX004? | No shared surface; all 12 FX002/FX004 mutations still fire at unchanged counts. |
| M4 | Does it re-open the reader divergence (ruling #9, retracted in R2)? | No. The pin value is untouched — still the floor. `validSegment` is not involved. |
| M5 | Does the claim-scan interact with the **tokenizer** guard (R3)? | Yes, and deliberately: `commentProse` reuses `codeOnly`, so the line-preservation control now protects the claim scan too. If the tokenizer breaks, the claim scan fails red rather than silently finding no prose — the same fail-closed direction. |
| M6 | Could the claim control itself become true-but-empty? | It is the risk the guards exist for, and it **actually happened twice in development** (both self-reference bugs made it report violations, not silence — the safe direction). Its three planted guards fire; PIN-M13/M14 fire in real source. |

## R6 — the narrowing was not carried out. Both escapes are closed

Ruling #13, and the ruling is explicit that this is **not a sixth iteration of the
scan**: it is ruling #12's instruction (*"the narrowed claim applies there too… stated in
the log, not implied"*) left unfinished, plus one edit that rides along because it is the
same file in the same breath. Both findings are upheld. Neither is a scan defect.

### Finding 1 — the blanket claim survived in a THIRD file

`segment.ts` still asserted, at `SegmentDecodeOptions`:

> …them ORIGINATES a value — **so no production path can raise the effective pin.**

That is the withdrawn blanket wording, and it was **false where it stood**: the
reviewer's asserted dynamic dispatch drives the downstream effective pin to 2.7 and
refuses a 2.4 record — a fact this packet's own `KNOWN GAP, ASSERTED` control asserts
one file away.

The control could not see it because `CLAIM_SITES` listed only the seam and the test
file. **That is the whole bug.** The fix is the small one the ruling specified: the
narrowed claim, verbatim, at that site, and the site added to `CLAIM_SITES`.

**No scan was written to hunt for further claim sites.** `CLAIM_SITES` is a *declared*
list on purpose — the same reason the pin allowlist is by line and not by file. A claim
site is a place someone chose to make a promise, and there is no pattern that reliably
finds those; declaring one is a one-line edit, finding one is a reading job, and it stays
a reading job. I did the reading for the two neighbouring files (`ref-source.ts`,
`session-export.ts`) against all eight retracted wordings and **found no further site**;
that is a reading, not a guarantee.

### Finding 2 — a COMPUTED title reprinted the withdrawn wording, invisibly

The title half of the claim scan matched `describe`/`it` only where the first argument
was a **literal**:

```ts
/\b(?:describe|it)\(\s*(['"`])([\s\S]*?)\1/g
```

So `describe(['no production ', 'path can raise it'].join(''), …)` printed the retracted
claim in **every failure header** while the control reported nothing.

The irony is worth recording because it is the lesson: **that idiom is the one I used in
this very file** to stop fabricated fixtures self-matching. The evasion was already in
the file, in my own hand, as a technique — and I did not think to point it at my own
check.

**The fix is structural and is not a better parser.** Per the ruling, an expression
parser that chased computed titles would be the fifth scan and would lose to the sixth
construction. Titles are now read from the **runner's collected tree** instead
(`resolvedTitles(ctx.task.file)`): collection has already finished by the time any test
body runs, so every title in the file is present — including suites declared *below* the
running test, which I verified rather than assumed — and every one is a plain string,
**whatever expression produced it**. There is nothing left to parse and therefore nothing
left to out-write. Source parsing stays for **prose**, where there is no runtime
equivalent to read.

`claimText` is now prose-only; `titleViolations` reads the runtime titles. Two readings,
because only one of them has a runtime form.

### Pre-fix output, verbatim

**Both holes open at once, against HEAD `48c879e8`** — the reviewer's computed-title
plant appended to the pre-fix control, `segment.ts` carrying the blanket wording:

```text
 ✓ test/services/telemetry/pin-knob-src-usage.test.ts (14 tests) 252ms

 Test Files  1 passed (1)
      Tests  14 passed (14)
```

Green, with the withdrawn claim printed in the report as a suite name:

```text
 ✓ test/services/telemetry/pin-knob-src-usage.test.ts > no production path can raise it > planted 0ms
```

**Finding 1, control firing** (fixed control, pre-fix `segment.ts`):

```text
 FAIL  test/services/telemetry/pin-knob-src-usage.test.ts > no production path raises the read pin without naming it (load-bearing) > CONTROL: the CLAIM and the SCAN'S COVERAGE agree, gap named in the same breath
AssertionError: expected [ …(2) ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "src/services/telemetry/segment.ts: claim missing",
+   "src/services/telemetry/segment.ts: retracted claim \"no production path can raise\"",
+ ]
```

**Finding 2, control firing** (fixed control, reviewer's computed-title plant):

```text
 FAIL  test/services/telemetry/pin-knob-src-usage.test.ts > no production path raises the read pin without naming it (load-bearing) > CONTROL: no RESOLVED title asserts a retracted claim, however assembled
AssertionError: expected [ Array(1) ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "title \"no production path can raise it\": retracted claim \"no production path can raise\"",
+ ]
```

### The new control, and its anti-vacuity

`CONTROL: no RESOLVED title asserts a retracted claim, however assembled` — and the
title of that control is supplied to `it` as an **identifier**, not a literal, so the
control demonstrates the case it exists to cover rather than only asserting it.

Its first assertion is the non-vacuity one, deliberately placed first: **if the runner's
tree ever changes shape the walk returns nothing and the check passes by having read no
titles at all** — this packet's own defect class, inside the control written to kill it.
So it asserts its own title comes back before it asserts anything about the contents.

Guards, per the ruling: a literal banned title and a computed banned title are caught
**identically** (that identity *is* the fix — by read time there is no difference left
between them), and a benign computed title is **not** reported, or the control would just
be banning a syntax.

Both findings are permanent gate entries: **PIN-M15** (the blanket claim returns to
`segment.ts`) and **PIN-M16** (the reviewer's computed-title plant). Both fire.

### R6 interaction pass (ruling #6, re-run because items changed)

| # | Question | Finding |
|---|---|---|
| N1 | Any behaviour change? | None. `segment.ts` is a **doc block only** — no executable line touched; `tsc --noEmit` clean. The test file gains one control and swaps one reading for another. |
| N2 | Does dropping source-title parsing LOSE coverage? | **(Corrected in R7 — the original answer claimed a strict superset and that is false; see below.)** The two readings are **not comparable by subset in either direction**, because they do not read the same kind of thing. The property that actually holds: **every title the runner collects is read, whatever expression produced it — literal or computed — and PIN-M13 and PIN-M16 prove both. Text resembling a `describe` call in a comment or a quoted string is not a title and is not read.** |
| N3 | Does reading `ctx.task.file` couple the control to a vitest internal? | Yes, and it is stated rather than hidden. `file.tasks` is the runner's collected tree; a shape change would break the walk. The non-vacuity assertion is exactly the mitigation — a broken walk fails **red**, not silent. |
| N4 | Does adding `segment.ts` to `CLAIM_SITES` create a new failure mode? | Yes, the intended one: `segment.ts` must now carry the claim verbatim forever. PIN-M15 is that gate. |
| N5 | Does R6 disturb the R4 seal or the R5 gap assertion? | No. Both untouched and still passing; the seal's behavioural claim and the asserted gap are unchanged. All 30 mutations fire. |
| N6 | Does it touch FX002/FX004 or the pin VALUE? | No shared surface. Pin still at the floor; all 12 FX002/FX004 mutations fire at unchanged counts. |

## R7 — N2 claimed a strict superset. It was not one. Log-only correction

The reviewer declined an easy approve over the sentence above, and it was right to: **a
false proof claim in the log is a defect in exactly the thing this packet exists to
fix.** The decoy that settles it:

```ts
const decoy = "describe('no production path can raise it', () => {})";
```

The old source regex extracted that as a title. The runner never will — **because it is
not a title.** It is a string literal inside code. So the old reading matched *text that
looked like a `describe` call anywhere in the file*, comments and quoted strings
included, none of which were ever titles; the new reading reads *the titles the runner
actually collected*. One gained every computed title; the other had false matches that
were never coverage. Neither contains the other. N2 above now states the property that
does hold, and the false one is corrected rather than merely softened.

**This correction is unguarded, deliberately.** The obvious move — adding the superset
phrasing to `RETRACTED_CLAIMS` so the fix self-enforces — does not work. The false claim
lives in **this log**, and the log is deliberately not a `CLAIM_SITES` entry: it is the
packet's history and must be able to quote its own retracted statements verbatim. Worse,
this same file uses "strict superset" **five other times, correctly** — every one of them
about **reader A vs reader B** and the divergence R2 retracted, not about this control.
A ban would fire on the true uses and miss the false one. **A control that cannot
distinguish the wrong claim from the right one is not a control**, so there is none here
— the sentence is corrected and the absence of a guard is stated.

**Three consecutive rounds now, the mechanism was right and the SENTENCE was wrong.** R4,
R5, R6 — the seal held, the reading held, the coverage held, and each time the claim
written around it said more than it had earned. That is this packet's own thesis landing
on the packet: *an instrument whose claim is broader than its coverage.*






`harness/cli/test/output/error-codes.test.ts` already asserts
`expect(code).toMatch(/^E\d{3}$/)` across `Object.values(ErrorCodes)` — exactly the
requested control, covering every future code. Adding a second would be a second source
of truth. **E149 was added to the exhaustive registry snapshot in the same file**, which
is the declared-registry gate doing its job.

## The discard proof — and its inertness in the LIVE tree

`\.harness/extensions/flow-eval/packet-code-shape-discard.test.ts` — a **new test file
only**; no existing flow-eval file was modified.

It drives the **real lane** (`resolveAssertionDetailed`) and proves both halves:
a code outside `/^E\d{3}$/` is discarded so it cannot license a `fail` **or** a
false-green `pass`; a valid code still licenses both; a malformed sibling does not
poison a good entry (exclude, not reject); and **every code in the CLI registry —
including E149 — is counted, not discarded.**

**Non-vacuity proven, not assumed.** Transiently widening `REFUSAL_CODE` to `/^.*$/`
made the suite go **2 failed | 3 passed**; `resolvers.ts` was restored and
`git diff` on it is **empty before and after** (byte-identical).

**Inertness proof, with Ruling #4's positive control.** `doctor --json` **BEFORE**
listed 12 loaded entries and **contained** flow-eval's `entryPath`
(`.harness/extensions/flow-eval/extension.ts`, `loaded`) — so the probe is populated and
correctly keyed, and an unchanged list afterwards means something. **AFTER**: the list is
**byte-identical** (`diff` empty), and `flow-eval --help` hashes identically
(`c52636fa4f4eea8c93667aa529e8368bf0d5ab6b`) both sides.

## FX002 · Ruling #7 — unresolved is a STATE, and only some of it is a finding

**Field evidence (ESTABLISHED — orchestrator scan of all 458 `~/.pij` descriptors,
plus my own read of the live `pij-telegram` descriptor):**

- **397 adopted** (`spawnedBy` null) vs **61 spawned** — the adopted case is the
  majority, not an edge.
- **396 of 397 adopted seats carry `harnessSessionId`** — the read-time join key exists
  in the field at scale, not just on the seat that happened to look.
- **`pij-telegram` carries no session key at all** — and it is **not** a degenerate
  outlier. It is a **RELAY**: a bridge, not an agent session. Its real descriptor
  carries `relay: true`, `lifecycle: 'bound'`, `harness: 'pi'` and **no
  `harnessSessionId` key whatsoever**. It will never have one, by its nature, forever.
- **harnessSessionId collisions: NOT-PROBEABLE.** Deliberately *not* recorded as
  "zero". `by_harness_session` is first-wins, so a collision and a non-collision produce
  the **identical observation** — the instrument that would count collisions is the same
  mechanism that conceals them. A `0` in a table gets read as data by the next person,
  and there will be a next person. The ambiguity guard is therefore **prospective and
  unexercised by real data**, validated only against fabricated input. It stays.

  Worth naming: that is *absent-vs-invisible* — the exact distinction this packet
  defends — showing up **inside our own evidence for the fix**, not in the system under
  repair.

**The design consequence.** Because a relay is a permanent legitimate inhabitant, the
unresolved path is **not an error path**. If unresolved carried a severity,
`pij-telegram` would emit it *forever*, and a permanent warning is one everyone learns
to ignore — which would then **hide the real unresolved cases behind it**. An alarm
whose only steady output is noise guards nothing.

So the vocabulary splits along **actionability**, decided in exactly one place
(`isActionable`) so no consumer re-derives severity and drifts:

| reason | actionable | meaning |
|---|---|---|
| `no_session_by_nature` | **no** | a relay/bridge — expected, permanent steady state |
| `registry_unavailable` | **no** | a capability gap is not a subject failure |
| `session_key_missing` | **yes** | a non-relay seat that *should* have had a key |
| `no_descriptor_match` | **yes** | nothing in the registry claims this session |
| `ambiguous` | **yes** | >1 descriptor claims it — never silently first-wins |

`resolveDescriptorIdentity` answers the **descriptor direction** ("can this seat be
joined at all?"), which is where the bridge case can be *said*: the session direction is
keyed **by** a session id, so a seat that has none can never be its subject.

`relay` was added to `PijDescriptor` **additively** — without it, "has no session
because it is a bridge" and "should have a session and does not" are the same
observation.

## The interaction pass (Ruling #6) — reviewing the packet as a SET

This packet was assembled **incrementally**: FX002 as a dossier, FX004 after its
mechanism was refuted, the pin folded in later. Each was adjudicated against the world as
it stood when it arrived, so until all three were in hand nobody was positioned to review
them as one set. This is that pass — asking of each item not "is it correct" but **"is it
still correct in the presence of the others"**.

| # | Interaction | Finding |
|---|---|---|
| **I1** | **pin → FX002** | FX002's env-based resolution reads `captured_env` from segments that **survived** the pin. A *spawned* seat whose segments are all below-pin now reports `unresolved` where it previously resolved from env. **Verified empirically**: identity `{unresolved, registry_unavailable}` with `segments_refused {below_pin: 1}`. Both facts are in the envelope, so it is honest — but a reader must **correlate two fields**. Stated, not hidden. |
| **I2** | **FX002 → pin** | A capture-time marker would bump the schema to 2.8, which the 2.7 pin refuses — the instrument would stop reading its own output. **Avoided** by resolving at read time. |
| **I3** | **FX004 → FX003** (already approved in this PR) | E149 must match `/^E\d{3}$/` or the flow-eval refusal lane silently discards it. **Controlled** by the discard proof, which drives the real lane with every registered code. |
| **I4** | **FX004 → error-code registry** | E149 added to the exhaustive snapshot; the registry-shape assertion already covers it. |
| **I5** | **pin → the SECOND reader** | See the boundary below — the packet **widens** an existing divergence. The most consequential item in this pass. |
| **I6** | **pin knob → the pin** | A knob is an opt-out. **Controlled** by `pin-knob-src-usage.test.ts`. |
| **I7** | **FX002 `relay` → fleet-evidence** | `rosterDescriptor` synthesises a `PijDescriptor` and needed the new field; set `relay: false` with a reason (that path only runs for members that *have* join keys). Caught by typecheck. |
| **I8** | **FX004 guard → telemetry capture** | The guard exits *after* the capture preamble, so an E149 invocation captures and exits like any other error path. **Verified live**: exit 1, clean JSON, empty stderr. |
| **I9** | **pin → flow-eval evidence** | flow-eval reads via `harness telemetry get` → `session-evidence` → `readRefSegments` → **the pinned decoder**. So the pin *does* bind flow-eval. **The failure direction is the safe one**: reduced evidence makes telemetry assertions resolve `unknown`, never `fail` — exactly the polarity FX003 established. |


### The R2 interaction pass — re-run because an item changed

Ruling #6 makes this a **stage**, not advice, and R2 changed a value three other items
lean on. Same question, asked again over the assembled set.

| # | Interaction | Finding |
|---|---|---|
| **J1** | **R2 → I1** | **I1 IS RETRACTED — the interaction no longer exists.** I1 was the item I most wanted challenged: a spawned seat whose segments were all below-pin reported `unresolved`, requiring a reader to correlate two envelope fields. At a floor pin **nothing is below-pin in production**, so identity is never lost to a policy refusal. The finding was real; the reversal dissolved it rather than my fixing it. |
| **J2** | **R2 → I2 (FX002 read-time)** | **The hazard SURVIVES the reversal, by a different mechanism, and the ruling still holds.** A capture-time marker would bump `SEGMENT_SCHEMA_VERSION` to 2.8 — which is refused not for being *below* the pin but for being **outside `KNOWN_SCHEMA_VERSIONS`** (`unsupported_version`). The instrument would still stop reading its own output. So read-time was right for a reason that **outlives the pin value**, and the correct guard is not about the pin at all: **whatever we WRITE must be in the DECLARED set.** This pass produced a new control for exactly that — *"the instrument can READ ITS OWN OUTPUT"* asserts `KNOWN_SCHEMA_VERSIONS` contains `SEGMENT_SCHEMA_VERSION` and that its rank is not below the pin. Bumping the write schema without declaring it now fails a test instead of silently blinding the reader. |
| **J3** | **R2 → I5 (second reader)** | **The widening is retracted** — A is a strict superset of B again, back to the pre-packet state. See the divergence section; the reviewer was told about the widening, so it must be told the widening is gone. |
| **J4** | **R2 → I6 (the knob)** | **The hazard inverted** (permissive → strict) and the control was rewritten to match, not patched to prove the old claim. Two planted `src/` mutations fire; both are now permanent gate entries. **Superseded by R3 — the rewritten control was still blind one hop out. See the K-pass.** |
| **J5** | **R2 → I9 (flow-eval evidence)** | Direction reverses **favourably**: flow-eval's telemetry assertions now see *more* evidence, not less. Nothing to guard — but note that more evidence means an assertion previously resolving `unknown` can now resolve `pass`/`fail`. That is the instrument working, and it changes **no** recorded result, because the 2.7 pin never shipped. |
| **J6** | **R2 → the Option C rationale** | The knob's original justification (frozen-corpus read-back) **evaporated** — production reads the corpus now. The knob is retained for a *different* reason (`below_pin` exercisability), so the in-code rationale was **rewritten rather than left standing**. A parameter whose stated reason has been retracted is this packet's defect class in prose. |
| **J7** | **R2 → the synthetic fixtures** | The 2.7 moves were collateral of the old pin and their justifying comments were now false; **reverted**. Restores 2.2/2.6 records flowing through a production act. |
| **J8** | **R2 → FX004 / E149** | **No interaction.** FX004 is the extension-discovery lane; it neither reads nor decodes segments. Checked rather than assumed. |
| **J9** | **R2 → the frozen-corpus proof** | The corpus decodes through the **production** path with no declared override — strictly stronger than before. The pre-2.7 decoder branches are no longer "kept alive by a test-only pin"; they are the production read path. |

**Nothing in this pass is left open.** J2 is the one that changed the build: it produced a
control that did not exist before and that guards a hazard the pin reversal did *not*
remove.

### The R3 interaction pass (K1–K5) — re-run because an item changed

Ruling #6's stage is re-entrant: R3 altered an item (the pin-knob control), so the set
was reviewed as a set again rather than the item being checked alone.

| # | Interaction | Finding |
|---|---|---|
| **K1** | **R3 → the whole `src/` tree** | **New coupling, accepted deliberately.** The control now scans **every** file under `src/`, so it is no longer a telemetry-local test — any file introducing the identifier `pin` fails a telemetry suite. Checked: no other packet item (FX002 `pij-identity`, FX004 `app.ts` / `no-extension-context`) introduces one. The coupling is the *mechanism*, not a side effect: a scan that only fires for files someone remembered to include is the defect being fixed. |
| **K2** | **R3 → `acts/update.ts`** | **A genuine cross-domain cost, stated.** Six allowlist entries belong to `harness update --pin`, an unrelated feature. Entries are normalised to the **tokenized** line, so help-text and message churn does not break them — but a structural edit there now fails a telemetry test. Judged worth it: a file-level exemption is precisely the narrowing that failed three times. |
| **K3** | **R3 → the Dim-0 gate** | **The gate had to change.** The third-hop hazard is cross-file by nature, and the runner could only edit one file. Extended to multi-file mutations applied/reverted as a unit. All 24 mutations re-verified after the change — **none went silent**, which is the specific risk of touching a gate runner. |
| **K4** | **R3 → J2's "read its own output" control** | **No conflict, and they compose.** J2's control asserts the *write* schema is in the declared set; R3's asserts nobody *raises the read pin*. Both are needed and neither can substitute: J2 guards the producer, R3 guards the policy. |
| **K5** | **R3 → the R2 planted-mutation proof (PIN-M7/M8)** | **Both still fire, at 4 and 8** (up from 3 and 7 — the new scan adds failing assertions, it does not replace them). The R2 proof is *extended*, not superseded; the old evidence stands and the R3 evidence is additional. |

**One thing this pass changed:** K3. Extending the mutation runner is a change to the
instrument that judges everything else, so re-running the *whole* gate rather than the two
new entries was not optional — a runner edit that silently broke one existing mutation
would have removed a control while appearing to add two.

## The reader divergence — the packet WIDENED it, then R2 RETRACTED the widening

**ESTABLISHED** (I read both accept sets directly, before and after R2, and confirmed
`published-telemetry.ts` contains **zero** uses of `decodeSegment`):

| Reader | Accepts (pre-packet) | At the 2.7 pin | **After R2 (current)** |
|---|---|---|---|
| **A** `decodeSegment` (`segment.ts`) | 1.1, 2.0–2.3, 2.4–2.7 — **nine** | 2.7 only — **one** | 1.1, 2.0–2.3, 2.4–2.7 — **nine** |
| **B** `validSegment` (`published-telemetry.ts:906`) | 2.4–2.7 — **four** | 2.4–2.7 — **four** | 2.4–2.7 — **four** |

The two readers **already disagreed** before this packet: A was a strict *superset* of B,
broader only on five dead versions — the harmless direction.

**Under the 2.7 pin, A became a strict SUBSET of B**, and the disagreement covered
2.4/2.5/2.6 — versions with real published sessions that `telemetry pull` succeeds on
today. `telemetry get`/`report` would have refused a 2.6 record while `pull` accepted it:
same bytes, two answers, depending which door you came through. Ruling #9 was right that
this had to be reported as *"we chose to widen a known divergence"*, not *"we chose not
to fix one"* — the packet **moved** something.

**R2 retracts that.** A is a strict superset of B again, and the residual disagreement is
back to the five dead versions that predate the packet, in the harmless direction,
untouched. **The packet now moves the divergence not at all.** The reviewer was told
about the widening as a deliberate decision, so it must now be told just as explicitly
that the widening is gone — an announced hazard that quietly disappears is its own kind
of stale report.

**Still deliberately not fixed**, and unchanged by R2: pinning `validSegment` would
refuse exactly the 2.6 sessions that presently work, and it is outside the packet's
subject on an already-widened fence. A sibling seat separately established that `pull`
fails `E222` on sessions whose `checks` event has gate keys containing `:` or a space — a
producer/reader **grammar** drift, unrelated to version. Stated, not fixed; that is the
trade, and after R2 it costs nothing observable.

## The Dim-0 mutation gate — 30 mutations, ALL FIRE (was 28, 26, 24, 22, 20)

Every mutation restores a **pre-fix behaviour**, not merely broken code. Runner:
`/tmp/packet-mut.py`. Counts below are from the final post-`biome` run (anchors were
re-verified after reformatting).

| Mutation | Failures |
|---|---|
| FX004-M1 guard disabled entirely (pre-fix E108 / silent `--help`) | 4 |
| FX004-M2 claims absent context even when extensions ARE loadable | 1 |
| FX004-M3 message reverts to the retracted "not in a harness repo" | 2 |
| FX004-M4 remedy names a dir without verifying it holds an extension | 5 |
| FX004-M5 "no ancestor" silently falls back to a guess | 4 |
| FX004-M6 `firstPositional` stops at the first token (flags hide the verb) | 2 |
| FX004-M7 E149 collapses back into E108 | 4 |
| PIN-M1 below-pin refused as `malformed` (reasons folded) | 5 |
| PIN-M2 an ABOVE-pin version mislabelled `below_pin` | 4 |
| PIN-M3 `decodeLooseSegment` catch collapses its reason | 2 |
| PIN-M4 session export drops the refusal tally from the envelope | 3 |
| **PIN-M5 knob default DIVERGES from the declared policy constant** *(rewritten — see below)* | 11 |
| PIN-M6 the pin compared by EQUALITY rather than as a floor | 16 |
| **PIN-M7 a production lane silently RAISES the pin (`ref-source`)** *(new, R2)* | 4 |
| **PIN-M8 the pass-through ORIGINATES a policy instead of forwarding one** *(new, R2)* | 9 |
| **PIN-M9 a pin ORIGINATES in a file that never names the decoder** *(R3 — the reviewer's plant; 3 → 2 after the R4 seal made it inert)* | 2 |
| **PIN-M10 a pin originates THREE hops out, via a forwarder that is not the decoder** *(R3, cross-file; 5 → 2, same reason)* | 2 |
| **PIN-M11 `pin` re-added to the production options bag — the sealed hole, re-armed** *(new, R4)* | 3 |
| **PIN-M12 a production lane CALLS the test-only pin seam** *(new, R4)* | 2 |
| **PIN-M13 the suite TITLE re-asserts the retracted, unrestricted claim** *(new, R5)* | 1 |
| **PIN-M14 the narrowed claim is stripped from the seam's own doc block** *(new, R5)* | 1 |
| **PIN-M15 the blanket claim returns to `segment.ts` — a claim site off the list** *(new, R6)* | 1 |
| **PIN-M16 a COMPUTED suite title re-asserts the retracted claim** *(new, R6 — the reviewer's construction)* | 1 |
| FX002-M1 adopted seat never consults the registry | 6 |
| FX002-M2 ambiguity resolved by first-wins GUESS (the false green) | 2 |
| FX002-M3 "no match" folded into "registry unavailable" | 2 |
| FX002-M4 registry OVERRIDES the seat's own env declaration | 2 |
| FX002-M5 uses the registry's lossy first-wins index | 2 |
| FX002-M6 relay collapsed into the ACTIONABLE twin (the permanent alarm) | 1 |
| FX002-M7 everything unresolved is actionable (severity decided wrongly, once) | 5 |

**PIN-M3 was SILENT on the first run** (R1) and that is the gate earning its keep: my
controls exercised `session-export`'s error path but never `ref-source`'s, so ruling
#1.2's claim was unproven at one of the two callers. Adding the ref-surface controls made
it fire. This is the R1-M9 shape from the other side — a claim nothing exercises proves
nothing.

### PIN-M5 went SILENT on the R2 run, and the diagnosis matters more than the fix

The first R2 run reported **19/20 fire, PIN-M5 silent**. The tempting read is "a control
went blind". It had not. PIN-M5 replaced `options.pin ?? SEGMENT_SCHEMA_PIN` with
`options.pin ?? '1.1'` — a genuine behavioural change at a 2.7 pin, and a **literal
no-op** once the constant *is* `'1.1'`. It fired nothing because **it had stopped being a
mutation**, not because anything stopped watching.

That is worth naming rather than quietly re-pointing, because it is this packet's own
defect class **inside the packet's own gate**: a probe that reports "nothing found" when
the honest answer is "I was no longer looking". A silent mutation has exactly two causes —
a blind control or a dead mutation — and they are indistinguishable from the summary line.
The only way to tell them apart is to read the mutation against the current source, which
is now a standing step whenever a constant this gate depends on changes.

Rewritten to the defect it exists to catch, in its inverted direction: a hardcoded default
that **diverges** from the declared policy constant (`?? '2.7'`), silently making
production stricter. It fires 9.

## Honest boundaries — what I could not see through

1. **The pin's accept-set scope was not mine to choose — RESOLVED.** "We decline 2.4"
   and "we can no longer read 2.4" are different products; I blocked rather than guess.
   Jordan resolved it twice: Option C, then the reversal to the floor. Recorded as closed
   rather than deleted, because stopping was the right move both times.
2. **`check:dd-docs FAIL — baked dd docs drifted from their sources`** appears in vitest
   output **both before and after** my changes, while the `check:dd-docs` gate itself
   reports **ok**. I did not chase it — it is pre-existing and outside this packet — but
   a gate reporting ok while its own output says FAIL is worth someone's attention.
3. **`tokensFromBlobs` declining to propagate is a judgement call.** I argued
   double-reporting; a reviewer could reasonably want the reason there too. It is stated
   in-code so the decision is visible rather than silent.
4. **The FX004 guard intercepts *any* unregistered name when no extensions are loadable**,
   not just names that would have been verbs. I cannot know whether `bogus` would have
   been a verb in a directory that has none, so the message asserts only the two facts I
   can establish (not a core command; no extension verbs registered here).
5. **I did not verify FX002 end-to-end against a real adopted seat's live telemetry.**
   The controls use fakes end-to-end. This boundary is now **narrower and
   evidence-backed** rather than open-ended: the orchestrator established (ESTABLISHED,
   probe cited) that its own seat *is* the adopted case — zero `PIJ_*` vars in env — and
   that `~/.pij/pij-related-koala.json` **does** carry a `harnessSessionId` matching the
   real session, with `spawnedBy` null. So the join key demonstrably exists on disk for a
   genuine adopted seat and read-time resolution **is possible** for the exemplar. What
   remains unproven is the end-to-end recovery: the buffer is flushed to refs, so it
   needs the branch build plus a ref read. **The gap stands, honestly, and is smaller.**

6. **The pin binds one of two readers — the widening is RETRACTED by R2.** The packet
   briefly turned a dead-version divergence into a live-data one; at the floor pin
   reader A is a strict superset of reader B again and the packet moves the divergence
   not at all. The *residual* pre-packet divergence (two independent accept sets, no
   shared source of truth) is untouched and remains someone's problem — stated, not
   fixed. The reviewer was told about the widening as a deliberate decision, so it is
   told just as plainly that it is gone.

7. **`below_pin` is unreachable in production, and one lane cannot exercise it at all.**
   The combine lane keeps a declared pin parameter, so the below-pin envelope plumbing
   stays proven. The **ref lane threads no pin**, so there its `below_pin` counter is
   neither reachable nor drivable in a test — it is a stated 0. I deliberately did **not**
   add a second knob to make it reachable: that would install the exact extra door the
   combine lane's control exists to police, to prove a counter that shares its one
   counting site (`tallyRefusal`) with a lane where it *is* proven. Stated in-code at the
   field itself, not just here.

8. **The ambiguity guard is unexercised by real data.** Collisions are *not-probeable*
   (the first-wins index conceals exactly what would count them), so the guard is
   prospective. Keeping it is the right call; claiming field validation for it would not
   be.

9. **The pin scan is a TEXT scan, not a type-aware one — and (b) was BUILT, not
   hypothesised. CLOSED BY SEALING (R4).** As written in R3 this boundary named three
   evasions: (a) a computed key `bag['p' + 'in'] = '2.7'`; (b) a spread of a bag whose
   pin arrived from **outside `src/`**, e.g. `combineSession(a, b, { ...JSON.parse(cfg) })`;
   (c) a rename at a distance through an untyped `Record<string, unknown>`. I called (b)
   "the real one" and left it open. **The reviewer then constructed it in production
   source and the suite stayed 9/9 green** — the boundary was correctly named and
   insufficiently acted on, and its stated mitigation (a new pin-accepting *type* cannot
   appear silently) did not apply, because this was a new **filling** of an existing one.

   R4 closes all three at once, and not by scanning harder: `pin` no longer exists on
   `CombineSessionOpts`, so there is no field for any of (a), (b) or (c) to fill. That
   half **stands** — a `pin` on the bag is inert, proven behaviourally.

   **R5 withdraws the OTHER half.** R4 also said the replacement was an identifier-shaped
   door "which data cannot open". **That is false and is retracted.** The reviewer built
   `Reflect.get(module, config.seam)`: under reflection the *name* is data too. A `Symbol`
   export was probed as the ruling preferred and does not hold either — it is reached by
   two hops off the namespace, or by symbol enumeration naming nothing at all. Tests and
   production share one module graph and reflection is total over it.

   The boundary that remains, stated at its true width: **the scans establish that no
   `src/` file WRITES a pin or the seam's name. They establish nothing about deliberate
   dynamic dispatch, which is out of scope and unchecked.** That sentence is now carried
   verbatim in all **three** claim sites — `segment.ts` was missing for a round (R6) —
   and enforced by a control, and the gap itself is asserted
   as a passing test so closing it later cannot happen silently.

   The equivalent hole at `SegmentDecodeOptions` (the decoder's own bag) is **not** closed
   and is not in scope (ruling #12 confirms: leave it): it is reached only from
   `services/telemetry`, its two `src/` call sites are declared, and sealing it would
   remove the knob the below-pin machinery is tested through. **The narrowed claim applies
   there too, unclosed for the same reason.** Named here so the seal is not read as wider
   than it is.

10. **The tokenizer's regex/division disambiguation is a HEURISTIC.** It decides `/`
    starts a regex from the preceding token, which is the standard approach and is not
    provably correct. I did not treat that as acceptable on its own: the line-count
    invariant turns a heuristic failure from **silent blindness into a red suite**, which
    is the honest form of "I used a heuristic". It holds for 252/252 files today. If a
    future file breaks it, the gate fails loudly and someone fixes the tokenizer — it
    cannot quietly stop finding pins.

11. **An intermittent failure I saw THREE TIMES and can neither reproduce nor explain.**
    Reported so it is not discovered as a surprise. During R3 verification, three
    consecutive bare `npx vitest run` invocations reported `1 failed | 4530 passed`, with
    the stack in `test/services/flow/archive-move.test.ts` (~line 296, a `flow list`
    immediately after `buildRepo()`). Then **six consecutive full runs went green at
    4531/4531**, and `harness checks` reported `tests:ok` on every attempt including the
    ones bracketing the failures. Facts, separated from inference:
    - The file passes in isolation (7/7).
    - The pre-change tree passed a full run — but **once only**, which is not enough to
      attribute the failure to my change.
    - My change is a **test-only** file that reads `src/` from disk; there is no
      mechanism by which it reaches flow archive-move.
    - I formed a hypothesis (git contention with the telemetry auto-push that `harness
      checks` performs) and **tested it** by running `checks` then the suite immediately.
      **It did not reproduce. The hypothesis is refuted, not confirmed.**

    So I am recording an unexplained intermittent, not a flake. Calling it a flake would
    be asserting a conclusion I did not reach — the exact move this packet exists to
    stop. It is very likely pre-existing and unrelated, and I could not establish that.

    **R4/R5/R6 status: UNEXPLAINED, NOT CLEARED — not upgraded (rulings #12, #13).** The reviewer added three more full
    4531/313 suites and seven isolated runs with no recurrence, and R4 adds another
    green full run — and correctly declined to call that absolution. Nine-plus green
    runs cannot prove a negative about something that fired three times. **It remains a
    live risk to CI**: if it fires there the PR does not go green, and we will know
    nothing more than we know now.

12. **Boundaries about the claim check rather than the pin — (a) and (b) new in R6, (c)
    added in R7.**

    (a) **`CLAIM_SITES` is a declared list, and I read for further sites rather than
    proving there are none.** Ruling #13 forbids hunting with a scan, and the reason is
    sound — a claim site is a place someone chose to make a promise, and no pattern finds
    those. So the check is exactly as complete as the list. I read `ref-source.ts` and
    `session-export.ts` against all eight retracted wordings and found nothing further.
    **That is a reading, not a guarantee**, and it is the same shape as the defect R6
    fixed: the previous list was also believed complete. The mitigation is that adding a
    site is one line, and PIN-M15 proves the check bites once a site is listed.

    (b) **Reading resolved titles couples the control to the runner's collected tree.**
    `ctx.task.file.tasks` is vitest's shape, not a public contract, and a change to it
    would break the walk. This is stated rather than hidden, and it is deliberately
    fail-**closed**: the control asserts its own title comes back *before* it asserts
    anything about the contents, so a broken walk goes red instead of quietly reading
    zero titles and passing. That ordering is the whole mitigation, and it is the same
    move as the tokenizer's line-count invariant in boundary 10.

    (c) **A retracted wording sitting in a code string literal is caught by nothing.**
    Added in R7. `codeOnly()` strips strings and `claimText` reads comments, so a line
    like `const decoy = "describe('no production path can raise it', () => {})"` is
    invisible to both halves of the check — and now that titles are read at runtime, it
    is not a title either. **Judged acceptable, and stated rather than assumed**: the ban
    exists to stop the claim being *asserted* — printed in a failure header, written in a
    doc block. A string that is never printed as a title asserts nothing to any reader.
    It is the same exemption that already lets `RETRACTED_CLAIMS` list the banned
    wordings as literals in that very file: **a file must be able to name what it
    withdrew without that counting as asserting it.** No scan is built for this; a scan
    would have to ban the file from naming its own retractions.

## Fence

`git status --short` touches only `harness/cli/src/**`, `harness/cli/test/**`,
`.harness/extensions/flow-eval/` (**one new test file**, R1 only — untouched in R2), and
`docs/fixes/FX002-*`. `package-lock.json` **unmodified**. Nothing pushed.

**Full suite: 4536 passed / 313 files, zero failures** (R1: 4523; R3: 4531; R4: 4533;
R5: 4535 — R6's title control is a net +1). Warn trio byte-identical to the dispatch baseline at every
checkpoint including R6: **arch 2 / markdown 196 / windows 6**.

R4 touched **one production file** (`src/services/telemetry/session-export.ts` — the
type change ruling #11 required) plus two test files and this log. **R5 and R6 touch no
production behaviour at all**: doc blocks in `session-export.ts` (R5) and `segment.ts`
(R6), the control file, and this log. `package-lock.json` **unmodified**. Nothing pushed.
