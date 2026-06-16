# Harness bypass + change records, the `win` retro kind, and a measures doc — Implementation Plan

**Plan Version**: 1.0.0
**Created**: 2026-06-16
**Spec**: [harness-bypass-change-records-spec.md](./harness-bypass-change-records-spec.md)
**Mode**: Full
**Status**: READY

## Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No critical `[NEEDS CLARIFICATION]` markers. The 2 low-stakes open Qs are locked to their recommended defaults: **D4 base `HEAD` SHA → OUT** (addable later, non-breaking); **D10 the-flow pre-implement edit → OOS user-global follow-up** (in-repo guarantee = the retro `--drain` backstop). |
| G2 | Constitution | PASS | P2 (Hexagonal) honored: provenance via injected ports (`GitPort`/`Clock`) + `version` injected as a **string** (computed in the act, never `readVersion()` in the service) + a **pure string splice** (no `node:fs`/YAML-parse in the service). P10 (dynamic verbs): **no new verb** — types plug into `registry.ts:40`. P5/P6 exit codes preserved (E180/unconfigured-2). No HIGH violation → no Deviation Ledger. |
| G3 | Architecture | PASS | New `GitPort.remoteUrl()` is additive (port + adapters); `record-service` stays pure (deps injected); inward dependency rule intact. `arch-check` (dependency-cruiser) deterministically enforces and will prove it in CI. |
| G4 | ADR Compliance | N/A | No `docs/adr/` in this repo. |
| G5 | Structure | PASS | All required sections present and populated. |
| G6 | Testing Alignment | PASS | Spec Testing Strategy = **Hybrid** (full TDD + `Fake*` for CLI code; manual/dogfood for skill prose). Phases 1–2 order test tasks before impl; Phases 3–5 use verify/dogfood/grep-guard as the spec dictates. ACs are measurable. Mock Usage B (hand-written fakes, never `vi.mock`). |
| G7 | Domain Completeness | PASS | No formal `docs/domains/registry.md` (logical boundaries — spec-confirmed). Every spec domain appears in Target Domains; Domain Manifest covers every file in the phase tables; no NEW domains (all existing code areas). |

## Summary

Add two committed record types (`harness-bypass`, `harness-change`) and a positive retro `kind: win`, stamp a CLI-owned provenance header onto **every** record write via injected ports, remove the `.harness/history.md` concept (the `harness-change` ledger replaces it), wire in-repo capture-seam prompts so the signals get recorded, and write a measures design doc. The approach is **code-first**: the record types + provenance land first (Phase 1), the `win` kind next (Phase 2), then the prose/removal work (Phases 3–4) that is inert until the types ship, and the doc + docs-sync last (Phase 5). The hard architectural decisions — provenance splices only environment keys (`schema_version` stays template-owned to avoid a duplicate YAML key), `version` injected as a string to keep the service P2-pure — are locked here. **Scope stops at recording in-repo**; the cross-repo scanner and DORA correlation are explicitly OOS.

## Target Domains

