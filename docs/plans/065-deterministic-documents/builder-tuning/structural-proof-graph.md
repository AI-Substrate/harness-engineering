# The structural proof graph

> Rough-out, 2026-08-04. Lives in `builder-tuning/` while it forms; promotes
> to `docs/how/dd/` when stable. Companion to `notes.md`, which carries the
> per-item rulings and open questions.

## The thesis

"Is this work done?" is usually answered by reading prose and trusting the
author. This system replaces that with a **structural claim over a typed
graph**: every claim is a row with an address, every row cites what supports
it, and the citations are links a tool can follow. Done becomes a property
you *query*, and — more importantly — a property you can **audit by
traversal**: pick any claim, walk its edges, and you arrive at instruments
you can run and testimony you can read.

The graph does not make claims true. It makes false claims **expensive and
visible**: to close a claim falsely, an agent cannot forget, drift, or
hand-wave — it must *fabricate*, in a document where the fabrication is
addressable, diffable, and staring at a human reviewer at PR time with its
supposed evidence one click away. That is the honest promise: not proof
against lying, but a structure in which lying is the only way to be wrong,
and lying leaves a trail.

## The five artifacts

| Artifact | Doc / section | Role | One word |
|---|---|---|---|
| Acceptance criterion | `plan.dd.json#acceptance_criteria` row | behaviour that must hold at ship | **claim** |
| Backpressure row | `backpressure.dd.json#rows` | how truth is measured — mode, tier, runnable `probe` | **instrument** |
| Task | `tasks/phase-N/tasks.dd.json#tasks` row | unit of work performed | **work** |
| Done-when entry (`dw-*`) | task file, per-task list (rename pending: `evidence` → `done_when`) | decomposed done-condition of one task | **assertion** |
| Log entry (`lg-*`) | `execution-log.dd.json#entries` | timestamped record of what happened | **testimony** |

Naming note (ruled): the section currently called `evidence` holds
*assertions* — each still cites `proven_by`. The actual evidence is what they
point at (testimony, instruments). Rename to `done_when`; the `dw-` prefix
already means exactly that.

## The edges, and what each one asserts

| Edge | From → to | What writing it asserts |
|---|---|---|
| `pressure` | claim/assertion → instrument | "this is how you'd check me" |
| `proven_by` | claim/assertion → testimony | "this is when I was checked" |
| `done` | task → its own done_when list | "done means these, not my checkbox" |
| `tasks` | plan phase row → phase task file | "this phase's work lives here" (absent until JIT-generated) |
| `satisfies` *(proposed)* | task → claim | "this work exists because of that claim" |
| `links` | testimony → anything | the log weaving back into the graph |

