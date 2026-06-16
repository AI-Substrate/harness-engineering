# Backpressure Coverage — harness bypass + change records, `win` kind, measures doc

**Spec**: [harness-bypass-change-records-spec.md](./harness-bypass-change-records-spec.md)
**Generated**: 2026-06-16
**Certainty**: Partial

> Advisory only — informs `/the-flow 3 architect`. Never blocks, never gates, no scores. (See eng-harness-2-backpressure.)

This is the **computational tier pulled forward to design time**: can the 11 ACs be *proven by deterministic sensors*, or only eyeballed? The answer here is encouraging — the record/registry/doctor/observe/retro-template test harnesses already EXIST with working fakes, and every behaviour gap is a **BUILDABLE extension** of those exact files (no ABSENT-class infrastructure on the behaviour axis). The genuinely inferential rows (prose sweeps, the doc) are correctly inferential and don't drag the rating.

## Existing Sensors (inventory)

Single package: root `@ai-substrate/engineering-harness`; the CLI is `harness/cli/` (no nested workspace manifest). Tests live in `harness/cli/test/**` mirroring `src/**` (not co-located), 64 `*.test.ts`, run via `cd harness/cli && vitest run --coverage`.

| Sensor | Command | Dimension | Found in |
|--------|---------|-----------|----------|
| record-service unit (placement, ordinal, exit codes, unconfigured, E180/E181/E108) | `vitest run test/services/record/record-service.test.ts` | behaviour | `harness/cli/test/services/record/` |
| record registry (type enumeration, source `core`) | `vitest run test/services/record/registry.test.ts` | behaviour | `harness/cli/test/services/record/` |
| **retro template↔schema superset** (reads real skill `retro.schema.json`, asserts template keys ⊇ `schema.required`) | `vitest run test/services/record/retro-template.test.ts` | architecture-fitness | `harness/cli/test/services/record/` |
| `record` act (CLI verb wiring) | `vitest run test/acts/record.test.ts` | behaviour | `harness/cli/test/acts/` |
| observe service + `observe` act (`OBSERVATION_KINDS`, buffer codec) | `vitest run test/services/observe/observe-service.test.ts test/acts/observe.test.ts` | behaviour | `harness/cli/test/services/observe/`, `test/acts/` |
| doctor service + act (enumerates record types in envelope) | `vitest run test/services/doctor/doctor-service.test.ts test/acts/doctor.test.ts` | behaviour | `harness/cli/test/services/doctor/`, `test/acts/` |
| **FakeGit** adapter test (the injected git port — currently `isRepo`/`currentBranch`) | `vitest run test/adapters/git/fake-git.test.ts` | behaviour | `harness/cli/test/adapters/git/` |
| version-lookup adapter | `vitest run test/adapters/version-lookup/version-lookup.test.ts` | behaviour | `harness/cli/test/adapters/version-lookup/` |
| arch-check (dependency-cruiser, hexagonal P2 rules) | `node harness/cli/bin/harness.js arch-check --json` | architecture-fitness | `.dependency-cruiser.cjs` + `.harness/extensions/arch-check/` |
| skills-check (SKILL.md frontmatter ≤1024, warn ≥900) | `node harness/cli/bin/harness.js skills-check --json` | maintainability | `.harness/extensions/skills-check/` |
| docs drift guard | `npm run check:docs` (`gen:docs` + `git diff --exit-code docs-content.ts`) | maintainability | root `package.json` + `scripts/gen-docs.mjs` |
| lint / build / typecheck | `npx biome check harness/cli` · `npm run build` · `npx tsc --noEmit -p harness/cli/tsconfig.json` | maintainability | root `package.json` |
| package-smoke (pack tarball, install bin, run with `.ts` extension fixture) | CI job `package-smoke` | behaviour | `.github/workflows/ci.yml` |
| **CI proof gate** (`ci-required` ← rename-guard + build-test + package-smoke) | `.github/workflows/ci.yml` | behaviour + maintainability + architecture | `.github/workflows/` |

