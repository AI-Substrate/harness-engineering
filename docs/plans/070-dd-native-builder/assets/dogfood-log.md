# Dogfood log — plan 070 authoring & journey

> Running, detailed record of everything the dogfood surfaces — findings,
> paper cuts, wins, and the exact shapes future phases must reproduce or fix.
> Append-only by convention; each entry carries date, context, what happened,
> and where it landed (plan finding / task / observation / nowhere-yet).
> Jordan (2026-08-04): "make detailed notes as you dogfood, you might forget
> them." This file is that memory.

## DF-001 — id grammar refused hand-minted ids (E403 ×16)

- **When**: first `dd validate` of the hand-authored plan (as 069).
- **What**: authored AC ids `ac-01`…`ac-15` + `ac-07b`. Validator refused
  every one: minted ids need a registered prefix + **exactly four lowercase
  hex digits**. `ac-07b` is doubly illegal (3 digits + letter outside a
  4-hex tail).
- **Resolution**: renumbered `ac-6901…ac-6916` (then `ac-70xx` at the 070
  renumber). AC-07b became a plain sequential id.
- **Verdict**: the grammar working as designed — it stopped two ad-hoc id
  dialects from entering a corpus on day one.
- **Landed**: narrative in the (deleted) markdown plan header; this entry.

## DF-002 — the id-prefix registry is CLI-frozen

- **When**: designing full-spec sections (gate matrix, key findings, open
  questions) that wanted their own item kinds.
- **What**: `ID_PREFIXES = ['ph-','tk-','ac-','bp-','lg-','dw-']` is a
  hard-coded constant (`harness/cli/src/services/dd/core/constants.ts:1`).
  A schema cannot mint a new item kind — `oq-`/`kf-` rows would E403.
- **Workaround**: new sections designed **without `id` fields** — they don't
  need instance addressing. Loss: a gate-matrix row or key finding is not
  individually addressable.
- **Landed**: `harness observe` (buffer id DL-001, kind difficulty) + plan
  key finding + ph-7001 revisit note (register prefixes in schema
  declarations, or bless id-less rows as the pattern).

## DF-003 — full builder spec required 15 new schema sections; zero CLI change

- **When**: Jordan ruled the dd doc must carry the FULL builder plan spec
  ("this is the real deal").
- **What**: extended `.dd/schemas/builder/plan/schema.json` with
  research_context, testing_strategy, documentation_strategy,
  risks_assumptions, open_questions, workshop_opportunities, clarifications,
  planning_seam, gate_matrix, implementation_summary, key_findings,
  acceptance_coverage, risks, execution_guardrails (+ 4 enums: plan_mode,
  gate_status, impact, likelihood; + meta fields mode/plan_version/created/
  confidence/complexity_breakdown; + phases objective/delivers/key_risks;
  + tasks success/notes).
- **The win**: the generic shape renderer handled every one of them
  sight-unseen — object → field grid, array-of-objects → table, text →
  paragraph, enums validated. Schema-as-data held.