*(No formal domain registry — logical code boundaries, per spec.)*

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| `services/record` | existing | modify | add `harness-bypass` + `harness-change` core types; provenance-splice in `record-service`; register at `registry.ts:40` |
| `adapters/git` | existing | modify | add `remoteUrl(): string \| null` to `GitPort` + `ExecGit` + `FakeGit` |
| `services/observe` + retro schema (`eng-harness-4-retro/references/retro.schema.json`) | existing | modify | add `win` to `OBSERVATION_KINDS` + the `kind` enum; `schema_version` 1.0→1.1 minor bump |
| harness-loop skills (`eng-harness-loop/*`, `eng-harness-setup/eng-harness-0-add-extension`) | existing | modify | capture-seam prompts; `history.md` removal prose |
| governance docs (`.harness/engineering-harness.md`, `eng-harness-flow/references/{governance-doc,maturity-assessment,getting-started}.md`) | existing | modify | drop `history.md`; reword L3 rung |
| `docs/how/` + docs bundle (`docs-manifest.json` → `docs-content.ts`) | existing | modify + create (doc) | new `harness-value-measures.md`; update `record-and-record-types.md`; `gen:docs` |

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `harness/cli/src/adapters/git/git-port.ts` | adapters/git | contract | add `remoteUrl(): string \| null` to the port interface |
| `harness/cli/src/adapters/git/exec-git.ts` | adapters/git | internal | implement `remoteUrl()` via `spawnSync('git', ['remote','get-url','origin'])` |
| `harness/cli/src/adapters/git/fake-git.ts` | adapters/git | internal | add `remoteUrl?` to fake state |
| `harness/cli/test/adapters/git/fake-git.test.ts` | adapters/git | internal (test) | pin `remoteUrl` + null cases |
| `harness/cli/src/services/record/record-service.ts` | services/record | internal | add `git: GitPort` + `version: string` to `RecordDeps`; call `spliceProvenance(...)` before the write at line ~174 |
| `harness/cli/src/services/record/provenance.ts` (or inline in `record-service.ts`) | services/record | internal | **NEW** pure helper `spliceProvenance(template, fields): string` — split on the first `---\n`, prepend the 7-key block, never touch `schema_version`, idempotent, no I/O (P2) |
| `harness/cli/src/services/record/contract.ts` | services/record | contract | (read-only reference — 4-field contract; no change) |
| `harness/cli/src/services/record/registry.ts` | services/record | contract | append 2 types to `coreRecordTypes` (line 40) |
| `harness/cli/src/services/record/core-types/harness-bypass.ts` | services/record | internal | NEW template + `HarnessRecordType` (mirror `retro.ts`) |
| `harness/cli/src/services/record/core-types/harness-change.ts` | services/record | internal | NEW template + `HarnessRecordType` |
| `harness/cli/src/acts/record.ts` | services/record | internal | add `version: string` to `RecordActDeps`; compute `version = readVersion()` + build `git` here; inject both into `RecordDeps` (no new verb; dispatch otherwise unchanged) |
| `harness/cli/test/services/record/record-service.test.ts` | services/record | internal (test) | provenance-coverage + null-degradation + new-type scaffold cases |
| `harness/cli/test/services/record/registry.test.ts` | services/record | internal (test) | enumerate 2 new core types |
| `harness/cli/test/services/record/retro-template.test.ts` | services/record | internal (test) | `win`-enum-membership (reads `retro.schema.json` `…kind.enum`) + `schema_version` sync (template == schema). **Note**: the new types have **no schema file** — their body assertion is a *frozen-body-keys* check (expected key-set in the test), not a template↔schema-file superset |
| `harness/cli/test/acts/record.test.ts` | services/record | internal (test) | `harness record harness-bypass`/`harness-change` verb wiring |
| `harness/cli/test/services/doctor/doctor-service.test.ts` | services/record | internal (test) | doctor enumerates the 2 new types (source `core`) |
| `harness/cli/src/services/observe/buffer-codec.ts` | services/observe | internal | add `win: 'WIN'` to `OBSERVATION_KINDS` |
| `harness/cli/test/services/observe/observe-service.test.ts` | services/observe | internal (test) | `observe --kind win` round-trips |
| `skills/eng-harness-loop/eng-harness-4-retro/references/retro.schema.json` | retro schema | contract | add `win` to `kind` enum; bump `schema_version` 1.0→1.1 |
| `harness/cli/src/services/record/core-types/retro.ts` | services/record | internal | Phase-2 only: bump `RETRO_TEMPLATE` `schema_version` 1.0→1.1 + add `win` to comment/encoding-hint |
| `.harness/history.md` | governance docs | internal | DELETE (after migrating its one row) |
| `.harness/records/harness-change/2026-06-16/001-*.md` | services/record | internal | NEW migration record (the 2026-06-10 cwd-independent-test-suite row) |
| `.harness/engineering-harness.md` | governance docs | internal | drop `history.md` example ref (line ~100) |
| `skills/eng-harness-loop/eng-harness-flow/references/governance-doc.md` | governance docs | internal | delete G3 section + reword G5 Improve row (lines 41–49, 64) |
| `skills/eng-harness-loop/eng-harness-flow/references/maturity-assessment.md` | governance docs | internal | reword L3 rung (line 30) + L4 cadence; "`history.md` row" → "`harness-change` record" |
| `skills/eng-harness-loop/eng-harness-flow/references/getting-started.md` | governance docs | internal | file-structure + loop-beats + ladder prose (lines 91,186,220,261) |
| `skills/eng-harness-loop/eng-harness-1-boot/SKILL.md` | harness-loop skills | internal | status-report/measure prose (lines 148,154) |
| `skills/eng-harness-loop/eng-harness-4-retro/SKILL.md` | harness-loop skills | internal | reword field-source comment (line 385); add `--drain` bypass backstop + `win` "what worked well?" beat |
| `skills/eng-harness-loop/eng-harness-flow/SKILL.md` | harness-loop skills | internal | document stateless `bypass_recommended`/`bypass_cause` envelope field |
| `skills/eng-harness-setup/eng-harness-0-add-extension/SKILL.md` | harness-loop skills | internal | Step 4 "record the change" on verification pass (best-effort) |
| `harness/cli/test/architecture/history-md-guard.test.ts` (or CI step) | services/record | internal (test) | NEW grep-guard: no tracked doc/skill instructs writing `.harness/history.md` |
| `docs/how/harness-value-measures.md` | docs/how | contract (doc) | NEW measures design doc (AC-10) |
| `docs/how/record-and-record-types.md` | docs/how | internal (doc) | add 2 new types + provenance section |
| `harness/cli/src/services/docs/docs-manifest.json` | docs/how | internal | add `harness-value-measures` manifest entry |
| `harness/cli/src/services/docs/docs-content.ts` | docs/how | internal (generated) | regenerated by `npm run gen:docs` (committed to pass `check:docs`) |
| `AGENTS_README.md` | docs/how | internal (doc) | update only if record guidance changes, then `gen:docs` |

