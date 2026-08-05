# FX001 — findings batched to prime (`pij-massive-meadowlark`)

Handed over at the merge handshake, per prime's standing instruction that nothing
is owed until "fix pair has stopped pushing — final head `<sha>`". None of these
are FX001 fix scope; all are routed, not absorbed.

## 1. Prime's question — does a capture that never fired invalidate assertions beyond A10?

**Assertion-side sweep (mine).** Five committed scenario bundles, 63 assertions.
The `outcomeEvents` call site emits `command_exit` (verb/exit/status/code) and
`checks` (overall + per-gate verdicts). Assertion types consuming that path:

| type | scenarios | what D4 cost it |
|---|---|---|
| `gate-refused` | dd-native-builder A10 | **total** — the assertion the scenario exists for |
| `harness-verb-ran` | dd A7/A8, flow A14, ponytail×2 A11 | partial — a verb that ran and FAILED was invisible; successful runs still counted |
| `checks-ran` | md-to-pdf A9, flow A10, ponytail×2 A9 | partial — a checks run that FAILED produced no event, so "ran and failed" is indistinguishable from "never ran" |
| `retro-drained` (`fs+telemetry`) | md-to-pdf A10, flow A11, ponytail×2 A10 | the compound shape — see below |

**The direct answer to "is there any assertion that currently reads GREEN whose
green does not depend on the capture that never fired?" — NO, none found.**

The reason is structural and worth stating, because it is the good news: **D4's
silence systematically UNDER-counts**, and every assertion built on it turns
green→unknown or green→fail, never fail→green. `min: 1` thresholds met by the
surviving successful subset (`skill-called`, `harness-verb-ran`) still go green
**truthfully** — the verb genuinely did run.

And the one shape that COULD have produced a false green — the compound
`fs+telemetry` `retro-drained`, whose fs leg could have carried it while its
telemetry leg sat silently absent — **is explicitly built to refuse that**. It is
a three-valued AND with a named control: *"is UNKNOWN when telemetry is absent
but the record exists (unknown over pass)"* (`resolvers.test.ts:288`). That is
not luck; someone anticipated it. Prime's "a green that never consulted its
evidence is worse than an unknown" is already encoded in the instrument.

**THE GAP I WOULD NOT CLOSE THE QUESTION WITHOUT.** Those controls test telemetry
**ABSENT** (`ctxWith(null)`). D4 does not produce absence — it produces
**present-but-silently-incomplete**, which is a different and more dangerous
input: a resolver that keys on *presence* of evidence will treat an incomplete
lane as authoritative. I found no resolver that currently does, but the input
shape **is untested**, so my "no false greens" is a finding about the code as
written, not a guarantee under the failure mode D4 actually creates. Recommend a
control that feeds a populated-but-lossy evidence object, not just `null`.
See [[control-tested-vs-demonstrated]] — absent and lossy are different fixtures.

**Pending**: the coder's capture-side enumeration, dispatched while its context
was warm. The two lists are meant to **intersect, not to be taken on trust** —
where they disagree, that disagreement is the finding.

## 2. Routed findings (not fixed here)

- **D3 — adopted-root-seat identity capture gap.** No `PIJ_SESSION_ID` for
  adopted seats, so an adopted root's own lane is unjoinable by PIJ key. Prime
  allocates any ordinal.
- **Vocabulary additions have no version handle.** `scope_version` mirrors the
  Segment schema version, so nothing can honestly signal "same segment shape,
  larger attribute vocabulary". Ruled out of FX001 (Ruling #2); it is a
  telemetry-wire policy decision with a first-party downstream consumer
  (eng-thrive), whose documented read contract is the frozen schema file itself.
- **`docs/how/telemetry-otlp.md:67-68` stale** — says v0.2.0 / scope 2.5 while
  the code is at v0.3.0 / 2.6. Pre-dated FX001; fixing it was scope creep.
- **The CLI↔extension `SessionEvidence` lock-step test cannot fail to compile.**
  Only `src` is in tsconfig and its SAMPLE literal already omits fields, so the
  drift guard has only ever been demonstrated, never tested — and FX001's two new
  provenance fields inherit that blind spot on the extension side. Coder's find.
- **A third independent reason this lane reads empty**: outcome events fire only
  when a Bash call's signature IS a harness sub-command, so
  `node <path>/harness.js flow nav set` signs as `node` and is never correlated.
  Correct behaviour, but it means any proof of this lane must use the linked
  binary — and anyone re-deriving these counts without knowing it will measure
  zero and conclude wrongly.

## 3. The shape of the whole thing, for the P063 file

One observed silence, **three independent causes**, each of which fully explained
it: D4 (the event was never emitted), D2 (the code was stripped at roll), and the
signature rule (the command was never correlated). D2 was found first and looked
sufficient. It was not. The count that "proved" D2 — 0 coded exits across 112
refs — is explained by D4 **alone**.

This is the cost of counting causes from the outside. The only thing that found
the second and third was continuing to look after a confirmed, sufficient-looking
explanation was already in hand.
