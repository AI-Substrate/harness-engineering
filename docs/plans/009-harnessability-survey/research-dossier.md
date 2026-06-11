# Research Report: Reworking the `harnessability-assessment` skill (v0.2)

**Generated**: 2026-06-08T23:55:00Z
**Research Query**: "Rework harnessability-assessment (v0.2): survey existing engineering flows + deterministic harness opportunities, move output to `.harness/reports/harnessability/`, add A–F matrix + terminal summary, add manual/IDE-only scan. Map the current skill, its schema, axes, fan-out, and the cross-skill report-path contract."
**Mode**: Pre-Plan (feeds `/plan-1b`)
**Location**: docs/plans/009-harnessability-survey/research-dossier.md
**FlowSpace**: Available (markdown/JSON target — used direct reads)
**Inputs reviewed**: `scratch/paste/20260608T234721.md` (main handoff), `scratch/paste/20260608T234735.md` (manual/IDE addendum), the full skill package, the consumer skill (008), and prior-plan learnings (003, 008).

---

## Executive Summary

### What this rework does
Transforms `harnessability-assessment` from "does the repo have good onboarding/agent-context files?" into a **factual survey of the existing engineering environment** — build/CI/pre-commit/SDD flows, command surfaces, tests/fakes/sinks, dependency pressure, code-composition seams, and canonical-vs-**diffuse** harnesses — answering *"what engineering system already exists here, and where could the harness later plug in as first-class verbs?"* It stays **assessment-only** (no setup, no extension generation, no command running by default).

