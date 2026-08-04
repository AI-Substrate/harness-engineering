# dd-native builder — the structural proof graph, wired end to end

> Plan 069. Drafted by koala from the 2026-08-04 design session; every design
> decision below is a Jordan ruling recorded in
> `docs/plans/065-deterministic-documents/builder-tuning/notes.md` (the ruling
> ledger) and `structural-proof-graph.md` (the design doc). This plan
> implements those rulings and does not re-litigate them.

## Business Specification

### Research Context

📚 Direct continuation of plan 065 (shipped, PR #87): the dd document layer,
the `builder/*` schemas, the exemplar corpus, and the flow-spine departure
gate all exist and are tested. What does not exist: anything that *drives*
them. Zero `the-flow.json` files carry a `dd_link`; the builder skill and its
`flight-plan.template.json` have no dd knowledge; plans are still authored as
markdown. Plan #90 (merged) moved builder in-repo (`skills/builder/`),
introduced the assets/ plan-folder layout, the 7b post-flight stage, and
plan archiving — all of which this plan must land inside.

### Summary

Make the builder pipeline **dd-native, 100%**: `1b plan` emits `plan.dd.json`,
`5 tasks` emits per-phase task files, the flight-plan template and expander
author the `dd_link`s, and the flow's mechanical gates finally have documents
to gate on. Around that spine, ship the schema features the design session
ruled: typed link **relations** (frozen core of five), the generic per-item
**links bucket**, mandatory **`pressure`** on assertions with `not-applicable`
as the explicit out, the **`done_when`** rename, the **`satisfies`** edge
(task → AC), a **semantic validation layer** in `harness plan validate` with a
`--complete` mode whose green is strict-zero, a **check-kind flow gate** that
refuses ship-ward departure until that green, and a **PR surface** that
renders the closed AC table with resolved evidence links for the human
checkpoint.

The thesis (from `structural-proof-graph.md`): the graph does not make claims
true — it makes false claims **expensive and visible**. Agents run the whole
journey autonomously; the human reviews claims-with-evidence at the PR.

### Goals

- Typed link relations: semantics on the `rel`, not the field name; five
  built-ins frozen (`pressure` · `proven_by` · `satisfies` · `derives` ·
  `ref`); unknown rels legal, treated as `ref`.
- Every list item can carry a `links` bucket (list-typed `rel: "ref"`),
  auto-rendered as a final table column when present, traversed by
  `dd graph map`.
- Every done_when assertion names its instrument: `pressure` is a BP-row link
  or the literal `not-applicable`; absence is a validation ERROR. BP rows are
  a toolbelt — no state, no coverage reading, they gate nothing.
- `evidence` sections become `done_when` (the `dw-` prefix already says so).
- Task rows carry `satisfies` (always an array) back to the ACs they serve.
- `harness plan validate` grows the semantic layer: open-completables summary
  (info), rel-generic contradiction warnings (always), and `--complete` mode
  (per-row open warnings + orphan-AC warnings + strict-zero green).
- The flow gains a check-kind gate: the last review node refuses departure
  until `plan validate --complete` is green; phase nodes gate on their task
  sections; the builder template/expander authors all of it.
- `1b plan` and `5 tasks` author `.dd.json` natively; ship renders the
  dd-derived AC/evidence table into the PR body.

### Non-Goals

- **No probe execution anywhere in dd/plan surfaces** (ruled, twice):
  `harness checks` owns instrument execution; validate reads the record.
- No AC-state derivation — closure stays a performed act (agents close;
  the guard rails make it trustworthy).
- No code-drift freshness beyond the existing basis ledger (ruled: solve
  when it bites).
- No migration of existing markdown plans (058–068 stay as they are; the
  archive is institutional memory, not a conversion backlog).
- No per-assertion `satisfies` (ruled: task row, coarse).
- No allowlist/policy surface for `--complete` warnings (ruled: strict zero;
  `--force` is the bypass).
- No changes to the five lifecycle hooks, the harness-seam doctrine, or the
  E44x gate codes' meanings.

### Testing Strategy

- **Approach**: Hybrid — TDD for the new dd-core logic (rel parsing,
  contradiction engine, `--complete` predicate, check-gate evaluator);
  lightweight validation for renderer columns, skill prompt-ware, and PR
  body assembly.
- **Control discipline** (house rule: a check only ever run against good
  input has been demonstrated, not tested): every new warning/error class
  gets a planted-bad fixture that proves it FIRES, plus a good twin.
- **Mock usage**: fake ports only; real fixture corpora, extending the
  exemplar.
- **Skill-layer changes** (prompt-ware): proven by a scripted end-to-end
  dry-run — create a plan via the new template, JIT a phase, drive nav
  through a refusing gate to green — captured as an integration test where
  the CLI is the actor, and by doc-drift checks where it is not.

### Documentation Strategy

- `docs/how/dd/` chapters extended in place (relations, done_when, satisfies,
  links bucket, `--complete`); `structural-proof-graph.md` promotes from
  `builder-tuning/` into `docs/how/dd/` once schemas land.
- Baked `dd docs` corpus regenerated (`gen:dd-docs`) wherever schema surface
  changes; the exemplar corpus is upgraded to the new schemas and stays the
  worked reference.

### Complexity

- **Score**: CS-4
- **Breakdown**: S=2, I=2, D=1, N=1, F=1, T=2 (sum 9)
- **Confidence**: 0.8 — the dd/flow seams are all shipped and tested; the
  novel surface is the semantic validate layer and the check-kind gate, both
  behind existing injection seams. Risk concentrates in the builder
  prompt-ware (behavioural, not compiled).
- **Phases**: 6 — graph: P1 → P2 → (P3 ∥ P4) → P5 → P6.

### Acceptance Criteria

1. **AC-01 Relations**: a schema may declare `rel` on any link field (single
   or array items); the five built-in rels parse, resolve, and are exposed on
   the resolved schema; an unknown rel string is accepted and behaves as
   `ref`; `dd graph map` labels edges with their rel and can filter by it.
   The built-in set is frozen in the surface manifest (one-line renegotiation
   to extend).
2. **AC-02 Links bucket**: any list-item shape may carry a `links` bucket
   (array of `rel: "ref"` links) without per-schema bespoke fields; rendered
   as a final `Links` column only when at least one item in that list has
   entries; edges appear in `dd links` / `dd graph map`; absent bucket ⇒
   byte-identical render to today.
3. **AC-03 Pressure mandatory**: in the `builder/done_when` schema, an
   assertion without `pressure` is a validation ERROR (planted-bad fixture
   proves it fires); `pressure: not-applicable` validates, renders honestly,
   and is queryable (a stock jq one-liner lists every not-applicable
   assertion in a plan — documented).
4. **AC-04 done_when rename**: builder schemas and the exemplar corpus use
   `done_when` (section) with unchanged `dw-` ids; renderer titles read
   naturally; no `evidence`-named section remains in living builder schemas;
   frozen historical corpora are signposted, not rewritten.
5. **AC-05 satisfies**: task rows carry `satisfies` as an always-array of
   rel-typed links to AC rows; `dd graph map` on an AC shows the incoming
   work-accounting; a task with a non-array `satisfies` fails validation.
6. **AC-06 Contradiction engine**: `harness plan validate` warns whenever a
   gate-terminal item links (via `proven_by`, `satisfies`, or `derives`) to a
   checkable target that is not gate-terminal — written once against rels,
   never against field names; planted-bad fixtures prove each rel path fires;
   the consistent-open and evidence-ready-unclaimed cells stay silent.
7. **AC-07 --complete mode**: `harness plan validate --complete` adds per-row
   warnings for every open completable and every AC with no incoming
   `satisfies` edge (orphan); green means **zero errors and zero warnings**;
   without `--complete`, open completables appear only as a summary info
   line. Exit/envelope semantics match house degrade rules.
8. **AC-08 Check-kind gate**: a flow node may carry
   `dd_link: { check: "plan-validate", address: <plan.dd.json> }`; departure
   evaluates the semantic validator live and refuses on non-green, quoting
   the findings verbatim; `--force` records the defended override exactly as
   the completion gate does; the completion-kind gate is unchanged and both
   kinds share the untrusted-reading discipline.
9. **AC-09 Template authors the gates**: the flight-plan template + expander
   emit `dd_link`s — each phase node gating on its phase task section, the
   last review node carrying the check-kind gate; a pre-JIT departure
   attempt refuses with `target-invalid` (the you-never-tasked-this-phase
   refusal, pinned by test).
10. **AC-10 dd-native authoring**: `1b plan` emits `plan.dd.json` (+ built
    sibling) as the plan artifact and `5 tasks` emits
    `assets/tasks/phase-N/tasks.dd.json` with done_when lists and
    `satisfies` edges, adding the phase row's `tasks` link in the same
    stroke; the flow discovers both; a scripted end-to-end dry-run proves
    create → JIT → refuse → green → depart.
11. **AC-11 PR surface**: ship renders a dd-derived AC table into the PR
    body — each row with its state mark and resolved links (proven_by,
    pressure, incoming satisfies) as clickable references — generated from
    the corpus, never hand-written; a plan with an unclosed AC cannot reach
    this point (AC-08) and the renderer refuses rather than fabricates if
    handed one.
12. **AC-12 Layout & archive**: the dd corpus lives inside the #90 assets/
    convention (plan doc at root, task files under `assets/tasks/`); after a
    post-flight `git mv` to `docs/plans/archive/<ord>-<slug>/`, the corpus
    is still doctor-clean (relative addresses survive; shas unchanged).
13. **AC-13 Exemplar & docs**: the exemplar corpus upgrades to the new
    schemas (rels, done_when, mandatory pressure, satisfies) and validates
    doctor-clean; `docs/how/dd/` chapters and the baked docs corpus cover
    the new surface; `just checks` green; warn trio at baseline.

### Clarifications (all Jordan, 2026-08-04 — see original-ask.md)

- Fully autonomous journeys; agents close ACs; human checkpoint is the PR.
- BP toolbelt model; `pressure: not-applicable`; toolbelt never gates.
- Strict-zero `--complete`; `--force` (human-authorized, recorded) is the
  only bypass.
- Builder fully dd-native — no dual markdown path.
- Links bucket explicitly in scope; PR surface explicitly "now".

## Implementation Plan

### Phase graph

```
P1 (dd core: rels, bucket, schemas) ──► P2 (plan validate semantic layer)
                                          ├──► P3 (flow check-gate + template gates)
                                          └──► P4 (builder dd-native authoring)
P3 + P4 ──► P5 (ship PR surface) ──► P6 (exemplar upgrade, docs, checks join)
```

### Phase 1 — Relations, buckets, and schema surface (dd core)

The schema layer learns `rel` (declaration parsing, resolved-schema exposure,
frozen-five registry in the surface manifest, unknown-rel-as-ref); the
renderer learns the `links` bucket column (reusing the array-of-link
machinery from #87); `builder/*` schemas gain `done_when` (rename),
`satisfies` (always-array, rel-typed), and mandatory `pressure` with the
`not-applicable` literal. Every new failure class gets its planted-bad
fixture and good twin. Watch item from OD-8: the declaration parser's
allow-list silently drops unknown keys — `rel` must be added there, and the
pin lives in `declarations.test.ts`/`parse.test.ts` (not the renderer suite).

### Phase 2 — The semantic validation layer (`harness plan validate`)

The doc-type-aware consumer grows opinions: open-completables summary line
(always), the rel-generic contradiction engine (always), `--complete` mode
(per-row opens + orphan ACs + strict-zero green). New E-code block allocated
for semantic findings (E430–E439 is full — leaf decision: next free block,
recorded in the error-code JSDoc discipline). `dd validate` stays byte-for-
byte mechanical — regression-pinned.

### Phase 3 — The check-kind flow gate

`DdLink` grows the `check` variant; a second evaluator behind the existing
`deps.gate` seam evaluates `plan-validate` live at departure (same
no-caching, nothing-written-on-refusal, `--force`-records-override contract
as the completion gate; same sanitize/untrusted-reading discipline for
anything recorded). The flight-plan template + expander author the per-phase
completion gates and the last-review check gate; the pre-JIT
`target-invalid` refusal is pinned as intended behaviour. Barrel discipline:
the flow reaches the semantic validator through a deliberate exported seam,
never past one (extend `flow-consumes-dd-sdk-only` accordingly).

### Phase 4 — Builder goes dd-native (prompt-ware, in-repo)

`skills/builder/` stage modules: `1b plan` authors `plan.dd.json` under the
#90 assets/ layout; `5 tasks` authors the phase task file (done_when +
satisfies + pressure) and adds the phase row's `tasks` link; `6 implement` /
`6a progress` update states through dd surfaces; discovery/readers
re-pointed. The doctrine-parity block is untouched; where prompt-ware
behaviour can't be compile-checked, the P4/P3 joint end-to-end dry-run is
the proof (AC-10).

### Phase 5 — The PR surface (ship)

Ship assembles the dd-derived AC table (state marks + resolved proven_by /
pressure / incoming-satisfies links) into the PR body; refuses to fabricate
when handed an unclosed corpus. Repo-relative links render as clickable
GitHub URLs at the recorded head SHA.

### Phase 6 — Exemplar, docs, checks join

Exemplar corpus upgraded to the new schemas (including
`pressure: not-applicable` on the currently-unpressured dw rows);
`docs/how/dd/` chapters + justfile recipes extended; `structural-proof-graph`
promoted into `docs/how/dd/`; baked docs regenerated; archive-move
doctor-clean proof (AC-12); full `just checks` + warn-trio baseline
verification.

### Execution guardrails

- Worked in the s065 worktree/branch (Jordan's call — "nicely set up here");
  rebased onto main at `64609beb` before drafting.
- `just build` after every CLI edit before exercising the live `harness`
  binary; `just fix` before any push (CI gates on biome).
- Frozen surfaces: the `dd` verb family and E-code blocks extend only via
  the one-line surface-manifest renegotiation; the five rels join that
  manifest on landing.
- Historical corpora are never rewritten to satisfy new schema rules —
  living corpora upgrade; frozen ones get signposts (the living/frozen
  boundary rule).
