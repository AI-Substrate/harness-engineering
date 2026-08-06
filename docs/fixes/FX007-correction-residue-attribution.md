# FX007 — correction of record: the residue attribution in #101 was wrong

**Written**: 2026-08-06 by `pij-yearling-jernau` (FX007 owner), after
`pij-respectable-clam` challenged the attribution and `pij-massive-meadowlark`
asked for a probe rather than a theory.
**Against**: `main` @ `e756d091` (#101).

This corrects the FX007 record. It is filed because a wrong cause, once written
into a commit message, gets quoted later as if it were measured.

---

## What #101 claimed, and why it was wrong

#101's commit message said the remaining failures were:

> legacy wire versions (1.0–2.3) the reader refuses by design, plus a residue
> that fails on product-commit coverage

**The product-commit half is false.** `verifyProductCommitCoverage`
(`rolled-shard.ts:126-165`) is never the rejector for `d24b76ef`. Clam read the
function, walked its inputs, and said the contradiction branch at `:158` cannot
fire. Clam was right.

### How the wrong cause was reached

The claim rested on one experiment: removing `product_commits` from the manifest
made the same bytes decode. That felt decisive and was not. Removing the field
changes the ref's **shape classification**, which changes which files the reader
admits, which routes the decode around the OTLP logs path entirely — where the
real rejection lived. The experiment moved more than one variable and I read its
result as a mechanism.

**The lesson is the same one FX007 is about.** A grammar was never derived from
producer output; a cause was never derived from the reader's own report. Both are
confident maps built from a bounded probe.

## The actual mechanism, established by instrumentation

The reader was instrumented locally to record every falsy return with its source
line, then fed `d24b76ef`'s verbatim bytes. 9,586 falsy returns were recorded;
9,583 were benign `hasControlCharacter` returns inside `.some()`/`.every()`
predicates. The decisive tail was exactly three entries:

```
return-false@1063  ->  validLogs false  ->  decode-reject@1767
```

| | |
|---|---|
| **Rejecting key** | `git commit` |
| **Path** | `session.logs.jsonl` → logRecord (`harness.event.kind=tools`) → attribute `harness.tool.control` → kvlistValue key |
| **Site** | `published-telemetry.ts:1063`, the kvlist-entry guard in `validAttributeValue` |
| **Constant** | `SAFE_IDENTIFIER = /^[A-Za-z0-9_.:@+/{}-]{1,256}$/` — admits a colon, **not a space** |

It is the **same defect class FX007 fixed** — a multi-word producer label refused
by a hand-written grammar — in a **second constant on the OTLP path** that the
segment-path fix never touched.

## The coverage qualification on #101's numbers

#101 reported full-corpus decode going 33 → 41 of 119. That number is real, but
its **coverage claim is narrower than it reads**:

- `5cfdf02d` carries **zero** kvlist attributes; `d24b76ef` carries three.
- Sessions that never emit a kvlist attribute never exercise `SAFE_IDENTIFIER`.

So part of that improvement is sessions that **do not touch the affected path at
all**. They were not fixed on this axis — they never tested it. A number that
improves for a reason you did not cause is exactly the kind of evidence that gets
cited later as proof of something it never showed.

Corpus sweep of every kvlist key across all refs: **9 refs stranded** by the
space, all on `harness.tool.control`, keys `git commit` and `git push`.

## Residue after the `SAFE_IDENTIFIER` fix — sites named, not attributed

Three refs still fail, and each is a **different** mechanism. These are named from
traces, not inferred:

| Ref | Site | What the trace says |
|---|---|---|
| `6616ca6a` @ 2026/07/25 | `validSegmentKnownField FIELD=plans_touched` → `:1781` | `plans_touched: ["   "]` — a whitespace-only plan id. Looks like producer garbage, not reader over-strictness. |
| `71679da4` @ 2026/08/04, 08/05 | the `catch` in `decodePublishedTelemetrySession` (`:1687`) | An **exception**, not a validation refusal. `session.logs.jsonl` is 2,086,875 bytes; `StrictJsonParser` caps at 100,000 nodes. A scale limit reported as "malformed or unsafe". |
| `71679da4` @ 2026/08/03 | `evidenceForRef` returned null (`:1846`) | Not yet narrowed. |

**None of these is investigated further here**, and none is attributed beyond what
its trace shows. The exception case is worth its own ticket: a size limit and a
malicious payload are currently indistinguishable to a caller.

## Why this took two seats and two days

`decodePublishedTelemetrySession` returns a bare
`{ok: false, reason: 'malformed_or_unsafe'}` — no rejecting site, no field, no
key. Finding a one-word answer (`git commit`) required rebuilding the reader with
instrumentation. Clam independently lost a hand-walk of a function that turned out
not to be the cause.

**Three independent instances, same missing sentence.** This is FX010's case.
