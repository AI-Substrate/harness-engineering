# First-Class Documentation Support Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-08
**Spec**: [first-class-documentation-spec.md](first-class-documentation-spec.md)
**Workshop**: [workshops/001-doc-bundling-and-source-of-truth.md](workshops/001-doc-bundling-and-source-of-truth.md) (authoritative — Option C)
**Status**: READY

## Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No `[NEEDS CLARIFICATION]` markers; W1 + output-shape resolved in spec/workshop. validate-v2: thesis Advanced, 1 MEDIUM fixed (T001 contract pinned) |
| G2 | Constitution | PASS | `docs` is a CORE command (P10 intact); service pure (P2); curated allow-list (P12); envelope+exit codes (P4/P6); fakes (P3). Raw-markdown-for-`<id>` is a deliberate agent-ergonomic output (like `help`'s human text), not a violation. No deviation ledger needed. |
| G3 | Architecture | PASS | Service pure (no `node:fs`/`cwd`); act owns I/O; the generator is **build tooling**, outside the Acts→Services→Ports runtime. Layering respected. |
| G4 | ADR Compliance | N/A | No `docs/adr/` present |
| G5 | Structure | PASS | All required Simple-mode sections present + populated |
| G6 | Testing Alignment | PASS | Hybrid: test tasks precede impl for service/act; snapshot/drift tasks for content; ACs measurable |
| G7 | Domain Completeness | PASS | No formal registry (informal clusters); Target Domains + Domain Manifest cover every file referenced |

## Summary

Add a first-class, core `harness docs` command (peer of `help`/`doctor`/`new`) backed by a **pure `DocsService`** that lists and returns the harness's curated, publication-safe documentation so an `npx`/installed consumer can read it **offline**. Docs are bundled via **Option C** (workshop 001): a plain-`node` build-time generator inlines a curated allow-list of `.md` files into a committed `docs-content.ts` that `tsc` compiles into `dist` — single source of truth, no runtime path resolution, `files` unchanged. `harness docs` emits a JSON envelope list; `harness docs <id>` emits raw markdown to stdout; unknown ids return an `E160` error. The `DocsService` (`listDocs`/`getDoc`) is the transport-agnostic seam a **future MCP server** (out of scope) reuses unchanged.

## Target Domains

> No `docs/domains/` registry exists. Domains below are informal source clusters in `harness/cli/src/`, named for traceability only (no files moved/refactored).

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| `services/docs` (docs) | **NEW** | **create** | Pure `DocsService` (list/get) + curated manifest + generated content + types |
| `acts` (cli acts) | existing | **modify** | Add `registerDocsAct`; register in `app.ts` |
| `services/help` (help) | existing | **modify** | Advertise `docs` (PURPOSE / safe-first-actions / help text) |
| `services/extensions` (registry) | existing | **modify** | Add `docs` to `RESERVED_NAMES` (core command, cannot be shadowed) |
| `output` (output kernel) | existing | **modify** | Add `E160` (doc not found); update frozen error-codes table + test |
| build/packaging | existing | **modify** | `scripts/gen-docs.mjs` + `gen:docs`/`build` wiring; `files` unchanged |
| docs corpus (`docs/how`, `harness/cli`) | existing | **modify** | Author `using-harness-docs.md`; document `docs` in `harness/cli/README.md` |

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `harness/cli/src/services/docs/contract.ts` | docs | contract | `DocEntry`/`DocContent`/`DocsListResult`/`DocLookup` — the MCP-stable types |
| `harness/cli/src/services/docs/docs-manifest.json` | docs | internal | Curated allow-list (id/title/summary/sourcePath/audience) — the P12 curation point |
| `harness/cli/src/services/docs/docs-content.ts` | docs | internal | **GENERATED** (committed, "do not edit") — `DOCS` array |
| `harness/cli/src/services/docs/docs-service.ts` | docs | internal | Pure `listDocs`/`getDoc` over `DOCS` |
| `harness/cli/src/acts/docs.ts` | acts | internal | `registerDocsAct` — list→envelope, `<id>`→raw md, unknown→`E160` |
| `scripts/gen-docs.mjs` | build/packaging | internal | Build-time generator (plain node; reads manifest → emits `docs-content.ts`) |
| `harness/cli/src/output/error-codes.ts` | output | internal | Add `DOC_NOT_FOUND: 'E160'` |
| `harness/cli/src/services/extensions/registry.ts` | services/extensions | internal | `RESERVED_NAMES` += `docs` |
| `harness/cli/src/services/help/help-service.ts` | help | internal | Advertise `docs` |
| `harness/cli/src/app.ts` | acts | internal | Register `docs` in `buildProgram` |
| `docs/how/using-harness-docs.md` | docs corpus | internal | The user guide (also a corpus member — recursive) |
| `harness/cli/README.md` | docs corpus | internal | Document `docs` command + exit codes (P6) |
| `package.json` | build/packaging | internal | `gen:docs` script + `build` chaining |
| `harness/cli/test/services/docs/*.test.ts`, `test/acts/docs.test.ts`, `test/integration/docs.test.ts` | docs/acts | internal | TDD + snapshot/drift/curation tests |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | **No asset pipeline**: `build` is bare `tsc`, `files` ships only `harness/cli/dist`, `dist/` gitignored. Markdown won't ship without intervention. | Option C (workshop 001): generate committed `docs-content.ts` under `src/`; `files` unchanged. |
| 02 | High | **`tsconfig` `rootDir: src` + `include:["src"]`** forces the generated file under `src/`, where tests/biome consume it. | Commit the generated file (not gitignore); add drift test + CI regen-check (workshop 001 §D2). |
| 03 | High | **Service purity (P2)**: a service reading `node:fs`/`cwd` breaks layering AND the MCP seam. | `DocsService` operates over the imported `DOCS` array only; all I/O in the act. |
| 04 | High | **Frozen snapshots**: `error-codes.test.ts` snapshots the ErrorCodes table; `app.test.ts`/`index.test.ts` snapshot the command list (`['help','doctor','new',...]`). | Adding `E160` + the `docs` command **requires** updating these snapshots in the same tasks. |
| 05 | High | **Reserved-name parity**: core commands (`help`/`doctor`/`new`) are in `RESERVED_NAMES` so extensions can't shadow them (P8/P10). | Add `docs` to `RESERVED_NAMES`; update `registry.ts` + its test; update help PURPOSE wording ("help, doctor, new **and docs** are always available"). |
| 06 | Medium | **Generator escaping**: README/guide content contains backticks + `${`. | Emit `content` via `JSON.stringify(text)` (not template literals) — workshop 001. |
| 07 | Medium | **Recursive corpus**: `using-harness-docs.md` is both a deliverable and an allow-listed doc. | Author it before the generator runs in the final build; it's listed in the manifest. |
| 08 | Medium | **MCP forward-compat is a guardrail, not a deliverable**: nothing in this plan adds MCP; the service just must stay pure + typed. | Document `listDocs`/`getDoc` as the future `docs_*` seam in the guide + service doc comment. |

## Implementation

**Objective**: Ship a core `harness docs` command + pure `DocsService` + Option-C bundling, with curated, offline, drift-guarded docs, without precluding a future MCP server.
**Testing Approach**: **Hybrid** (spec) — TDD red→green for `DocsService` + `docs` act; snapshot/byte-drift tests for the generated index/content; curation test for P12; fakes only (no `vi.mock`).

### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T001 | Define docs contract types (full workshop shape) | docs | `harness/cli/src/services/docs/contract.ts` | Exports match workshop §Contract **exactly**: `DocEntry { id; title; summary; audience: 'human'\|'agent'\|'both' }`, `DocContent { id; title; content; format: 'markdown' }`, `DocsListResult { docs: DocEntry[] }`, `DocLookup = DocContent \| { notFound: true; id }`; `tsc` clean | MCP-stable shapes — `format`/`audience` pinned so a future `docs_*` tool imports unchanged (val MEDIUM) |
| [x] | T002 | Add `E160 DOC_NOT_FOUND` + update frozen error-codes test | output | `src/output/error-codes.ts`, `test/output/error-codes.test.ts` | New code present; snapshot test updated & green | Finding 04 |
| [x] | T003 | Author the curated allow-list manifest | docs | `src/services/docs/docs-manifest.json` | Lists `extend-the-harness`, `using-harness-docs`, `cli-readme`, `authoring-verbs` w/ id/title/summary/audience/sourcePath; excludes AGENTS.md/plans/scratch | P12 curation point |
| [x] | T004 | Author `using-harness-docs.md` (guide + corpus member) | docs corpus | `docs/how/using-harness-docs.md` | Standalone guide: `docs` usage, exit codes, "future MCP `docs_*` reuses `DocsService`" note | Findings 07/08; Doc Strategy |
| [x] | T005 | Write the build-time generator | build | `scripts/gen-docs.mjs` | `node scripts/gen-docs.mjs` reads manifest → writes `docs-content.ts` w/ `JSON.stringify`-escaped content + "do not edit" header | Findings 06; plain node, zero deps |
| [x] | T006 | Wire `gen:docs` into build | build | `package.json` | `"gen:docs"` added; `"build"` = `npm run gen:docs && tsc -p harness/cli/tsconfig.json`; `files` UNCHANGED | Workshop §Build wiring |
| [x] | T007 | Generate + commit `docs-content.ts` | docs | `src/services/docs/docs-content.ts` | `npm run gen:docs` produces it; committed; `tsc` compiles it | Committed per §D2 |
| [x] | T008 | **TDD** `DocsService` (RED→GREEN) | docs | `test/services/docs/docs-service.test.ts`, `src/services/docs/docs-service.ts` | Tests first: `listDocs()` returns entries; `getDoc(known)`→content; `getDoc(unknown)`→`{notFound,id}`. Service imports `DOCS`, no `node:fs`/`cwd`. Green. | Finding 03; fakes-only |
| [x] | T009 | **TDD** `registerDocsAct` (RED→GREEN) | acts | `test/acts/docs.test.ts`, `src/acts/docs.ts` | Tests first: `harness docs`→`formatOk` envelope `{docs:[…]}` exit 0; `harness docs <id>`→raw markdown to stdout exit 0; `harness docs <unknown>`→`formatError` `E160` exit 1 | Output shape per spec/workshop §D4 |
| [x] | T010 | Register `docs` in composition root + update command-list snapshots | acts | `src/app.ts`, `test/app.test.ts`, `test/index.test.ts` | `registerDocsAct(program, io, …)` after `registerNewAct`; command-list snapshots include `docs`; green | Finding 04 |
| [x] | T011 | Reserve `docs` core name | services/extensions | `src/services/extensions/registry.ts`, `test/services/extensions/registry.test.ts` | `RESERVED_NAMES` includes `docs`; conflict test green | Finding 05 |
| [x] | T012 | Advertise `docs` in help | help | `src/services/help/help-service.ts`, `test/services/help/*.test.ts` | PURPOSE mentions `docs`; `safe_first_actions` includes a `harness docs` line; `renderHelpText` shows it; tests updated | Finding 05; AC8 |
| [x] | T013 | **Drift + curation tests** | docs | `test/services/docs/docs-content.test.ts` | (a) for each manifest entry, `getDoc(id).content` byte-equals source `.md`; (b) `DOCS` ids ⊆ manifest; excludes AGENTS.md/`docs/plans/**`/`scratch/**` | R2/R3; AC4; snapshot index |
| [x] | T014 | Document `docs` in CLI README | docs corpus | `harness/cli/README.md` | `harness docs` + `harness docs <id>` documented with exit codes (0/1, `E160`) | P6; AC8 |
| [x] | T015 | Build + offline smoke | build | (build output) | `npm run build` green; `node harness/cli/dist/index.js docs` lists; `… docs extend-the-harness` prints md; `dist/services/docs/docs-content.js` contains content | AC5; proves npx ships docs |
| [x] | T016 | Full gate + CI drift guard | all | `package.json`/CI | `biome check` + `tsc` + `vitest run --coverage` green; add/note `npm run gen:docs && git diff --exit-code <generated>` check | AC12; R2 |

### Acceptance Criteria

- [ ] AC1 — `harness docs` emits `ok` envelope listing `{id,title,summary}[]` (human table in human mode), exit 0.
- [ ] AC2 — `harness docs <id>` (known) emits byte-faithful markdown content, exit 0.
- [ ] AC3 — `harness docs <unknown>` emits `formatError` with `E160` + fix-prescribing message (P7), non-zero exit.
- [ ] AC4 — Corpus is an explicit allow-list including `extend-the-harness`, `using-harness-docs`, the CLI README, and `authoring-verbs`; excludes `AGENTS.md`, `docs/plans/**`, `scratch/**` (P12) — asserted by a test.
- [ ] AC5 — Built package (`harness/cli/dist`) contains the doc content so `harness docs <id>` works for an npm/npx consumer with no repo checkout (`files` unchanged).
- [ ] AC6 — `DocsService` source imports no `node:fs` and reads no `process.cwd()`; returns the **full typed records** (`DocContent` with `format: 'markdown'`, `DocEntry` with `audience`) per the workshop contract; all formatting in the act.
- [ ] AC7 — `docs` is a CORE command (registered in `buildProgram`), not an extension verb; reserved in `RESERVED_NAMES` (P8/P10 intact).
- [ ] AC8 — `harness help` advertises `docs`; `harness/cli/README.md` documents it with exit codes (P6).
- [ ] AC9 — `E160` added to the error-codes table and its frozen snapshot test updated.
- [ ] AC10 — `docs/how/using-harness-docs.md` exists, reads standalone, and is itself listed/retrievable via `harness docs`.
- [ ] AC11 — The guide/service comment documents `listDocs`/`getDoc` as the future `mcp/tools/docs_*` seam; no MCP code added; service couples to neither commander nor stdout.
- [ ] AC12 — `biome` + `tsc` + vitest (with coverage) all green.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| R1 — Bundling mechanism wrong | Low (resolved) | High | Option C locked in workshop 001; `files` unchanged; no runtime resolution |
| R2 — Source↔artifact drift | Medium | Medium | Byte-drift test per entry (T013) + CI regen-clean check (T016) |
| R3 — Curation leak (P12) | Low | High | Explicit allow-list manifest + curation test (T013/AC4) |
| R4 — Frozen-snapshot churn breaks build | Medium | Low | T002/T010/T011 update the snapshots in-task |
| R5 — Raw-markdown stdout vs envelope confusion | Low | Low | List=envelope, `<id>`=raw md (EPIPE-safe), documented in README + help |

> **Agent Harness**: Not applicable (no `docs/project-rules/engineering-harness.md`; user override consistent with plans 004/005/006). Validation is via unit tests + the offline build smoke (T015) + an optional `minih` e2e agent at review time. Harness-loop scaffolding intentionally omitted (no harness governance doc / no `docs/harness`).

---

## Validation Record (2026-06-08)

### Validation Thesis

**Raison d'être**: Docs that live only in the repo tree are invisible to an agent that npx-installed the harness; a first-class `harness docs` command makes curated docs discoverable + readable offline.

**Value claim**: An installed/npx consumer reads the harness's curated docs locally (offline); a future MCP server reuses the same doc surface with zero rework.

**Artifact promise**: `/plan-6` can build the feature from this plan with minimal clarification.

**Intended beneficiaries**: the /plan-6 implementer; end users/agents of the installed CLI; a future MCP server.

**Proof target**: Implementation

**Evidence standard**: source-truth match for codebase claims; testable Done-When per task; build-smoke proving offline ship (AC5); purity test (AC6); curation/drift tests (AC4/R2).

**Thesis source**: first-class-documentation-spec.md + workshops/001 + original-ask.md

**Thesis verdict**: Advanced

**Main thesis risk**: Minimal — plan stays on offline curated docs + pure service + MCP seam without adding MCP work.

---

| Agent | Lenses Covered | Thesis Axes Covered | Issues | Verdict |
|-------|---------------|---------------------|--------|---------|
| Coherence & Source-Truth | Coherence, Completeness, System Behavior, Hidden Assumptions, Source Truth | Implementation Readiness, Evidence Sufficiency | 0 | ✅ |
| Thesis Alignment | Thesis Alignment, Proof-Level Fit | Thesis Alignment, User/Product Value Preservation | 0 | ✅ |
| Forward-Compatibility | Forward-Compatibility, Contract Integrity, Test Boundary | Agent Readiness, Downstream Usefulness | 1 MEDIUM fixed | ⚠️→✅ |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| `/plan-6` implementer | Tasks compile/test cleanly; committed generated `src/` file doesn't break `tsc`/`vitest`/`biome` | Build/packaging foot-gun | ✅ | T006–T007, T013, T016; workshop D2/D5 (committed under src + drift/regen check) |
| Future MCP `mcp/tools/docs_*` | `listDocs`/`getDoc` pure + fully-typed for direct import | Shape mismatch | ✅ (fixed) | T001 now pins `format:'markdown'` + `audience`; AC6/AC11; service tested at its own layer (T008) |
| Bundling/build chain | `files` unchanged; generated `.ts` → `dist`; no runtime resolution | Contract drift | ✅ | Summary + T006–T007 + AC5; workshop D1/D2 (Option C) |

**Thesis alignment**: Value claim advanced at the Implementation proof level with strong evidence; main risk minimal (no MCP scope creep, MCP seam now contract-pinned).

**Outcome alignment**: The plan advances "Docs that live only in the repo tree are invisible to an agent that npx-installed the harness; baking a curated, publication-safe doc set into the shipped CLI closes that gap" — and with the T001 fix the MCP seam is now fully contract-specified.

**Standalone?**: No — downstream consumers (/plan-6 implementer, future MCP server, build chain) are concrete and were validated.

Overall: VALIDATED WITH FIXES