### Three load-bearing insights
1. **The output-path change is a repair, not just a feature.** The consumer side already ships the new contract: `engineering-harness-setup` (plan 008) and `skills/README.md` advertise `.harness/reports/harnessability/latest.json` as a pinned sentinel, but the **producer skill still writes the old `harness/assessment/`**. v0.2 closes this live mismatch. The new run-dir scheme **must preserve `latest.json`/`latest.md` at the directory root** so the 008 sentinel keeps resolving. (`skills/engineering-harness-setup/AUTHORING.md:22`, `SKILL.md:100-105`; current producer `skills/harnessability-assessment/SKILL.md:88-104`)
2. **The schema is `additionalProperties: false` with 21 required top-level keys.** Every new array/object the suggestions add (≈10 of them) must be **whitelisted in `properties`**, kept **out of `required`** (additive-optional, per AUTHORING invariant #8 + PL-03), and the **grade enum + `schema_version` literal must change** (not additive). This is the highest-risk surface.
3. **The A1–A10 / B1–B10 two-axis model stays; the A–F matrix augments it.** The suggestions explicitly say add `assessment_matrix[]` rows "rather than replacing the current axes" and "keep the two-axis tuple visible." The fan-out subagent→schema-slice ownership map (AUTHORING invariant #9) must move in lockstep with the schema.

### Quick stats
- **Skill package**: `SKILL.md` (1041 lines), `README.md` (57), `AUTHORING.md` (104), 6 templates (~2110 lines total).
- **Schema**: Draft 2020-12, top-level `additionalProperties: false`, 21 required keys, grade enum `A–E`, version literal `harnessability-assessment.v0.1`.
- **Consumers of the output path**: 1 (plan 008's `engineering-harness-setup` — sentinel only). No code/test consumers of `harness/assessment/` outside the skill itself.
- **Prior learnings surfaced**: 8 (PL-01…PL-08) from plans 003 + 008.
- **Domains / compound system**: none (`docs/domains/` absent, `docs/harness/` absent → compound integration skipped).

---

## How the skill currently works

### Output contract (the thing changing most)
Current (`SKILL.md:88-104`, `README.md:13-19`):
```text
harness/assessment/latest.md
harness/assessment/latest.json
harness/assessment/schema.json
harness/assessment/runs/<UTC_TIMESTAMP>.md   # YYYYMMDDTHHMMSSZ
harness/assessment/runs/<UTC_TIMESTAMP>.json
```
Target (suggestions §"Required output contract change"):
```text
.harness/reports/harnessability/<ORDINAL>-<SLUG>/{report.md,report.json,summary.md,evidence.jsonl}
.harness/reports/harnessability/latest.md
.harness/reports/harnessability/latest.json     # <- 008 sentinel; MUST be preserved
.harness/reports/harnessability/schema.json
```
Run-slug examples: `001-initial-harnessability`, `002-ci-and-precommit-survey`. Ordinal = next free by scanning existing report dirs.

### Scoring model (`SKILL.md:155-218`)
- Two axes: **Operate-Today** (usable now?) and **Adaptability** (cheaply changeable to add proof loops?). Always report the **tuple**, never collapse to one grade.
- Dimension bands: Strong 3 / Partial 2 / Weak 1 / Absent 0 / N-A excluded / Unknown 0. `axis_percent = earned/applicable_max*100`.
- **Letter grades today are A–E** with thresholds A≥85, B 70–84, C 50–69, D 30–49, E <30 (`SKILL.md:189-197`).
- Optional Harnessability Index (lossy blend, default 0.5:0.5), separate Confidence (high/med/low).
- Readiness ladder H0–H5; proof ladder L0–L6.

### Dimensions
- **Axis A (Operate-Today)** A1–A10: cold-start, setup/env, locality/dep-exposure, front-door, boot/health, seed/reset, interaction surfaces, deterministic sensors, observability, compounding loop. (`SKILL.md:246-371`)
- **Axis B (Adaptability)** B1–B10: structural coupling, temporal coupling, cohesion, seams/substitution, hermetic testability, side-effect sinks, state/consequence, architecture-boundary enforceability, complexity, inner-loop speed. (`SKILL.md:372-487`)

### Fan-out (`SKILL.md:815-856`, AUTHORING invariant #9)
Optional 6 read-only inspector subagents; the **schema is the merge contract** (each returns a fragment validating against its slice; orchestrator is the only writer/validator). Current ownership: (1) commands/sensors, (2) env/deps, (3) state/interaction/observability, (4) tests/seams, (5) structure/adaptability, (6) cold-start/compounding. Ownership map must stay collectively exhaustive over A1–A10/B1–B10 + the top-level arrays.

### Invariants that must NOT break (AUTHORING.md)
- Canonical boundary sentence **byte-identical**: `The agent harness drives. The engineering harness proves.` (source `templates/canonical-boundary.txt`).
- Setup/assessment/runtime separation — don't make it "setup v2" or a default command-runner.
- **No generic core `backpressure` command key** in shipped surfaces.
- Product-code affordances **proposal-only**.
- Schema authoritative; example JSON validates; prefer additive optional fields.
- No private-source contamination; sanitized examples use `sample-service`; placeholders upper-snake `{{[A-Z_][A-Z0-9_]*}}`.
- Neutral framing — no `supersede`/`successor`/`legacy`/`migration` (except real DB/schema migrations).

---

## What the suggestions add / change (delta)

| Area | Current | v0.2 target | Type |
|---|---|---|---|
| Output path | `harness/assessment/` | `.harness/reports/harnessability/<ord>-<slug>/` + root `latest.*`/`schema.json` | **Breaking (repairs consumer)** |
| `summary.md` (terminal-sized) | none | new template; one-screen verdict + highs/lows + "first things to harness" | Additive |
| Schema version | `…v0.1` | `…v0.2` | Change |
| Grades | A–E | **A–F** (F = not harnessable as-is) + shifted bands | **Change (non-additive)** |
| Assessment matrix | A1–A10/B1–B10 only | + `assessment_matrix[]` (M01… cross-cutting) + `final_grade`, axes preserved | Additive |
| Engineering-flow recon | implicit | new section + `engineering_flows[]` (incl. SDD-like) | Additive |
| Pre-commit / local gates | implicit in A8 | new section + `pre_commit_gates[]` | Additive |
| CI/local equivalence | none | new section + `ci_local_equivalence[]` | Additive |
| Deterministic-encoding quality | implicit | new table + `deterministic_encoding_opportunities[]`; "prefer encoding over context-file accretion" rule | Additive |
| Test mechanisms (mock vs **fake/sink**) | tests-as-recon (B4/B5/B6) | + `test_mechanisms[]` with harness-reuse classification | Additive |
| External dependency pressure | env/dep inventory | + `external_dependency_pressure[]` clusters | Additive |
| Code composition / seams | B-axis prose | new scan + boundary records | Additive |
| Existing harness concept | front-door dims | canonical **and diffuse** harness detection (`existing_harness_concepts`) | Additive |
| Candidate first harness surfaces | remediations | `candidate_first_harness_surfaces[]` (factual, "do not implement") | Additive |
| Manual / IDE-only scan (addendum) | none | optional `manual_operation_signals[]`; advisory; lowers A4/A5/A7/A8/A9/B5/B10 only when no CLI/CI parity; don't over-penalise desktop/mobile/brownfield | Additive |
| Execution flow | 11 steps | re-ordered 18 steps (flows + command surfaces inspected **before** recommending verbs) | Change |
| Fan-out ownership | 6 subagents (current map) | 6 subagents (re-scoped to own new arrays) | Change (lockstep w/ schema) |
| README / AUTHORING | v0.1 invariants | + deterministic-encoding-over-drift, existing-flow-first, terminal-summary boundary, A–F grading invariants; updated validation checklist | Additive |

---

## Critical findings

### 🚨 CF-01 — Live producer/consumer path mismatch (repair, preserve the sentinel)
The 008 consumer + `skills/README.md` already point at `.harness/reports/harnessability/latest.json`; the producer still writes `harness/assessment/`. v0.2 fixes this. **Constraint:** the new `<ordinal>-<slug>/` run-dir is fine, but `latest.json` and `latest.md` **must exist at the directory root** (`.harness/reports/harnessability/latest.json`) or the 008 "report exists?" check breaks. Update any 008-side wording that assumes *only* a flat `latest.json` if needed. (`engineering-harness-setup/SKILL.md:100-105`, AUTHORING.md:22; PL-07)

### 🚨 CF-02 — Schema migration is the highest-risk surface
Top-level `additionalProperties:false` + 21 required keys. The ~10 new top-level keys must be added to `properties`, kept **optional** (not in `required`) so the core scorecard stays stable (AUTHORING #8, PL-03). Non-additive edits also required: extend grade enums `A–E → A–F` everywhere they appear (schema `verdict.*_grade`, the JSON-minimum-shape block `SKILL.md:962-972`, the matrix), and bump the `schema_version` literal. **The example `assessment-latest.json` must still validate** against the updated schema (CI-style check with `jsonschema`/`ajv`).

### 🚨 CF-03 — A–F is not purely additive: band thresholds shift
Adding F changes existing boundaries: C 50–69 → **55–69**, D 30–49 → **40–54**, E <30 → **25–39**, F **0–24** (suggestions §"Update scoring to A–F"). Decide whether the existing `sample-service` example grades change. Keep the **two-axis tuple visible** and never let `final_grade` hide a poor Operate-Today/Adaptability score.

### 🚨 CF-04 — Fan-out map + schema must change in lockstep
AUTHORING invariant #9: subagent→schema-slice ownership must stay collectively exhaustive. Adding `engineering_flows[]`, `pre_commit_gates[]`, `ci_local_equivalence[]`, `test_mechanisms[]`, `deterministic_encoding_opportunities[]`, `existing_harness_concepts`, `external_dependency_pressure[]`, `candidate_first_harness_surfaces[]`, `assessment_matrix[]`, `manual_operation_signals[]` means re-assigning owners (suggestions propose a 6-subagent map). Schema edit + ownership-map edit are one change.

### 🚨 CF-05 — Don't let scope creep break the "assessment-only" identity
The suggestions are large but explicitly preserve: assessment-only (no setup/extension generation/default command running), proposal-only affordances, no generic `backpressure` command, evidence-before-interpretation, env-names-only. The biggest failure mode (PL-01/PL-06): turning report content into hardcoded logic or a giant onboarding doc. Keep guidance **file-backed** (templates/docs), keep the terminal summary short, detailed evidence in `report.md`.

---

## Prior Learnings (institutional knowledge)

| ID | Type | Source | Key insight | Action for v0.2 |
|----|------|--------|-------------|-----------------|
| PL-01 | decision | 003 research-dossier:238-249,304-341 | Orient is post-setup, read-only, evidence/inference separated; H0–H5 (repo) ≠ L0–L4 (setup) | Keep read-only/report-first; every new scan carries provenance/confidence/status |
| PL-02 | decision | 003 research-dossier:210-232 | Report carries command_tiers/services/env/state/observability/gaps/affordances/questions sections | Fit new scans as **additive evidence** into existing sections, not a new top-level model |
| PL-03 | decision | 003 spec:191-196, plan:57-64 | Intentional "tight core, explicit optional extensions"; schema sprawl flagged as a risk | New arrays **optional but whitelisted**; keep `additionalProperties:false` |
| PL-04 | gotcha | 003 research-dossier:315-320, exec.log:28-31 | Template placeholders ≠ leak placeholders; templates may keep `{{XXX}}`, generated reports must not | Separate **template-lint** from **output-lint** in validation |
| PL-05 | gotcha | 003 exec.log:28-31,39-44 | Sanitized examples are the highest-risk publication surface | Keep examples obviously synthetic (`sample-service`) **and** schema-valid |
| PL-06 | decision | 003 research-dossier:322-348 | Guidance file-backed, not hardcoded; public docs concise | New grades/scans land in templates+docs, not logic strings |
| PL-07 | contract | 008 retro:21-37, the-flow.json:33-35 | 008 pinned the report move to `.harness/reports/harnessability/latest.json` as "parallel work" | Update setup/hand-off docs together; **preserve `latest.json`** |
| PL-08 | decision | 003 research-dossier:268-286 | Product-code affordances first-class but proposal-only with risk/safety semantics | New A–F grades must not blur "proposal" into "permission to apply" |

---

## Modification considerations

**✅ Safe to add** (additive-optional, low blast radius): the new report **sections** in `templates/assessment-report.md`; the new **optional** top-level arrays in the schema; `summary.md` + `evidence-log.jsonl` templates; README "what it produces" + AUTHORING invariants; the manual/IDE scan (advisory).

**⚠️ Modify with caution**: grade enum `A–F` + band thresholds (touches schema enums, the JSON-minimum-shape block, scoring section, and example grades — sweep all); the output path (sweep SKILL flags `--output-dir`, output-contract section, safety-defaults line 118, README, `skills/README.md`, 008 docs); fan-out ownership map (lockstep with schema).

**🚫 Danger zones**: the canonical boundary sentence (byte-identical); making it `additionalProperties:true` (PL-03 says no); adding a generic `backpressure` command key; converting proposal-only affordances into apply-by-default.

---

## Open decisions for `/plan-1b` (recommended answers)

- **D1 — Schema strategy.** Recommend: bump to `harnessability-assessment.v0.2`; add new top-level keys to `properties` as **optional** (not `required`); keep `additionalProperties:false`; extend grade enums to include `F`. *(Confirm: any new key that fan-out subagents always emit — do we promote it to `required`, or keep all v0.2 additions optional?)*
- **D2 — Run-dir + sentinel.** Recommend: `.harness/reports/harnessability/<ordinal>-<slug>/{report.md,report.json,summary.md,evidence.jsonl}` + root `latest.md/.json/schema.json`; **preserve `latest.json` sentinel**; ordinal by scanning existing report dirs. *(Confirm: keep old `harness/assessment/` write for one release as a deprecation shim, or hard-switch? Recommend hard-switch — repairs the mismatch, no other consumers.)*
- **D3 — Matrix vs axes.** Recommend: **augment** — add `assessment_matrix[]` (M01… + `final_grade`) while keeping A1–A10/B1–B10 and the two-axis tuple visible.
- **D4 — Manual/IDE scan.** Recommend: optional `manual_operation_signals[]`; advisory; influences A4/A5/A7/A8/A9/B5/B10 only; explicit "don't over-penalise brownfield/desktop/mobile" guard.
- **D5 — Fan-out re-map.** Recommend: adopt the suggestions' 6-subagent ownership map; update AUTHORING invariant #9's exhaustiveness statement in the same change.
- **D6 — Mode & testing.** Likely **Full** (or a chunky Simple) — edits span SKILL + schema + 4 existing templates + 2 new templates + README + AUTHORING + a 008-doc touch. Testing = structural validation (below). *(Confirm Simple vs Full in `/plan-1b`.)*
- **D7 — `summary.md` grade format.** Suggestion shows "Overall: C+". Decide plain A–F vs +/- modifiers. Recommend plain A–F for now (no modifier sprawl); revisit if needed.

---

## Validation tooling (verified available)
- `just list-skills` → `npx skills@latest add "$(pwd)" -l` (skill discovery). (`justfile:7-9`)
- Python `jsonschema 4.26.0` **and** `ajv` (PATH) → validate schema is Draft 2020-12 + validate `assessment-latest.json` against `assessment-report.schema.json`.
- Grep gates (from AUTHORING checklist): boundary-sentence byte match; private-source/source-ID leak grep; malformed-placeholder grep on templates; no unresolved placeholders in example reports; no `backpressure` command key; no `supersede`/`successor`/`legacy` framing.
- No dedicated `just` schema-validation target exists yet — a small inline `python -c`/`ajv` step is the current path (consider adding a `just validate-harnessability` target as part of the rework).

## File inventory (edit targets)
| File | Role | Change |
|---|---|---|
| `skills/harnessability-assessment/SKILL.md` | shipped skill (1041 ln) | output contract, scoring A–F, exec flow (18 steps), new sections, fan-out re-map, JSON-min-shape enums |
| `…/README.md` | shipped (57 ln) | "what it produces" path, "where it fits", new-capability blurb |
| `…/AUTHORING.md` | repo-internal (104 ln) | new invariants + updated validation checklist |
| `…/templates/assessment-report.md` | md template | add the new sections |
| `…/templates/assessment-report.schema.json` | **authoritative** schema (457 ln) | v0.2: new optional keys, A–F enums, version literal |
| `…/templates/assessment-latest.md` | sample (sample-service) | regrade/expand to new sections |
| `…/templates/assessment-latest.json` | sample — **must validate** | new fields, A–F, must pass schema |
| `…/templates/summary.md` | **new** | terminal-sized summary template |
| `…/templates/evidence-log.jsonl` | **new (optional)** | evidence-log example |
| `…/templates/canonical-boundary.txt` | invariant source | **do not touch** |
| `skills/README.md` | catalog | already on new path; verify wording matches v0.2 |
| `skills/engineering-harness-setup/{SKILL,README,AUTHORING}.md` | consumer | verify sentinel still resolves; reconcile any flat-`latest.json` assumption |

## Next steps
- Proceed to **`/plan-1b`** to write the spec. Resolve D1–D7 (front-loaded questions). No external research needed — the two handoff docs already carry the design intent and external-research basis.
- This research is **read-only and complete.** No files were modified.

---
**Research Complete** · Report: docs/plans/009-harnessability-survey/research-dossier.md
