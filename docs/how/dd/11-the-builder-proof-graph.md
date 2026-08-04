# The builder proof graph

Every other chapter here describes a mechanism: an envelope, an address, a
schema, a gate. This one describes what they add up to, and why a plan authored
as deterministic documents is worth the trouble.

## The thesis

"Is this work done?" is normally answered by reading prose and trusting the
author. A plan says a thing shipped; a task table has a tick in it; a reviewer
decides how much of that to believe. Nothing in that chain can be queried, and
nothing in it fails loudly when it stops being true.

The builder replaces it with a **structural claim over a typed graph**. Every
claim is a row with an address. Every row cites what supports it. Every citation
is a link a tool can follow. "Done" becomes a property you can *query* — and,
more usefully, a property you can **audit by traversal**: pick any claim, walk
its edges, and you arrive at instruments you can run and testimony you can read.

The graph does not make claims true. It makes false claims **expensive and
visible**. To close a claim falsely an agent cannot simply forget, drift, or
hand-wave — it has to *fabricate*, in a document where the fabrication is
addressable, diffable, and sitting in front of a human at PR time with its
supposed evidence one click away. That is the honest promise: not proof against
lying, but a structure in which lying is the only remaining way to be wrong, and
lying leaves a trail.

## Two graphs, joined

It helps to see that a plan is really two different graphs wearing one coat.

The **work graph** is what is being done now: phases, tasks, assertions, the
current state of each. It is intensely valuable for about a fortnight and then
it expires. Nobody re-reads last quarter's task list to decide what to do today.

The **knowledge graph** is what was learned: which criterion a change served,
what instrument measured it, what the log said when it ran, which decision was
ruled and why. That does not expire. It compounds — each plan leaves the next
one a slightly better map of the system.

Most planning tools collapse these into one artifact and then lose both: the
work graph goes stale and gets deleted, taking the knowledge with it. Keeping
them apart is not the answer either, because then the knowledge is written
twice, by hand, and the copy rots.

The join is what this system is actually for. The two graphs share one substrate
— addressed rows and typed citations — so the knowledge is a *by-product* of
doing the work rather than a second chore after it. A task that records
`satisfies` is doing work-tracking today and leaving an accountability trail
forever. The join is deterministic (an address resolves or it does not), typed
(a `rel` says what the citation means), and it carries **recorded freshness**
(the basis ledger says which SHA a citation was true at, so a stale one can be
detected rather than assumed).

That last point is what stops the knowledge graph quietly becoming fiction. A
citation with no freshness record is a claim about the past presented as a claim
about the present.

## The five artifacts

| Artifact | Doc / section | Role | One word |
|---|---|---|---|
| Acceptance criterion | `plan.dd.json#acceptance_criteria` row | behaviour that must hold at ship | **claim** |
| Backpressure row | `backpressure.dd.json#rows` | how truth is measured — mode, tier, runnable `probe` | **instrument** |
| Task | `assets/tasks/phase-N/tasks.dd.json#tasks` row | unit of work performed | **work** |
| Done-when entry (`dw-*`) | task file, per-task `done_when` list | decomposed done-condition of one task | **assertion** |
| Log entry (`lg-*`) | `execution-log.dd.json#entries` | timestamped record of what happened | **testimony** |

The `done_when` section holds *assertions*, not evidence — the evidence is what
they point at. The `dw-` prefix already said so, and the section was renamed to
match.

## The edges, and what each one asserts

| Edge | From → to | What writing it asserts |
|---|---|---|
| `pressure` | claim/assertion → instrument | "this is how you'd check me" |
| `proven_by` | claim/assertion → testimony | "this is when I was checked" |
| `done` | task → its own `done_when` list | "done means these, not my checkbox" |
| `tasks` | plan phase row → phase task file | "this phase's work lives here" |
| `satisfies` | task → claim | "this work exists because of that claim" |
| `links` | testimony → anything | the log weaving back into the graph |

Direction follows **birth order**: the later-born artifact points backward at
what already existed. A task can cite an acceptance criterion; a plan cannot cite
task ids that do not exist yet. Incoming edges are recovered by traversal
(`harness dd graph map … --direction in`), never authored twice — an edge written
from both ends is an edge that can disagree with itself.

### Relations are typed

Edge semantics live on a **`rel`** declared per link field in the schema, not on
the field's name. Five built-in rels, frozen like the CLI surface:

| rel | machine meaning |
|---|---|
| `pressure` | instrument citation; mandatory, or the literal `not-applicable` |
| `proven_by` | testimony citation; contradiction-warned |
| `satisfies` | serves-a-claim; contradiction-warned |
| `derives` | this row's state is computed from the target list (the `done` edge) |
| `ref` | plain reference; rendered and traversed, no semantics |

Any other rel string is legal and behaves as `ref`, so custom schemas mint their
own exactly as they mint custom completion vocabularies.

Writing the enforcement against rels rather than field names is what makes the
whole layer portable: a second schema that declares `rel: "satisfies"` inherits
the contradiction protection with no new code, and renaming a field cannot
silently switch a check off.

