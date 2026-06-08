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

### T006 — build wiring ✅
- package.json: added `"gen:docs": "node scripts/gen-docs.mjs"`; `"build"` now `npm run gen:docs && tsc -p harness/cli/tsconfig.json`. `files` UNCHANGED (["harness/cli/dist","LICENSE"]) — Option C ships docs via compiled src, no asset dir.

### T007 — generate + commit docs-content.ts ✅
- `npm run gen:docs` → committed `harness/cli/src/services/docs/docs-content.ts` (4 docs, `as const`). tsc clean.
- D2 (purity guard): updated `test/architecture/no-direct-node-io.test.ts` to skip files with the `@generated` header (generated doc data can legitimately quote `from 'node:fs'` in prose). Guard green.
- D3 (biome): docs contain literal `${...}` in code examples → `noTemplateCurlyInString` warnings. Added a biome `overrides` entry disabling the linter for `docs-content.ts` (formatter stays on). `biome check --error-on-warnings harness/cli` now exit 0; formatter no-op; regen drift-stable.

### T008 — TDD DocsService ✅ (RED→GREEN)
- RED: wrote docs-service.test.ts (5 tests, fakes-only) → import-fail.
- GREEN: `docs-service.ts` — pure `listDocs(docs=DOCS)` (strips content) + `getDoc(id, docs=DOCS)` (→DocContent w/ format:'markdown' | {notFound,id}). Imports DOCS only; no node:fs/cwd (P2/Finding 03). Optional corpus param = test seam + MCP-reuse. `DocRecord` exported. 5 tests green; tsc + biome clean.

### T009 — TDD registerDocsAct ✅ (RED→GREEN)
- RED: docs.test.ts (6 tests) → import-fail.
- GREEN: `acts/docs.ts` — list→formatOk {docs} (+human table); `<id>`→raw markdown to stdout (no envelope) exit 0; `<unknown>`→formatError E160 exit 1. All exits via exitWithEnvelope (single-exit guard intact).
- Discovery: test bug — `not.toContain('"status"')` collided with a JSON example inside extend-the-harness.md. Replaced with `startsWith('{"command"')===false`; full-equality `out()===content` already proves raw-dump.
- Added EPIPE guard in `index.ts` (swallow broken-pipe on stdout via process.exitCode, re-throw other stream errors) so `harness docs <id> | head` never stack-traces — makes the act's EPIPE-safe comment true.
- 6 act tests green; tsc + biome + architecture(single-exit) green.

### T010 — register docs in composition root ✅
- app.ts: import registerDocsAct (biome organizeImports placed it before doctor), call `registerDocsAct(program, io)` after registerNewAct → command order help, doctor, new, docs, <verbs>.
- Updated frozen command-list snapshots: app.test.ts (2 sites) + index.test.ts (1 site) → ['help','doctor','new','docs',...]. Integration test asserts core cmds individually (no full-list snapshot). 16 tests green; tsc + biome clean.

### T011 — reserve docs core name ✅
- registry.ts: RESERVED_NAMES += 'docs'; added a parallel `docs`-reserved test (extension `docs` verb → conflict, shadows ['docs']).
- Coupled fixes: scaffold-service.ts next_action message now "(reserved: help, doctor, new, docs)"; scaffold reserved-name it.each += 'docs' (E151).
- Coupled doc accuracy: extend-the-harness.md + authoring-verbs.md "reserved core commands" lines now include docs → regenerated docs-content.ts (2 lines changed). tsc + biome + 43 tests green.

### T012 — advertise docs in help ✅
- help-service.ts: PURPOSE now "help, doctor, new, and docs are always available"; safe_first_actions += a `harness docs` line; renderHelpText Commands list += `docs [id]`. Pinned with a `text.toContain('docs')` assertion. 8 help tests green; biome clean.

### T013 — drift + curation tests ✅
- docs-content.test.ts: (a) per-manifest-entry byte-equal `getDoc(id).content === source .md` (proves Option-C round-trip + catches stale regen/hand-edits); (b) set(DOCS ids)===set(manifest ids); (c) listDocs ids match; (d) P12 forbidden-path guard (AGENTS.md/docs/plans/scratch). 7 tests green; biome clean.
- Follow-up: biome `it.each` formatting — ran `biome format --write` on the drift test (cosmetic). biome check green.

### T014 — document docs in CLI README ✅
- harness/cli/README.md: command-surface table += `harness new <name>` (was missing since plan 006) + `harness docs [id]`; intro + reserved-commands line now list help/doctor/new/docs; usage block += docs examples; exit-codes table += E160. README is a corpus member → regenerated docs-content.ts; drift test green; tsc clean.

### T015 — build + offline smoke ✅
- `npm run build` (gen:docs && tsc) exit 0; `dist/services/docs/docs-content.js` = 26KB with embedded content (`files` unchanged → ships via dist).
- Smoke (run from /tmp, offline, dist only): `docs`→ok envelope exit 0; `docs extend-the-harness`→raw md exit 0; `docs no-such-doc`→E160 exit 1; `docs <id> | head -2`→EPIPE-safe (no stack trace, exit 0); `docs --no-json`→human table. Proves npx ships docs offline (AC5).

### T016 — full gate + CI drift guard ✅
- Added `"check:docs": "npm run gen:docs && git diff --exit-code <generated>"`; CI step "Docs drift guard" after Build (runs `npm run check:docs`). Verified: passes clean; catches an edited-source-without-regen (exit 1).
- Excluded the generated data file from coverage (vitest.config.ts) alongside src/index.ts.
- FINAL GATE: biome(--error-on-warnings) 0 · tsc 0 · check:docs 0 · vitest 210/210 pass (35 files) · coverage 93.4%.
