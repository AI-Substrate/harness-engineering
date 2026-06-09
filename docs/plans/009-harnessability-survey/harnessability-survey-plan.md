# Harnessability Assessment v0.2 — Survey the Existing Engineering Environment — Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-09
**Spec**: [harnessability-survey-spec.md](./harnessability-survey-spec.md)
**Status**: READY

## Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No `[NEEDS CLARIFICATION]` markers remain; Clarifications session resolved; OQ1–OQ4 carry recommended defaults applied below. |
| G2 | Constitution | PASS | `docs/project-rules/constitution.md` present. G1–G4 edit a docs/JSON skill package (P2/P3 hexagonal rules govern CLI code, not skill files). G5's extension obeys P2/P4/P5/P8: no `node:*` imports, wraps `git`+`minih` via `ctx.exec`, returns the stable Envelope with `next_action`, degrades (never pretends). No HIGH-impact violation → no Deviation Ledger. |
| G3 | Architecture | PASS | `docs/project-rules/architecture.md` present. Skill files sit outside the CLI hexagon. G5's `.harness/extensions/validate-harnessability.ts` is a runtime extension per architecture §5 (default-exports a `HarnessVerb`, uses injected `VerbContext` ports). The minih agent folder is config, not CLI code. No layer/dependency-rule breach. |
| G4 | ADR Compliance | N/A | No `docs/adr/` directory exists. |
| G5 | Structure | PASS | All required Simple-mode sections present and populated. |
| G6 | Testing Alignment | PASS | Spec strategy = Lightweight (structural validation). Tasks include a dedicated validation sweep (T015) and measurable acceptance criteria. Mock usage A honoured (no mocks; `sample-service` fixture is the real input). |
| G7 | Domain Completeness | PASS | No formal `docs/domains/` registry. All 5 spec Target-Domain rows present below; Domain Manifest covers every file in the task table; the two NEW entries are artifacts (an extension + a minih agent), not registry domains, so no domain-setup task is required. |

## Summary

Rework the `harnessability-assessment` skill package to **v0.2** so it surveys the *existing* engineering environment (flows, command surfaces, pre-commit gates, CI/local parity, test mechanisms, dependency pressure, code-composition seams, canonical-vs-diffuse harnesses, manual/IDE-only signals) **before** proposing any harness verbs. The work bumps the JSON schema to `…v0.2` with ~12 **additive-optional** top-level arrays, layers an **A–F** assessment matrix over the existing A1–A10/B1–B10 axes, adds a terminal-sized `summary.md`, and migrates output to `.harness/reports/harnessability/<ordinal>-<slug>/` while **preserving the root `latest.json` sentinel** — repairing a live producer/consumer mismatch with plan 008. A final task-group (**G5**) dogfoods the repo's own harness: it authors this repo's first `.harness/extensions/` verb (`validate-harnessability`) plus a minih worker agent that runs the *current* skill against three small cross-language repos, harvesting evidence that sharpens the rework. Expected outcome: a factual, reproducible survey a later extension-authoring step can act on, with all v0.1 invariants intact.