## Key Findings

*(All file:line integration points below were **source-verified during validate-v2** — `RecordDeps = {fs,clock,proc}`, the write at `record-service.ts:174`, `version.ts` reads `node:fs`, `git-port.ts` exposes only `isRepo`/`currentBranch`, `RecordActDeps` lacks `version` — so these are confirmed integration targets, not assumptions.)*

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | **Critical** | **`schema_version` key-collision.** `RETRO_TEMPLATE` already declares `schema_version: "1.0"`; the Frozen Contract also lists `schema_version` as a provenance key. Splicing it would create a **duplicate YAML key** and force a byte-change to `RETRO_TEMPLATE`. | The splice injects **only the 7 environment/identity keys** (`record_kind`, `harness_version`, `branch`, `repo`, `created_at`, `agent`, `plan_id`). **`schema_version` stays template-owned** (matches the Frozen Contract "Source: record-type constant") — **all three templates declare `schema_version` in their constant**. So every written record carries **all 8** Frozen-Contract keys = 1 template-owned (`schema_version`) + 7 spliced; the provenance-coverage test asserts **all 8 present, exactly one each** — reconciling with spec AC-3's "8 keys merged into the frontmatter" while the *splice* only touches 7. `RETRO_TEMPLATE` byte-identical under Phase 1. |
| 02 | **High** | **`version` must be an injected string.** `readVersion()` (`version.ts:15`) reads `package.json` via `node:fs`; calling it inside `record-service` violates Constitution P2. It's already imported in `app.ts:46`. | Compute `version = readVersion()` in `acts/record.ts` and inject `deps.version: string`. The service does string interpolation only. `arch-check` proves the service stays I/O-free. |
| 03 | **High** | **Provenance splice = pure string op.** `record-service.ts:174` writes `fs.writeText(fileAbs, entry.template)`. Splice must go **after the opening `---\n`** (`template.split('---\n', 2)` → prepend the 7-key block), be **idempotent**, and never YAML-parse in the service (P2). | New pure helper `spliceProvenance(template, {record_kind, version, branch, repo, created_at, agent, plan_id})`; line 174 writes the spliced string. Unit-tested with all fakes. |
| 04 | **High** | **`history.md` has ZERO code writers** (pure hand-maintained prose). Removal = ~17 prose ops across **7 docs** + migrate **1 data row** (the 2026-06-10 cwd-independent-test-suite entry). No runtime breaks. | Phase 3: migrate the row → a `harness-change` record, delete the file, sweep all 7 docs (full inventory in `research-dossier.md` § history.md removal), then a grep-guard (precedent: CI `rename-guard`). |
| 05 | **High** | **No ajv/JSON-Schema validator anywhere** in the CLI; `retro-template.test.ts` asserts `schema.required` keys only — never enum *values*. So "`win` is in the enum / old records still validate" has no sensor today. | Cheapest deterministic proof (no new dep): extend `retro-template.test.ts` to read `…kind.enum` and assert it contains `win`, + a `schema_version`-sync assertion (template == schema). Full ajv validation is optional/OOS. |
| 06 | **High** | **`win` schema_version bump vs AC-5 "byte-identical".** Adding `win` needs `schema_version` 1.0→1.1 in the schema; for fresh records to be tagged correctly the **template** should bump too — a 1-line edit to `RETRO_TEMPLATE`, which the literal AC-5 text forbids. | Scope AC-5's "byte-identical" to the **provenance mechanism (Phase 1)**. The **only** edit to `RETRO_TEMPLATE` in this plan is the Phase-2 `schema_version` 1.0→1.1 bump (accompanies the schema's own bump), covered by the sync assertion (KF-05). Surfaced to validate-v2 + user-confirm; non-blocking. |
| 07 | **Medium** | **`doctor` + `acts/record` need NO code change.** Doctor auto-enumerates from the registry (`doctor-service.ts:217`); the record act is pure dispatch to `createRecord` (`acts/record.ts:55`). Types plug in at `registry.ts:40` only. | Phase 1 touches the registry + 2 new template files; doctor/list/verb coverage is *assertion-only* (extend tests, no new code). |
| 08 | **High** | **Skill `description:` frontmatter is near the 900-char `skills-check` warn band** (`eng-harness-flow` ~882). Seam prose in the description would trip the warn (non-blocking but noise) and risks the 1024 hard limit. | All capture-seam prose goes in the SKILL **body**, never the `description:`. Phase 4 verify step re-checks the band via `skills-check`. |

## Phases

### Phase Index