**CI severity nuance (matters for AC-11):** `arch-check` and `skills-check` ship at **WARN — exit 0, non-blocking** (they emit `::warning`, don't fail CI); coverage is **report-only, no thresholds**; only `check:docs` (`git diff --exit-code`) and biome/build/typecheck/vitest are **hard-blocking**. So "the full CI gate passes" (AC-11) is satisfied *with* arch-check/skills-check warnings present — AC-11 must not be mis-built as "zero warnings."

## Coverage Matrix

| Criterion / failure mode | Deterministic sensor | Status | Tier | Probe trail (required if ABSENT) |
|---|---|---|---|---|
| **AC-1** new types scaffold to `.harness/records/<type>/<date>/<NNN>[-slug].md`, return path, exit 0; unknown→E180; no `.harness/`→unconfigured(2) | extend `record-service.test.ts` + `acts/record.test.ts` (exact existing assertions, new type names) | **EXISTS** | computational | — |
| **AC-2** `record --list` + `doctor` enumerate both new types, source `core` | extend `registry.test.ts` + `doctor-service.test.ts`/`acts/doctor.test.ts` | **EXISTS** | computational | — |
| **AC-3** provenance keys stamped at write time, by CLI, from Clock/GitPort/version/env — never agent-filled | `record-service.test.ts` already asserts on the *written file text*; add `git`+`version` to `RecordDeps`, assert full key-set on output | **BUILDABLE** | computational | the "provenance-coverage test" the spec names (AC-5); today only `.toContain('schema_version')` is asserted |
| **AC-4** `branch`/`repo`/`plan_id`/`agent` degrade to `null` (no-repo / detached / no-remote / no-plan); write still succeeds | extend `record-service.test.ts` with a `FakeGit` returning null branch/remote | **BUILDABLE** | computational | `FakeGit` exists (`fake-git.test.ts`) but has no `remoteUrl` + no null-degradation case yet |
| **AC-5a** template *constants* byte-identical (`RETRO_TEMPLATE` + 2 new templates) | `retro-template.test.ts` asserts on the constant (`expect(template).toBe(...)`-style superset) | **EXISTS** | architecture-fitness | — |
| **AC-5b** *written* record carries **every** Frozen-Contract provenance key (not the constant) | new provenance-coverage test (no current test asserts the full key-set on the written file) | **BUILDABLE** | computational | grepped `**/*.test.ts` for provenance/written-frontmatter assertions — only a single `schema_version` substring check exists |
| **AC-6** new bodies carry exactly the contract keys + `cause`/`change_type` enums + `resolves` format | extend the `retro-template.test.ts` superset pattern to the 2 new templates | **BUILDABLE** | architecture-fitness | superset test exists for `retro` only |
| **AC-7a** `harness observe "<x>" --kind win` succeeds (`OBSERVATION_KINDS` + `WIN` prefix) | extend `observe-service.test.ts` / buffer-codec test | **BUILDABLE** | computational | observe tests exist; no `win` case |
| **AC-7b** `win` is in the schema `kind` enum **and** existing retros still validate (additive) | — (no ajv/JSON-Schema validator anywhere; superset test checks `schema.required` keys, **never enum values**) | **ABSENT → BUILDABLE** | computational | grepped `ajv\|Ajv\|schema_version` across `harness/cli/**/*.test.ts` → no schema-validation test; `retro-template.test.ts` reads `schema.required` only, never `…entries.items.properties.kind.enum` |
| **AC-8** `history.md` deleted, row migrated, **no** doc still instructs writing it, L3 rung reworded | — (no grep-guard today; CI `rename-guard` job is a working precedent that greps for stale strings) | **ABSENT → BUILDABLE** | inferential (computational if a grep-guard is built) | grepped CI + tests for any `history.md` reference-guard → none; removal is currently a manual read-grep sweep (~17 ops/7 docs per dossier) |
| **AC-9** capture-seam prose exists, references the locked types w/o typos, fires at the intended seam | `skills-check` proves SKILL.md **loadability** only; "fires at the seam" is dogfood | **ABSENT** | inferential / human-judgement | skills-check EXISTS for loadability/description-limit; seam-firing is prose behaviour, not machine-provable (spec says "not CI-gated") |
| **AC-10** measures doc is load-bearing (denominator, hand-traced examples, DORA framing, governance) | file-existence is trivially checkable; doc *sufficiency* is inferential | **ABSENT** | inferential / human-judgement | a doc's correctness/sufficiency cannot be machine-proven; this is `/the-flow 7 review` + human territory |
| **AC-11** full CI gate green (biome, build, check:docs, typecheck, vitest+cov, arch-check, skills-check, package-smoke) | the CI pipeline itself (`ci-required`) | **EXISTS** | computational | — (note WARN-severity nuance above) |

## Certainty: Partial

Behaviour + architecture coverage is good and *getting better cheaply*: AC-1/2/5a/11 already have **EXISTS** sensors with working fake harnesses, and every gap (AC-3, AC-4, AC-5b, AC-6, AC-7a, AC-7b) is **BUILDABLE by extending those exact test files** — `FakeGit` already exists and only needs `remoteUrl`; the written-file assertion idiom (`fs.readText(...).toContain(...)`) is already in `record-service.test.ts`. No behaviour/architecture criterion is ABSENT-and-unbuildable. → **Partial** (gaps are specifiable sensors, not eyeball-only). The three inherently-inferential rows (AC-8 prose sweep, AC-9 seam prose, AC-10 doc) are correctly inferential/human-judgement and do not lower the rating.

## Recommended Phase 0: Establish Backpressure

The trigger fires (AC-3/4/5b/6/7a have no EXISTS sensor yet). **But** the repo idiom is full-TDD and the spec already folds these tests into Phase 1 (provenance) and Phase 2 (`win`) — so this is **not a separate upfront phase**; it is the **test-first set the architect should pin as the leading task of each phase**, plus two cheap sensors worth naming explicitly because they're the load-bearing proof for the frozen contract and the additive-schema claim:

| Sensor to build | Proves | Suggested form |
|-----------------|--------|----------------|
| **Provenance-coverage test** — write a record through `createRecord` with `FakeGit`+`FakeClock`+version, assert the written frontmatter carries the full Frozen-Contract key-set, values from ports | AC-3, AC-5b (provenance is *stamped from ports*, not placeholdered or agent-filled) | vitest + `FakeGit`/`FakeClock`/`FakeProcess` (Mock Usage B) |
| **Null-degradation case** — same test with `FakeGit` returning null branch/remote, no `HARNESS_PLAN_ID`/`HARNESS_AGENT` | AC-4 (keys stamp `null`, never guessed; write still succeeds) | vitest fake variant |
| **Body-superset extension** — apply `retro-template.test.ts`'s superset assertion to the `harness-bypass` + `harness-change` templates | AC-6 (bodies match the frozen contract incl. enums) | vitest, reuse `topLevelKeys`/`frontmatter` helpers |
| **`win`-enum assertion** — extend `retro-template.test.ts` to read `…kind.enum` from the skill schema and assert it contains `win`; assert the CLI template/encoding-hint mention `win` | AC-7b (the schema↔template↔codec triad is wired for `win`; cheapest deterministic proof since there's no ajv) | vitest, reads the real `retro.schema.json` |
| **`observe --kind win` case** — extend `observe-service.test.ts` | AC-7a (`win` accepted, `WIN` prefix round-trips) | vitest |
| *(optional)* **history.md reference-guard** — a grep-guard (test or CI step) asserting no tracked doc/skill string instructs writing `.harness/history.md` | AC-8 (turns the manual removal sweep into a deterministic regression guard) | follow CI `rename-guard` precedent; or a vitest grep over `skills/` + `docs/` + `.harness/` |

**Honest non-gaps:** AC-9 (seam prose) and AC-10 (doc sufficiency) are *legitimately* inferential — `/the-flow 7 review` + dogfood is the right tier; do **not** invent a sensor to "prove" prose reads well. A full ajv JSON-Schema validator for AC-7b is **optional**: the enum-membership + `observe --kind win` sensors cover the practical risk without a new dependency; reach for ajv only if the team wants true record-validation in CI (a larger, separable add).

## How this differs from plan-3 G6 and plan-7

- **plan-3 Gate G6 (Testing Alignment)** checks test *tasks exist* and ACs are *measurable* — not whether a deterministic sensor covers the experienced failure modes (this survey's job).
- **`/the-flow 7 review`** is the inferential/eyeball tier (AC-9 prose, AC-10 doc sufficiency, taste) — legitimate and unchanged.
- **eng-harness-2-backpressure (this survey)** is the computational tier *before* architecture: it found that the proof surface is strong-and-extensible (Partial, no ABSENT behaviour rows) and named the six small sensors to write test-first.