## Target Domains

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| `harnessability-assessment` (skill package) | existing | modify | The whole rework lands here: `SKILL.md`, `README.md`, `AUTHORING.md`, `templates/*`. |
| `engineering-harness-setup` (skill package) | existing | consume / reconcile | Consumer of the report path; verify its `latest.json` sentinel still resolves; reconcile any flat-`latest.json` wording. No behavioural change. |
| `skills/README.md` (catalog) | existing | modify | Align catalog wording to v0.2 capabilities (rows already on the new path). |
| `.harness/extensions/` (this repo's own harness) | NEW (empty today) | create | Phase G5 dogfood: author the `validate-harnessability` verb — this repo's first/exemplar extension. |
| `agents/validate-harnessability-assessment-skill` (minih agent) | NEW | create | Phase G5: the per-repo worker the verb fires; runs the assessment skill against a clone and self-verifies. |

> No NEW formal `docs/domains/` domains — this repo has no domain registry and organizes by `skills/`. The two NEW rows are new *artifacts* (an extension file + a minih agent folder), not registry domains.

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `skills/harnessability-assessment/templates/assessment-report.schema.json` | harnessability-assessment | contract | The cross-skill report contract plan 008 consumes; the highest-risk surface. |
| `skills/harnessability-assessment/SKILL.md` | harnessability-assessment | internal | Execution flow, survey sections, deterministic-encoding rule, output-path contract. |
| `skills/harnessability-assessment/templates/assessment-report.md` | harnessability-assessment | internal | The detailed report template that grows the new survey sections. |
| `skills/harnessability-assessment/templates/summary.md` | harnessability-assessment | internal | NEW terminal-sized summary template. |
| `skills/harnessability-assessment/templates/assessment-latest.json` | harnessability-assessment | internal | Example output (sample-service) — must validate against the v0.2 schema. |
| `skills/harnessability-assessment/templates/assessment-latest.md` | harnessability-assessment | internal | Example markdown report — regenerated for A–F + new sections. |
| `skills/harnessability-assessment/templates/evidence-log.jsonl` | harnessability-assessment | internal | NEW optional evidence log template (if adopted in G4). |
| `skills/harnessability-assessment/README.md` | harnessability-assessment | internal | New invariants + capability description. |
| `skills/harnessability-assessment/AUTHORING.md` | harnessability-assessment | internal | Fan-out subagent→schema-slice ownership map (#9), updated in lockstep with the schema. |
| `skills/README.md` | catalog | cross-domain | Catalog row aligned to v0.2. |
| `skills/engineering-harness-setup/SKILL.md` | engineering-harness-setup | cross-domain | Reconcile any flat-only `latest.json` wording; confirm sentinel resolves. |
| `.harness/extensions/validate-harnessability.ts` | .harness/extensions | contract | NEW — the dogfood verb's public surface (verb name, options, Envelope). |
| `agents/validate-harnessability-assessment-skill/{agent.json,prompt.md,input-schema.json,output-schema.json,instructions.md}` | validate-harnessability-assessment-skill | internal | NEW — the per-repo minih worker. |
| `.minih.json` | repo minih config | cross-domain | Ensure the worker can resolve the `harnessability-assessment` skill. |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | **Live producer/consumer path mismatch (CF-01)**: plan 008's `engineering-harness-setup` + `skills/README.md` already point at `.harness/reports/harnessability/latest.json` (sentinel `test -f … \|\| ls …/*`), but the producer still writes the old `harness/assessment/`. | G1 migrates the producer to the new path **and** AC-2 keeps root `latest.{md,json}`/`schema.json` rewritten every run, so 008's detection **and** readability both work. |
| 02 | Critical | **Schema is the highest-risk surface (CF-02)**: Draft 2020-12, top-level `additionalProperties:false`, 21 required keys, grade enum A–E, version literal `…v0.1`. | G1/G3 add ~12 new keys to `properties` **as optional (never `required`)**, bump version to `…v0.2`, extend grade enums to include `F`. The example `assessment-latest.json` must still validate — checked last in G4. |
| 03 | High | **A–F is non-additive (CF-03)**: band thresholds shift (A 85–100, B 70–84, C 55–69, D 40–54, E 25–39, F 0–24); the `sample-service` example may regrade. | G3 adds the matrix; G4 recomputes the example's bands against the new thresholds and keeps the fixture obviously synthetic. |
| 04 | High | **Schema + fan-out must move in lockstep (CF-04)**: the AUTHORING #9 subagent→schema-slice ownership map must own every new array and stay collectively exhaustive. | G3 edits the schema and the ownership map in the same task-group; no array is left unowned. |
| 05 | High | **Assessment-only identity is load-bearing (CF-05)**: no setup, no command-runner, proposal-only affordances, no generic `backpressure` command key, boundary sentence byte-identical. | Non-Goals enforced throughout; G4 validation greps for boundary identity, `backpressure` key, and `supersede`/`successor`/`legacy` framing. |
| 06 | High | **G5 background-firing fragility (R8/PL)**: `ctx.exec` blocks and `node:*` imports are discouraged; `minih run.json` does **not** persist input params, so a run can't be mapped to a repo after the fact. | G5 backgrounds via `bash -c 'nohup minih run … & echo $!'` and uses **launch-time bookkeeping** (fire one run, resolve its dir via `minih last-run`, record before firing the next) per workshop 001; capture timeout degrades to `runId: null` + `run.log`/`minih history`. |

## Implementation

**Objective**: Ship `harnessability-assessment` v0.2 — additive-optional schema arrays + new survey sections + an A–F matrix + a terminal summary + a migrated, sentinel-preserving output path — with all v0.1 invariants intact, plus the G5 dogfood verb that validates the skill on real repos.

**Testing Approach**: **Lightweight — structural validation, inline** (no new `just` target; user chose ad-hoc). Proof = `just list-skills` discovers the skill; `assessment-report.schema.json` parses as Draft 2020-12 (`python -m jsonschema` / `ajv`); `assessment-latest.json` **validates against** the updated schema; template placeholders well-formed and filled examples carry no unresolved placeholders; boundary sentence byte-identical vs `templates/canonical-boundary.txt`; private-source/source-ID leak grep clean; no generic `backpressure` command key; no `supersede`/`successor`/`legacy` framing. **Mock Usage: A** — no mocks; the `sample-service` example fixture is the real validation input. G5's runtime behaviour (clone + background-fire) is verified by `harness doctor`/`help` (load check) and one smoke run where network + `minih` are available; absence of either degrades, not fails.

**Sequencing note**: **G1 → G2 → G3 → G4** is the dependency spine (schema/path first; survey sections map onto the new arrays; the matrix + fan-out re-map ride on both; templates/examples/validation come last because the example must validate against the *final* schema). **G5 is independent** (`Depends on: None`) — it exercises the *current v0.1* skill, so it may be **authored and fired first** (background minih agents run while G1–G4 proceed); fold any magic-wand/difficulty evidence it harvests into the G2/G3 survey sections before G4 finalises the example.

### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T001 | **G1** — Bump schema version literal to `harnessability-assessment.v0.2`. | harnessability-assessment | `skills/harnessability-assessment/templates/assessment-report.schema.json` | `schema_version` const reads `harnessability-assessment.v0.2`; schema still parses as Draft 2020-12. | CF-02 / AC-3 |
| [x] | T002 | **G1** — Add the ~12 new top-level keys to `properties` as **optional** (`report_paths`, `assessment_matrix`, `engineering_flows`, `pre_commit_gates`, `ci_local_equivalence`, `existing_harness_concepts`, `deterministic_encoding_opportunities`, `test_mechanisms`, `external_dependency_pressure`, `code_composition`, `candidate_first_harness_surfaces`, `manual_operation_signals`); keep top-level `additionalProperties:false`; nested `$defs` keep `additionalProperties:true` except value-bearing records. | harnessability-assessment | `…/templates/assessment-report.schema.json` | New keys present in `properties`, **none** added to `required`; `additionalProperties:false` intact; schema parses. | AC-3, OQ2/OQ4 (keep optional; `code_composition` first-class) — CF-02 |
| [x] | T003 | **G1** — Extend grade enums to include `F` everywhere (`verdict.*_grade`, JSON-minimum-shape block, scoring section, matrix); set band thresholds A 85–100 / B 70–84 / C 55–69 / D 40–54 / E 25–39 / F 0–24. | harnessability-assessment | `…/assessment-report.schema.json`, `…/SKILL.md` | Every grade enum/shape includes `F`; bands documented exactly as above. | AC-4 — CF-03 |
| [x] | T004 | **G1** — Migrate the output-path contract in `SKILL.md` to `.harness/reports/harnessability/<ordinal>-<slug>/{report.md,report.json,summary.md,evidence.jsonl}` (ordinal = next free by scanning report dirs); **every run overwrites** root `latest.{md,json}`/`schema.json` to mirror the newest run; remove all `harness/assessment/` references in shipped surfaces. | harnessability-assessment | `…/SKILL.md` | No `harness/assessment/` strings remain in shipped surfaces; root `latest.json` written every run (detection + readability); ordinal scheme documented. | AC-1, AC-2 — CF-01 / R2 |
| [x] | T005 | **G2** — Add the new survey sections to `SKILL.md` + `assessment-report.md`: engineering-flow recon (incl. SDD-like detection), pre-commit/local-gate inventory, CI/local equivalence, deterministic-encoding opportunities, test mechanisms (mock vs fake/sink/stub/contract/testcontainer), external-dependency pressure, code-composition/seams, canonical-vs-diffuse harness detection, candidate-first-harness-surfaces. | harnessability-assessment | `…/SKILL.md`, `…/templates/assessment-report.md` | All listed sections present in both files and mapped to their schema arrays. | AC-6 |
| [x] | T006 | **G2** — Reorder the execution flow so existing engineering flows + command surfaces are inspected **before** any candidate harness surfaces are proposed. | harnessability-assessment | `…/SKILL.md` | Flow text inspects existing flows/commands first; recommendations come after. | AC-8 |
| [x] | T007 | **G2** — Make "prefer deterministic encoding over context-file accretion" an explicit rule: never claim a context file (`AGENTS.md`/`CLAUDE.md`/`.cursor/rules`) is deterministic proof; distinguish mocks from fakes/sinks. | harnessability-assessment | `…/SKILL.md` | Rule stated verbatim-in-spirit; context-files explicitly not deterministic proof; mock vs fake/sink distinction present. | AC-9 |
| [x] | T008 | **G2** — Add the manual / IDE-only operation scan as advisory `manual_operation_signals[]` that influences A4/A5/A7/A8/A9/B5/B10 **only** and explicitly does **not** over-penalise desktop/mobile/hardware/brownfield topologies. | harnessability-assessment | `…/SKILL.md`, `…/assessment-report.md` | Scan documented as advisory; influence list scoped to those dimensions; non-penalisation note present. | AC-10 |
| [x] | T009 | **G3** — Add `assessment_matrix[]` + `final_grade` augmenting (never replacing) the A1–A10/B1–B10 axes; keep the two-axis Operate-Today/Adaptability tuple visible; `final_grade` must not hide a poor axis score. | harnessability-assessment | `…/SKILL.md`, `…/assessment-report.md`, `…/assessment-report.schema.json` | Matrix + `final_grade` present; axes + tuple still visible; rule that `final_grade` can't mask a weak axis is stated. | AC-5 |
| [x] | T010 | **G3** — Update the JSON-minimum-shape block enums for A–F. | harnessability-assessment | `…/SKILL.md` | JSON-min-shape grades include `F`, consistent with the schema. | AC-4 |
| [x] | T011 | **G3** — Update the fan-out subagent→schema-slice ownership map (AUTHORING #9) **in lockstep** with the schema so every new array is owned and the map stays collectively exhaustive. | harnessability-assessment | `…/AUTHORING.md` | Every new array in T002 has an owning subagent; no array unowned; map exhaustive. | AC-8 — CF-04 / R5 |
| [ ] | T012 | **G4** — Create the terminal-sized `templates/summary.md` (and optional `templates/evidence-log.jsonl`); keep detailed evidence in `report.md`. Summary grade format = plain A–F (OQ1). | harnessability-assessment | `…/templates/summary.md`, `…/templates/evidence-log.jsonl` | `summary.md` exists and the filled example fits one screen; detailed evidence stays in `report.md`. | AC-7, OQ1 |
| [ ] | T013 | **G4** — Regenerate `assessment-latest.{md,json}` for `sample-service` with A–F bands recomputed and the new (empty-or-populated optional) arrays; ensure the JSON **validates against** the updated schema. | harnessability-assessment | `…/templates/assessment-latest.json`, `…/templates/assessment-latest.md` | Example regenerated; `assessment-latest.json` validates against the v0.2 schema; bands match the new thresholds; fixture stays obviously synthetic. | AC-3/4 — R1/R3 |
| [ ] | T014 | **G4** — Update `README.md` + `AUTHORING.md` (new invariants + checklist), align the `skills/README.md` catalog row to v0.2, and reconcile any flat-only `latest.json` wording in `engineering-harness-setup/SKILL.md`. | harnessability-assessment, catalog, engineering-harness-setup | `…/README.md`, `…/AUTHORING.md`, `skills/README.md`, `skills/engineering-harness-setup/SKILL.md` | Docs describe v0.2; catalog row aligned; 008 sentinel wording consistent with AC-2 (root `latest.json` + history dirs). | AC-2 |
| [ ] | T015 | **G4** — Run the full structural-validation sweep. | harnessability-assessment | (validation only) | `just list-skills` discovers the skill; schema parses Draft 2020-12; `assessment-latest.json` validates; placeholder lint passes (templates may carry `{{UPPER_SNAKE}}`, filled examples carry none); boundary byte-identical vs `canonical-boundary.txt`; leak grep clean; no `backpressure` command key; no `supersede`/`successor`/`legacy` framing. | AC-11, AC-12 — R4/R6 |
| [ ] | T016 | **G5** — Scaffold `.harness/extensions/validate-harnessability.ts` via the `add-extension` skill (`harness new`) and wire the verb shell per [workshop 001](./workshops/001-validate-harnessability-verb.md): declare the verb (name, summary), options `--repo <url>` (repeatable, overrides the 3 defaults), `--keep`, `--model`; make `/tmp/harnessability-selftest-<ts>/` and `git clone --depth=1` the 3 default repos (blocking, fast). | .harness/extensions | `.harness/extensions/validate-harnessability.ts` | `harness doctor` shows the verb `loaded`; `harness help` lists `validate-harnessability` with its options; the clone step writes 3 clones into the temp dir; no `node:*` import; uses `ctx.exec`. | AC-13, AC-15 — R7 |
| [ ] | T016b | **G5** — Implement the custom composite handler's background-fire + return contract: for each clone fire one **background fire-and-forget** minih agent (`bash -c 'nohup minih run … --skill-source path:skills --skill harnessability-assessment … & echo $!'`) with **launch-time run-ID capture** (fire one, resolve its dir via `minih last-run`, record before firing the next); return immediately with an Envelope whose `data.runs[]` carries `runId/runDir/logPath/pid` and whose `next_action` is a runnable script (poll with `minih status/tail/last-run` + the per-report validation checklist). | .harness/extensions | `.harness/extensions/validate-harnessability.ts` | Verb returns within seconds; `data.runs[]` populated (one per repo); agents keep running after the verb exits; a clone/`minih` failure **degrades** (never crashes) with a `next_action`; capture timeout degrades to `runId: null` + `run.log`. | AC-14 — R8 |
| [ ] | T017 | **G5** — Author the `agents/validate-harnessability-assessment-skill/` minih agent (`agent.json`/`prompt.md`/`input-schema.json`/`output-schema.json`/`instructions.md`), mirroring `agents/install-and-validate-test-extension/`: param `targetRepo`; permissions read-only + shell/write allow, `allowedRoots` extended to temp dirs, **network off**; invoke the `harnessability-assessment` skill against the clone, **independently verify** outputs (don't trust the self-report), emit a PASS/FAIL verdict + dual-layer magic-wand retro (skill vs minih). | validate-harnessability-assessment-skill | `agents/validate-harnessability-assessment-skill/*` | Folder exists with all 5 files; `minih`/`minih skills discover` resolves the agent + the skill; agent emits the verdict + retro shape per its output schema. | AC-13 |
| [ ] | T018 | **G5** — Wire + smoke-verify: ensure the worker can resolve the `harnessability-assessment` skill (verb passes `--skill harnessability-assessment` explicitly, or add it to `.minih.json` `include`); run `minih skills discover` to confirm resolution; where network + `minih` are available, run `harness validate-harnessability` once. | repo minih config, .harness/extensions | `.minih.json`, `.harness/extensions/validate-harnessability.ts` | (a) `minih skills discover` resolves the worker + the `harnessability-assessment` skill; (b) a smoke run returns `data.runs[]` + `next_action` within seconds; (c) the fired agents are still running after the verb returns (poll once via `minih status`); (d) a deliberately bad `--repo <url>` degrades with a `next_action` rather than crashing; (e) `--keep` preserves the temp env. | AC-14, AC-15 |

### Acceptance Criteria

- [ ] **AC-1** Output path migrated to `.harness/reports/harnessability/<ordinal>-<slug>/{report.md,report.json,summary.md,evidence.jsonl}`; all `harness/assessment/` references removed from shipped surfaces. (T004)
- [ ] **AC-2** Sentinel preserved: every run overwrites root `.harness/reports/harnessability/{latest.md,latest.json,schema.json}` so 008's `test -f …/latest.json` resolves **and** `latest.json` stays a readable, ordinal-independent file; any flat-only wording reconciled. (T004, T014)
- [ ] **AC-3** Schema v0.2, additive-optional: version literal `harnessability-assessment.v0.2`; the new top-level keys are in `properties`, **not** `required`; top-level `additionalProperties:false` preserved. (T001, T002)
- [ ] **AC-4** A–F grades: enums include `F` everywhere; bands A 85–100 / B 70–84 / C 55–69 / D 40–54 / E 25–39 / F 0–24. (T003, T010)
- [ ] **AC-5** Matrix augments, never replaces: A1–A10/B1–B10 + the two-axis tuple stay visible; `assessment_matrix[]` + `final_grade` layered on; `final_grade` cannot hide a poor axis. (T009)
- [ ] **AC-6** New survey sections present in `SKILL.md` and `assessment-report.md` (all ten enumerated). (T005)
- [ ] **AC-7** Terminal-sized `templates/summary.md` exists; filled example fits one screen; detailed evidence stays in `report.md`. (T012)
- [ ] **AC-8** Existing-flow-first ordering; fan-out ownership map updated in lockstep and collectively exhaustive. (T006, T011)
- [ ] **AC-9** Deterministic-encoding rule stated; context files never claimed as deterministic proof; mock vs fake/sink distinguished. (T007)
- [ ] **AC-10** Manual/IDE scan advisory: `manual_operation_signals[]` optional, influences A4/A5/A7/A8/A9/B5/B10 only, no over-penalising desktop/mobile/hardware/brownfield. (T008)
- [ ] **AC-11** Invariants intact: boundary sentence byte-identical; no `backpressure` command key; affordances proposal-only; no `supersede`/`successor`/`legacy` framing; `sample-service` fixture; no private-source/source-ID contamination. (T015)
- [ ] **AC-12** Validation passes: `just list-skills` discovers it; schema parses Draft 2020-12; `assessment-latest.json` validates; placeholders well-formed; examples have no unresolved placeholders; boundary + leak greps pass. (T013, T015)
- [ ] **AC-13** Dogfood verb authored & loadable: `.harness/extensions/validate-harnessability.ts` exists (via `add-extension`); `harness doctor` → `loaded`; `harness help` lists it; the minih agent folder exists with all 5 files and is discoverable. (T016, T017)
- [ ] **AC-14** Dogfood verb behaves per workshop 001: clones the 3 defaults, fires one background fire-and-forget minih agent per repo (still running after return), returns within seconds an Envelope whose `data.runs[]` carries run IDs/dirs/log paths and whose `next_action` carries the `minih status/tail/last-run` poll commands + the per-report validation checklist; bad URL / missing `minih` degrades; `--keep` preserves the temp env. (T016b, T018)
- [ ] **AC-15** Default targets are small, public, cross-language: `chalk/chalk` (JS), `BurntSushi/byteorder` (Rust), `spf13/pflag` (Go), cloned `--depth=1`; overridable via repeatable `--repo <url>`. (T016, T018)

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **R1** — Adding/altering schema keys invalidates `assessment-latest.json` (CF-02). | Medium | High | Keep new keys optional; validate the example against the schema as the **last** G4 step (T013/T015). |
| **R2** — Run-dir-only output false-positives 008's detection while leaving nothing stable to read (CF-01). | Medium | High | AC-2 mandates root `latest.*` rewritten every run (T004). |
| **R3** — A–F threshold shift regrades the `sample-service` example (CF-03). | High | Medium | Recompute example bands against the new thresholds; keep the fixture obviously synthetic (T013). |
| **R4** — Scope creep erodes the assessment-only identity (CF-05). | Medium | High | Non-Goals load-bearing; affordances proposal-only; no `backpressure` key; grep in T015. |
| **R5** — Schema/fan-out drift (CF-04). | Medium | High | Edit schema + ownership map in the same task-group (G3 / T011). |
| **R6** — Publication-boundary leak from handoff/dossier private IDs. | Low | High | Shipped surfaces use neutral language + `sample-service`; leak grep in T015. |
| **R7** — G5 scope/runtime risk (extension + minih agent + background orchestration, network clones). | Medium | Medium | Keep it simple per workshop 001 (verb only *prompts*); small/public/stable defaults; degrade (never crash) on failure; G5 is self-contained and deferrable. |
| **R8** — G5 background-firing fragility; `run.json` doesn't persist params. | Medium | Medium | Background via `nohup … &`; launch-time bookkeeping via `minih last-run`; capture timeout degrades to `runId: null` + `run.log`/`minih history` (T016). |

---

## Validation Record (2026-06-09)

### Validation Thesis

**Raison d'être**: A Simple-mode implementation plan that lets `/plan-6` build `harnessability-assessment` v0.2 (schema migration + survey sections + A–F matrix + output-path move + sentinel preservation) plus the G5 dogfood verb, with no re-discovery.

**Value claim**: Buildable from the plan alone; repairs the live producer/consumer path mismatch with plan 008; the dogfood verb makes assessment reproducible and harvests magic-wand evidence that sharpens v0.2.

**Artifact promise**: Every task has a path + measurable Done-When; ACs trace to tasks; risks map to mitigations.

**Intended beneficiaries**: `/plan-6` implementer; the `add-extension` skill + G5 implementer; plan 008 `engineering-harness-setup`.

**Proof target**: Implementation.

**Evidence standard**: Real paths; measurable ACs; correct dependency ordering; claims match the repo + workshop 001.

**Thesis source**: `harnessability-survey-spec.md` + `research-dossier.md` (CF-01…CF-05).

**Thesis verdict**: Advanced.

**Main thesis risk**: G5 background-orchestration is the only non-trivial build surface; contained by splitting T016/T016b and pinning both mechanisms to workshop 001.

---

| Agent | Lenses Covered | Thesis Axes Covered | Issues | Verdict |
|-------|---------------|---------------------|--------|---------|
| val-coherence | Coherence, Completeness, Edge Cases, CS-challenge, Concept Documentation | Implementation Readiness, Proof-Level Fit | 1 MEDIUM + 1 LOW fixed (split T016→T016/T016b; decomposed T018 smoke sub-checks) | ⚠️ → ✅ |
| val-sourcetruth | Source-Truth/Evidence, Risk, Technical Constraints, Hidden Assumptions, Domain Boundaries, Deployment & Ops | Evidence Sufficiency | 0 | ✅ |
| val-thesis-fwd | Thesis Alignment, Forward-Compatibility, Contract Integrity | Thesis Alignment, Downstream Usefulness | 0 | ✅ |

**Lens coverage**: 13/15 (Thesis Alignment ✓ mandatory; Forward-Compatibility ✓ engaged — downstream `/plan-6`, `add-extension`, and plan 008 all consume this plan).

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| `/plan-6` implementer | executable 7-col tasks w/ paths + Done-When | shape mismatch | ✅ | T001–T018 all name paths + measurable Done-When; Testing Approach + ACs present. |
| `add-extension` skill + G5 implementer | verb contract buildable from workshop 001 | contract drift | ✅ | T016/T016b/T017 mirror workshop 001's verb, options, Envelope, backgrounding, run-ID capture. |
| plan 008 `engineering-harness-setup` | AC-2 keeps root `latest.json` (detection + readability) | sentinel contract drift | ✅ | AC-2 + T004/T014 preserve root `latest.{md,json}`; 008 sentinel `test -f …/latest.json \|\| ls …/*` resolves. |

**Thesis alignment**: Value claim advanced at Implementation proof with Strong evidence; main risk (G5 orchestration) contained by the T016/T016b split + workshop-001 pinning.

**Outcome alignment**: "make the report a factual survey a later extension step can use to pick which verbs to encode first — and fixes the producer/consumer path mismatch so plan 008's setup flow can actually read it." The plan as written advances this outcome.

**Standalone?**: No — downstream `/plan-6`, the `add-extension`/G5 implementer, and plan 008 all consume this plan.

Overall: ⚠️ VALIDATED WITH FIXES
