# Harnessability Assessment v0.2 — survey the existing engineering environment

**Mode**: Simple
**Status**: Specifying
**Plan**: docs/plans/009-harnessability-survey/
**Spec**: harnessability-survey-spec.md

📚 Specification incorporates findings from `research-dossier.md` (CF-01…CF-05, PL-01…PL-08, D1–D7).

## Research Context

The current `harnessability-assessment` skill (1041-line `SKILL.md`, 6 templates, a Draft-2020-12 JSON schema with top-level `additionalProperties:false` + 21 required keys, A–E grades, A1–A10/B1–B10 axes, an optional 6-subagent fan-out) scores how harnessable a repo is. Two sanitized handoff docs (`scratch/paste/20260608T234721.md`, `…234735.md`) ask to evolve it to **v0.2**: make it survey the *existing engineering environment* (flows, command surfaces, pre-commit gates, CI/local parity, tests/fakes/sinks, dependency pressure, code-composition seams, canonical-vs-diffuse harnesses, manual/IDE-only signals) **before** recommending any harness verbs, move its output to `.harness/reports/harnessability/`, add an A–F assessment matrix and a terminal-sized summary, and make "prefer deterministic encoding over context-file accretion" an explicit rule. Crucially, the consumer side (plan 008's `engineering-harness-setup` + `skills/README.md`) **already** points at `.harness/reports/harnessability/latest.json`, while the producer wrote the old `harness/assessment/` at spec time — so the path move **repairs a live mismatch**. _(Resolved during implementation — T004 migrated the producer; the mismatch no longer exists as of commit b3ab547.)_

## Summary

**WHAT**: Rework the `harnessability-assessment` skill package to v0.2 — additive new report sections + optional schema arrays that survey the existing engineering environment, an A–F assessment matrix layered over the existing two axes, a terminal-sized `summary.md`, and a migrated, sentinel-preserving output path.

**WHY**: Today the skill under-weights the engineering system a repo *already has* (scripts, CI, pre-commit, SDD flows, fakes/sinks, diffuse harnesses) and over-weights context files. v0.2 makes the report a factual survey that a later extension-authoring step can use to pick which verbs to encode first — and fixes the producer/consumer path mismatch so plan 008's setup flow can actually read it.

## Goals

- Survey **existing engineering flows + command surfaces first**, then identify candidate (not implemented) harness verbs.
- Make **"prefer deterministic encoding over context-file accretion"** an explicit, load-bearing rule; never treat `AGENTS.md`/`CLAUDE.md`/`.cursor/rules` as deterministic proof.
- Migrate output to `.harness/reports/harnessability/<ordinal>-<slug>/` with stable root `latest.*`/`schema.json`, **preserving the `latest.json` sentinel** the 008 consumer reads (detection **and** readability).
- Add an **A–F** assessment matrix that *augments* (never replaces) the A1–A10/B1–B10 axes; keep the two-axis tuple visible.
- Emit a **terminal-sized `summary.md`**; keep detailed evidence in `report.md`.
- Add a **manual / IDE-only operation** scan as advisory signals that influence existing dimensions, without over-penalising desktop/mobile/brownfield.
- Keep all v0.1 invariants intact (assessment-only, proposal-only affordances, no generic `backpressure` command, boundary sentence, schema-authoritative, no private-source contamination).

## Non-Goals

- Not implementing any harness verbs (`build`/`test`/`pre-commit`/`boot`/etc.) — the report only **identifies candidates**.
- Not turning the skill into setup v2, an extension generator, a default command-runner, a giant onboarding doc, or a productivity/compliance score.
- Not building a `harness init` / `harness boot` act (that lives in the CLI / a future effort).
- Not changing the `harnessability-assessment` ↔ `add-extension` ↔ runtime-loop responsibility split.
- Not running the assessment against a real repo as part of this work (the deliverable is the skill package + sanitized examples).

## Target Domains

> This repo has **no formal `docs/domains/` registry**; it organizes by `skills/`. The unit of change here is one skill package.

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| `harnessability-assessment` (skill package) | existing | **modify** | The whole rework lands here: `SKILL.md`, `README.md`, `AUTHORING.md`, `templates/*`. |
| `engineering-harness-setup` (skill package) | existing | **consume / reconcile** | Consumer of the report path; verify its `latest.json` sentinel still resolves; reconcile any flat-`latest.json` wording. No behavioral change. |
| `skills/README.md` (catalog) | existing | **modify** | Catalog rows already on the new path; align wording to v0.2 capabilities. |
| `.harness/extensions/` (this repo's own harness) | **NEW (empty today)** | **create** | Phase G5 dogfood: author the `validate-harnessability` verb here — this repo's first/exemplar extension. |
| `agents/validate-harnessability-assessment-skill` (minih agent) | **NEW** | **create** | Phase G5: the per-repo worker the verb fires; runs the assessment skill against a clone and self-verifies. |

No NEW formal `docs/domains/` domains. The two **NEW** entries above are new *artifacts* (an extension file + a minih agent folder), not registry domains.

## Testing Strategy

- **Approach**: Lightweight — **structural validation**, run inline during implementation (user chose ad-hoc; no new `just` target).
- **Rationale**: The skill package has no executable logic; correctness = valid schema + valid example + intact invariants.
- **Focus Areas**:
  - `just list-skills` discovers the skill.
  - `templates/assessment-report.schema.json` parses as Draft 2020-12 (`python -m jsonschema` / `ajv`).
  - `templates/assessment-latest.json` **validates against** the updated schema (jsonschema 4.26 and/or ajv — both available).
  - Placeholder lint: templates may carry `{{UPPER_SNAKE}}`; filled example files carry **no** unresolved placeholders (PL-04 — template-lint ≠ output-lint).
  - Canonical boundary sentence byte-identical vs `templates/canonical-boundary.txt`.
  - Private-source/source-ID leak grep on shipped surfaces; no generic `backpressure` command key; no `supersede`/`successor`/`legacy` framing.
- **Excluded**: unit/integration/e2e test code (nothing to execute); no agent-harness Boot→Interact→Observe (no running software).
- **Mock Usage**: A — avoid mocks; the `sample-service` example fixture is the real validation input.

## Documentation Strategy

- **Location**: D — no new top-level repo docs; documentation lives in the **skill package's own surfaces** (`SKILL.md`, `README.md`, `AUTHORING.md`) plus the `skills/README.md` catalog row.
- **Rationale**: The skill *is* the documentation; new repo docs would duplicate it (PL-06 — keep guidance file-backed and concise).

## Complexity

- **Score**: CS-4 (large)
- **Breakdown**: S=2 (≈10 skill files + an extension + a minih agent), I=2 (cross-skill report contract **and** a verb↔minih↔skill integration), D=2 (schema migration: additive-optional + enum change + version bump), N=1 (detailed handoff to apply), F=1 (publication-boundary + schema-validity constraints), T=1 (structural validation, example must validate, sentinel preserved). Total **9 → CS-4**.
- **Confidence**: 0.78
- **Mode note**: CS-4 would typically suggest Full; the user chose **Simple** for lighter ceremony. The plan should sequence the work as ordered task-groups **G1→G5** within a single phase (see below); the architect may still apply its inline gates.
- **Assumptions**: handoff record-shapes are authoritative for the new arrays; no other consumers of `harness/assessment/` exist (verified — only descriptive plan-doc mentions); jsonschema/ajv available (verified).
- **Dependencies**: plan 008's `engineering-harness-setup` sentinel; `templates/canonical-boundary.txt`.
- **Risks**: see Risks & Assumptions.
- **Phases (as Simple task-groups)**:
  - **G1 — Schema + output-path/sentinel migration** (the risky core): bump to `…v0.2`; add new optional top-level keys under `additionalProperties:false`; extend grades A→F + shift bands; migrate output contract to `.harness/reports/harnessability/<ordinal>-<slug>/` + root `latest.*`/`schema.json`; remove old-path references; preserve `latest.json` sentinel (detection + readability).
  - **G2 — New survey sections + scans** in `SKILL.md` + `templates/assessment-report.md`: engineering-flow recon (incl. SDD-like), pre-commit/local-gate inventory, CI/local equivalence, deterministic-encoding opportunities, test mechanisms (mock vs fake/sink), external-dependency pressure, code-composition/seams, canonical-vs-diffuse harness detection, candidate-first-harness-surfaces, manual/IDE-only signals; reorder execution flow (flows/commands **before** recommendations).
  - **G3 — A–F matrix + scoring + fan-out re-map**: `assessment_matrix[]` + `final_grade` augmenting the axes; update JSON-min-shape enums; update fan-out subagent→schema-slice ownership in lockstep with the schema (AUTHORING #9).
  - **G4 — Templates, examples, docs, validation**: new `summary.md` (+ optional `evidence-log.jsonl`); regenerate `assessment-latest.{md,json}` (sample-service, A–F, validates); update `README.md` + `AUTHORING.md` (new invariants + checklist); align `skills/README.md`; reconcile 008 wording; run the full structural-validation sweep.
  - **G5 — Dogfood self-test verb** (validates v0.1 on real repos → evidence for the rework): author the `validate-harnessability` harness extension (in this repo's own `.harness/extensions/`) **and** the `validate-harnessability-assessment-skill` minih agent, per [workshop 001](workshops/001-validate-harnessability-verb.md). The verb clones 3 small cross-language repos to `/tmp`, fires one background minih agent per repo (parallel, fire-and-forget), and returns instantly with the run IDs + `next_action` prompting (how to poll + what to validate). **Sequencing note for `/plan-3`**: G5 works against the *current (v0.1)* skill, so it can run **early** to gather real magic-wand/difficulty evidence that informs G1–G4. This is the dogfood/exemplar — it makes this repo eat its own harness.

## Acceptance Criteria

1. **Output path migrated**: a run writes `.harness/reports/harnessability/<ordinal>-<slug>/{report.md,report.json,summary.md,evidence.jsonl}`; ordinal = next free by scanning existing report dirs. All `harness/assessment/` references in shipped surfaces are removed/updated.
2. **Sentinel preserved (detection + readability)**: every run overwrites root `.harness/reports/harnessability/{latest.md,latest.json,schema.json}` to mirror the newest run, so 008's `test -f .harness/reports/harnessability/latest.json` resolves **and** `latest.json` is a stable, ordinal-independent file the consumer can read for recommendations. Any 008-side wording assuming a flat-only `latest.json` is reconciled.
3. **Schema v0.2, additive-optional**: `schema_version` literal is `harnessability-assessment.v0.2`; new top-level keys (`report_paths`, `assessment_matrix`, `engineering_flows`, `pre_commit_gates`, `ci_local_equivalence`, `existing_harness_concepts`, `deterministic_encoding_opportunities`, `test_mechanisms`, `external_dependency_pressure`, `code_composition`, `candidate_first_harness_surfaces`, `manual_operation_signals`) are present in `properties`, **not** in `required`; top-level `additionalProperties:false` is preserved.
4. **A–F grades**: grade enums include `F` everywhere they appear (schema `verdict.*_grade`, the JSON-minimum-shape block, the scoring section, the matrix); band thresholds are A 85–100, B 70–84, C 55–69, D 40–54, E 25–39, F 0–24.
5. **Matrix augments, never replaces**: A1–A10/B1–B10 dimensions remain; the two-axis Operate-Today/Adaptability tuple stays visible; `assessment_matrix[]` + `final_grade` are layered on; `final_grade` must not hide a poor axis score.
6. **New survey sections present** in `SKILL.md` and `templates/assessment-report.md`: engineering-flow recon (incl. SDD-like detection), pre-commit/local-gate inventory, CI/local equivalence, deterministic-encoding opportunities, test mechanisms (mock vs fake/sink/stub/contract/testcontainer), external-dependency pressure, code-composition/seams, canonical-vs-diffuse harness detection, candidate-first-harness-surfaces, manual/IDE-only signals.
7. **Terminal-sized summary**: `templates/summary.md` exists and the filled example summary fits comfortably on one screen; detailed evidence stays in `report.md`.
8. **Existing-flow-first ordering**: the execution flow inspects existing engineering flows + command surfaces **before** proposing any candidate harness surfaces; the fan-out subagent→schema-slice ownership map is updated to own every new array and stays collectively exhaustive (AUTHORING #9, in lockstep with the schema).
9. **Deterministic-encoding rule**: the skill states "prefer deterministic encoding over context-file accretion," never claims a context file is deterministic proof, and distinguishes mocks from fakes/sinks.
10. **Manual/IDE scan is advisory**: `manual_operation_signals[]` is optional, influences A4/A5/A7/A8/A9/B5/B10 only, and explicitly does not over-penalise desktop/mobile/hardware/brownfield topologies.
11. **Invariants intact**: canonical boundary sentence byte-identical; no generic `backpressure` command key; product-code affordances proposal-only; no `supersede`/`successor`/`legacy` framing; sanitized examples use `sample-service`; no private-source/source-ID contamination on shipped surfaces.
12. **Validation passes**: `just list-skills` discovers the skill; the schema parses as Draft 2020-12; `assessment-latest.json` validates against the updated schema; template placeholders well-formed; example reports have no unresolved placeholders; boundary + leak greps pass.
13. **Dogfood verb authored & loadable** (G5): `.harness/extensions/validate-harnessability.ts` exists (authored via the `add-extension` skill); `harness doctor` shows it `loaded`; `harness help` lists `validate-harnessability`. The `validate-harnessability-assessment-skill` minih agent folder exists with `agent.json`/`prompt.md`/`input-schema.json`/`output-schema.json`/`instructions.md` and is discoverable.
14. **Dogfood verb behaves per workshop 001** (G5): running `harness validate-harnessability` clones the 3 default repos to a temp dir, fires one **background, fire-and-forget** minih agent per repo (they keep running after the verb returns), and returns within seconds an Envelope whose `data.runs[]` carries the run IDs/run dirs/log paths and whose `next_action` contains the `minih status/tail/last-run` poll commands **and** the per-report validation checklist. A bad URL / missing `minih` degrades (never crashes), carrying a `next_action`. `--keep` preserves the temp env.
15. **Default targets are small, public, cross-language** (G5): the verb's baked-in defaults are `chalk/chalk` (JS), `BurntSushi/byteorder` (Rust), `spf13/pflag` (Go), cloned `--depth=1`; the list is overridable via a repeatable `--repo <url>` option.

## Risks & Assumptions

- **R1 — Example breaks schema** (CF-02). Adding/altering schema keys can invalidate `assessment-latest.json`. *Mitigation*: keep new keys optional; validate the example against the schema as the last G4 step before considering done.
- **R2 — Sentinel/readability regression** (CF-01). A run-dir-only output would false-positive 008's detection while leaving nothing stable to read. *Mitigation*: AC-2 mandates root `latest.*` every run.
- **R3 — A–F threshold shift changes example grades** (CF-03). Band boundaries move (C/D/E). *Mitigation*: recompute the `sample-service` example bands against the new thresholds; keep it obviously synthetic (PL-05).
- **R4 — Scope creep erodes assessment-only identity** (CF-05). *Mitigation*: Non-Goals are load-bearing; affordances stay proposal-only; no `backpressure` command; guidance stays file-backed (PL-06).
- **R5 — Schema/fan-out drift** (CF-04). *Mitigation*: change schema and the ownership map in the same task-group (G3); AUTHORING #9 stays in lockstep.
- **R6 — Publication boundary**. Handoff/dossier reference private scratch IDs. *Mitigation*: shipped surfaces use neutral language + `sample-service`; run the leak grep (AC-12).
- **R7 — G5 scope/runtime risk**. The dogfood verb adds an extension + a minih agent + background-process orchestration (network clones, fire-and-forget). *Mitigation*: keep it **simple** per workshop 001 (verb only *prompts*, it doesn't review); defaults are small/public/stable repos; network is needed only for the clone step; the verb degrades (never crashes) on clone/minih failure. G5 is self-contained — it can be deferred without blocking G1–G4.
- **R8 — Background-firing fragility** (G5). `ctx.exec` blocks and `node:*` imports are discouraged, so backgrounding goes through `bash -c 'nohup … &'`; run-ID capture uses **launch-time bookkeeping** (fire one run, immediately resolve its dir via `minih last-run`, record before firing the next — `run.json` does **not** persist input params). *Mitigation*: workshop 001 pins both mechanisms; a capture timeout degrades to `runId: null` + the per-repo `run.log` / `minih history`.
- **Assumption**: the handoff's JSON record-shapes are authoritative and need only light adaptation to fit the existing schema `$defs` style (nested records keep `additionalProperties:true`, except value-bearing records like `environmentVariable`).
- **Assumption (G5)**: `chalk/chalk`, `BurntSushi/byteorder`, `spf13/pflag` are public and cloneable by whoever runs the verb; a sparse/manual-IDE repo is best supplied as a `--repo` override for edge-case testing (the defaults are all well-instrumented).

## Open Questions

> Most D1–D7 are resolved with recommended answers in the dossier and applied above. Remaining truly-open items (low-risk, recommend defaults — confirm during `/plan-3` or implementation):

- **OQ1 — `summary.md` grade format**: plain A–F vs `+/-` modifiers (handoff shows "Overall: C+"). *Recommend*: plain A–F (no modifier sprawl) for v0.2.
- **OQ2 — Required-vs-optional promotion**: should any always-emitted new array (e.g. `engineering_flows`, `assessment_matrix`) be promoted to `required` in v0.2? *Recommend*: keep **all** v0.2 additions optional (PL-03) to avoid breaking partial/legacy reports; revisit in a later version.
- **OQ3 — Output-path cutover**: keep a deprecation shim writing old `harness/assessment/` for one release, or hard-switch? *Recommend*: **hard-switch** — no other consumers exist and it repairs the mismatch.
- **OQ4 — `code_composition` key shape**: first-class top-level array vs nested under `harness_recommendations`/`backpressure_surfaces`. *Recommend*: first-class optional array for downstream clarity (handoff's preference).

## Dogfood Self-Test Verb (Phase G5)

> Authoritative design: **[workshops/001-validate-harnessability-verb.md](workshops/001-validate-harnessability-verb.md)** (Contract Ready). This section summarizes; the workshop governs.

This repo *builds and installs* the harness but ships **zero extensions** and no canonical exemplar. G5 closes that by authoring this repo's **first/exemplar extension** — a self-test that validates the very skill this plan reworks, using minih:

- **`harness validate-harnessability`** (the verb, in `.harness/extensions/validate-harnessability.ts`) — orchestrator. Custom composite handler (not `--wrap`). Steps: make `/tmp/harnessability-selftest-<ts>/` → `git clone --depth=1` the 3 default repos (blocking, fast) → for each clone, fire one **background, fire-and-forget** minih agent (`bash -c 'nohup minih run … & echo $!'`, so they survive the verb exit) and **immediately resolve its run dir via `minih last-run`** before firing the next (launch-time bookkeeping — `run.json` does not record params) → **return immediately** with `data.runs[]` (runId/runDir/logPath/pid) and a `next_action` that is a runnable prose script (poll with `minih status/tail/last-run`; when complete read `output/report.json` and validate verdict + schema-validity + spot-checked claims; then fold magic-wands into v0.2). Options: `--repo <url>` (repeatable, overrides defaults), `--keep`, `--model`.
- **`validate-harnessability-assessment-skill`** (the minih agent, in `agents/…`) — per-repo worker. Same folder shape as `agents/install-and-validate-test-extension/`. Param `targetRepo`. Permissions: read-only + shell/write allow, `allowedRoots` extend to temp dirs, **network off**. It invokes the `harnessability-assessment` skill against the clone, **independently verifies** the outputs (don't trust the self-report), emits a PASS/FAIL verdict + dual-layer magic-wand retro (skill vs minih).
- **Defaults (small, public, cross-language)**: `chalk/chalk` (JS), `BurntSushi/byteorder` (Rust), `spf13/pflag` (Go). A sparse/manual-IDE repo is a good `--repo` override for edge-case testing.
- **Why a phase here**: G5 exercises the *current (v0.1)* skill on real repos, so it produces the magic-wand/difficulty evidence that sharpens G1–G4. `/plan-3` may sequence it **first** (evidence-gathering) or alongside G4. It is self-contained and can be deferred without blocking the rework.

## Workshop Opportunities

| Topic | Type | Status | Why Workshop | Key Questions |
|-------|------|--------|--------------|---------------|
| `validate-harnessability` dogfood verb (G5) | Integration Pattern | ✅ **Complete & authoritative** — [workshops/001](workshops/001-validate-harnessability-verb.md) | Pin the verb↔minih↔skill contract, background-firing, run-ID capture. | (resolved) verb name; backgrounding via `nohup &`; run-ID via runs-dir diff; clone-from-github; fire-and-forget. **Open: Q1 clone URLs → resolved to the 3 defaults above.** |
| v0.2 schema field shapes (the ~12 new arrays) | Data Model | Optional | Nail required-vs-optional, enum vocabularies, and `$defs` placement before editing the schema — though the handoff already specifies record shapes in detail. | Which arrays (if any) are `required`? Do new enums (`type`, `kind`, `proof_level`) reuse existing vocab? Where do nested `$defs` keep `additionalProperties:true`? |
| A–F bands + matrix↔axes mapping | Other | Optional | The band shift is non-additive and the matrix must not hide a weak axis. | Exact percent cutoffs; how `final_grade` is derived from the matrix while the tuple stays primary; how `sample-service` regrades. |

> The last two are **optional** — the handoff docs + dossier already carry enough detail to proceed straight to `/plan-3`. Reach for a workshop only if the schema field shapes feel underspecified when planning.

## Clarifications

### Session 2026-06-08

- **Q: Workflow Mode?** → **Simple** (user chose lighter ceremony despite CS-4; work sequenced as task-groups G1–G5 in one phase — G5 is the dogfood self-test verb, added 2026-06-09).
- **Q: Validation approach?** → **Ad-hoc structural validation**, inline during implementation; **no** new `just validate-harnessability` target.
- **Mock Usage** → A (avoid mocks; the `sample-service` example fixture is the validation input). *(pre-filled — determined by a docs/JSON skill having no executable logic)*
- **Documentation Strategy** → D (no new repo docs; the skill package's own surfaces carry the documentation). *(pre-filled)*
- **Agent Harness Readiness** → **Feature doesn't need an agent harness.** This is a docs/JSON skill package with no running software to Boot→Interact→Observe; structural validation is the appropriate feedback loop. *(recorded without asking — Simple mode, self-evident)*
- **Target Domains** → No formal `docs/domains/` registry; the unit of change is the `harnessability-assessment` skill package, with `engineering-harness-setup` + `skills/README.md` as consume/reconcile touch-points. No NEW domains. *(no Round-2 Domain Review needed)*

---

## Validation Record (2026-06-09)

### Validation Thesis

**Raison d'être**: The contract `/plan-3` builds the harnessability-assessment v0.2 rework from — now extended with **Phase G5**, a dogfood self-test verb that validates the very skill being reworked.

**Value claim**: The assessment becomes a factual survey usable by later extension-authoring; the output-path move repairs a live producer/consumer mismatch (plan 008's `latest.json` sentinel); the dogfood verb makes validation reproducible and harvests magic-wand/difficulty evidence that sharpens v0.2.

**Artifact promise**: `/plan-3` can architect from this spec with no re-discovery; the `add-extension` skill + G5 implementer can build the verb from workshop 001 (Contract-Ready).

**Intended beneficiaries**: `/plan-3-v3-architect`; the G5 implementer + `add-extension` skill; plan 008's `engineering-harness-setup` (consumes the report path).

**Proof target**: Contract

**Evidence standard**: testable ACs; workshop technical claims match the real minih CLI + harness verb contract; sentinel/schema constraints precise.

**Thesis source**: `research-dossier.md` (CF-01…CF-05).

**Thesis verdict**: Advanced

**Main thesis risk**: G5 adds an extension + minih agent + background orchestration; kept isolated as a separate dogfood artifact so the assessment-only thesis holds.

---

| Agent | Lenses Covered | Thesis Axes Covered | Issues | Verdict |
|-------|---------------|---------------------|--------|---------|
| val-accuracy (Source-Truth) | Evidence Sufficiency, Technical Constraints, Hidden Assumptions, Edge Cases | Evidence Sufficiency, Proof-Level Fit | 1 HIGH + 1 LOW fixed (run-ID capture via `run.json` impossible — params not persisted) | ⚠️ → ✅ |
| val-thesis (Thesis + Coherence) | Thesis Alignment, Proof-Level Fit, Concept Documentation, Domain Boundaries | Thesis Alignment, User/Product Value | 1 MEDIUM fixed (stale `G1→G4`) | ✅ |
| val-fwdcompat (Forward-Compatibility) | Forward-Compatibility, Integration & Ripple, Contract Integrity | Downstream Usefulness, Contract Integrity | 0 (all consumers PASS) | ✅ |

**Lens coverage**: 11/15 (Thesis Alignment ✓ mandatory; Forward-Compatibility ✓ engaged — downstream `/plan-3` exists).

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| `/plan-3-v3-architect` | Testable ACs, ordered G1–G5, Simple-mode coherence, CS, risks | Shape mismatch | ✅ | `Mode: Simple` + `CS-4` + ordered G1→G5 + ACs/risks (spec §Complexity, §Acceptance Criteria) |
| `add-extension` skill + G5 implementer | Contract-ready verb design (name, params, Envelope, bg mechanism, run-ID capture, agent shape/perms) | Shape mismatch / test boundary | ✅ | workshop 001 pins all (after the launch-time-capture fix) |
| plan 008 `engineering-harness-setup` | `.harness/reports/harnessability/latest.json` stays at root + readable | Contract drift | ✅ | AC-2 preserves root `latest.json` (detection + readability); 008 sentinel `test -f … \|\| ls …/*` |

**Thesis alignment**: Value claim advanced at Contract proof with Strong evidence; main risk (G5 scope) is contained by isolating the dogfood verb from the assessment-only skill.

**Outcome alignment**: "make the report a factual survey a later extension step can use to pick which verbs to encode first — and fixes the producer/consumer path mismatch so plan 008's setup flow can actually read it." Yes; the spec + workshop advance that outcome.

**Standalone?**: No — downstream `/plan-3`, the G5 implementer, and plan 008 all consume this artifact.

Overall: ⚠️ VALIDATED WITH FIXES
