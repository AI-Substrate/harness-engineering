# Execution Log — Plan 009: harnessability-assessment v0.2

**Mode**: Simple (single phase) · **Plan**: [harnessability-survey-plan.md](./harnessability-survey-plan.md)
**Companion**: `code-review-companion` run `2026-06-09T12-00-15-857Z-e2a9` (Power-On-Mode, live per-commit review)
**Testing**: Lightweight structural validation (no harness governance doc → no Boot/Interact/Observe).

Companion onboarding: `minih agent-readme` · companion-mode protocol: https://github.com/AI-Substrate/minih/blob/main/docs/how/companion-mode.md

## Companion finding disposition

| Finding ID | ackOf (task/sha) | Severity | Summary | Disposition |
|------------|------------------|----------|---------|-------------|
| _(none yet)_ | | | | |

---

## Task entries

### T001–T003 · G1 schema v0.2 core
**Files**: `templates/assessment-report.schema.json`, `templates/assessment-latest.json`
- T001: `schema_version` const → `harnessability-assessment.v0.2`; description rewritten for v0.2.
- T002: added 12 optional top-level keys to `properties` (`report_paths`, `assessment_matrix`, `engineering_flows`, `pre_commit_gates`, `ci_local_equivalence`, `existing_harness_concepts`, `deterministic_encoding_opportunities`, `test_mechanisms`, `external_dependency_pressure`, `code_composition`, `candidate_first_harness_surfaces`, `manual_operation_signals`) + their `$defs`; added optional `verdict.final_grade`. None added to `required`; top-level `additionalProperties:false` preserved.
- T003: `$defs/grade` enum → `["A","B","C","D","E","F"]`.
- Example `assessment-latest.json` version bumped to v0.2 so it stays valid every commit (full A–F/matrix regen deferred to T013).

**Evidence**: `jsonschema.Draft202012Validator` — schema valid Draft 2020-12; example VALIDATES; grade enum includes F; required count 21 (unchanged); new keys all optional; `additionalProperties:false` intact.

### T004 · G1 output-path + sentinel migration
**Files**: `SKILL.md`, `README.md`
- Rewrote the SKILL.md `## Output contract`: history dir `.harness/reports/harnessability/<ordinal>-<slug>/{report.md,report.json,summary.md,evidence.jsonl}` + root `latest.{md,json}`/`schema.json` overwritten every run. Documented `<ordinal>` = next free 3-digit by scanning report dirs.
- Documented the **sentinel** verbatim: `test -f .harness/reports/harnessability/latest.json || ls .harness/reports/harnessability/*` (008 consumer); root `latest.json` kept present AND readable every run (detection + readability per AC-2).
- Updated `--output-dir` default, "write reports under", and the "previous reports" evidence path; mirrored the new path block + v0.2 version into README.
**Evidence**: `grep -rn "harness/assessment" skills/harnessability-assessment/` → NONE (clean); new path present 13× SKILL.md / 7× README.

### T005–T008 · G2 survey sections + ordering + rules
**Files**: `SKILL.md`, `templates/assessment-report.md`
- T005: new `## Existing engineering environment survey` section in SKILL.md mapping 10 survey dimensions → their v0.2 JSON arrays (engineering flows incl. SDD-like, pre-commit/local gates, CI/local equivalence, existing harness concepts canonical-vs-diffuse, test mechanisms, external-dependency pressure, code composition/seams, deterministic-encoding opportunities, manual/IDE signals, candidate-first surfaces). Matching report sections added to `assessment-report.md` (placed after Repository topology, before Axis A — survey-before-score).
- T006: new execution step `### 6b. Synthesize the existing engineering environment survey` + explicit **existing-flow-first rule**; step 10 now derives `candidate_first_harness_surfaces[]`/`deterministic_encoding_opportunities[]` only after the survey; step 11 writes `summary.md` + records `report_paths` + confirms the sentinel.
- T007: "Prefer deterministic encoding over context-file accretion" rule — context files are orientation not proof; mocks vs fakes/sinks distinguished.
- T008: manual/IDE-only scan documented as advisory, influences A4/A5/A7/A8/A9/B5/B10 only, never over-penalises desktop/mobile/hardware/brownfield (`penalize: no`).

