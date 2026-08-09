# Research Dossier: a deterministic "stream owes a flow" verb for pij workteam

**Generated**: 2026-08-09T02:15:00Z
**Query**: "design the harness verb that answers 'does stream X have a flight plan AND does its plan validate', for pij workteam verbs to call"
**Effort**: Standard (lead probes + 1 architecture worker)
**Evidence**: 14 current sources · 4 historical sources

## The Ask

Jordan's pre-amble (2026-08-09) ruled that plan validation will NOT go into `harness checks` —
the builder flow is one SDD flavour among several — and that enforcement instead lives in pij's
**workteam** verbs and skill, which will mandate builder in workteam context and call **harness
verbs** to detect a stream that never produced a flight plan or a valid plan (the measured
failure: pij wave s092–s100, 0/9 flight plans, 2/9 no plan document, 9/9 merged green — #140,
AI-Substrate/pij#227). This dossier answers: what does the harness surface already provide for
each clause, where does a new verb register, how must it ship so pij can call it, and what
design decisions remain.

## Answer

1. **Both clauses already have deterministic primitives.** `plan validate` fails `E400`/exit 1
   on a missing `plan.dd.json` — that alone goes red on 098/099-shaped streams (F-01) — and
   the flow-read service distinguishes missing (`E301`), malformed (`E300`), legacy (`E308`),
   and future-version (`E306`) flight plans (F-08).
2. **`plan ready` is 80% of the wanted verb but has the wrong polarity for workteam**: it
   already composes plan-validity with the flight plan beside it, but by design (plan 072
   AC-06) an absent flow yields `cant-tell`/exit 2 — an honest refusal, not a failure. In
   workteam context "no flow" must be a hard finding (H-01, F-05, F-06).
3. **The verb must be core, not an extension**: the npm package ships only `bin`/`dist`/`skills`
   — `.harness/extensions/` is repo-local and discovered from cwd only, so a verb pij calls via
   the globally installed `harness` in arbitrary repos has to live in `harness/cli/src/acts/`
   (F-10, F-11). Extensions also cannot claim the reserved names `flow`/`plan` (F-12).
4. **Registration is one seam**: an `acts/<name>.ts` exporting `register<X>Act(program, io,
   deps)` plus one import+call in `app.ts`; envelope via `formatOk`/`formatError`, codes from
   the `ErrorCodes` registry, exit mapped status-only by the kernel (ok/degraded→0, error→1,
   unconfigured→2) (F-09, F-13).
5. **Integration with s080 is settled**: consume the CLI envelope, never dd internals —
   `services/dd/**` and `acts/dd/**` are deleted in their phase 3, `acts/plan/index.ts` is
   frozen for their whole plan. `plan validate|ready` survive with envelope parity as their AC
   (see `design-constraints.md`).
6. **Red-first is locally reproducible**: a 098-shaped fixture (`findings.md` + `SEAT.md`, no
   plan doc, no flow) already fails both clauses in this worktree (F-01, F-02); the real
   streams remain available read-only under `~/pi-hacking/pij-worktrees/` for validation.

## Evidence

| ID | Finding | Evidence | Planning implication | Confidence |
|----|---------|----------|----------------------|------------|
| F-01 | `plan validate` on a folder with no `plan.dd.json` (098-shaped fixture, and a nonexistent dir) → `E400`, envelope `error`, exit 1 | probe P1/P3 vs `.harness/temp/s081/fixtures/098-shaped`; MEASURED 2026-08-09 | clause 1 ("plan exists") is already deterministic; the actual wave failure goes red today | High |
| F-02 | `plan ready` on the same no-plan fixture → identical `E400`/exit 1 | probe P2 | either verb catches the no-plan case; the gap is only the flow clause | High |
| F-03 | `plan validate` on a valid plan (078) → `ok`, counts envelope, exit 0 | probe P4 | clause 2 ("it validates") works as-is | High |
| F-04 | `plan ready` returns `basis_sha256` of the plan bytes in every verdict | probe P5/P6 envelopes | pij can cache verdicts against plan bytes (koala's suggestion holds) | High |
| F-05 | `plan ready` with plan-but-no-flow (078) → `unconfigured`, verdict `cant-tell`, reason `no-flight-plan`, exit 2 | probe P5 | the flow-absence signal EXISTS but is deliberately soft; workteam needs it hard | High |
| F-06 | `plan ready` with plan+flow+stale survey (073) → `degraded`, `not-ready`/`stale-basis`, exit 0 (`--strict` → error/1) | probe on 073; `plan ready --help` | the verdict vocabulary (ready/not-ready/cant-tell + reasons) is precedent to extend, not replace | High |
| F-07 | `plan ready` maps flow-read failures explicitly: E301→`no-flight-plan`, other read errors→`flight-plan-unreadable` | `harness/cli/src/acts/plan/index.ts:500-515,620-625`; `services/flow/chores-read.ts:262-272` | reachability vocabulary already exists in core under `plan` | High |
| F-08 | Flow readability is centrally asserted by `readFlowDoc`: E301 missing, E300 bad JSON, E308 legacy/no-provenance, E306 forward-major | `services/flow/flow-service.ts:100-134`; `output/error-codes.ts:96-118`; probes P7/P8 | new verb reuses `readFlowDoc` (or the envelope of a read verb), never re-implements existence | High |
| F-09 | Core verbs register via `register<X>Act(program, io, deps)` in `buildProgram`; envelope built by the act, exit owned by the kernel, status-only mapping ok/degraded→0, error→1, unconfigured→2 | `harness/cli/src/app.ts:319-431`; `output/exit.ts:5-10,38-43` | one clean seam for a new act; exit semantics are fixed by convention, not per-verb | High |
| F-10 | npm package ships `harness/cli/bin`, `dist`, `skills` only — no `.harness/extensions/` | `package.json:11-28` | a pij-callable verb must be core in `harness/cli/src`; extensions don't travel | High |
| F-11 | Extension discovery is cwd-only (`<cwd>/.harness/extensions/`, one level, jiti-loaded pre-parse) | `services/extensions/discovery.ts:5-8,26-66`; `app.ts:290-311` | even a vendored extension only exists where the consuming repo carries the folder — wrong distribution for workteam | High |
| F-12 | Extensions cannot claim reserved core names incl. `flow` and `plan` (E141/E142 conflicts) | `services/extensions/registry.ts:82-97,270-282` | a flow-family subverb can only be core; an extension would need a new top-level name | High |
| F-13 | `--json` is a global tri-state resolved once at the entrypoint; acts never re-derive it; non-ok results must carry `next_action` (P5) | `app.ts:78-104`; `services/extensions/contract.ts:43` | verb inherits output mode; contract obligations are mechanical | High |
| F-14 | No `flow validate`/`flow check` verb exists — flow subverbs are create/new/show/list/nav/rail/chores/orient/status/mutators/render; existence surfaces only as read-verb failures | `harness/cli/src/acts/flow.ts:334-1219` | the dedicated reachability verb is a genuine gap, not a duplicate | High |
| F-15 | The literal `flow create flight-plan --slug --plan-dir` one-liner #140 proposes fails `E304` — `flight-plan` is not a bundled type; the working invocation needs `--path/--schema/--template/--agent` resolved from the builder skill | `../friction-log.md` F1; MEASURED | the pij-facing contract must carry the full invocation, or s081 bundles `flight-plan` as a first-class flow type — decision required | High |

## Historical Evidence

| ID | Prior friction / decision | Source | Applicability now | Implication |
|----|---------------------------|--------|-------------------|-------------|
| H-01 | Plan 072 built `plan ready` and DELIBERATELY ruled absent-flow → `cant-tell`, never pass/fail (AC-06: "declined-vs-never-run is only knowable from the flight plan; a document-only plan cannot answer it"); `--strict` opt-in teeth were "the one decision worth a human ruling" | `docs/plans/archive/072-plan-ready-gate/plan-ready-gate-plan.md#AC-06,#94-99` | Direct | the workteam verb must not silently flip 072's polarity inside `plan ready`; either a new mode/flag or a new verb, with the divergence argued in the plan |
| H-02 | The measured defect: 0/9 flight plans, 2/9 no plan doc, 9/9 merged green; assertion needed is two-clause, first clause catches the actual case; build red first against 098/099; count examined-and-excluded | #140, AI-Substrate/pij#227 (read 2026-08-09) | Direct | acceptance criteria and fixture shape come straight from these |
| H-03 | Fix hierarchy at dispatch (template < kickoff step < `stream create` mints the flow) and its bypass evidence (s101 and this worktree hand-rolled) — even the strongest pij seam is optional | `~/pi-hacking/pij` `docs/how/fleet/stand-up.md@4b911616` §4, §7; allocation records verified locally | Direct | the harness verb must stand alone (callable post-hoc on any worktree), not assume it was invoked at allocate time |
| H-04 | Constitution/plan-024 doctrine: the CLI is the only flow writer/generator; CLI-is-the-API (P4) is why koala's envelope seam is the integration contract | plan 024 (archive); s080 coordination note in `design-constraints.md` | Direct | verb consumes envelopes (`plan validate`/`ready`) and `readFlowDoc`-class reads; no dd imports |

## Risks and Unknowns

| Item | Evidence | Why it matters | Resolution / next evidence |
|------|----------|----------------|----------------------------|
| `acts/plan/index.ts` is frozen (s080, entire plan duration) | koala coordination, `design-constraints.md` | adding a `plan` subverb or flag means editing the frozen file | prefer a new act or a `flow`-family subverb (`acts/flow.ts` is not in s080's set); any `plan` surface change routes through koala/prime first |
| Touching `harness/cli/src/**` needs prime notified per stream fence | stream brief §fence | the chosen seam is inside the fence's tell-first zone | already flagged in report spine 54204; confirm before implementation |
| Polarity conflict with plan 072's AC-06 | H-01 | flipping cant-tell→fail inside `plan ready` would break 072's ruled semantics and koala's parity AC | new verb or explicit new flag (e.g. `--require-flow`), decided in the plan stage with the 072 rationale answered |
| What "flow exists" means for non-builder SDD flavours (OpenSpec etc.) | pre-amble ruling: builder mandated only in workteam context | the verb is called by workteam (builder-mandated), but a general verb that hard-fails any flowless plan would overreach | scope the verb's contract as workteam-facing; document that general repos use `plan ready`'s soft verdict |
| Full-good `plan ready` (fresh survey) not yet observed | probes covered error/cant-tell/stale only | the ok/`ready` envelope shape is inferred from source, not measured | measure during implementation once 081's own plan+survey exist (self-dogfood provides the fixture) |

## Planning Handoff

- **Preserve**: `plan validate`/`ready` envelopes and exit semantics (koala parity AC); plan 072's three-valued verdict for the general case; status-only exit mapping; `next_action` on every non-ok.
- **Change carefully**: anything under `harness/cli/src` (fence tell-first); never `acts/plan/index.ts`, `services/dd/**`, `acts/dd/**` (s080); no hand-written flow state (invariant #6).
- **Likely files/symbols**: new `harness/cli/src/acts/<name>.ts` + one registration line in `app.ts:386-424`; reuse `readFlowDoc` (`services/flow/flow-service.ts:100`) and shell/compose `plan validate|ready` envelopes; tests beside existing act tests in `harness/cli`; local fixtures modelled on `.harness/temp/s081/fixtures/098-shaped` (promote into the test tree).
- **Decisions still required**: verb name and family (new top-level act vs `flow`-family subverb); one verb vs `plan ready --require-flow`-style mode (must answer 072's AC-06 rationale); whether s081 bundles `flight-plan` as a first-class flow type to fix F-15/E304; the exact examined/excluded reporting shape for multi-stream sweeps; the written pij-facing contract format for the ermine handoff.
