# Harness Record Command Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-09
**Spec**: [harness-record-command-spec.md](./harness-record-command-spec.md)
**Status**: READY

## Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No critical `[NEEDS CLARIFICATION]` markers; open questions are deferred design choices (Q-A/Q-C) or resolved (Q-B). |
| G2 | Constitution | PASS | P10 governs the dynamic **verb** surface ("core hardcodes no verb list"); `record` is a **reserved core command**, added exactly as `skills`/`new`/`docs` were (all post-date P10) — its *types* stay dynamic/extension-ownable, so **no amendment required**. Ports/adapters respected; honesty (`unconfigured`) used; `record` is original behaviour for a real gap (P8 N/A). |
| G3 | Architecture | PASS | New `services/record/` is pure (injected ports); `acts/record.ts` is a thin shell; envelope + error codes reused; no business logic in act/entrypoint. |
| G4 | ADR Compliance | N/A | No `docs/adr/`. |
| G5 | Structure | PASS | All Simple-mode required sections present + populated. |
| G6 | Testing Alignment | PASS | Hybrid: TDD (test-before-impl) for every CLI behaviour unit; skill-markdown + docs are manual; ACs observable. |
| G7 | Domain Completeness | PASS | Domain system uninitialized; Target Domains = the 3 spec areas; Domain Manifest covers every file. |

> **Harness loop**: omitted — this repo has no `docs/project-rules/engineering-harness.md`. No Phase-0 harness, no boot/retro task rows, no Harness Loop/Agent Harness Strategy sections. (This repo *is* the harness product; validation is via its own `vitest` suite + manual skill checks — per spec Clarifications.)

## Summary

