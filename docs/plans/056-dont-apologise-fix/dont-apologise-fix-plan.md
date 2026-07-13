# Don't Apologise — Fix: environment-first posture across builder + eng-harness-flow
**Mode**: Simple
**Plan Version**: 1.1.0 — validation findings V-01…V-08 folded in (2026-07-09)
**Created**: 2026-07-09
**Status**: READY
**Spec source**: unified (this file)

## Business Specification

### Research Context

📚 Incorporates findings from `research-dossier.md` (F-01…F-13) and the authoritative workshop `workshops/001-telemetry-for-flow-improvement.md` (D1–D6; D1 ratified **first-class**, Q3 ratified **now**). Prior art: plan 044 (retro closeout UX), plan 040 (template/instructions channel), plan 055 (vendored skills).

### Summary

Agents neurotically pursue "done" and treat environment friction as something to apologise for and route around; the learning evaporates. This plan encodes a standing second posture — **don't apologise, fix; the environment is a target of work for us, agents and humans together; pay every difficulty forward** — into the channels agents actually re-read mid-work, rewrites the retro drain into a recommendation-led conversation whose outcomes (dispositions) are recorded for every presented observation including declines, and extends the CLI schema + telemetry vocabulary so the change's effectiveness is measurable from real work when we return in ~3 weeks.

### Goals

- The posture is re-encountered mechanically mid-phase (orient/instructions), not remembered from a doc read once.
- Friction capture names the real tool (`harness observe`) at the moment friction bites, with an honest fallback for harness-less direct-jump runs.
- The phase-end drain reads as "we have options to improve this environment; highest value is X because…" — numbered, human, recommendation-led; never letter codes or menu-speak.
- Every presented observation leaves a disposition trace (`fixed-now|task|plan|diffs|command|kept|declined|deferred`) — declines and deferrals included — queryable offline for recurrence analysis.
- Small environment fixes can happen mid-flow, tracked as flight-plan excursion nodes (intent + outcome), no mini-plan ceremony.
- Effectiveness is checkable at T+3wk from real telemetry via a committed runbook + a persistent flight-plan affordance.

### Non-Goals

- No gates, scores, compliance floors, or runtime targets — the harness assists; the user still delivers their work (Goodhart guard: metrics are never surfaced to the working agent as targets).
- No changes to the router's `--hook` vocabulary, minih/companion protocol, or harvest UX beyond letter-code leak fixes.
- No offline-analysis tooling (this plan ships the data shape; the consumer is a later plan).
- No instruction migration for in-flight flows (new flows only).
- No MUST-FIX neurosis: the directive carries its own discrimination test.

### Target Domains

_No `docs/domains/` registry exists in this repo; domains below are the informal change surfaces._

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| builder skill (`skills/builder/`) | existing | **modify** | Directive layers 1, 2, 3-partial, 4; letter-code purge; excursion-fix guidance |
| eng-harness-flow skill (`skills/eng-harness-flow/`) | existing | **modify** | Drain rewrite (retro.md), coach posture, retro.schema.json 1.2, narrowed-rule mirror copy |
| CLI observe/record (`harness/cli/src/services/{observe,record}/`) | existing | **modify** | Fingerprint at capture; RETRO_TEMPLATE + pinning test; stale-path comment fix |
| CLI telemetry (`harness/cli/src/services/telemetry/`) | existing | **modify** | `retro` artifact type + extractor; disp_*/kind_* count keys; `observe_kind`; schema mirrors; insight generators |
| flow-eval extension (`.harness/extensions/flow-eval/`) | existing | **modify** | Planted-friction scenario + assertions |
| docs (`docs/how/`) | existing | **modify** | telemetry-field-reference update; tripwire-review runbook (plan folder) |

### Testing Strategy

- **Approach**: Hybrid — TDD for all CLI changes (schema, fingerprint, extractor, generators: vitest, house style); lightweight for skill prose (doctrine-parity guard + `skills-check` + grep assertions); the flow-eval planted-friction scenario is the behavioural test.
- **Mock Usage**: Real fixtures only (jiti-loaded extensions, real buffer/record files) — matches Constitution P3.
- **Focus Areas**: contract trios moving together (schema+template+test; events+segment-schema); privacy-by-construction on every new telemetry field.
- **Excluded**: prose quality of skill text (operator judgement + flow-eval).