- **Caveat (flagged to Jordan)**: the extension was drafted in one pass;
  ph-7002 (tk-7041's formalization) owes it planted-bad fixtures per new
  section and a section-ordering test.
- **Landed**: schema committed with the plan; plan key finding row 9.

## DF-004 — `satisfies` wired TODAY with shipped machinery

- **When**: Jordan asked "tasks and ACs don't talk to each other yet?"
- **What**: the edge didn't need ph-7001. Typed link arrays
  (`{type:'array',items:{type:'link',target:…}}`) + bare-`#` same-doc
  addresses shipped in #87. Added `satisfies` to the tasks schema, inverted
  the coverage map onto task rows.
- **Proof**: `dd graph map …#acceptance_criteria/ac-7011` → 3 incoming
  edges (tk-7041/7042/7047) each with exact source location
  (`$.sections[tasks].value[16].satisfies[0]`).
- **Deferred honestly**: only the `rel: "satisfies"` annotation (machine
  semantics) waits for ph-7001.
- **Landed**: commit `1bed0dae`; the plan's own graph is traversable.

## DF-005 — ordinal collision: renumber is a real workflow

- **What**: drafted as plan 069; `069-discipline-signal-capture` (PR #92)
  landed on main the same day. Renumbered: `git mv` folder, ordinal 70, all
  ids `ac-70xx`/`ph-70xx`/`tk-70xx`, text refs.
- **Note for ph-7002**: `1b plan` dd-native must pick its ordinal at CREATE
  time against origin/main, not the local checkout — same-day collisions
  are real.
- **Landed**: this entry only (candidate prompting line for tk-7041).

## DF-006 — `harness flow apply` op vocabulary is undiscoverable

- **When**: expanding the flight plan template to 3 phases.
- **What**: two E108 rounds before the right shape: (1) ops are FLAT
  (`{"op":"insert","id":…,"after":…}`), not nested
  (`{"op":"insert-node","node":{…}}`) — the CLI verb is `insert-node` but
  the batch op is `insert`, and nothing documents the difference; (2)
  placement takes EXACTLY one of after/before/branch_of — supplying
  after+before (natural for "splice between") is refused; the engine rewires
  the successor edge itself.
- **Cost**: two failed invocations + a source dive
  (`flow-mutations.ts:1233-1252`) to learn the vocabulary.
- **Landed**: `harness observe` candidate — an `ops` example in
  `flow apply --help` or a baked doc would have cost zero. NOT yet a plan
  task; candidate for ph-7002's instructions[] work (tk-7044) since gate
  authoring uses the same surface.

## DF-007 — hand-JIT of phase-1: the exact shape `5 tasks` must reproduce

- **What**: performed the JIT expansion manually as the fixture for
  tk-7042. The moves, in order:
  1. Seed task rows move **OUT** of `plan.dd.json#tasks` into
     `assets/tasks/phase-1/tasks.dd.json#tasks` — never duplicated (dual
     truth = contradiction risk the moment states diverge).
  2. Each task gains `done: "#evidence/<task-id>"` and a per-task evidence
     list (2–4 assertions decomposed from its success criterion).
  3. `satisfies` addresses REWRITE for the new location:
     `#acceptance_criteria/…` → `../../../plan.dd.json#acceptance_criteria/…`.
  4. The plan's phase row gains `tasks: "assets/tasks/phase-1/tasks.dd.json#tasks"`
     in the same stroke.
  5. Section is named `evidence` under today's schema — the `done_when`
     rename is this phase's own deliverable (tk-7015); the file says so in
     its meta.summary.
- **Landed**: commit `a33fa4f7`; tk-7042's fixture.

## DF-008 — dw-id mint collided; the validator caught it (19 dup errors)

- **What**: my first dw scheme (`dw-701{i}` derived from a bad string
  slice) produced identical ids across all 12 tasks. `dd validate` refused
  with per-location duplicate-id errors before anything shipped.
- **Fix**: `tk-70XY` → `dw-0XY{i}` (unique 4-hex tails).
- **Note for tk-7042**: the verb needs a deterministic, collision-free dw
  mint — this exact bug class is what it must design against.
- **Landed**: this entry; fix in `a33fa4f7`.

## DF-009 — `address-target-untracked` WARN on new files: honest, self-curing

- **What**: post-JIT validate warned the plan's new `tasks` link targeted an
  untracked file. Correct — the target existed on disk but not in git; the
  commit itself cleared it (post-commit validate 0/0).
- **Note**: `1b plan`/`5 tasks` (tk-7041/7042) should expect this warning in
  the authored-but-not-yet-committed window and NOT suppress it — it is the
  basis ledger's honesty about what a fresh clone would see.

## DF-010 — flight-plan position discipline (where the journey actually is)

- **What**: research + plan marked done with receipt comments (comment
  first, status second); nav sits at `plan` because the **backpressure
  chore is due** there — the pre-coding survey is the genuine next beat,
  and it will produce `backpressure.dd.json`, the toolbelt this plan's
  evidence lists cite from ph-7001 onward.
- **Chicken-and-egg resolved**: today's template has no dd_links (gate
  authoring is ph-7002's deliverable). Per ac-7017 the flight plan
  retrofits itself mid-journey — ph-7002 lands, THIS flow gains real gates
  for its remaining nodes.

## DF-013 — prose sections authored without paragraph breaks = wall-of-text

- **When**: Jordan reading the rendered plan ("looks like no line breaks
  working?").
- **What**: NOT a renderer bug — `renderer.ts` block context is verbatim
  (`return String(value)`), so `\n\n` in source renders as real paragraphs.
  The fault was authoring: research_context (1037 chars), meta.summary (921),
  implementation_summary (728), risks_assumptions (409), and the tasks-file
  meta.summary were all single newline-free strings.
- **Fix**: inserted `\n\n` at topic boundaries, `harness dd build` both
  siblings, validate 0/0.
- **Landed**: observation DL-005; prompting requirement for tk-7041/7042
  (authoring verbs must write paragraph-broken prose); candidate semantic
  warn (long prose, zero breaks) for the ph-7001 validator — LEAN only, not
  ruled.

## DF-014 — required `summary` section: forced in schema, and it bit immediately

- **When**: Jordan asked whether future agents' plans get the Summary section
  too, or only ours.
- **What**: flipped `required: true` on the new `summary` section in
  `builder/plan` — `validate.ts` refuses a missing required section with
  E402, so this is now mechanical for every future builder/plan dd, not a
  convention. The very first validate then E402'd **our own task file**:
  phase task files ride the `builder/plan` schema today, so plan-level
  requireds bind them too.
- **Fix**: gave tasks.dd.json its own summary section (prose out of
  meta.summary, strapline left behind) — same move as the plan.
- **Landed**: evidence that task files need their OWN schema
  (`builder/tasks`), not a borrowed plan schema — feeds tk-7042's 5-tasks
  design directly.

## DF-015 — my required-summary commit broke the repo corpus; the coder caught it

- **When**: the coder measured the checks baseline before its tk-7015 commit
  (`git stash` → `dd doctor`) and found the tree ALREADY red: 2× E402 on the
  exemplar corpus + E422 render drift, all inherited from my commits.
- **Root cause**: I flipped `required: true` on `summary` after validating
  only MY plan's neighbourhood — a scoped gate run is not a general green. A
  required-section change sweeps every document on the schema repo-wide;
  `dd doctor` before commit would have shown it in one call. The exemplar
  siblings had also been drifting since the DF-003 schema extension (never
  regenerated).
- **Fix (mine — outside the coder's fence)**: summary sections added to both
  exemplar docs, all five exemplar siblings rebuilt, recorded basis for the
  tasks ref updated (E434). `dd doctor` 0/0, `build --check` drift-free.
- **Also learned**: `dd build` REPORTS a moved live basis
  (`refreshed_bases`) but never persists it — updating the recorded sha is a
  deliberate author act (065 ledger semantics); the new `dd set` verb isn't
  in dist until the phase-end rebuild.
- **Process debt owned**: I also committed schema.json inside the coder's
  declared fence mid-flight. Standing rule for the rest of phase 1: I do NOT
  touch `.dd/schemas/builder/**`; needs route through the coder.
- **Landed**: this entry; prompting candidate for tk-7041 (schema edits
  demand a doctor sweep pre-commit).

## Open dogfood threads (check before ship)

- [ ] **RENAME PENDING — 070 → 071** (prime ruling 2026-08-04: ordinal
      collision with `070-capture-stall`; capture-stall keeps 070, we take
      071; 072 is next-free and must be ASKED for, never read off main).
      Timing per Jordan: execute at the phase-1 boundary (coder report +
      review verdict in), NOT mid-flight — the coder works in this same
      worktree against tk-70xx ids. The sweep: `git mv` folder →
      `071-dd-native-builder`; ids `ac-/tk-/ph-/bp-70xx → 71xx` (dw-0XYi ids
      carry no ordinal — untouched); prose "plan 070"; `meta.ordinal` 70→71;
      the-flow `plan_id` (CLI-owned — check for a verb, else note); rebuild
      .dd.md siblings via `harness dd build`; recompute plan SHA-256 →
      update backpressure-coverage.md Basis + re-receipt the backpressure
      seam (`backpressure-<hash12>` node, renumber-only delta). Own commit,
      explicit pathspec, confirm path+SHA to prime. Notify coder of the id
      mapping before its next phase touches the corpus.

- [ ] DF-002 revisit lands in ph-7001 (prefix registry vs id-less pattern).
- [ ] DF-003 schema extension gets its fixtures + ordering test (tk-7041).
- [ ] DF-005 ordinal-at-create rule reaches tk-7041's prompting.
- [ ] DF-006 ops-vocabulary doc reaches tk-7044's instructions[] work.
- [ ] DF-008 collision-free dw mint reaches tk-7042's design.
- [ ] Backpressure survey (flow chore) → `backpressure.dd.json` → evidence
      lists gain `pressure` links (mandatory once tk-7015 lands).
- [ ] **MIGRATE 070's tasks.dd.json** `evidence` → `done_when` + per-row
      `pressure` links (bp-70xx or `not-applicable`) — MINE, using the
      tk-7028 writer verbs, as soon as tk-7015 lands (fence ruling A,
      2026-08-04: coder ships a deprecated `evidence` alias; the alias DROP
      rides tk-7061's exemplar migration commit in ph-7003).

## DF-011 — the reconcile pass and module contracts are dd-blind

- **What**: builder's spine-reconcile reads `#### Phase Index` from markdown;
  the backpressure module's contract names `<slug>-plan.md`; the plan node's
  baked `instructions[]` speak `Status: READY` markdown. All satisfied in
  *intent* by the dd plan, but every read is markdown-shaped. ph-7002's
  prompting work (tk-7041/7044/7045) owns the re-point.
- **Also**: the `builder/backpressure` schema enums (`BUILD`,
  `human-judgement`) diverge from the module prose (`BUILDABLE`,
  `inferential`) — the schema refused the prose vocabulary; schema won.

## DF-012 — dd has no writer: the python-shaped hole (RULED into the plan)

- **What**: every structural edit of this journey's own documents was ad-hoc
  `json.load → poke → json.dump` — no validation before write, sibling
  rebuild manual, ids hand-minted (the DF-008 collisions). Jordan spotted
  the pattern live ("you keep running python… is there something we can
  bake into harness?").
- **Ruled**: `dd get/set/add/rm` + `--mint` — ac-7019, tk-7028, bp-7019 —
  and **built FIRST in phase 1** ("do it early on") so the journey itself
  stops hand-editing the moment the verbs exist. tk-7043 (6/6a state
  mutation) explicitly depends on it.