| Phase | Title | Primary Domain | Objective (1 line) | Depends On |
|-------|-------|---------------|-------------------|------------|
| 0 | *(Establish Backpressure — folded in, not standalone)* | — | The 6 sensors from `backpressure-coverage.md` are written **test-first inside Phases 1–2** (repo idiom is full-TDD); no separate phase. | — |
| 1 | CLI core: record types + provenance | services/record | Two new core types scaffold + every write carries the spliced provenance header (from ports) | None |
| 2 | `win` retro kind | services/observe + retro schema | `win` is a first-class kind in the codec + schema + template, additive (minor bump) | None (cluster after 1) |
| 3 | Remove `history.md` | governance docs / skills | Migrate the one row, delete the file, sweep 7 docs, guard against regressions | Phase 1 (needs `harness-change` type to migrate) |
| 4 | In-repo capture seams | harness-loop skills | The records actually get prompted at retro-drain / router / add-extension seams | Phases 1–2 (refs the types + `win`) |
| 5 | Measures doc + docs sync | docs/how | The load-bearing measures doc + the published-docs gate stays green | Phase 1 (documents the types) |

> **Backpressure folding (advisory, from `backpressure-coverage.md`, Certainty: Partial):** the survey recommended **not** a standalone Phase 0 — the 6 BUILDABLE sensors are extensions of existing fake-based tests, so they ride as the leading test task of each phase: provenance-coverage + null-degradation + `remoteUrl` (Phase 1), body-superset (Phase 1), `observe --kind win` + `win`-enum + version-sync (Phase 2), and the optional `history.md` grep-guard (Phase 3).

---

#### Phase 1: CLI core — record types + provenance stamping

**Objective**: Two new core types scaffold via `harness record <type>`, and every record write (incl. `retro`) carries the CLI-stamped provenance header, spliced from injected ports.
**Domain**: services/record (+ adapters/git, version)
**Delivers**: `GitPort.remoteUrl()`; `harness-bypass.ts` + `harness-change.ts` templates; `RecordDeps` gains `git`+`version`; `spliceProvenance` helper; registry entries; full test coverage.
**Depends on**: None.
**Key risks**: KF-01 (schema_version collision), KF-02 (version-as-string/P2), KF-03 (splice purity/idempotency).

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 1.0 | **Harness pre-flight** — `/eng-harness-flow --event pre-implement --phase "Phase 1: CLI core" --plan-dir docs/plans/020-harness-bypass-change-records` | — | Router envelope handled; boot verdict narrated verbatim before code | _Harness seam_ |
| 1.1 | **TEST** `remoteUrl` contract + null cases in `fake-git.test.ts` (repo w/ remote → url; no remote → null; not-a-repo → null) | adapters/git | RED: tests fail (no method yet) | TDD |
| 1.2 | Add `remoteUrl(): string \| null` to `GitPort`; implement in `ExecGit` (`git remote get-url origin`, null on non-zero) + `FakeGit` (state.remoteUrl) | adapters/git | GREEN: 1.1 passes | Additive (KF-07 pattern) |
| 1.3 | **TEST** provenance-coverage in `record-service.test.ts`: written frontmatter carries **all 8** Frozen-Contract keys, **exactly one each** (7 spliced from `FakeGit`/`FakeClock`/`version`/env + `schema_version` template-owned); assert `schema_version` is **present, not a hardcoded value** (read it from the template so Phase 2's 1.0→1.1 bump can't break this test); splice idempotent; **null-degradation** (FakeGit null branch/remote, no `HARNESS_PLAN_ID`/`HARNESS_AGENT` → those keys `null`, write still ok) | services/record | RED | Per finding 01, 02, 03; cross-phase hazard guarded |
| 1.4 | Add `git: GitPort` + `version: string` to `RecordDeps` **and `version: string` to `RecordActDeps`**; write `spliceProvenance(template, fields)` (pure: split on first `---\n`, prepend 7-key block, never touch `schema_version`); update `record-service.ts:174` to write the spliced string; wire `acts/record.ts` to compute `version = readVersion()` + build `git` + pass both into deps | services/record | GREEN: 1.3 passes; `arch-check` clean (service still I/O-free) | Per finding 01–03 |
| 1.5 | **TEST** new-type scaffold + **frozen-body-keys** in `record-service.test.ts`: `harness record harness-bypass`/`harness-change` → path/exit-0/E180/unconfigured-2; written body carries exactly the frozen contract keys (incl. `cause`/`change_type` enums, `resolves` ≤200 chars). **No schema file for the new types** — the assertion checks the body against an expected key-set in the test (not a template↔schema-file superset; only `retro` has a schema) | services/record | RED | Frozen Frontmatter Contract; finding C2 |
| 1.6 | Create `core-types/harness-bypass.ts` + `harness-change.ts` (mirror `retro.ts`: frontmatter `schema_version` + body keys; 4-field `HarnessRecordType`); register both in `coreRecordTypes` at `registry.ts:40` | services/record | GREEN: 1.5 passes | Per finding 04 (retro.ts:19–57 precedent) |
| 1.7 | **TEST+VERIFY** `record --list` + `doctor` enumerate both new types `source: core` (extend `registry.test.ts` + `doctor-service.test.ts` + `acts/record.test.ts`) | services/record | RED→GREEN; `harness doctor --json` shows `record-types: 3` | Doctor needs no code change (KF-07) |
| 1.z | **Harness phase-end** — `/eng-harness-flow --event phase-end --plan-dir docs/plans/020-harness-bypass-change-records` | — | Router envelope handled at phase end | _Harness seam_ |