Direction follows **birth order**: the later-born artifact points backward at
what already existed (a task can cite an AC; a plan cannot cite task ids that
don't exist yet). Incoming edges are recovered by traversal (`dd graph map`),
never authored twice.

### Relations are typed (ruled)

Edge semantics live on a **`rel`**, declared per link field in the schema —
not on the field name. Five built-in rels, frozen like the CLI surface:

| rel | machine meaning |
|---|---|
| `pressure` | instrument citation; mandatory-or-`not-applicable` |
| `proven_by` | testimony citation; contradiction-warned |
| `satisfies` | serves-a-claim; completable→completable contradiction-warned |
| `derives` | this row's state is computed from the target list (the `done` edge) |
| `ref` | plain reference; rendered and traversed, no semantics |

Any other rel string is legal and behaves as `ref` — custom schemas mint
their own, mirroring custom completion enums. The enforcement logic is
written once against rels, so any schema declaring `rel: "satisfies"`
inherits the contradiction protection with zero new code, and `dd graph map`
can label and filter edges by meaning. The generic per-item links bucket is
simply a list-typed `rel: "ref"`.

## Triangulation — why the graph is stronger than any edge

A claim is supported by up to three **independent legs**:

```
            instrument (BP row + probe)     ← fails when: probe red / never built
           ↗
  CLAIM ──→ testimony (log entry)           ← fails when: missing / contradicted
           ↘
            work accounting (satisfies ←)   ← fails when: serving tasks open
```

The legs fail *differently*, which is the point: an agent that fakes one leg
is contradicted by the others. Ticking an AC while its tasks sit open is a
contradiction warning; citing testimony that doesn't exist is a broken link;
an assertion that names no instrument at all is a validation failure. Each
defect class has a distinct, mechanical detector.

## Derived state — computed, never typed, wherever possible

- **Task state** is derived from its done_when list (W10, shipped): every
  assertion gate-terminal ⇒ task complete.
- **AC state** stays an *authored closure* — a performed act, not a
  derivation — because tasks are work and an AC is behaviour; all-work-done
  does not prove behaviour holds. Agents close ACs (ruled: journeys are fully
  autonomous); the guard rails below are what make that trustworthy.

## Backpressure is a toolbelt (ruled)

BP rows are a **catalog of instruments**, nothing more:

1. **The obligation lives on the assertion, not the instrument.** Every
   `dw-*` entry MUST carry a `pressure` — a done-when with no named
   instrument is a validation **failure**. "Done when X" without "and here is
   how X gets checked" is an incomplete sentence. The value is either a link
   to a BP row or the literal **`not-applicable`** (ruled) — an explicit,
   recorded, queryable "no instrument checks this", which is a different
   thing from silence. `jq` can list every not-applicable assertion in a
   plan; a forgotten field cannot be listed.
2. **BP rows have no state, no coverage reading, no closure — and they gate
   nothing, ever.** Things use them or don't. An unused BP row is a tool
   nobody picked up: fine, silent, no orphan warning.
3. The completeness check therefore points **outward from assertions**
   ("does every assertion name its instrument?"), never inward at the
   toolbelt ("does this instrument have customers?").

## The enforcement ladder

Three tiers, three postures — each consumes the graph, none duplicates
another:

| Tier | Surface | Posture |
|---|---|---|
| mechanical | `dd validate` | structure + links + vocabularies; silent on states |
| semantic | `harness plan validate` | warns: contradictions always; open completables as a summary line, per-row under `--complete` |
| refusal | flow gate (`dd_link` at nav departure) | phase nodes gate on their task section; the final review node gates on `plan validate --complete` green |

Key properties:

- **Contradiction warns** fire whenever a `checked` item links to a checkable
  target that is not gate-terminal — generic over any completable→completable
  edge, so new edges (like `satisfies`) inherit protection for free.
- **The final gate re-reads the whole graph now**, catching regressions
  behind you — earlier gates were point-in-time verdicts.
- **`plan validate` never runs probes** (ruled). It is read-only and checks
  the *record*. **Probe execution belongs to `harness checks`, full stop**
  (ruled): the standing sensors run continuously and CI runs the suite; no
  dd/plan surface executes anything. The graph stores where the instruments
  are; `harness checks` is what runs them.
- `--force` remains the recorded, defended human override; `human-skipped` /
  `na` on individual rows are the legitimate outs.

## The human's place

Journeys are autonomous end-to-end; the human checkpoint is the **PR stage**.
What arrives there is not "trust me" — it is the closed AC table with every
row's evidence one link away: its instrument (and the probe command to run it
yourself), its testimony, its serving tasks and their assertions. The
reviewer's job shifts from *reconstructing* whether work was done to
*spot-checking a proof* that is already laid out — follow any edge that
smells wrong.

## What this deliberately does not do (yet)

- **No probe execution at closure** — the structure plus human PR review plus
  CI is the current bar; deterministic run-the-probe-at-close is a future
  tightening, noted and parked.
- **No code-drift freshness** — testimony ages ("39 tests green" was then);
  the basis ledger covers document drift only. Solve when it bites.
- **No claim of truth** — the graph proves *support*, consistency, and
  auditability. Truth still comes from instruments actually being good and
  humans actually spot-checking.

## Pending features feeding this graph

- `satisfies` edge (task → AC) — granularity/cardinality under iteration.
- `evidence` → `done_when` rename.
- Mandatory `pressure` on every done_when assertion (validation failure when
  absent) — the toolbelt rule above.
- The `rel` vocabulary (§ Relations are typed) — schema declaration support,
  the rel-generic warn engine, and `dd graph map` edge labels/filtering.
- Generic `links` bucket on any list item (now just list-typed `rel: "ref"`),
  auto-rendered as a final table column — every row type weaves into the
  graph without a bespoke schema field each time.