Add a core `harness record <type>` command that scaffolds a templated record file into `.harness/records/<type>/<YYYY-MM-DD>-<slug>.md` (collision → `-NNN`) and returns its path for the calling agent to fill. Record types are defined by a 4-field contract (`{ kind:'record', type, description, template }`) and merged from two sources — **core-bundled** (`retro`) and **extension-provided** (a `kind:'record'` default export discovered by the existing loader, which is widened from verb-only). The eng-harness observe/retro skills are then adapted to call the command, jotting crash-resilient scratch to gitignored `.harness/temp/<agent>/` and materialising committed records at drain. The CLI stays schema-agnostic (the record's schema lives in its template), so adding the next record type is a template + four fields.

## Target Domains

| Domain / Area | Status | Relationship | Role |
|---|---|---|---|
| Harness CLI core (`harness/cli/`) | existing | **modify** | New `acts/record.ts` + `services/record/`; widen extension contract/loader for `kind:'record'`; `E180`/`E181`; reserve `record`; extend `doctor` + `new`. |
| eng-harness loop skills (`skills/eng-harness-loop/`) | existing | **modify** | Adapt `eng-harness-3-observe` (scratch → `.harness/temp/`) + `eng-harness-4-retro` (drain materialises a record; harvest reads new+legacy). |
| Repo substrate (`docs/`, `README.md`, `.gitignore`) | existing | **modify** | `docs/how/` guide; README/`skills/README.md`; gitignore `.harness/temp/`. |

> Formal domain system is **not initialized** (constitution); classifications below are informal area tags.

## Domain Manifest

| File | Domain | Classification | Rationale |
|---|---|---|---|
| `harness/cli/src/services/record/contract.ts` | CLI core | contract | `HarnessRecordType` — exported via `harness/contract`. |
| `harness/cli/src/services/record/core-types/retro.ts` | CLI core | internal | Core `retro` type + `RETRO_TEMPLATE`. |
| `harness/cli/src/services/record/record-service.ts` | CLI core | internal | Pure: resolve type, resolve path (clock+fs), render template, ensure temp. |
| `harness/cli/src/services/record/registry.ts` | CLI core | internal | Merge core ∪ extension record types. |
| `harness/cli/src/services/extensions/contract.ts` | CLI core | contract | Widen export union + `kind` discriminator (modify). |
| `harness/cli/src/services/extensions/registry.ts` | CLI core | internal | Verb-vs-record dispatch + conflict recording + reserve `record` (modify). |
| `harness/cli/src/services/extensions/discovery.ts` | CLI core | internal | Discovery unchanged or minimal (verify). |
| `harness/cli/src/output/error-codes.ts` | CLI core | internal | `E180`, `E181` (modify). |
| `harness/cli/src/acts/record.ts` | CLI core | internal | Thin commander act (new). |
| `harness/cli/src/app.ts` | CLI core | internal | `registerRecordAct` (modify). |
| `harness/cli/src/services/scaffold/{scaffold-service,templates}.ts` | CLI core | internal | `--record` variant + reject reserved `record` (modify). |
| `harness/cli/src/acts/new.ts` | CLI core | internal | `--record` flag (modify). |
| `harness/cli/src/services/doctor/doctor-service.ts` | CLI core | internal | Record-types enumeration line (modify). |
| `harness/cli/test/services/record/*.test.ts`, `test/acts/record.test.ts`, `test/services/extensions/*record*.test.ts` | CLI core | internal | Fake-adapter unit tests. |
| `.gitignore` | substrate | internal | Ignore `.harness/temp/`. |
| `skills/eng-harness-loop/eng-harness-3-observe/SKILL.md` | loop skills | cross-domain | Scratch → `.harness/temp/<agent>/` (markdown). |
| `skills/eng-harness-loop/eng-harness-4-retro/SKILL.md` | loop skills | cross-domain | Drain materialises record; harvest globs (markdown). |
| `skills/eng-harness-loop/eng-harness-flow/SKILL.md` (+ `references/*`) | loop skills | cross-domain | Path narration updates (markdown). |
| `docs/how/record-and-record-types.md`, `README.md`, `skills/README.md` | substrate | internal | Docs. |

## Key Findings

| # | Impact | Finding | Action |
|---|---|---|---|
| 01 | Critical | Extension system is **verb-only** today (`ExtensionExport = HarnessVerb \| HarnessVerb[]`; `registry.ts` validates only verbs). Routing `kind:'record'` needs a widened union + record registry + verb-vs-record dispatch + load/validation split — a dedicated task cluster, not a flag. | Group B (T007–T009) lands the loader change with a back-compat test before the act consumes the registry. |
| 02 | High | CLI is **schema-agnostic** — a record's schema lives in its `template`. Keep core tiny: no validation engine, no harvest/cluster (spec non-goals). | Contract = 4 fields (T002); resist scope creep. |
| 03 | High | The core `retro` template must not drift from `retro.schema.json`; `system.compound.*` is a **convention** inside the schema's open `system` object, not a defined field. | Template echoes the schema's required fields; pinned by a unit test (T004). |
| 04 | Medium | Reserving `record` requires updating `RESERVED_NAMES` (`registry.ts`) **and** the scaffold guard (`scaffold-service.ts`) so `harness new record` → `E151`. | T012 + T014. |
| 05 | Medium | Buffer = gitignored scratch `.harness/temp/<agent>/` (crash-resilient working memory); record = committed output; CLI **ensures** temp on first use. | `ensureTemp` (T005) + `.gitignore` (T015). |
| 06 | Medium | `--harvest` must read new (`.harness/records/retro/*`) **and** legacy (`docs/harness/agents/**`, `docs/retros/*`) so no existing retro vanishes. | T017. |

## Implementation

**Objective**: Ship a core `harness record <type>` command + generic record-type system (core ∪ extension), with `retro` as the first core type, and adapt the observe/retro skills to use it.

**Testing Approach**: **Hybrid** — Full TDD with **fake adapters** (no `vi.mock`) for all CLI behaviour (test row precedes impl row in every group); skill-markdown + docs verified **manually** (read + path grep). The CLI↔skill seam is pinned by the T004 template/schema test.

### Tasks

Grouped for readability (single-phase Simple plan). Order is dependency-correct; test rows precede their impl rows.

**Group A — record-type contract + core `retro` type + record service**

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|---|---|---|---|---|---|---|
| [x] | T001 | Define `HarnessRecordType` (4 fields) + export via `harness/contract` | CLI core | `src/services/record/contract.ts`, root `package.json` exports map | Type compiles; `HarnessRecordType`/`HarnessExtensionExport` importable from `harness/contract` | Finding 02 |
| [x] | T002 | Author core `retro` type + `RETRO_TEMPLATE` (inline TS const, lean Q-A) | CLI core | `src/services/record/core-types/retro.ts` | `retroRecordType` exports `{kind,type:'retro',description,template}` | Finding 03; Q-A lean=inline |
| [x] | T003 | **RED** tests: record-service path resolution (date-slug via fake clock; collision `-001`/`-002`; mkdirp; never clobber) + `ensureTemp` (creates `.harness/temp/`, idempotent) + unconfigured when no `.harness/` | CLI core | `test/services/record/record-service.test.ts` | Tests fail (no impl) | Findings 05; ACs 1,2,4,17 |
| [x] | T004 | **RED+GREEN** test: `RETRO_TEMPLATE` parses as YAML frontmatter and its keys ⊇ `retro.schema.json` required (`schema_version,retro_id,agent,started_at`); uses only the open `system` object | CLI core | `test/services/record/retro-template.test.ts` | Test asserts superset; documents `system.compound` as convention | Finding 03; AC 9 |
| [x] | T005 | **GREEN** impl: `record-service.ts` — `resolveType`, `resolvePath` (clock+fs, collision counter), `renderTemplate`, `ensureTemp`, typed outcome | CLI core | `src/services/record/record-service.ts` | T003 passes | Pure; injected `fs`/`clock`/`proc` ports |
| [x] | T006 | **test→impl**: `registry.ts` — **core types only** (no extension merge yet); enumerate core `retro` | CLI core | `src/services/record/registry.ts`, `test/services/record/registry.test.ts` | Core enumeration test passes | Extension merge deferred to T009 — loader must widen first (Finding 01) |

**Group B — widen the extension loader for `kind:'record'`** (Finding 01 — do before the act)

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|---|---|---|---|---|---|---|
| [x] | T007 | **RED** routing tests: absent `kind` ⇒ verb (back-compat); `kind:'record'` routed to record registry; malformed record export skipped + recorded (`E140`); extension shadowing core `retro` → conflict, core wins | CLI core | `test/services/extensions/record-routing.test.ts` | Tests fail | ACs 6,15,16 |
| [x] | T008 | **GREEN** impl: widen `ExtensionExport` union + add `kind` discriminator (`kind?:'verb'` default) | CLI core | `src/services/extensions/contract.ts` | Existing verb extensions still type-check | Finding 01 |
| [x] | T009 | **GREEN** impl: registry dispatch verb-vs-record; **extend the record registry to merge extension-provided types (core ∪ extension)** with deterministic conflict (core wins; first-extension wins; recorded); isolation unchanged (`E140` non-fatal) | CLI core | `src/services/extensions/registry.ts`, `src/services/record/registry.ts`, `src/services/extensions/discovery.ts` (verify) | T007 passes; `doctor` reports provenance + conflicts for malformed/shadowed exports; `harness record --list` enumerates core ∪ extension; existing extension tests green | Findings 01,15; closes the T006 core-only seam |

**Group C — `record` act + error codes + reserve + `--list` + bare + doctor + `new --record`**

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|---|---|---|---|---|---|---|
| [x] | T010 | Add `E180` (RECORD_TYPE_UNKNOWN) + `E181` (RECORD_WRITE_FAILED) | CLI core | `src/output/error-codes.ts` | Codes exported; no collision | AC 3 |
| [x] | T011 | **RED** act tests: create → `ok` envelope w/ `data.path`+evidence+next_action; collision `-001`; unknown type `E180` exit 1; no `.harness/` → `unconfigured` exit 2; type-name `^[a-z][a-z0-9-]*$` invalid → error; `--list` (human + `--json` payload `{type,description,source,entryPath?}`); bare `record` = orientation exit 0 | CLI core | `test/acts/record.test.ts` | Tests fail | ACs 1,2,3,4,5,14,18 |
| [x] | T012 | **GREEN** impl: `acts/record.ts` (`<type>` arg, `--slug`, `--list`); register in `app.ts`; **reserve** `record` (`RESERVED_NAMES` in `registry.ts`) | CLI core | `src/acts/record.ts`, `src/app.ts`, `src/services/extensions/registry.ts` | T011 passes; `record` runs under `--no-extensions` | ACs 5,8,18; depends on T011 (test-first) |
| [x] | T013 | **test→impl**: `doctor` enumerates record-types (core+extension provenance) without invoking handlers | CLI core | `src/services/doctor/doctor-service.ts`, `test/services/doctor/*` | Doctor shows record-types line | AC 5 |
| [x] | T014 | **test→impl**: `harness new <name> --record` scaffolds a record-type extension stub; `harness new record` rejected `E151` | CLI core | `src/services/scaffold/{scaffold-service,templates}.ts`, `src/acts/new.ts`, `test/services/scaffold/*` | Stub file created + loadable; reserved name rejected | ACs 7,8; Finding 04 |

**Group D — skill adaptation (manual) + gitignore**

> T016–T019 are **manual** skill/doc edits — verified by read + path-reference grep, **not provable by the test suite** (the spec's accepted test-boundary; the CLI↔skill seam is pinned by T004 instead).

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|---|---|---|---|---|---|---|
| [x] | T015 | Add `.harness/temp/` to `.gitignore` | substrate | `.gitignore` | `git check-ignore .harness/temp/x` matches; `.harness/records/` still tracked | ACs 12,17 |
| [x] | T016 | Adapt `eng-harness-3-observe`: scratch entries → `.harness/temp/<agent>/`; document path re-derivation on context loss | loop skills | `skills/eng-harness-loop/eng-harness-3-observe/SKILL.md` | No `docs/harness/_buffers` write path remains; scratch path documented | AC 10 (manual verify) |
| [x] | T017 | Adapt `eng-harness-4-retro`: `--drain` materialises a committed record via `harness record retro`; `--harvest` reads `.harness/records/retro/*` **and** legacy globs | loop skills | `skills/eng-harness-loop/eng-harness-4-retro/SKILL.md` | Drain/harvest paths updated; legacy back-compat retained | ACs 10,11 (manual) |
| [x] | T018 | Update `eng-harness-flow` SKILL + references: retro/record path narration (`docs/harness/agents` → `.harness/records/retro`) | loop skills | `skills/eng-harness-loop/eng-harness-flow/{SKILL.md,references/*}` | grep finds no stale `docs/harness/agents` retro paths | manual |
| [x] | T019 | Audit `eng-harness-1-boot` / `eng-harness-2-backpressure` for retro/record path refs; update if any | loop skills | `skills/eng-harness-loop/eng-harness-1-boot/SKILL.md`, `.../eng-harness-2-backpressure/SKILL.md` | grep clean | manual |

**Group E — docs**

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|---|---|---|---|---|---|---|
| [x] | T020 | Write `docs/how/record-and-record-types.md` (use `harness record`; placement/collision; authoring a type core+extension) | substrate | `docs/how/record-and-record-types.md` | Guide mirrors `docs/how/extend-the-harness.md` shape | Docs Hybrid |
| [x] | T021 | Update `README.md` + `skills/README.md` (add `harness record`; `.harness/records/` + gitignored `.harness/temp/`) | substrate | `README.md`, `skills/README.md` | Loop description mentions `harness record` | Docs Hybrid |

**Group F — verify**

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|---|---|---|---|---|---|---|
| [x] | T022 | Full green: `cd harness/cli && just fft` (fix→format→test w/ coverage) | CLI core | — | Existing suite + new tests pass; biome clean | AC 13 |

### Acceptance Criteria

Derived from spec ACs 1–18 (all testable):

- [x] AC1 — `record retro --slug x --json` → `ok` envelope, `data.path` + evidence under `.harness/records/retro/`, `next_action` to fill.
- [x] AC2 — second same-day create → `…-x-001.md`; third → `…-x-002.md`; never clobbers.
- [x] AC3 — unknown type → `error` `E180` exit 1, next_action lists known types.
- [x] AC4 — no `.harness/` → `unconfigured` exit 2, next_action; nothing written.
- [x] AC5 — `--list` (human + `--json` with `{type,description,source,entryPath?}`) enumerates core ∪ extension; `doctor` shows the same.
- [x] AC6 — `.harness/extensions/*.record.ts` (`kind:'record'`) discovered + usable; load failure non-fatal (`E140`, in doctor).
- [x] AC7 — `new <name> --record` scaffolds a loadable record-type stub.
- [x] AC8 — `record` reserved (runs under `--no-extensions`; `new record` → `E151`).
- [x] AC9 — `RETRO_TEMPLATE` keys ⊇ schema required fields; uses open `system` object (T004).
- [x] AC10 — observe writes scratch to gitignored `.harness/temp/<agent>/`; drain materialises a committed record via `harness record retro`.
- [x] AC11 — harvest reads new + legacy globs.
- [x] AC12 — `.harness/temp/` gitignored; `.harness/records/` committed.
- [x] AC13 — full CLI suite passes; new behaviour covered by fake-adapter tests.
- [x] AC14 — type-name validated `^[a-z][a-z0-9-]*$`.
- [x] AC15 — deterministic registry merge + core-shadow/extension conflict recorded.
- [x] AC16 — malformed record export skipped + recorded, never crashes.
- [x] AC17 — `record` ensures `.harness/temp/` exists + gitignored on first use.
- [x] AC18 — bare `harness record` = orientation listing, exit 0.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Widening the verb-only loader breaks existing verb extensions | Medium | High | Back-compat test first (T007); `kind?` absent ⇒ verb; run full extension suite (T009/T022). |
| `RETRO_TEMPLATE` drifts from `retro.schema.json` | Medium | Medium | Pinned by T004 superset test; single source of truth note. |
| Core-template packaging (inline vs bundled `.md`) | Low | Low | Lean = inline TS const (T002) — no `package.json#files` change. |
| Scope creep into validation/harvest in core | Low | Medium | Spec non-goals explicit; reviewer rejects; core stays 4-field + scaffold-only. |
| Skill adaptation not unit-testable (manual) | Medium | Low | CLI↔skill seam pinned by T004; skill edits verified by read + path grep (T016–T019). |

## Notes

- **Deferred (out of scope, next plan)**: `harness init` governance writer; a second core record type (`dev-survey` stays a docs example, Q-C); runtime record validation; external pipeline-skill adoption (`plan-6a*`).
- **Q-A** (inline vs bundled templates) → resolved lean **inline TS const** (T002); revisit only if templates grow large.
- **Effort concentration**: T007–T009 (widening the verb-only loader for `kind:'record'`) is the risky mini-phase that drives most of the effort and risk. CS-3/Simple is retained because the surface is one cohesive CLI change with strong fakes; if T007–T009 balloons during build, escalate to Full and split it out.

---

## Validation Record (2026-06-09)

`/plan-3` auto-validation — 3 agents (coherence/completeness, thesis, forward-compatibility).

| Agent | Lenses | Issues | Verdict |
|-------|--------|--------|---------|
| Coherence & Completeness | Integration & Ripple, Edge Cases, Hidden Assumptions, Implementation Readiness | 1 CRITICAL, 1 MED, 1 LOW — all fixed | ⚠️ → ✅ |
| Thesis Alignment | Thesis Alignment | 0 (1 LOW = no-op) | ✅ |
| Forward-Compatibility | Forward-Compatibility (paths verified vs source) | 2 MED, 1 LOW — addressed | ⚠️ → ✅ |

**Fixes applied:**
- **CRITICAL** — T006 ordered the core∪extension registry *merge* before the loader was widened (Group B). Split: T006 is now **core-types-only**; the extension-aware merge moved into **T009** (after the loader widens). Removes the build-against-a-missing-seam trap.
- **MED** — T009 Done-When made observable (doctor provenance/conflicts + `--list` still enumerates).
- **MED** — T012's dependency on T011 made explicit; Group D flagged **manual / not suite-testable** (accepted test-boundary).
- **LOW** — P10 strengthened from assertion to precedent: `record` is a reserved core *command* (like `skills`/`new`/`docs`, all post-P10), so no amendment.
- **Note** — T007–T009 called out as the effort/risk-concentrated mini-phase (escalate to Full if it balloons).

**Thesis alignment**: value claim advanced at Implementation proof with Strong evidence; no non-goal creep; main risk is the loader-widening mini-phase, now explicitly flagged.

**Outcome alignment**: "A core command makes record creation deterministic, agent-callable, and uniform." — the plan advances this; the ordering trap is fixed and the manual-skill rows are scoped as a known test-boundary.

**Standalone?**: No — `/plan-6` (implementation) is the pending consumer.

Overall: ⚠️ VALIDATED WITH FIXES → **READY**