#### Phase 2: `win` retro kind

**Objective**: `win` ("this worked well / the harness was effective") is a first-class kind across the codec, schema, and template — additive, backward-compatible (minor bump).
**Domain**: services/observe + retro schema.
**Delivers**: `win: 'WIN'` in `OBSERVATION_KINDS`; `win` in the schema `kind` enum; `schema_version` 1.0→1.1 (schema + template); encoding-hint + comment; tests.
**Depends on**: None (code-independent); land **after** Phase 1 at merge — `win` is only *usable* once the types/seams exist (Phase 4 depends on both 1–2).
**Key risks**: KF-05 (no validator — enum-membership is the proof), KF-06 (byte-identical scope vs the bump).

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 2.0 | **Harness pre-flight** — `/eng-harness-flow --event pre-implement --phase "Phase 2: win retro kind" --plan-dir docs/plans/020-harness-bypass-change-records` | — | Router envelope handled | _Harness seam_ |
| 2.1 | **TEST** — *add* three assertions (none exist today): (a) `observe --kind win` round-trips + `OBSERVATION_KINDS` exports `win: 'WIN'` (extend `observe-service.test.ts`); (b) **enum-membership** — read `retro.schema.json` `…entries.items.properties.kind.enum` and assert it ∋ `win` (extend `retro-template.test.ts`, which has *zero* enum assertions today); (c) **`schema_version`-sync (red-line)** — assert template `RETRO_TEMPLATE` `schema_version` == schema `schema_version` (both `1.1`); existing retros (no `win`) still validate | services/observe + schema | RED | Per finding 05, 06 |
| 2.2 | Add `win: 'WIN'` to `OBSERVATION_KINDS` (`buffer-codec.ts:20`); add `win` to the schema `kind` enum + bump schema `schema_version` 1.0→1.1; bump `RETRO_TEMPLATE` `schema_version` 1.0→1.1 (**the only `RETRO_TEMPLATE` edit in this plan**) + add `win` to the encoding-hint table + template comment | services/observe + schema | GREEN: 2.1 passes | Per finding 06 (AC-5 scoped to provenance) |
| 2.3 | **VERIFY** additivity + forward note: a 1.0 retro with no `win` still validates against 1.1; document the version-coverage forward-compat note (scanner reports % readable, logs unreadable kinds) | schema | Documented in the record doc (Phase 5) + retro skill | R2 |
| 2.z | **Harness phase-end** — `/eng-harness-flow --event phase-end --plan-dir docs/plans/020-harness-bypass-change-records` | — | Router envelope handled | _Harness seam_ |

#### Phase 3: Remove `history.md`

**Objective**: The `harness-change` ledger replaces `.harness/history.md` entirely — migrate the one row, delete the file, re-point every reader, and guard against regressions.
**Domain**: governance docs / skills (prose) + 1 migration record.
**Delivers**: 1 migrated `harness-change` record; deleted `history.md`; ~17 reworded prose ops across 7 docs (incl. the L3 rung); a grep-guard.
**Depends on**: Phase 1 (the `harness-change` type must exist to migrate into).
**Key risks**: KF-04 (sweep completeness — no runtime break, but doc rot if missed).

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 3.0 | **Harness pre-flight** seam | — | Envelope handled | _Harness seam_ |
| 3.1 | Migrate the 2026-06-10 cwd-independent-test-suite row into a `harness-change` record (`harness record harness-change`); fill `change_type` (`fixture`), `target`, `resolves` (ref the plan-014 retro) | services/record | Record exists under `.harness/records/harness-change/` with the migrated content + stamped provenance | The one data row (KF-04) |
| 3.2 | Delete `.harness/history.md` | governance docs | File gone; `git status` shows deletion | After 3.1 |
| 3.3 | Sweep the 7 docs: `.harness/engineering-harness.md` (ex ref), `governance-doc.md` (delete G3 §, reword G5 Improve row), `maturity-assessment.md` (reword **L3 rung**: "a `history.md` row exists" → "a `harness-change` record exists" + L4 cadence), `getting-started.md` (file-structure/beats/ladder), `eng-harness-1-boot/SKILL.md` (status/measure prose), `eng-harness-4-retro/SKILL.md` (field-source comment) | governance docs / skills | No tracked doc/skill instructs writing or reading `history.md` as a live ledger; L3 rung reads in `harness-change` terms | Inventory in `research-dossier.md` § history.md removal |
| 3.4 | **TEST (MANDATORY guard — makes AC-8 deterministic)**: add `history-md-guard.test.ts` (or CI step) — grep `skills/` + `docs/how/` + `.harness/` for `\.harness/history\.md`; fail on any non-whitelisted live match (whitelist past-plan docs under `docs/plans/0NN-*` that *discuss* the removal). This converts the ~17-op sweep (full inventory in `research-dossier.md` § history.md removal) from an eyeball checklist into a regression gate | services/record | GREEN: zero live references | Precedent: CI `rename-guard` |
| 3.z | **Harness phase-end** seam | — | Envelope handled | _Harness seam_ |

