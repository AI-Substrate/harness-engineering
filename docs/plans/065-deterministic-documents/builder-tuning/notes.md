# Builder tuning — wiring the-flow to dd

> Working notes from a live Jordan ↔ koala design iteration, started 2026-08-04
> (post PR #87 merge). This is the "make the bridge travelled" conversation: the
> dd gate shipped in Phase 6, but nothing authors a `dd_link` and no skill knows
> the mechanism exists. These notes capture the design as it forms. **Nothing
> here is a plan yet** — statuses are marked per item: `RULED` (Jordan decided),
> `LEAN` (direction agreed in discussion, not formally ruled), `OPEN`.

## Ground truth this builds on (shipped, PR #87)

- `flow-dd-gate.ts` — departure gate on the flow spine. Runs on the node being
  **left** (departure is the completion claim). Always evaluated live; the
  recorded `reading` is display-only. Refusal names every incomplete item with
  its state. `--force` is the defended, recorded override; an agent may not
  reach for it on its own judgment (workshop-002).
- `dd_link` is **opt-in absolutely** — a node without one is byte-identical to
  pre-gate behaviour. If a link is present, absent `gate` means it gates;
  `gate: false` keeps it as a surfaced reference.
- Default gate-terminal set: `checked · human-skipped · na` (out of
  `unchecked · checked · blocked · human-skipped · na`); a schema's own
  `gate_terminal` declaration replaces it entirely.
- The flow consumes dd through **barrels only** (`flow-consumes-dd-sdk-only`
  dep-cruiser rule + seam test). dd computes completion; the consumer decides
  what completion is allowed to stop.
- **The gap**: zero `the-flow.json` files carry a `dd_link`; the builder skill
  and its `flight-plan.template.json` know nothing of it. Fully built, fully
  tested, currently a production no-op.

## The link topology today (exemplar `builder/*` schemas)

- AC row: `pressure` → backpressure row, `proven_by` → log entry.
- Phase row: `tasks` → `tasks/phase-N/tasks.dd.json#tasks` — **field absent
  until the task file is JIT-generated** (only ph-0002 carries it in the
  exemplar). Task lists are NOT generated until just before the phase.
- Task row: one `done` link → its own per-task evidence list; task state is
  **derived** from that list (W10), never typed.
- Evidence entry (`dw-*`): `proven_by` → log entry, `pressure` → backpressure.
- **There is no AC↔task edge in either direction.** The relation is only
  inferable where both happen to cite the same backpressure row / log entry —
  an inference over shared citations, not a declared relationship.

## The problem statement (why an AC↔task edge)

AC "complete" and task "complete" are two unrelated hand-typed claims; nothing
can catch them disagreeing. Two silent failure directions:

- **Premature claim** — AC `checked` while a task serving it is
  `unchecked`/`blocked`. A ship gate reading the AC row opens on a keystroke,
  not on work.
- **Stale truth** — every task done, AC still `unchecked` because nobody went
  back. Gate refuses a genuinely-complete ship; `--force` erodes.

W10 already cured this one tier down (task state derived from evidence). The AC
tier still runs on the honour system because the edge a derivation would need
does not exist in the schema.

## Proposed edge: `satisfies` (name negotiable)

A link field on the **task side** pointing back at the AC:

```json
{ "id": "tk-0204", "state": "checked", "done": "#evidence/tk-0204",
  "satisfies": "../../plan.dd.json#acceptance_criteria/ac-0201" }
```

Direction is forced by JIT timing: at plan time ACs exist but task ids don't,
so the plan author cannot write task ids on an AC; the JIT task author has the
ACs in front of them. Same direction-of-birth principle as `proven_by` — the
later-born artifact points backward.

`RULED` (2026-08-04) — **`satisfies` lives on the task row**, coarse: one
judgment per task, made while the AC is in front of the JIT author.
Per-assertion linking forces N ambiguous micro-judgments for tracing that
already exists via each assertion's own `proven_by`/`pressure` chain. AC
review at PR walks two hops: AC ← task ← assertions.

`RULED` (2026-08-04) — **cardinality: `satisfies` is always an array**, even
with one entry (one shape forever for jq and the warn engine). Multi-link
fields already shipped in PR #87 (array-of-link rendering); with rels the
declaration is `{ "type": "array", "items": { "type": "link", "rel":
"satisfies" } }`. Distinct from the `ref` bucket: declared edges carry
meaning and obligations; the bucket carries context.

`RULED` (2026-08-04) — **orphan ACs warn under `--complete` only**: an AC
with no incoming `satisfies` edge is silent mid-flight (later phases
legitimately haven't tasked their ACs yet) and a warning in "prove me done"
mode.

## Validation layering — `RULED` in discussion

Jordan: "dd validate is fine, it's mechanical not semantic." The semantic
warnings belong in `harness plan validate` (the doc-type-aware consumer, which
is allowed to have opinions about an AC section). Three-tier posture:

| Surface | Posture | Question it answers |
|---|---|---|
| `dd validate` | mechanical, silent on states | is the doc well-formed, links resolvable? |
| `harness plan validate` | semantic, warns | does this plan's story hang together? |
| flow gate (`dd_link`) | refusal | may you leave this node? |

Verified live: `dd validate` on the exemplar returns 0/0 with unchecked ACs
present — correct, `unchecked` is a legal state, not a defect.

Two semantic warnings for `harness plan validate`:

1. **Open completables surfaced** — `LEAN`: a summary line, not per-row warn
   (mid-flight it would wolf-cry); escalates to warn-per-row under a
   `--complete` flag ("I believe this plan is done, prove me wrong" mode).
2. **Checked-but-contradicted** — a `checked` item whose linked checkable
   target is not gate-terminal. Always warns, no flag. This is FU-5
   generalized (FU-5 ruled "warning" 2026-08-04, unimplemented, E430–E439
   block full — needs a code). Written generically over any
   completable→completable link, it covers the future `satisfies` edge for
   free. The consistent-unchecked and evidence-ready-row-unclaimed cells stay
   silent; only checked-over-unchecked is the contradiction.

## What closes an AC — the taste question

Options iterated:

- (a) Human flips it, warnings guard it — stale direction still silent.
- (b) Fully derived from satisfying tasks — rejected in discussion:
  philosophically wrong; tasks are work performed, an AC is a claim about
  system behaviour; all-tasks-done doesn't prove the behaviour holds.
- (c) **Derived readiness, evidence-citing closure** — graph computes "ready
  to close" (every satisfying task terminal, proven_by resolves), surfaces it;
  closure is a performed act citing evidence, not a derivation.

`RULED` (Jordan, 2026-08-04): **agents may close ACs — journeys are fully
autonomous.** The human checkpoint moves to the **PR stage**: humans review
the closed ACs and their linked evidence there, with the whole graph
(`ac → proven_by → log`, `satisfies` incoming edges, basis freshness) rendered
for them. So (c)'s shape survives with the agent as the closing actor; what
makes agent closure trustworthy is the mechanical guard rail — the
contradiction warn plus the validate-green gate mean an agent *cannot* close
an AC the graph disagrees with, and the PR reviewer sees claims-with-evidence,
never bare ticks.

Structurally, closure is **the final review node's job** — the gate makes
skipping it a refusal rather than lag.

## Gate wiring — `RULED` in discussion (the shape of this session)

Mechanical fact that shapes it: the gate runs on the node you LEAVE, and
`ship` is terminal — never departed — so an "AC gate on ship" is dead code;
it must sit on the node whose departure claims ship-readiness.

```
research → plan → phase-1 → review-1 → … → phase-N → review-N → ship
                    ⛨ tasks/phase-1              ⛨ tasks/phase-N
                                                  ⛨ plan validate --complete → green
```

- **Every phase node** gates on its own task section:
  `dd_link → tasks/phase-N/tasks.dd.json#tasks`. Local, cheap, refusal names
  rows with states. Evidence-backed all the way down (task state already
  derived from evidence lists).
- **The last review node** gates on **`harness plan validate --complete`
  showing green** (Jordan: "even better: last phase gated on plan validate
  showing green"). Strictly stronger than gating on `#acceptance_criteria`:
  - catches **regressions behind you** (per-phase gates are point-in-time;
    validate-green re-reads the whole graph now);
  - folds in the **contradiction warnings** (can't ship an inconsistent story);
  - folds in **freshness** (basis-stale findings — green means checked against
    the bytes actually there).
- Per-phase gates are kept, not replaced: early local sentries; the final gate
  is the global audit at the door.
- Read out loud: *you leave the phase when the work is done; you leave the
  review when the claims are verified.*

**JIT-as-feature**: builder authors `dd_link` on phase nodes at plan time,
pointing at a task file that doesn't exist yet → gate answers `target-invalid`
→ refuses departure. Correct by accident: you cannot close a phase whose task
file was never generated. Arrive → `5 tasks` creates file + phase row's
`tasks` link → work → rows terminal → depart. No special-casing.

**New gate kind required** (the one mechanical honesty): today's evaluator
only resolves an address and reads completion states. "Validator is green" is
a verdict, not a section state. Shape sketched:

```json
"dd_link": { "check": "plan-validate", "address": "docs/plans/<ord>-<slug>/plan.dd.json" }
```

The seam accommodates it: the gate is an injected evaluator (`deps.gate`),
pure over deps; a `check` gate is a second evaluator behind the same seam,
wired at the act layer. Refusal quotes the validator's findings verbatim.
Layering caution: flow must not import plan-act internals — same barrel
discipline as dd.

## Evidence anatomy session (2026-08-04, later)

Pulled apart evidence / backpressure / ACs / tasks. Semantic roles settled in
discussion: AC = **claim**, backpressure row = **instrument** (with runnable
`probe`), task = **work**, `dw-*` entry = **assertion**, log entry =
**testimony**. An AC is *triangulated* — instrument + testimony + (future)
work accounting — three legs that fail independently.

Rulings from the pass over the five tensions:

- `RULED` — **no mandatory probe-execution at AC closure** (yet). The
  structure means a false closure requires outright fabrication, not drift;
  tests/CI still run and humans still review the PR. The graph's job is to
  make lying *visible and addressable*, not impossible. Deterministic
  run-probe-at-close is a possible future tightening, deliberately not baked
  now.
- `RULED` — **time/code-drift: don't overbake.** Testimony ages; probes are
  the time-honest edge; solve when it bites. Parked.
- `RULED` — **fix the names.** The `evidence` section holds *assertions*, not
  evidence; the evidence is what they point at. Proposed rename: section
  `evidence` → `done_when` (the `dw-` id prefix already literally means
  done_when — W10's original language). "Evidence" then correctly names the
  pointed-at testimony/instrument layer.
- `RULED` — **backpressure is a toolbelt** (superseding the earlier
  incoming-edge-derivation lean). BP rows are a catalog of instruments: no
  state, no coverage reading, no closure, and they gate nothing, ever. The
  obligation flips to the assertion side: **every `dw-*` entry must carry a
  `pressure` link or validation fails.** The check points outward from
  assertions ("does every assertion name its instrument?"), never inward at
  the toolbelt. Recorded in `structural-proof-graph.md` § Backpressure is a
  toolbelt.
- `RULED` — **`pressure: not-applicable`** is the legitimate out for
  assertions no instrument checks (e.g. "the README explains the lockout
  policy"). Explicit and queryable — distinct from a missing field, which
  fails validation. Consequence: exemplar dw entries currently missing
  `pressure` (dw-0212, dw-0221, …) get `not-applicable` or a real link when
  the schema change lands.
- `RULED` — **`plan validate` never runs probes.** Read-only, effect-free.
  Validate checks the record, not the run.
- `RULED` (reinforced) — **no "proper" pressure linking for now** — no
  ACs-run-probes-go-green machinery anywhere in this design. **`harness
  checks` fills the instrument-execution role**, full stop. Possible later
  iteration, explicitly not now.

- `RULED` — **built-in link relations (`rel`), frozen core + open namespace.**
  Semantics live on the relation, not the field name: a schema declares
  `{ "type": "link", "rel": "pressure" }` and the field may be called
  anything. Five reserved rels, frozen like the CLI surface (one-line
  renegotiation to extend): `pressure` (mandatory-or-`not-applicable`;
  unpressured-assertions query), `proven_by` (testimony; contradiction warn),
  `satisfies` (completable→completable warn; incoming work-accounting),
  `derives` (state computed from target list — the `done` edge), `ref`
  (plain reference, no semantics). Any other rel string is legal and behaves
  as `ref` — custom schemas stay sovereign, mirroring custom completion
  enums. Payoff: warn logic written once against rels, never against
  `builder/*` field names — any schema declaring a known rel inherits the
  protection with zero new code; `dd graph map` labels and filters edges
  semantically. The generic links-bucket feature collapses into "list-typed
  `rel: ref`" — no bespoke feature needed.

Two new work items from this session:

- **Structural proof graph doc** — rough documentation of how the graph forms
  the proof of work: `builder-tuning/structural-proof-graph.md` (this folder
  first; promotes to `docs/how/dd/` when it stabilizes).
- **Feature: generic `links` bucket on list items** — any list item may carry
  `links: [<address>, …]`, auto-rendered as a final table column when any item
  in the list has one. Log entries already have a bespoke `links` field; this
  generalizes it to every list type. Needs: schema treatment (reserved
  optional field on list-item shapes), renderer column (link-rendering already
  exists from FU-3 work), and `dd graph map` picking the edges up (it should,
  if they're typed as links — verify).

## Open items

- `RULED` (2026-08-04) — **`--complete` green = strict zero warnings**, with
  bypass when required: `--force` at the flow gate, human-authorized and
  recorded (workshop-002 etiquette — never on agent judgment). Every warning
  is either fixed or a human decision on the record; no allowlist, no policy
  surface. "Agent proceeds past a warning it deems harmless" is exactly the
  judgment agents don't get.
- ~~Q1 granularity~~ — RULED: task row (see the `satisfies` section).
- ~~Cardinality / orphan ACs~~ — RULED: always-array; orphan warn under
  `--complete` only.
- `OPEN` — non-last review nodes: currently gate on nothing; could gate on
  phase-scoped ACs if ACs ever declare a phase (needs an AC→phase edge —
  exemplar id convention `ac-02xx` hints at one). Parked.
- `RULED` (2026-08-04) — **builder goes fully dd-native, 100%**: `1b plan`
  emits `plan.dd.json`, `5 tasks` emits the phase task file, the
  template/expander authors the `dd_link`s. No dual markdown path. NOTE:
  builder scripts were just updated in main — rebase this branch before
  building anything.
- `OPEN` — FU-5 E-code allocation (E430–E439 full).
- `RULED` (2026-08-04) — **PR surface is in scope NOW**: the ship verb's PR
  renders the dd-derived AC table with each row's `proven_by` / `pressure` /
  incoming `satisfies` edges resolved to clickable links — the human
  checkpoint reviews claims-with-evidence, never bare ticks.
- `RULED` (2026-08-04) — **packaging: a new numbered plan, drafted by koala,
  worked in this branch/worktree** (the s065 setup stays). Plan scope
  includes the links bucket on list items (list-typed `rel: "ref"`, Jordan:
  explicit include).

- `RULED` (2026-08-04, post-validation) — **scoped semantic validate**:
  `plan validate <plan> --address <addr>` runs the semantic checks over the
  address's reachable closure (+ incoming `satisfies` for ACs); always
  per-row/strict in scope; the pre-departure rehearsal and the per-claim
  proof-tree read. Phase gates stay on the cheap completion read. Plan 069
  AC-07b.

## Session log

- 2026-08-04 — folder created at Jordan's request; notes drafted from the live
  iteration (AC↔task edge → validation layering → closure taste → gate wiring
  → validate-green final gate).