### Documentation Strategy

- **Location**: docs/how/ only — update `telemetry-field-reference.html` for the new vocab; the tripwire-review runbook lives in this plan folder (it is plan-scoped, not evergreen).
- **Rationale**: existing surfaces; no README audience for internal contract changes.

### Complexity

- **Score**: CS-3 (medium)
- **Breakdown**: S=2, I=1, D=1, N=1, F=1, T=1 (sum 7)
- **Confidence**: 0.85
- **Assumptions**: additive schema/vocab changes don't break existing consumers (validated by suite); the expander inherits template instruction text for phases 2..N per the 040 doctrine.
- **Dependencies**: none external; deploy order CLI-first-then-skills (SKILL.md § Prerequisite).
- **Risks**: see § Risks & Assumptions.
- **Phases**: 1 (Simple) — tasks dependency-ordered CLI → skills → eval/runbook.

### Acceptance Criteria

1. **AC-01 Directive in all four layers**: builder SKILL.md carries the canonical invariant (with the inheritance discrimination test and the "us = agents and humans together" frame, naming `/eng-harness-flow` and `harness observe`); the flight-plan template's phase + observe nodes carry a channel-sized posture instruction; `60-implement.md` and `50-phase-tasks.md` carry one harness-tolerant posture line each (observe + execution-log fallback); `harness-seams.md` § Why carries the pay-it-forward echo. Each non-canonical layer cites the invariant rather than restating it.
2. **AC-02 Mechanical re-read proven**: a fresh flow created from the updated template shows the posture instruction in `harness flow orient` output at its phase node.
3. **AC-03 Narrowed rule, consistent everywhere**: all harness-blind statements (builder SKILL.md #9, 00-routing § Harness router posture, harness-seams inversion ¶, eng-harness-flow § Progressive disclosure) say orchestration-blind + `harness observe` permitted with fallback. Verified by a **grep assertion across all four sites** (the parity guard only byte-compares the one shared block — necessary but not sufficient); keep the narrowed wording **outside** the guarded block (the existing statements already are).
4. **AC-04 Dispositions recorded first-class**: a drained retro record contains every presented entry with `disposition:` (schema 1.2) and `fp:`; a declined entry is present with `disposition: declined`; old 1.1 records still validate.
5. **AC-05 Telemetry additive + private**: `retro` artifact events emit with disp_*/kind_*/observations counts summing correctly against the record; `HarnessEvent.observe_kind` present when verb=observe; `segment.schema.json` mirrors stay `additionalProperties: false`; no free text in any new field.
6. **AC-06 Insight generators**: `observe_conversion` and `disposition_mix` emit numbers over an existing session cohort with zero LLM involvement.
7. **AC-07 Letter codes purged**: `grep -rn "s/t/p/e/d/a" skills/builder/` returns only nothing (the eng-harness-flow ban text may keep naming them as the anti-pattern).
8. **AC-08 Drain rewrite**: `retro.md` § Step 2 presents numbered, well-spaced recommendation-led paragraphs (lead sentence, per-item what/fix/who-benefits, judgement-based "highest value because…", one-sentence close with default + escape hatch); records dispositions for all presented entries; offers do-it-now for small fixes with an excursion-node track (`insert-node --branch-of`, intent + outcome notes).
9. **AC-09 Planted-friction eval**: a flow-eval scenario with a planted friction scores (a) friction→observe/fix within the phase and (b) drain-format + disposition-recording conformance; runs green against a subject session.
10. **AC-10 T+3wk re-entry affordance**: a committed `tripwire-review.md` runbook in this plan folder naming the **three tripwires with thresholds**: **TW-1 conversion** — friction→observe conversion (`observe_conversion`: observe events ÷ non-zero `command_exit`+`api_error`) shows no improvement vs the pre-change cohort after ~3 weeks → the channels aren't landing, rethink; **TW-2 discrimination** — declined-rate > 60% of presented observations OR > 5 observations/phase average → discrimination test too loose, tighten; **TW-3 drain fatigue** — drain skip-rate (retro chores `skipped`÷(done+skipped)) rising vs baseline → the presentation is still a chore, revise format. Every query **executes** today; `observe_conversion` and TW-3 return real baselines, disposition-based queries are definitionally zero at T0 (validated as execute-only). Plus a persistent `tripwire-review` excursion node anchored off `ship` (status `assumed`) so the thread is visible in the flight plan when we return.
11. **AC-11 Token profile not worsened**: net-new skill prose across all touched skill files ≤ ~40 lines total (channel-sized one-liners + one canonical invariant + the drain format block); the diff is the evidence.

### Risks & Assumptions

| Risk | Mitigation |
|------|-----------|
| Parity-block edit lands one-sided → suite fails or doctrine forks | Read `doctrine-parity.ts` coverage first; both copies in one commit; prefer wording outside the block where possible |
| Schema-pinning trio drifts (schema/template/test) | One task, one commit, test updated in the same change |
| Observe-spam / MUST-FIX neurosis | Discrimination test inside the directive; two-strikes for papercuts; drain declined-rate is the tripwire |
| Goodhart on metrics | Metrics live in offline insights + runbook only; never in agent-facing prose |
| Expander doesn't inherit posture instructions for phases 2..N | Verify where per-phase instruction text is sourced (template vs doctrine block); patch both if split |

### Open Questions

_None blocking. Fingerprint tuning is post-ship (workshop Q2, non-blocking)._

### Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| Telemetry for flow improvement | Data Model / Integration | ✅ Complete (001) | resolved D1–D6 |

### Clarifications

#### Session 2026-07-09

- Q: Workflow mode? → A: **Simple** (user override of Full recommendation).
- Q: Testing strategy? → A: **Hybrid** (TDD CLI / lightweight prose / eval scenario).
- Q: Mock usage? → A: **Real fixtures only**.
- Q: Documentation? → A: **docs/how/ only**.
- Q (workshop D1): disposition placement? → A: **first-class field, schema 1.2**.
- Q (workshop Q3): `observe_kind` now? → A: **now**.
- Pre-plan (grill session): full decision record captured in `original-ask.md`; mid-flow additions: T+3wk re-entry affordance; token-inefficiency logging during dogfood (observations SUGG-001/002 in buffer).

## Planning Seam

_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: none — all resolved.

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | y | informs Key Findings (F-01…F-13) |
| workshops/001-telemetry-for-flow-improvement.md | y | authoritative: D1–D6 contracts baked into tasks |

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | no unresolved markers; grill + workshop resolved all decisions |
| G2 | Constitution | PASS | P12 honoured by construction (closed vocab, no free text); P2 hexagonal respected (services only); P3 real fixtures |
| G3 | Architecture | PASS | changes confined to services + extensions + skill prose; no new ports; output contract untouched |
| G4 | ADR Compliance | N/A | no `docs/adr/` in repo |
| G5 | Structure | PASS | all required sections present |
| G6 | Testing Alignment | PASS | TDD tasks precede impl on CLI cluster; prose tasks carry validation steps; eval scenario present |
| G7 | Domain Completeness | PASS | no registry; informal manifest covers every file in the task table |

### Summary

Land the CLI contracts first (schema 1.2 + fingerprint + telemetry vocab + extractor + generators, all TDD), then the skill prose (directive layers, narrowed rule, drain rewrite, purge), then the proof layer (flow-eval scenario, tripwire runbook, field-reference update). Everything additive; suite + parity guard green throughout; deploy CLI before skills.

### Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `skills/eng-harness-flow/references/retro.schema.json` | eng-harness-flow | contract | schema 1.1→1.2: optional `fp`, `disposition` |
| `harness/cli/src/services/record/core-types/retro.ts` | cli-record | contract | RETRO_TEMPLATE echo + stale-path comment fix |
| `harness/cli/test/**/retro-template.test.ts` | cli-record | internal | pinning test updated with trio |
| `harness/cli/src/services/observe/buffer-codec.ts` | cli-observe | contract | `fp` field in ObservationEntry |
| `harness/cli/src/services/observe/observe-service.ts` | cli-observe | internal | fingerprint computation at capture |
| `harness/cli/src/services/telemetry/events.ts` | cli-telemetry | contract | `observe_kind`, `retro` ArtifactType, disp_*/kind_* count keys |
| `harness/cli/src/services/telemetry/segment.schema.json` | cli-telemetry | contract | schema mirror of events additions |
| `harness/cli/src/services/telemetry/segment.ts` | cli-telemetry | internal | serializer per-field pick must carry `observe_kind` (V-01) |
| `harness/cli/src/services/telemetry/otlp/{logs.ts,semconv.ts}` | cli-telemetry | internal | OTLP emit + parse for `observe_kind` (V-01) |
| `harness/cli/src/services/telemetry/{capture-service.ts,session-export.ts}` | cli-telemetry | internal | populate `observe_kind` at harness-event construction (V-01) |
| `harness/cli/src/services/telemetry/artifact-semantics.ts` | cli-telemetry | internal | retro-record extractor |
| `harness/cli/src/services/telemetry/insights.ts` (+ generators) | cli-telemetry | internal | `observe_conversion`, `disposition_mix` |
| `skills/builder/SKILL.md` | builder | contract | canonical invariant + #9 narrowing |
| `skills/builder/references/flight-plan.template.json` | builder | contract | posture instructions on phase/observe nodes |
| `skills/builder/references/{00-routing.md, harness-seams.md, coach.md, getting-started.md, flight-plan.example.json}` | builder | internal | narrowed rule, § Why echo, letter-code purge, drain narration |
| `skills/builder/references/stages/{60-implement.md, 50-phase-tasks.md}` | builder | internal | posture lines (observe + fallback) |
| `skills/eng-harness-flow/{SKILL.md, references/coach.md, references/stages/retro.md}` | eng-harness-flow | contract | mirror copy, coach posture, drain rewrite |
| `.harness/extensions/flow-eval/{fixtures/*, scenario/assertion additions}` | flow-eval | internal | planted-friction scenario |
| `docs/how/telemetry-field-reference.html` | docs | internal | new vocab documented |
| `docs/plans/056-dont-apologise-fix/tripwire-review.md` | docs | internal | T+3wk runbook |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | Doctrine-parity guard is code; mirrored block names `observe` (dossier F-03) | Both copies, one commit; verify guard coverage before wording placement |
| 02 | Critical | Pinning test covers only top-level keys + a hard 1.1 lockstep — entry-level `fp`/`disposition` invisible to it (validation V-03 corrected F-08's stronger claim) | T001 extends the test to entry level + bumps lockstep, all in one commit |
| 03 | High | Telemetry vocab closed by construction, schema-mirrored (F-09) | Additions in events.ts + segment.schema.json as a pair (T004) |
| 04 | High | Per-turn channel already exists — orient prints instructions[] (F-02) | Layer 2 is text-only; AC-02 verifies end-to-end |
| 05 | High | Per-phase instruction sourcing for phases 2..N may live in the doctrine block, not the template (risk row 5) | T008 verifies + patches both sources |
| 06 | Medium | `system.compound.status` stays as long-horizon lifecycle; disposition is drain-time (workshop D1) | Template comment documents the distinction |
| 07 | Medium | FlowEvent × TurnEvent already give per-stage token attribution (workshop baseline) | Runbook cites it; next (efficiency) plan consumes it |

### Implementation

**Objective**: Land the measurable environment-first posture in one dependency-ordered pass: CLI contracts → skill prose → proof layer.
**Testing Approach**: Hybrid (TDD on CLI; lightweight + parity/skills-check on prose; flow-eval scenario as behavioural proof).

#### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | T001 | Retro schema 1.2 trio: add optional `fp` + `disposition` (8-value enum) to schema, RETRO_TEMPLATE, pinning test; fix stale `eng-harness-loop` path comment. **Extend the pinning test to entry level** — it currently sees only column-0 top-level keys + a hard `1.1` version lockstep, so `fp`/`disposition` would be invisible to it: add assertions that the template entry declares both fields, `$defs` entry properties declare both, the enum has exactly 8 values, and update the lockstep to `1.2` in the same commit | eng-harness-flow / cli-record | `skills/eng-harness-flow/references/retro.schema.json` · `record/core-types/retro.ts` · `harness/cli/test/services/record/retro-template.test.ts` | Entry-level pinning assertions green; 1.1 records still validate (fields optional); template documents disposition vs compound.status | TDD; one commit; validation V-03 |
| [ ] | T002 | Fingerprint at capture: `fp = sha256(kind\|target?\|norm(desc))[0:12]` in ObservationEntry + observe-service; norm = lowercase, strip punct, first 8 tokens ≥3 chars | cli-observe | `observe/buffer-codec.ts` · `observe/observe-service.ts` | New captures carry fp; codec round-trips; tests green | TDD; workshop D3 |
| [ ] | T003 | Telemetry vocab: `HarnessEvent.observe_kind?` (closed 8-kind enum, verb=observe only); `ArtifactType += 'retro'`; `ARTIFACT_COUNT_KEYS += observations, disp_*(8), kind_*(8)`; mirror in segment.schema.json; **carry the field through the full wire path** — serializer pick (`segment.ts` harness case), OTLP emit+parse (`otlp/logs.ts`, `otlp/semconv.ts`), and populate at the harness-event construction sites (`capture-service.ts`, `session-export.ts`, source adapters) | cli-telemetry | `telemetry/events.ts` · `telemetry/segment.schema.json` · `telemetry/segment.ts` · `telemetry/otlp/{logs.ts,semconv.ts}` · `telemetry/capture-service.ts` · `telemetry/session-export.ts` | Serialize round-trip test proves `observe_kind` survives segment AND otlp lanes; **negative snapshot test: telemetry key set excludes `fp` and any reason/prose field (workshop D5 guard)**; additionalProperties:false retained | TDD; workshop D4+D5; validation V-01/V-05 |
| [ ] | T004 | Retro-record artifact extractor: counts observations/dispositions/kinds from `.harness/records/retro/**.md` in the capture window | cli-telemetry | `telemetry/artifact-semantics.ts` | Extractor counts sum against a real fixture record; no free text emitted | TDD; AC-05 |
| [ ] | T005 | Insight generators `observe_conversion` (observe events ÷ non-zero command_exit + api_error) and `disposition_mix` | cli-telemetry | `telemetry/insights.ts` + generator files | Both emit over an existing cohort fixture; zero LLM | TDD; workshop D6 |
| [ ] | T006 | Canonical directive: new builder invariant — don't apologise—fix; us = agents+humans; inheritance discrimination test (own-mistake silent / hard-wall+proof-gap immediate / papercut two-strikes); names `/eng-harness-flow` + `harness observe`; pay-it-forward | builder | `skills/builder/SKILL.md` | Invariant present; ≤ 1 paragraph; other layers cite it | AC-01 |
| [ ] | T007 | Narrow harness-blind → orchestration-blind in all four statements (+ mirror copy), observe permitted with execution-log fallback for direct-jump | builder / eng-harness-flow | `SKILL.md#9` · `00-routing.md § Harness router posture` · `harness-seams.md` inversion ¶ · `eng-harness-flow/SKILL.md` | Wording consistent; parity guard green | AC-03; finding 01 |
| [ ] | T008 | Template posture instructions: one line on `phase-1` + `observe-1` instructions[] ("Environment friction is work, not an apology: fix small things, otherwise `harness observe` it — is this environment working for us?"). **Resolve the phases-2..N carrier explicitly**: no CLI expander exists (the engine authors `apply` ops from the doctrine block, which carries chore shape but NO `instructions[]` prose) — decide and implement the deterministic carrier (recommend: 00-routing expander step states "clone instruction text from the template's phase-1/observe-1 nodes"; if any text must land inside the doctrine-parity block, edit both copies in one commit) | builder | `flight-plan.template.json` · `00-routing.md` expander step (+ doctrine block both copies if needed) | Multi-phase fixture: expander-created `observe-2` carries the posture line, verified via `orient` (AC-02) | finding 05; validation V-02 |
| [ ] | T009 | Sub-skill posture lines: `60-implement` (friction → observe or execution-log fallback, keep moving) + `50-phase-tasks` (brief carries the posture); harness-tolerant wording | builder | `stages/60-implement.md` · `stages/50-phase-tasks.md` | One line each, cites invariant; skills-check green | AC-01 |
| [ ] | T010 | harness-seams § Why echo: pay-difficulties-forward paragraph citing the invariant | builder | `references/harness-seams.md` | Outside parity block, or both copies if inside | AC-01 |
| [ ] | T011 | Letter-code purge: rewrite the 4 leak sites in human terms ("the harness will offer a few environment improvements it noticed") | builder | `coach.md:291` · `harness-seams.md:104` · `getting-started.md:182` · `flight-plan.example.json:100` | `grep -rn "s/t/p/e/d/a" skills/builder/` empty | AC-07 |
| [ ] | T012 | Drain rewrite: retro.md § Step 2 → recommendation-led numbered paragraphs (lead line; per-item what/fix/who-benefits; judgement "highest value because…"; single closing sentence with default + escape); record disposition for EVERY presented entry incl. declined/deferred; offer do-it-now (small/reversible) → flight-plan excursion node (intent+outcome via CLI); update coach.md posture line | eng-harness-flow | `references/stages/retro.md` · `references/coach.md` | Format matches AC-08; disposition write path documented; supersedes 044 two-menu format | AC-04, AC-08 |
| [ ] | T013 | Builder-side drain narration + excursion-fix guidance: awaiting-6 script + harness-seams seam presentation reference the new conversational drain; document the mid-flow fix excursion pattern (insert-node --branch-of, intent + outcome notes) | builder | `references/coach.md` · `references/harness-seams.md` | Narration lifts the new format; excursion pattern stated once | AC-08 |
| [ ] | T014 | flow-eval planted-friction scenario: fixture repo with a planted misleading error; assertions score (a) friction→observe/fix within phase, (b) drain format + dispositions recorded. **The scenario's expected drain includes at least one `declined` and one `deferred` outcome, asserted present in the retro record** — the declined-trace branch is the headline promise and must be behaviourally exercised, not just documented | flow-eval | `.harness/extensions/flow-eval/fixtures/*` + scenario | Scenario runs green; both markers scored; declined/deferred entries present in the produced record (verifies AC-04's declined clause) | AC-04, AC-09; validation V-04 |
| [ ] | T015 | Tripwire-review runbook + flight-plan affordance: `tripwire-review.md` with TW-1/TW-2/TW-3 (enumerated with thresholds in AC-10), exact commands (insights + record queries + per-stage FlowEvent×TurnEvent baseline); run every query today — real baselines where data exists, execute-only validation for disposition queries (zero at T0 by definition); add persistent `tripwire-review` excursion node off `ship` (status assumed) | docs / builder-flow | `docs/plans/056-dont-apologise-fix/tripwire-review.md` · this plan's `the-flow.json` | All queries execute; TW-1/TW-3 baselines recorded; node visible in the-flow.md | AC-10; validation V-06/V-07 |
| [ ] | T016 | Update telemetry field reference with new vocab (observe_kind, retro artifact type, disp_*/kind_* keys) | docs | `docs/how/telemetry-field-reference.html` | New fields documented with the same per-kind format | AC-05 |
| [ ] | T017 | Full verification sweep: `just fft`, parity guard, skills-check, AC-02 end-to-end (fresh flow → orient, **plus multi-phase expander fixture → observe-2**), AC-03 four-site grep (orchestration-blind + observe-permitted wording), AC-07 grep, token-budget diff count (AC-11) | all | — | All green; AC checklist annotated in execution log | AC-11 |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | T006, T008, T009, T010 | T017 sweep |
| AC-02 | T008 | T017 (fresh create + orient) |
| AC-03 | T007 | parity guard (T017) |
| AC-04 | T001, T002, T012, T014 | T001/T002 tests + T014 scenario (declined/deferred entries behaviourally exercised) |
| AC-05 | T003, T004, T016 | T003/T004 tests |
| AC-06 | T005 | T005 tests over cohort fixture |
| AC-07 | T011 | T017 grep |
| AC-08 | T012, T013 | review + flow-eval scenario |
| AC-09 | T014 | scenario run |
| AC-10 | T015 | runbook baseline run today |
| AC-11 | T006–T013 restraint | T017 diff count |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Parity guard one-sided edit | Medium | High (suite red) | T007 reads guard coverage first; single commit |
| Expander instruction sourcing split | Medium | Medium | T008 explicitly verifies before editing |
| Prose bloat breaches AC-11 | Medium | Medium | One canonical statement; every other layer a cited one-liner; T017 counts |
| Eval scenario flaky against live subjects | Low | Medium | Fixture-pinned friction; judged fields for prose quality |