#### Phase 4: In-repo capture seams

**Objective**: The records actually get recorded — highly-suggestive, non-blocking prompts at the in-repo seams, with no dependency on user-global the-flow.
**Domain**: harness-loop skills (prose).
**Delivers**: retro `--drain` bypass backstop + `win` "what worked well?" beat; `eng-harness-flow` `bypass_recommended`/`bypass_cause` envelope doc; `eng-harness-0-add-extension` Step 4 change-record prompt.
**Depends on**: Phases 1–2 (prose references the types + `win` — inert until they ship).
**Key risks**: KF-06/KF-08 (prose placement; description char band — body not `description:`).

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 4.0 | **Harness pre-flight** seam | — | Envelope handled | _Harness seam_ |
| 4.1 | `eng-harness-4-retro/SKILL.md`: add a `--drain` **bypass backstop** + a `win` "what worked well?" beat in a new capture-seams subsection (leave the `[s/t/p/e/d/a]` menu intact); reference `harness record harness-bypass` + `--kind win` with no typos | harness-loop skills | Prose exists, fires at the drain seam in dogfood; `description:` unchanged (body-only) | AC-9; KF-08 |
| 4.2 | `eng-harness-flow/SKILL.md`: document a **stateless** `bypass_recommended`/`bypass_cause` field in the `--json` envelope (router only *flags*, never writes/blocks) | harness-loop skills | Envelope doc present; description stays under the 900 warn band | AC-9; D2 |
| 4.3 | `eng-harness-0-add-extension/SKILL.md`: add a **Step 4 "record the change"** on verification pass (best-effort: "if the harness is set up, `harness record harness-change …`") | harness-loop skills | Optional, non-blocking step present; never errors when type absent | AC-9 |
| 4.4 | **VERIFY (dogfood + skills-check)**: prose fires at the intended seam; references the locked types without typos; `skills-check --json` shows no description in the 900–1024 band | harness-loop skills | Dogfood pass; `skills-check` clean (or warn-only) | AC-9; AC-11 |
| 4.z | **Harness phase-end** seam | — | Envelope handled | _Harness seam_ |

#### Phase 5: Measures doc + docs sync

**Objective**: The load-bearing measures design doc exists, and the published-CLI-docs gate stays green.
**Domain**: docs/how (+ docs bundle).
**Delivers**: `docs/how/harness-value-measures.md`; updated `record-and-record-types.md`; manifest entry + regenerated `docs-content.ts`.
**Depends on**: Phase 1 (documents the two types + provenance).
**Key risks**: KF-08 (R6 framing must be explicit); the `gen:docs`/`check:docs` coupling.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 5.0 | **Harness pre-flight** seam | — | Envelope handled | _Harness seam_ |
| 5.1 | Write `docs/how/harness-value-measures.md`: (a) bypass rate + change rate (encoded-mitigation ratio) + denominator (PRs primary, plans/sessions secondary); (b) **one hand-traced `harness-bypass` + one `harness-change` example showing every Frozen-Contract field** + a note that those fields are sufficient for a scanner to extract join keys; (c) DORA as leading/lagging correlation (not a 5th metric); (d) anti-Goodhart / team-level-only / no-individual-attribution + the R6 under-reporting defense | docs/how | All four (a–d) present; examples show every frozen field | AC-10; leans on `harness-foundations/source-notes/notes3.md` |
| 5.2 | Update `docs/how/record-and-record-types.md` (the 2 new types + the provenance header section); update `AGENTS_README.md` only if record guidance changed | docs/how | New types + provenance documented | AC-10 |
| 5.3 | Add `harness-value-measures` to `docs-manifest.json`; run `npm run gen:docs`; commit `docs-content.ts` | docs/how | `npm run check:docs` (gen + `git diff --exit-code`) passes | The doc-sync obligation (KF-07 from scout) |
| 5.4 | **VERIFY full CI gate** (AC-11): biome, build, **check:docs**, typecheck, vitest+coverage, arch-check, skills-check, package-smoke, ci-required | docs/how | CI green; note `arch-check`/`skills-check` ship WARN/exit-0 (non-blocking), coverage report-only — "green" ≠ "zero warnings" | AC-11 + the backpressure CI nuance |
| 5.z | **Harness phase-end** seam | — | Envelope handled | _Harness seam_ |

## Acceptance Criteria

