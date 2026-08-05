# Is this plan ready to start work on?

`harness plan ready <target>` answers one question, at the two moments an agent
should ask it: when a plan is first written, and again at a gate.

```bash
harness plan ready docs/plans/archive/071-dd-native-builder
```

It is a **read**. It never writes to the plan document or the flight plan.

## What `<target>` has to be

A **dd-native** plan: a `plan.dd.json`, or the directory containing one. Both
forms resolve to the same document, so the example above is interchangeable
with `docs/plans/archive/071-dd-native-builder/plan.dd.json`.

A markdown-only plan folder is not a target and does not get a verdict — it
gets an honest error, because there is no structured document to read
criteria out of:

```console
$ harness plan ready docs/plans/072-plan-ready-gate
{"command":"plan ready","status":"error", … ,"error":{"code":"E400","message":"no plan document at …/docs/plans/072-plan-ready-gate/plan.dd.json"}, …}
```

## Three answers, not two

| Verdict | Envelope status | Exit | What it means |
| --- | --- | --- | --- |
| `ready` | `ok` | 0 | Every acceptance criterion is claimed by a task, and the backpressure survey is on the record for these exact plan bytes. |
| `not-ready` | `degraded` | 0 | Something specific is wrong, and the command says which one thing. |
| `cant-tell` | `unconfigured` | 2 | **A refusal to guess.** Either there is nothing in the plan to judge, or the survey dimension is unreadable from here. |

The third one is the reason this verb exists.

An empty plan currently scores *perfectly* on every other check: a fresh
scaffold returns `orphans: 0, error: 0`, because zero acceptance criteria
cannot produce an unclaimed one. Any gate that keyed on "no errors, no
orphans" would declare the emptiest possible plan the readiest. So a plan
with **zero claim rows** gets its own answer — `cant-tell`, reason
`nothing-to-check` — and it can never read `ready`, no matter how green
everything else is.

`unconfigured` is not a hedge. It is this CLI's existing word for "nothing is
mapped here yet", and exit 2 is what it already carries — so the refusal is
honest without inventing a new code.

## The two dimensions

### Criteria — read from the plan document

Composed from `harness plan validate --complete`, not re-derived. That mode
already emits `orphan-claim` — *"has no incoming satisfies — no task accounts
for it"* — which is precisely the question. `plan ready` reports those rows by
address and adds no analysis of its own.

Non-vacuity is measured as **at least one claim row**. A plan with criteria
but no tasks is *not* vacuous: it has something to judge, and it fails —
`not-ready`, with each unaccounted criterion named.

### Survey — read from the flight plan

Whether the backpressure survey was **done**, or **deliberately declined**, is
not knowable from the plan document. Only the flight plan
(`the-flow.json`, beside the plan by default; `--flow <path>` to point
elsewhere) carries the chore and its receipt.

| Chore state | Reads |
| --- | --- |
| `done`, a `validation` receipt whose `basis_sha256` matches the plan's current bytes | satisfied |
| a `decision` receipt (the human's decline) | **satisfied** — see below |
| a `validation` receipt for *other* bytes | `stale-basis` — never satisfied |
| a `validation` receipt with no `basis_sha256` at all | `missing-basis` — never satisfied |
| terminal, no receipt at all | `missing-receipt` — never satisfied |
| not terminal | `not-run` |
| no flight plan beside the plan | `cant-tell` |

A receipt is an **append-only comment** whose `kind` is explicitly `validation`
or `decision`. A `note` is not a receipt (notes are overwritable, and a receipt
you can quietly rewrite proves nothing), and neither is a comment with no
`kind` — an allow-list that accepted the unstated case would be decorative.

The survey node is found by its doctrine-pinned **id** — `backpressure`, or
`backpressure-<first 12 hex of the surveyed plan's SHA-256>` on a re-basis — or
by node `type: backpressure`. Either matches. The doctrine pins the id and says
nothing about the type, so keying on type alone would depend on whoever mints
the node picking the same one by coincidence.

When a node carries several receipts, the **newest wins**. Comments are
append-only, so a re-surveyed node holds its history: letting an older receipt
shadow a newer one would report `stale-basis` about a survey that has already
been redone.

#### Why a decline is green

Declining the backpressure survey is the human's call, and a gate that read a
decline as "not ready" would be a compliance floor — which the flow explicitly
forbids. So a chore carrying its **decision receipt** is a legitimate `ready`.

The receipt is what does the work. `skipped` with no receipt is *not*
satisfied: without one, "the human decided against it" and "somebody clicked
past it" are the same bytes on disk, and only one of those is a decision.

#### Why a decline needs no basis, and a completed survey does

The two receipt kinds are treated **asymmetrically, on purpose**:

- A **`validation` receipt is a completed survey** — a claim about *specific
  plan bytes*. It requires basis equality, and it goes stale the moment those
  bytes change.
- A **`decision` receipt is the human's decline** — a decision about *the
  work*, not about the bytes. There is nothing for a later edit to invalidate,
  so no basis is required.

This is not a convenience. The doctrine's decline command is
`harness flow comment --kind decision --source user --text "<the human's
verbatim words>"`, which records the words and **no `basis_sha256` at all**.
A gate that demanded a basis on a decline would be demanding a field the
protocol never writes — the decline would be unsatisfiable in normal use, and
the human's "no" would silently read as not-ready.

#### Why the basis matters

A completed survey's receipt records the SHA-256 of the plan it surveyed. If
the plan has been edited since, the receipt is for a document that no longer
exists, and the verdict is `stale-basis`. An edit made after the survey does
not inherit the old green.

A `validation` receipt with **no** basis is a completed *attempt* but not a
completed survey — the doctrine's router-unavailable receipt
(`decision:unavailable reason:… time:…`) is exactly this shape. It records that
something happened; it cannot say which bytes were looked at, because none
were. That reads `missing-basis`, not satisfied.

## What it deliberately does not check

**It does not require every acceptance criterion to name a backpressure
instrument.** `pressure` is excluded from the plan's claiming relations on
purpose: a backpressure row has no state to contradict and gates nothing, and
treating a missing instrument link as a claim failure would re-invent a
coverage predicate the design already threw away. `plan ready` gates on the
survey *chore*, never on per-criterion links. (An architecture test freezes
`semantics.ts` so this cannot be reversed quietly.)

## Giving CI teeth

By default a `not-ready` verdict exits **0**. The terminal is advisory — the
gate reports, it does not block a person mid-flight.

CI opts in:

```bash
harness plan ready docs/plans/archive/071-dd-native-builder --strict
```

`--strict` turns `not-ready` into status `error`, exit **1** (`E462`). It is
`error`/1 rather than `degraded`/non-zero because exit codes are mapped from
status alone at a single chokepoint, and a `degraded` envelope cannot exit
non-zero — so the strict path picks the status that honestly carries a failure
instead of bypassing the mapping.

`--strict` does **not** change a `cant-tell`. A refusal is still exit 2:
"I cannot tell" is not a not-ready, and reporting it as one would be the gate
inventing an answer it does not have.

## One line, not a wall

The verdict is a single line, and details print for the dimension that
decided it — never for both. Per-row warnings about a mid-flight plan teach a
reader to ignore warnings, which is a failure mode this codebase has already
ruled on. The full structured reading is always in `data` for anything that
wants to consume it:

```console
$ harness plan ready docs/plans/archive/071-dd-native-builder --json | jq -c '.data | {verdict, reason, decided_by}'
{"verdict":"not-ready","reason":"stale-basis","decided_by":"survey"}
```