### T009–T011 (+ T003 bands) · G3 A–F matrix + scoring + fan-out re-map
**Files**: `SKILL.md`, `templates/assessment-report.md`
- T003 (band text, deferred from the schema commit): `### Letter grades` table → A 85-100 / B 70-84 / C 55-69 / D 40-54 / E 25-39 / F 0-24.
- T009: new `### Assessment matrix (A–F)` subsection — `assessment_matrix[]` + `verdict.final_grade` augment (never replace) the axes; rule that `final_grade` must not hide a poor axis. Report template gains a Final-grade line + `## Assessment matrix` table + an augment-not-replace note.
- T010: JSON-minimum-shape block → version v0.2, grade enums A–F everywhere, `final_grade` added, + prose note listing the optional v0.2 arrays.
- T011: fan-out subagent→schema-slice ownership re-mapped in lockstep — subagent 1 owns `pre_commit_gates`/`ci_local_equivalence`, 2 owns `external_dependency_pressure`, 4 owns `test_mechanisms`, 5 owns `code_composition`, 6 owns `engineering_flows`/`existing_harness_concepts`/`manual_operation_signals`; orchestrator synthesizes `assessment_matrix`/`final_grade`/`deterministic_encoding_opportunities`/`candidate_first_harness_surfaces`/`report_paths`. Map is collectively exhaustive (every v0.2 array has one owner).
**Evidence**: example still validates; no v0.1 / old-band stragglers in SKILL.md.

### T012–T013 · G4 summary template + example regen
**Files**: `templates/summary.md` (new), `templates/evidence-log.jsonl` (new), `templates/assessment-latest.{json,md}`
- T012: created terminal-sized `summary.md` (verdict tuple + final_grade + one-line matrix + top blockers + encode-first + first-safe-session + paths) and an optional `evidence-log.jsonl` template.
- T013: regenerated the `sample-service` example. Grades re-checked against new bands (62→C, 55→C — no regrade). Added `verdict.final_grade: C`, `report_paths`, `assessment_matrix[]` (8 rows), and all 10 survey arrays to the JSON; mirrored Final-grade line, `## Assessment matrix`, and the full `## Existing engineering environment survey` into the markdown.
**Evidence**: enriched `assessment-latest.json` VALIDATES against v0.2 schema; 12/12 new keys present; no unresolved `{{}}` placeholders in the filled examples.

### T014 · G4 docs + catalog + 008 reconcile
**Files**: `README.md`, `AUTHORING.md`, `skills/README.md`, `skills/engineering-harness-setup/SKILL.md`
- README: added a v0.2 capability paragraph (survey-first, A–F matrix, summary.md, deterministic-encoding preference).
- AUTHORING #8 → v0.2 contract (lists the optional arrays, final_grade, grade F; additionalProperties:false preserved); #9 notes the ownership map must cover every v0.2 array; checklist +2 items (summary.md terminal-sized; ownership map exhaustive); extension guidance "keep v0.2 focused".
- skills/README.md catalog row reworded to v0.2 (survey + A–F + summary.md).
- 008 reconcile: the sentinel block already accepts "any file under the dir" (history subdirs OK); added a clarifying line that root `latest.json` is kept current every run with per-run history under `<ordinal>-<slug>/`. No contract change — AC-2 satisfied.

### T015 · G4 structural-validation sweep
**Sweep result** (AC-11 + AC-12, AUTHORING checklist 1–11):
1. `just list-skills` → discovers `harnessability-assessment`. ✅
2. `assessment-report.schema.json` parses as valid Draft 2020-12; `assessment-latest.json` + `codebase-affordance-record.json` parse. ✅
3. `assessment-latest.json` validates against the v0.2 schema. ✅
4. Template placeholders all well-formed `{{UPPER_SNAKE}}`; filled examples carry **no** unresolved placeholders. ✅
5. Canonical boundary sentence byte-identical (SKILL.md ↔ `canonical-boundary.txt`). ✅
6. Private-source/source-ID leak grep on shipped surfaces → CLEAN. ✅ **(fix applied)**
7. No generic core `backpressure` command key (only the legit `backpressure_surfaces[]` array + descriptive usage). ✅
8. No `supersede`/`successor`/`legacy` framing. ✅

**Fix during sweep**: my new survey content used the literal `docs/plans/` as a generic SDD-pattern example, which tripped the boundary leak grep (that token is on the AUTHORING #5 list). Reworded to "a `plans/` directory / `/plan-*` or `task-*` skills / RFC-ADR conventions" in SKILL.md (×2) + both examples — keeps the SDD-detection intent without emitting the flagged token. Example re-validated post-reword.
