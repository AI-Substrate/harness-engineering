# Execution Log — Plan 007 first-class-documentation (Implementation phase)

**Mode**: Simple (single phase, 16 tasks) · **Testing**: Hybrid (TDD for DocsService + docs act; snapshot/byte-drift; curation) · fakes only.
**Companion**: `code-review-companion` run `2026-06-08T22-08-20-158Z-d7d0` (Power-On-Mode, live review per commit).

## Pre-flight discoveries (before T001)

| # | Discovery | Decision |
|---|-----------|----------|
| D1 | Corpus member `authoring-verbs` source is `harness/cli/docs/authoring-verbs.md` (exists), not `docs/`. All 4 manifest sources resolvable (3 exist + `using-harness-docs.md` authored in T004). | Manifest ids: `extend-the-harness`, `using-harness-docs`, `cli-readme`, `authoring-verbs`. |
| D2 | **Purity guard collision**: `test/architecture/no-direct-node-io.test.ts` scans `src/services/**/*.ts` for `from 'node:fs'`. The generated `docs-content.ts` embeds doc markdown as strings; a doc containing that literal would false-trip the guard. | Exclude the generated data module (by `@generated` header) from the purity scan. |
| D3 | **Biome churn risk**: the committed generated file is linted by `biome check harness/cli` (workshop accepts "linted by biome"). | Generator runs `biome format --write` on its own output as a final step → canonical, drift-stable bytes. |
| D4 | **Coverage**: `vitest` coverage `include: ['src/**/*.ts']`, no thresholds. Generated file is pure data. | Add `docs-content.ts` to coverage `exclude` to keep the report honest (non-blocking). |
| D5 | Command registration order in `buildProgram`: help, doctor, new, then verbs. `docs` registered after `new` → command list `['help','doctor','new','docs',...]`. Snapshots in `app.test.ts` (2 sites) + `index.test.ts` (1 site) updated in T010. | — |

## Task log

### T001 — docs contract types ✅
- Created `harness/cli/src/services/docs/contract.ts`: `DocEntry{id,title,summary,audience}`, `DocContent{id,title,content,format:'markdown'}`, `DocsListResult{docs}`, `DocLookup = DocContent | {notFound,id}`. Matches workshop §Contract + validation MEDIUM (format/audience pinned).
- `tsc --noEmit` clean. No imports → pure types module.

### T002 — E160 DOC_NOT_FOUND ✅
- Added `DOC_NOT_FOUND: 'E160'` to `error-codes.ts`; updated frozen snapshot in `error-codes.test.ts`. Both tests green (E-prefix uniqueness check passes).

### T003 — curated manifest ✅
- Created `harness/cli/src/services/docs/docs-manifest.json` — 4 curated docs (extend-the-harness, using-harness-docs, authoring-verbs, cli-readme), each id/title/summary/audience/sourcePath (repo-root-relative). `$comment` documents the P12 curation rule (excludes AGENTS.md/plans/project-rules/scratch). Valid JSON.

### T004 — using-harness-docs.md guide ✅
- Authored `docs/how/using-harness-docs.md` (standalone, matches docs/how/ style): model, list/read usage + JSON, exit codes (0/E160), "offline by design" bundling, and the "DocsService seam → future MCP docs_*" note. Also a corpus member (manifest id using-harness-docs).

### T005 — build-time generator ✅
- Created `scripts/gen-docs.mjs` (pure node, zero deps): validates each manifest entry + source existence (fail-fast), reads each .md, emits `docs-content.ts` with `@generated` header + `DOCS = [...] as const`, content via `JSON.stringify` (KF-06 escaping). Final step biome-normalises the output when biome is present (drift-stable + lint-clean per D3). `node --check` OK.