- [ ] **AC-1** `harness record harness-bypass` / `harness-change` scaffold to `.harness/records/<type>/<YYYY-MM-DD>/<NNN>[-slug].md`, return the path, exit 0; unknown type → E180; no `.harness/` → unconfigured (exit 2). *(Phase 1.5–1.7)*
- [ ] **AC-2** `record --list` + `harness doctor` enumerate both new types with `source: core`. *(Phase 1.7)*
- [ ] **AC-3** Every record write (incl. `retro`) is stamped at write time by the CLI, merged into the frontmatter, carrying **all 8** Frozen-Contract keys (`schema_version` template-owned + the 7 spliced from Clock/`GitPort`/version/env) — never agent-filled. *(Phase 1.3–1.4; finding 01–03)*
- [ ] **AC-4** Git-unavailable / detached / no-remote / no-plan → `branch`/`repo`/`plan_id`/`agent` stamp `null`; write still succeeds. *(Phase 1.3–1.4)*
- [ ] **AC-5** *(scope per KF-06)* Template constants are byte-identical **under the provenance mechanism (Phase 1)** — provenance is splice-at-write, never baked into the constant. The **sole** `RETRO_TEMPLATE` edit in this plan is the Phase-2 `schema_version` 1.0→1.1 bump (a coordinated schema change, sync-tested in 2.1) — *not* part of AC-5. The existing superset test (asserts the constant) still passes; a new provenance-coverage test asserts the *written* record carries all 8 Frozen-Contract keys (exactly one each). *(Phase 1.3; finding 01, 06; R2 resolved)*
- [ ] **AC-6** `harness-bypass`/`harness-change` carry exactly the frozen body keys (incl. `cause`/`change_type` enums + `resolves` format), pinned by a **frozen-body-keys test** — the new types have **no schema file**, so the assertion is against the frozen key-set in the test, not a template↔schema-file superset (only `retro` has a schema). *(Phase 1.5; finding C2)*
- [ ] **AC-7** `harness observe "<x>" --kind win` succeeds; `win` is in the schema `kind` enum (bumped `schema_version`, minor); existing retros still validate; forward version-coverage documented. *(Phase 2)*
- [ ] **AC-8** `.harness/history.md` deleted, its row migrated to a `harness-change` record, no doc/skill still instructs writing it, L3 rung reads in `harness-change` terms. *(Phase 3)*
- [ ] **AC-9** In-repo capture seams prompt the records (prose, dogfood-verified, never blocks): retro `--drain` bypass backstop + `win` beat; router `bypass_recommended`/`bypass_cause` envelope doc; add-extension Step 4 change record. *(Phase 4)*
- [ ] **AC-10** `docs/how/harness-value-measures.md` is load-bearing (it **describes** the measures — it does **not** build the scanner/correlation, which is OOS): bypass/change rate + denominator; hand-traced examples showing **all 8 provenance keys** + body, proving the frontmatter is sufficient for a scanner to extract the join keys; DORA framed as leading/lagging correlation (not a 5th metric); anti-Goodhart/team-level-only + the R6 under-reporting defense. *(Phase 5.1)*
- [ ] **AC-11** Full CI gate passes (biome, build, check:docs, typecheck, vitest+coverage, arch-check, skills-check, package-smoke); skill `description:` stays under the 900-char warn band. *(Phase 5.4)*

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **R1 — `schema_version` duplicate-key** if the splice injects it | Medium | High (breaks YAML parse) | Splice injects only the 7 env/identity keys; `schema_version` template-owned; provenance-coverage test asserts exactly one (KF-01) |
| **R2 — AC-5 "byte-identical" vs the `win` schema_version bump** | — | — | **RESOLVED (validate-v2)**: AC-5's byte-identical is scoped to the Phase-1 provenance mechanism; the sole `RETRO_TEMPLATE` edit is the Phase-2 1.0→1.1 bump (coordinated schema change, sync-tested in 2.1). AC-5 reworded to embed the scope (KF-06) so review reads no contradiction |
| **R3 — provenance not P2-clean** (service touches fs/git) | Low | High | `version` injected as a string (computed in the act); splice is a pure string op; `arch-check` (dependency-cruiser) deterministically enforces (KF-02, KF-03) |
| **R4 — history.md sweep misses a reference** | Medium | Medium (doc rot, no runtime break) | Full inventory in `research-dossier.md`; grep-guard test (Phase 3.4) makes regressions deterministic (KF-04) |
| **R5 — under-reporting (Goodhart)** — capture is voluntary | High | Medium | Records framed as team-level-only gifts; AC-10 measures doc states "zero bypasses = not measured, not perfect" + PR denominator (KF-08; spec R6) |
| **R6 — schema/template version skew** for `win` | Medium | Medium | `schema_version`-sync assertion (template == schema); no second schema copy (R5 of spec confirmed) |
| **R7 — skill `description:` over the 900 warn band** | Medium | Low (warn-only) | Seam prose in the body, never the description; `skills-check` verify in Phase 4.4 (KF-08) |

## Harness Seams