## Triangulation — why the graph is stronger than any single edge

A claim is supported by up to three **independent legs**:

```text
            instrument (BP row + probe)     ← fails when: probe red / never built
           ↗
  CLAIM ──→ testimony (log entry)           ← fails when: missing / contradicted
           ↘
            work accounting (satisfies ←)   ← fails when: serving tasks open
```

The legs fail *differently*, and that is the entire point. An agent that fakes
one leg is contradicted by the others. Ticking a criterion while its tasks sit
open is a contradiction warning; citing testimony that does not exist is a broken
link; an assertion naming no instrument at all is a validation error. Each defect
class has its own mechanical detector, so covering up requires forging three
things that are checked by three different mechanisms.

## Derived state — computed, never typed, wherever possible

**Task state is derived** from its `done_when` list: every assertion
gate-terminal means the task is complete. The `done` link is target-pinned at
`done_when`, so a task's state can be derived from assertions and from nothing
else.

**Criterion state stays an authored closure** — a performed act, not a
derivation. Tasks are work and a criterion is behaviour, and all-work-done does
not prove behaviour holds. Agents close criteria, because journeys are
autonomous; the guard rails below are what make that trustworthy.

## Backpressure is a toolbelt

Backpressure rows are a **catalog of instruments**, and nothing more:

1. **The obligation lives on the assertion, not the instrument.** Every `dw-*`
   entry must carry a `pressure`; an assertion with no named instrument is a
   validation error. "Done when X" without "and here is how X gets checked" is an
   incomplete sentence. The value is a link to a backpressure row, or the literal
   `not-applicable` — an explicit, recorded, queryable "no instrument checks
   this", which is a different thing from silence. `jq` can list every
   `not-applicable` assertion in a plan; a forgotten field cannot be listed.
2. **Backpressure rows have no state, no coverage reading, and they gate
   nothing, ever.** Things use them or they do not. An unused row is a tool
   nobody picked up: fine, silent, no orphan warning.
3. The completeness check therefore points **outward from assertions** ("does
   every assertion name its instrument?"), never inward at the toolbelt ("does
   this instrument have customers?").

## The enforcement ladder

Three tiers, three postures. Each consumes the graph; none duplicates another.

| Tier | Surface | Posture |
|---|---|---|
| mechanical | `harness dd validate` | structure, links, vocabularies; silent on states |
| semantic | `harness plan validate` | contradictions always; open rows as a summary line, per-row under `--complete` |
| refusal | flow gate (`dd_link` at departure) | phase nodes gate on their task section; the last review node carries `{"check": "plan-validate"}` and gates on `plan validate --complete` |

Key properties:

- **Contradiction warnings** fire whenever a gate-terminal row cites a checkable
  target that is not gate-terminal — written once, generically, over rels.
- **The final gate re-reads the whole graph now**, catching regressions behind
  you. Earlier gates were point-in-time verdicts.
- **`plan validate` never runs probes.** It is read-only and checks the *record*.
  Probe execution belongs to `harness checks`: the graph stores where the
  instruments are, and something else runs them.
- `--force` is the recorded, defended human override; `human-skipped` and `na` on
  individual rows are the legitimate outs.

## Writing the graph

Documents are mutated through the CLI, never by hand: `harness dd get`, `dd set`,
`dd add --mint`, `dd rm`. Each validates the result before anything reaches disk
and rebuilds the `.dd.md` sibling in the same operation, so a refusal leaves the
document exactly as it was and a success can never leave source and sibling out
of step.

This is not fussiness about tooling. Hand-editing breaks the graph in two ways
that are both silent: the generated sibling stops matching its source, and any
recorded basis SHA citing the document goes stale with nothing to say so. The
verbs exist so that the freshness half of the join stays honest without anyone
having to remember it.

## The human's place

Journeys are autonomous end to end. The human checkpoint is the **pull request**,
and what arrives there is not "trust me" — it is the closed criteria table with
every row's evidence one link away: its instrument, its testimony, the tasks that
served it. `harness plan pr-body` renders it from the corpus, and refuses to
render at all if the corpus is not closed, because a table that quietly omitted
the criteria that were not met would make an approval mean less than the approver
thought it did.

The reviewer's job shifts from *reconstructing* whether the work was done to
*spot-checking a proof already laid out* — follow any edge that smells wrong.

## What this deliberately does not do

- **No probe execution at closure.** Structure, plus human review at the PR, plus
  CI, is the current bar. Running the probe at close is a future tightening.
- **No code-drift freshness.** Testimony ages — "39 tests green" was true then.
  The basis ledger covers document drift only.
- **No claim of truth.** The graph proves *support*, consistency, and
  auditability. Truth still depends on the instruments being good and the humans
  actually spot-checking.

## See also

- [Completion states and gates](04-completion-states-and-gates.md) — the state
  vocabulary and the gate-terminal set.
- [Freshness and the basis ledger](07-freshness-and-the-basis-ledger.md) — how a
  citation records what it was true at.
- [Validation and doctor](08-validation-and-doctor.md) — the mechanical tier.
- [Command reference](10-command-reference.md) — every verb named above.