- **Entry point**: `/eng-harness-flow --event <seam> [--phase <id>] [--plan-dir <p>] --json` — the single door to the engineering harness; child skills are private and never named in this plan.
- **Backpressure** (post-spec seam): ran before this plan — see [`backpressure-coverage.md`](./backpressure-coverage.md) (Certainty: **Partial**). Recommended Phase 0 folded in? **Yes** — the 6 sensors ride as test-first tasks in Phases 1–2 (no standalone Phase 0).
- **Pre-implement** (`--event pre-implement`): fired by the implement verb at each phase start (the N.0 rows); verdicts narrated verbatim from the envelope (`healthy / SLOW / UNHEALTHY / UNAVAILABLE`). `UNAVAILABLE` is not an error — falls back to standard testing.
- **Phase end** (`--event phase-end`): fired by the implement verb at each phase seam (the N.z rows); `--event plan-complete` fires at merge.
- **Best-effort**: every item above is advisory and never blocks; the router decides what the harness does at each seam. *(This plan dogfoods the very seams it edits — Phase 4's capture prompts are the same loop this plan rides.)*

---

## Validation Record (2026-06-16)

### Validation Thesis

**Raison d'être**: Give the 5 implement phases an unambiguous, P2-compliant build sequence so the harness's use/non-use/effectiveness becomes recorded in-repo.

**Value claim**: Implementation is buildable with minimal clarification; the hard architectural calls (schema_version collision, version-as-string, splice purity, AC-5 scope) are resolved up front, not discovered mid-build.

**Artifact promise**: Each phase has concrete deliverables + test-first tasks + measurable success criteria; the frozen contract is honored; CI stays green.

**Intended beneficiaries**: the 5 implement phases, `/the-flow 5 tasks`, `/the-flow 7 review`, the future OOS cross-repo scanner.

**Proof target**: Implementation.

**Evidence standard**: file:line integration points (source-verified during validate-v2), testable ACs mapped to phases, gate matrix, research-grounded mitigations.

**Thesis source**: `harness-bypass-change-records-spec.md` (11 ACs + Frozen Contract) + `distilled-ask.md` (10 decisions).

**Thesis verdict**: **Advanced** (after fixes) — value claim advanced at the Implementation proof level for the CLI phases; AC-9/AC-10 are legitimately inferential (dogfood/review tier), which is by-design per the spec's never-gate / team-level-only stance (R5/R6), not a defect.

**Main thesis risk**: the "recorded in-repo" leg leans on best-effort capture (R5/R6) — accepted and framed team-level-only in the measures doc; a capture-rate gate was *deliberately not added* (would violate the spec + harness doctrine).

---

| Agent | Lenses Covered | Thesis Axes | Issues | Verdict |
|-------|---------------|-------------|--------|---------|
| Coherence + Completeness | System Behavior, Edge Cases, Domain Boundaries, Implementation Readiness | Downstream Usefulness | 1 CRIT, 2 HIGH, 3 MED, 4 LOW | ⚠️ → fixed |
| Risk + Technical-Constraint | Technical Constraints, Hidden Assumptions, Integration & Ripple, Deployment/Ops | Safety to Change | 0 design bugs (KF-01/02/03 source-verified correct); 1 spec-clarity note | ✅ |
| Thesis Alignment | Thesis Alignment, Evidence Sufficiency, Proof-Level Fit | Thesis Alignment, Evidence Sufficiency | 2 HIGH, 4 MED/LOW | ⚠️ → fixed/accepted |
| Forward-Compatibility | Forward-Compatibility, Integration & Ripple, Contract Integrity | Contract Integrity | 1 CRIT, 1 HIGH, 3 MED/LOW | ⚠️ → fixed |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| `/the-flow 5 tasks` | unambiguous deliverables + test-first ordering | shape mismatch | ✅ (post-fix) | Phases carry objective/deliverables/per-task success criteria; TDD ordering annotated |
| `/the-flow 6 implement` | file:line targets + locked decisions | test boundary | ✅ | KF-01–08 source-verified; Phase 1 names real test files + fakes |
| `/the-flow 7 review` | testable ACs, no plan↔spec contradiction | contract drift | ✅ (post-fix) | AC-5 reworded to embed KF-06 scope; R2 resolved; 11 ACs testable |
| Future OOS scanner | frozen 8-key join contract honored | contract drift | ✅ (post-fix) | All 8 keys present per record (1 template-owned + 7 spliced); provenance-coverage test asserts all 8; AC-10 examples show all 8 |

**Thesis alignment**: Value claim advanced at the Implementation proof level; main risk (best-effort capture) is accepted-by-design (R5/R6, team-level-only), not a defect — and the frozen-contract integrity gap (7-vs-8 keys) is closed.

**Outcome alignment**: The plan's position (phase structure, Domain Manifest, locked decisions) advances the VPO Outcome ("You can't answer 'is the harness creating value?' with positive signals alone… This plan records the signals in-repo") — after fixes, the 8-key frozen contract is unambiguous for the future scanner and the AC-5 scope is contradiction-free for review.

**Standalone?**: No — downstream consumers (the 5 phases, tasks/implement/review stages, the future scanner) exist.

Overall: ⚠️ **VALIDATED WITH FIXES**
