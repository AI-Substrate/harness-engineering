# Extension Enhancements 1 Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-10
**Spec**: [extension-enhancements-1-spec.md](./extension-enhancements-1-spec.md)
**Status**: READY

## Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No `[NEEDS CLARIFICATION]` markers; spec Open Questions: none remaining (9 clarification rounds recorded) |
| G2 | Constitution | PASS | P2 (FsPort, no node:fs in services), P3 (fakes), P4/P5 (envelope + honest unconfigured), P7 (doctor prescribes fix), P10 (verbs stay dynamic; `instructions` joins `help`/`doctor` as a reserved **core act**, not a verb list) all honored; no Deviation Ledger needed |
| G3 | Architecture | PASS | New code follows Entrypoint → Act → Service → Port layering; instructions reads via `FsPort`; single `process.exit` site untouched |
| G4 | ADR Compliance | N/A | No `docs/adr/` directory exists |
| G5 | Structure | PASS | All required sections present; cross-references resolve |
| G6 | Testing Alignment | PASS | Hybrid per spec: RED test tasks precede GREEN impl tasks for every CLI-core area; lightweight/manual verification noted on docs/skill/governance tasks; criteria measurable |
| G7 | Domain Completeness | PASS | No `docs/domains/` registry (constitution §5: domain system not initialized — informal areas tracked for traceability, matching the spec's Target Domains note); all 5 spec domains present; manifest covers all task files; no NEW domains |

## Summary

The harness CLI gains **agent instructions** — a queryable role-briefing channel for the calling agent: a baked core briefing surfaced by a new core act `harness instructions`, and per-extension briefings as `instructions.md` files loaded at runtime from disk via `FsPort` (`harness instructions <verb>`). Simultaneously, extension discovery becomes **folder-only**: an extension is a little package at `.harness/extensions/<name>/` with convention-required files (`extension.ts` entry + `instructions.md`) that `doctor` validates and wails about when missing, plus free-form internals imported relatively. The repo's two dogfood extensions move to folder form with genuine authored briefings (one splitting helpers into `lib/` to prove package-internal imports), the eng-harness skills drop the legacy governance fallback chain in favour of canonical `.harness/engineering-harness.md`, and this repo finally authors its own governance doc. Single phase, TDD for CLI core, full suite green at the end.

## Target Domains

> No `docs/domains/` registry exists (constitution §5: domain governance is additive, not yet initialized). Domains below are the repo's informal areas, as declared in the spec.

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| harness-cli core (`harness/cli/src`) | existing (informal) | modify | Folder-only discovery + rejected-entry records; new `instructions` service/act (baked core briefing + runtime `.md` loading); help banner + `has_instructions`; doctor package-convention validation; folder-form scaffold |
| dogfood extensions (`.harness/extensions/`) | existing (informal) | modify | Move both flat extensions to `<name>/extension.ts` packages; author genuine `instructions.md` briefings; split `validate-harness-flow` helpers into `lib/` |
| harness skills (`skills/eng-harness-*`) | existing (informal) | modify | Remove legacy `docs/project-rules/*` governance fallback chain; boot gains step-0 "read instructions"; folder-form extension prose; breadcrumb in governance-doc template |
| repo governance (`.harness/`, `AGENTS.md`, `README.md`) | existing (informal) | modify | Author `.harness/engineering-harness.md` (8 BIO fields, boot = vitest); correct `AGENTS.md:21` + `README.md:114` |
| docs (`docs/how/`) | existing (informal) | modify | `extend-the-harness.md` rewrite (folder layout, instructions authoring, minih distinction) + `npm run gen:docs` regen |

## Domain Manifest

> Paths relative to repo root `~/substrate/harness-engineering`.

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `harness/cli/src/services/extensions/discovery.ts` | harness-cli core | internal | Folder-only resolution chain + rejected-entry reporting |
| `harness/cli/src/services/extensions/registry.ts` | harness-cli core | internal | Synthesize `failed` records for rejected flat files; `instructions` added to `RESERVED_NAMES` |
| `harness/cli/src/services/extensions/contract.ts` | harness-cli core | contract | **Guard: expected unchanged** — `HarnessVerb`/`ExtensionRecord` shapes suffice (verb→folder via record `entryPath`); any change needs explicit justification |
| `harness/cli/src/services/instructions/core-instructions.ts` | harness-cli core | internal | NEW — baked core agent briefing (TS constant, help-service style) |
| `harness/cli/src/services/instructions/instructions-service.ts` | harness-cli core | internal | NEW — verb→folder resolution, runtime `instructions.md` read via `FsPort`, `verbs_with_instructions` |
| `harness/cli/src/acts/instructions.ts` | harness-cli core | internal | NEW — `harness instructions [verb]` act, envelope + exit codes |
| `harness/cli/src/app.ts` | harness-cli core | internal | Register instructions act |
| `harness/cli/src/services/help/help-service.ts` | harness-cli core | internal | `agents_start_here` + per-verb `has_instructions` (FsPort injected) |
| `harness/cli/src/acts/help.ts` | harness-cli core | internal | Compose FsPort into help service |
| `harness/cli/src/services/doctor/doctor-service.ts` | harness-cli core | internal | Package-convention validation (instructions.md presence per extension; core instructions row) |
| `harness/cli/src/services/scaffold/scaffold-service.ts` | harness-cli core | internal | Folder-form output + starter `instructions.md` |
| `harness/cli/src/services/scaffold/templates.ts` | harness-cli core | internal | Starter `instructions.md` template; entry templates unchanged in content |
| `harness/cli/src/acts/new.ts` | harness-cli core | internal | Folder-form reporting; no `--flat` |
| `harness/cli/src/output/error-codes.ts` | harness-cli core | contract | New codes E143/E144/E145 (additive) |
| `harness/cli/test/**` (≈10 touched files + new fixtures) | harness-cli core | internal | Fixture migration to folder layout; new RED tests; jiti subdir-import fixture |
| `harness/cli/src/services/docs/docs-content.ts` | harness-cli core | internal | Regenerated by `npm run gen:docs` after doc edit (never hand-edited) |
| `.harness/extensions/validate-harness-flow/{extension.ts, lib/worker-io.ts, instructions.md}` | dogfood extensions | internal | Moved from flat file; helper split proves AC-14; authored briefing |
| `.harness/extensions/validate-harnessability/{extension.ts, instructions.md}` | dogfood extensions | internal | Moved from flat file; authored briefing |
| `skills/eng-harness-loop/eng-harness-1-boot/SKILL.md` | harness skills | internal | Canonical-only governance path; step-0 read-instructions |
| `skills/eng-harness-setup/eng-harness-0-harnessability-assessment/SKILL.md` (+ `templates/assessment-latest.md`) | harness skills | internal | Drop legacy fallback chain |
| `skills/eng-harness-loop/eng-harness-2-backpressure/SKILL.md` | harness skills | internal | Drop legacy fallback chain |
| `skills/eng-harness-loop/eng-harness-4-retro/SKILL.md` | harness skills | internal | Drop legacy fallback chain |
| `skills/eng-harness-loop/eng-harness-flow/SKILL.md` | harness skills | internal | Correct flat-extension-path prose |
| `skills/eng-harness-loop/eng-harness-flow/references/governance-doc.md` | harness skills | internal | "AGENTS START HERE → `npx harness instructions`" breadcrumb (AC-12 mechanism) |
| `.harness/engineering-harness.md` | repo governance | internal | NEW — this repo's hand-written governance doc (8 BIO fields) |
| `AGENTS.md` | repo governance | internal | Line 21: canonical path + current framing |
| `README.md` | repo governance | internal | Line 114: canonical path |
| `docs/how/extend-the-harness.md` | docs | internal | Folder layout (only form), instructions authoring, minih distinction |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | **Discovery tracks no rejections.** `discovery.ts` returns `string[]` candidates only (flat files accepted at lines 41–43 via `CODE_FILE`; subdirs already resolve manifest → `index.ts`/`index.js` at 52–64); nothing records what was skipped, so doctor cannot surface flat files today. `registry.ts` already has a `failed()` helper (≈206–213) that builds a record without a load attempt. | Decision D1: discovery returns `{ candidates, rejected[] }`; registry synthesizes `failed` records (E143) from `rejected[]`. Doctor's existing record rendering then surfaces them with **zero new doctor render paths**. |
| 02 | Critical | **Scaffold writes flat files; spec entry is `extension.ts`, not `index.ts`.** `scaffold-service.ts:78–106` writes `<name>.ts` (or `<name>.record.ts`) directly under `.harness/extensions/`; the research suggestion to scaffold `index.ts` contradicts spec AC-6/AC-8 — the canonical entry is `extension.ts`, with `index.*` as fallback in the chain. | Scaffold writes `<name>/extension.ts` (or `extension.js` with `--js`; `--record` template content also lands in `extension.ts` — the `.record.ts` filename convention dies) + starter `instructions.md`. Discovery's per-folder chain becomes `manifest → extension.ts → extension.js → index.ts → index.js`. |
| 03 | High | **~10 test fixtures/seedings assume flat layout.** Physical fixtures (`test/integration/fixtures/repo/.harness/extensions/{hello.ts,build.ts,broken.ts,greetjs.js}`, `repo-conflict/{alpha.ts,beta.ts}`) plus FakeFs seedings (`app.test.ts:60–61`, `new.test.ts:62,73,114,134`) all break when discovery goes folder-only. | Dedicated fixture-migration task (T011) converts all to folder form in the same change as discovery; one rejected-flat fixture is deliberately **kept** to prove the new rejection path. Full suite is the regression sensor. |
| 04 | High | **Bundled docs bake the flat layout.** `docs/how/extend-the-harness.md` is compiled into `harness/cli/src/services/docs/docs-content.ts` by `scripts/gen-docs.mjs` (`npm run gen:docs`); CI guards drift (`check:docs`). Editing the doc without regen ships a CLI that contradicts its own guide. | T016 pairs the doc edit with `npm run gen:docs`; Done-When includes a clean `check:docs`. |
| 05 | High | **jiti subdir relative imports are unproven.** `jiti-loader.ts` (`moduleCache: false`) has no test loading an entry that imports `./lib/helper.ts`; AC-14 makes package-internal imports first-class. | T011 adds a real-loader integration fixture (`extension.ts` + `lib/helper.ts`); T012 proves it in production by splitting `validate-harness-flow` worker-io helpers into `lib/worker-io.ts`. |
| 06 | High | **Legacy governance chain lives in 4+ skill files.** Fallback prose (`docs/project-rules/engineering-harness.md` → `agent-harness.md` → `harness.md`) appears in eng-harness-0-harnessability-assessment (SKILL.md:28–30 + template), eng-harness-1-boot, eng-harness-2-backpressure, eng-harness-4-retro; eng-harness-flow SKILL.md quotes a flat extension path. Setup skills author no files, so the AGENTS-START-HERE breadcrumb can only live in the governance-doc **template**. | T014 enumerates exactly these surfaces; frozen `docs/plans/00x` history untouched; global `~/.claude` SDD skills remain the flagged out-of-repo follow-up. |
| 07 | Medium | **Doctor "wail" semantics are safe to make `degraded`.** `degraded` exits 0 (`exit.ts:5–10`); CI runs `harness doctor --json` non-blocking; no justfile/skill treats doctor non-ok as a hard failure. `instructions` is absent from `RESERVED_NAMES` (registry.ts:38–45) — the name is free today; **T004 adds it** so no future extension can shadow the core act. | Decision D2 below adopts overall `degraded` for convention violations — honest (P5) and consequence-free for existing automation. |

## Implementation

**Objective**: Land agent instructions (baked core + runtime per-extension `instructions.md`), folder-only package-shaped extensions with doctor validation, and governance-path normalization — in one phase, suite green throughout.

**Testing Approach**: Hybrid (per spec) — Full TDD for CLI core (each area below is a RED test task followed by a GREEN impl task; fakes only, per Constitution P2/P3); lightweight/manual verification for extension moves, skills, governance doc, and docs tasks.

### Design Decisions (resolving the spec's deferred-to-plan-3 choices)

- **D1 — Rejected-entry mechanism (AC-6)**: `discoverExtensions()` returns `{ candidates: string[]; rejected: { path: string; reason: string }[] }`. A flat code file directly under `.harness/extensions/` produces a `rejected` entry with reason `unsupported flat layout — move to <name>/extension.ts`. `buildExtensionRegistry()` maps each rejected entry to a synthesized `failed` `ExtensionRecord` (via the existing `failed()` helper) carrying **E143 `EXTENSION_FLAT_LAYOUT`**. Doctor renders these through its existing record path — no new render code.
- **D2 — Doctor wail for missing `instructions.md` (AC-5/AC-9)**: a `loaded` extension folder without `instructions.md` keeps status `loaded` (the verb runs — AC-9), but the doctor extensions layer reports a per-extension complaint line (**E144 `EXTENSION_INSTRUCTIONS_MISSING`** in the detail) with `next_action: "author .harness/extensions/<name>/instructions.md — see harness instructions"`, and flips the layer `!ok` → overall envelope `degraded` (exit 0). Honest per P5/P7; verified consequence-free for CI/skills (Finding 07). Core baked instructions always report present (a core-layer row).
- **D3 — Instructions act statuses (AC-3)**: unknown verb, or known verb whose extension lacks `instructions.md` → `unconfigured` (exit 2) with `next_action` (mirrors `record.ts` unknown-type pattern; no error code — P5 gap semantics). `instructions.md` exists but read throws → `error` (exit 1) with **E145 `INSTRUCTIONS_UNREADABLE`**. Scoped strictly to the `instructions` act.
- **D4 — Load timing**: per-extension instructions are read **lazily at act invocation** (never cached across process runs — trivially satisfies "edit → next invocation, no rebuild"); `has_instructions` in help is an `FsPort` existence check at help-build time. Discovery/registration stay I/O-light.
- **D5 — Contract untouched**: no `instructions` field on `HarnessVerb`; no `ExtensionRecord` shape change. Verb→folder resolution = find the record whose `verbs[]` contains the verb, take `dirname(record.entryPath)`, join `instructions.md`. Multi-verb extensions therefore share one file (AC-2) for free.

### Tasks

> Paths relative to repo root `~/substrate/harness-engineering`. Strand A = CLI core (TDD), Strand B = dogfood extensions, Strand C = skills/governance/docs.

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T001 | **RED — folder-only discovery tests**: per-folder chain `manifest → extension.ts → extension.js → index.ts → index.js`; `.tsx`/`.mjs`/`.cjs` reachable only via manifest; flat code file → `rejected[]` with flat-layout reason; containment (no `../` escape) + dedupe-by-resolved-path + `--no-extensions` behavior preserved | harness-cli core | `harness/cli/test/services/extensions/discovery.test.ts` | New tests written against the D1 return shape; fail against current code | AC-6; FakeFs only |
| [x] | T002 | **GREEN — discovery + registry + error codes**: implement D1 (`{candidates, rejected}` return; drop flat-file acceptance; extend per-folder chain); registry synthesizes `failed` records (E143) from `rejected[]`; add E143/E144/E145 to error-code table | harness-cli core | `harness/cli/src/services/extensions/discovery.ts`, `harness/cli/src/services/extensions/registry.ts`, `harness/cli/src/output/error-codes.ts` | T001 tests pass; no `node:fs` in services; existing discovery/registry tests updated-and-green | Findings 01, 02 |
| [x] | T003 | **RED — instructions service/act tests**: bare → baked core briefing + `verbs_with_instructions[]`; `<verb>` → entire unmodified file content, runtime-loaded (edit FakeFs between calls → new content); multi-verb extension shares one file; unknown verb / missing file → `unconfigured` + `next_action`; unreadable → `error` E145 | harness-cli core | `harness/cli/test/services/instructions/instructions-service.test.ts`, `harness/cli/test/acts/instructions.test.ts` | Tests encode D3/D4/D5 + AC-1/2/3; fail before impl | ACs 1–3 |
| [x] | T004 | **GREEN — instructions service + act**: `core-instructions.ts` (baked briefing: envelope contract, inference/determinism role split, discovery pointers), `instructions-service.ts` (verb→folder via registry `entryPath`, FsPort read), `acts/instructions.ts` (commander positional `[verb]`, mirrors `record.ts` wiring), register in `app.ts`, add `instructions` to `RESERVED_NAMES` | harness-cli core | `harness/cli/src/services/instructions/core-instructions.ts`, `harness/cli/src/services/instructions/instructions-service.ts`, `harness/cli/src/acts/instructions.ts`, `harness/cli/src/app.ts`, `harness/cli/src/services/extensions/registry.ts` | T003 tests pass; `--json` first-class; exit codes 0/2/1 per D3 | Finding 07 (name free) |
| [x] | T005 | **RED — help surfacing tests**: human output leads with "AGENTS START HERE: npx harness instructions" banner; `--json` carries `data.agents_start_here` + per-verb `has_instructions: boolean` | harness-cli core | `harness/cli/test/services/help/help-service.test.ts` (or co-located acts test) | Tests fail before impl | AC-4 |
| [x] | T006 | **GREEN — help service/act**: inject FsPort; existence-check `instructions.md` per verb's owning folder (D4); banner in human renderer; JSON fields | harness-cli core | `harness/cli/src/services/help/help-service.ts`, `harness/cli/src/acts/help.ts` | T005 tests pass; existing help tests green | |
| [x] | T007 | **RED — doctor convention tests**: extension with `instructions.md` → clean row; without → per-extension complaint + `next_action` ("author … — see harness instructions") + overall `degraded` (exit 0); flat-file `failed` record renders "unsupported flat layout — move to `<name>/extension.ts`"; core instructions row always present | harness-cli core | `harness/cli/test/services/doctor/doctor-service.test.ts` | Tests encode D2; fail before impl | AC-5, AC-9; the wail |
| [x] | T008 | **GREEN — doctor service**: package-convention validation per D2 (instructions presence check via FsPort against record folders; layer detail + next_action; degraded flip) | harness-cli core | `harness/cli/src/services/doctor/doctor-service.ts` | T007 tests pass; existing doctor tests green | Zero new render path for flats (D1) |
| [x] | T009 | **RED — scaffold tests**: every variant (default, `--wrap`, `--record`, `--js`) emits `<verb>/extension.ts` (or `extension.js`) + starter `instructions.md` (guided-TODO addressed to the calling agent: what this verb computes, what judgment it expects back); no `--flat` flag exists; scaffolded output passes discovery | harness-cli core | `harness/cli/test/acts/new.test.ts`, `harness/cli/test/services/scaffold/scaffold-service.test.ts` | Tests fail before impl | AC-8; `.record.ts` filename convention retired (Finding 02) |
| [x] | T010 | **GREEN — scaffold service/templates/act**: folder-form output + starter `instructions.md` template; act reports folder paths | harness-cli core | `harness/cli/src/services/scaffold/scaffold-service.ts`, `harness/cli/src/services/scaffold/templates.ts`, `harness/cli/src/acts/new.ts` | T009 tests pass | |
| [x] | T011 | **Fixture migration + AC-14 loader proof**: convert integration fixtures (`repo/`, `repo-conflict/`) and FakeFs seedings to folder layout; keep ONE flat file as a **permanent** rejection-path fixture (`test/integration/fixtures/repo/.harness/extensions/flat-legacy.ts`, asserted via doctor output); add real-jiti integration fixture where `extension.ts` imports `./lib/helper.ts` (subfolder) and the verb runs | harness-cli core | `harness/cli/test/integration/fixtures/**`, `harness/cli/test/app.test.ts`, `harness/cli/test/integration/extensions.test.ts` | **Full suite green** (`just fft`); subdir-import fixture loads via real `JitiLoader` | AC-14; Findings 03, 05 |
| [x] | T012 | **Move validate-harness-flow to package form**: `validate-harness-flow/extension.ts` + helpers (`lastRunId`, `captureNewRun`, `writeFile`, `readJson`, `copyInto`, ≈lines 82–141 of the flat file) split into `lib/worker-io.ts`; author **genuine** `instructions.md` (what the verb computes — fan-out, `--collect` artifacts; the operator's loop — review worker outputs, engineering-harness.md, retros; the judgment expected back — echo-vs-real verdict per repo); delete flat file | dogfood extensions | `.harness/extensions/validate-harness-flow/extension.ts`, `.harness/extensions/validate-harness-flow/lib/worker-io.ts`, `.harness/extensions/validate-harness-flow/instructions.md` | `npx harness doctor` → loaded + convention satisfied; verb `--help` works; AC-14 proven in production | AC-7, AC-14 |
| [x] | T013 | **Move validate-harnessability to package form**: `validate-harnessability/extension.ts` (no split needed — 250 lines); author genuine `instructions.md`; delete flat file | dogfood extensions | `.harness/extensions/validate-harnessability/extension.ts`, `.harness/extensions/validate-harnessability/instructions.md` | `npx harness doctor` → both extensions loaded, zero convention complaints; `npx harness instructions validate-harnessability` returns the briefing | AC-7 |
| [x] | T014 | **Skills normalization**: eng-harness-1-boot reads `.harness/engineering-harness.md` ONLY + new step-0 ("run `harness instructions --json`; read briefings for verbs you'll use"); remove legacy fallback chain from eng-harness-0-harnessability-assessment (SKILL.md + assessment template), eng-harness-2-backpressure, eng-harness-4-retro; fix flat-path prose in eng-harness-flow; add "AGENTS START HERE → `npx harness instructions`" line to governance-doc template | harness skills | `skills/eng-harness-loop/eng-harness-1-boot/SKILL.md`, `skills/eng-harness-setup/eng-harness-0-harnessability-assessment/SKILL.md` + `templates/assessment-latest.md`, `skills/eng-harness-loop/eng-harness-2-backpressure/SKILL.md`, `skills/eng-harness-loop/eng-harness-4-retro/SKILL.md`, `skills/eng-harness-loop/eng-harness-flow/SKILL.md`, `skills/eng-harness-loop/eng-harness-flow/references/governance-doc.md` | (a) `grep -r "docs/project-rules.*harness" skills/` returns zero live-surface hits; (b) breadcrumb line present in `governance-doc.md` template; (c) manual read-through confirms folder-form prose in each edited skill | AC-12; Finding 06; frozen `docs/plans/00x` untouched |
| [x] | T015 | **This repo's governance doc + stale refs**: hand-write `.harness/engineering-harness.md` (8 grounded BIO fields; boot = `harness/cli` vitest suite via `just test`; includes the AGENTS-START-HERE breadcrumb per the template); correct `AGENTS.md:21` and `README.md:114` to canonical path + current framing | repo governance | `.harness/engineering-harness.md`, `AGENTS.md`, `README.md` | eng-harness-1-boot run here reports the doc (not UNAVAILABLE); `grep -n "docs/project-rules/engineering-harness" AGENTS.md README.md` → empty | AC-13 |
| [x] | T016 | **Docs**: rewrite `docs/how/extend-the-harness.md` (folder layout as the only form; `instructions.md` authoring — audience is the calling agent, convention name, one per extension; minih `prompt.md`/`instructions.md` distinction drawn once, explicitly); run `npm run gen:docs` | docs | `docs/how/extend-the-harness.md`, `harness/cli/src/services/docs/docs-content.ts` (generated) | `npm run check:docs` clean; doc shows zero flat-layout examples; "prompt" never used for the agent-instructions feature | AC-11; Finding 04; grep for naming bleed |
| [x] | T017 | **Final validation sweep**: `just fft` green; manual smoke in this repo: `npx harness instructions` / `instructions validate-harness-flow` / `instructions nosuchverb` (exit 2) / `help` (banner) / `doctor` (loaded ×2, no complaints) / `new tryout` then `doctor` (scaffold loads) | all | — | Every spec AC checked off against observed output; evidence pasted into execution log | ACs 1–14 end-to-end |

### Acceptance Criteria

- [x] AC-1: `npx harness instructions --json` → `ok`; `data.instructions` = baked core briefing; `data.verbs_with_instructions[]` accurate
- [x] AC-2: `npx harness instructions <verb> --json` → whole-file unmodified `instructions.md` content, runtime-loaded (edit → next invocation, no rebuild); multi-verb extensions share the file via registry verb→folder mapping
- [x] AC-3: instructions act only — unknown verb / missing file → `unconfigured` exit 2 + `next_action`; unreadable file → `error` E145 + `next_action`; never a crash or silent empty
- [x] AC-4: `harness help` leads with AGENTS START HERE banner; `--json` has `agents_start_here` + per-verb `has_instructions`
- [x] AC-5: doctor validates package convention; missing `instructions.md` → visible per-extension complaint + `next_action` + overall `degraded` (D2); core instructions row always present
- [x] AC-6: folder-only discovery chain `manifest → extension.ts → extension.js → index.ts → index.js`; `.tsx`/`.mjs`/`.cjs` manifest-only; flat files → `failed` record "unsupported flat layout — move to `<name>/extension.ts`" (E143, D1); containment + dedupe preserved
- [x] AC-7: both repo extensions in package form with genuine authored briefings; doctor `loaded` + convention satisfied; all verbs unchanged; suite green
- [x] AC-8: `harness new` all variants scaffold folder form + starter `instructions.md`; scaffold loads; no `--flat`
- [x] AC-9: extension without `instructions.md` still functions (`has_instructions: false`, AC-3 unconfigured on query) but doctor wails — convention violation, never a refusal to run
- [x] AC-10: all new reads via `FsPort`; every new branch unit-tested with fakes; suite green
- [x] AC-11: `extend-the-harness.md` documents folder layout, instructions authoring, minih distinction (and `gen:docs` regen is clean)
- [x] AC-12: boot skill canonical-only + step-0; setup skills folder-form only; breadcrumb in governance-doc template; flat-path prose corrected
- [x] AC-13: `.harness/engineering-harness.md` exists (8 BIO fields, boot = vitest); boot here reports it; `AGENTS.md:21` + `README.md:114` corrected
- [x] AC-14: package-internal relative imports proven by test fixture AND by `validate-harness-flow`'s `lib/worker-io.ts` split

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Loader regression — discovery touches every verb's entry path | Medium | High | T001/T011 regression tests + T012/T013 move-and-stay-green proof; one flat fixture kept to pin the rejection path |
| jiti fails subfolder relative imports in some edge case | Low | High | T011 real-loader fixture lands BEFORE T012 production split; if it fails, fall back to single-file extensions while investigating (AC-14 fixture is the sensor) |
| Docs drift — `docs-content.ts` contradicts edited guide | Medium | Medium | T016 Done-When requires `check:docs` clean; CI guard already exists |
| Naming bleed — "prompt" creeping into agent-instructions surfaces | Medium | Medium | T016/T017 grep for `prompt` in new surfaces; review checklist item |
| Strand-3 scope creep into frozen plan history | Low | Medium | T014 enumerates exact files; `docs/plans/00x` + historical retros explicitly untouched |
| Doctor `degraded` surprises a future strict consumer | Low | Low | `degraded` exits 0 (documented contract); D2 recorded here as the deliberate choice |

**Accepted assumptions** (carried from spec, deliberately not mitigated): the baked core briefing as a TS constant versions with the CLI — correct, since it documents the CLI's own contract; `instructions.md` files are repo-trusted content (same trust domain as the extension code beside them) — no sanitisation pass.

## Agent Harness Strategy

- **Current state**: no governance doc exists in this repo today (`.harness/engineering-harness.md` absent — verified; legacy `docs/project-rules/engineering-harness.md` also absent). There is no Boot→Interact→Observe pre-flight to run before this phase.
- **This plan creates it**: T015 hand-writes `.harness/engineering-harness.md` (8 BIO fields; boot = the `harness/cli` vitest suite via `just test` / `just fft`) — per the spec clarification, this is a task within the single phase, not a Phase 0 build (the doc is hand-written like every other repo's, per the init-correction record).
- **Until then**: implementation uses the plan's standard testing approach (vitest + fakes + `just fft`); after T015 lands, `eng-harness-1-boot` run in this repo reports the doc instead of `UNAVAILABLE` (AC-13 sensor).

---

## Validation Record (2026-06-10)

### Validation Thesis

**Raison d'être**: Convert the validated 14-AC spec into an executable build order with the spec's deferred mechanism choices resolved (D1–D5), so the implementing agent builds without re-deriving design.

**Value claim**: Implementation becomes mechanical — task order, file targets, test-first structure, and decision rationale pre-resolved; suite-green checkpoints prevent loader regression.

**Artifact promise**: 17 tasks covering all 14 ACs; D1–D5 decisions; honest gate matrix.

**Intended beneficiaries**: /plan-6 implementing agent (Simple mode consumes the inline task table directly), reviewer/companion, next dogfood run, extension authors.

**Proof target**: Implementation

**Evidence standard**: source claims match code (line-ref verified); every AC maps to ≥1 delivering + verifying task; decisions consistent with Constitution P2/P4/P5/P6/P7/P10.

**Thesis source**: extension-enhancements-1-spec.md (validated at Contract level) + the user's "little packages" addendum.

**Thesis verdict**: Advanced — no drift; the user's package-convention intent (doctor wails, free-form internals, genuine briefings) is preserved end-to-end.

**Main thesis risk**: (pre-fix) the one genuinely unspecified detail was the kept rejection-fixture's identity — fixed (T011 names `flat-legacy.ts`); remaining risk is jiti subfolder imports, mitigated by T011-before-T012 ordering.

---

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Coherence + Source-Truth | factual accuracy vs source, internal coherence, constitution conformance | 1 genuine MEDIUM fixed (Finding 07 wording could read as self-contradictory re RESERVED_NAMES); 8 others were pre-implementation category errors ("code doesn't do X yet" — X is the planned work), dismissed | ✅ design sound; D1–D5 architecturally verified (discovery 41–43/52–64, `failed()` 206–213, exit.ts degraded→0, P10 act-vs-verb distinction confirmed) |
| Completeness + Risk | 14-row AC coverage matrix, TDD ordering, Done-When testability, CS honesty, risk coverage | 2 genuine fixed (spec's two accepted assumptions surfaced under Risks; T014 Done-When made checklist-form); G7 "missing manifest rows" claim dismissed — the three instructions files are present in the Domain Manifest | ✅ 14/14 ACs have delivering + verifying tasks; all 17 Done-Whens testable; TDD pairs verified; CS-3 honest |
| Thesis + Forward-Compatibility | 9 thesis failure modes, 5 FC modes × 4 consumers | 1 genuine MEDIUM fixed (T011 fixture named); 3 cited gaps dismissed as already present in the artifact (D1's rejected shape is stated verbatim; Finding 02's index.ts suggestion is explicitly overruled; T015's Done-When is the local boot proof) | ✅ no thesis drift; confidence 0.82; all four FC consumers PASS |

**Fixes applied (2026-06-10)**: Finding 07 — clarified that `instructions` is free today and T004 reserves it; T011 — rejection fixture pinned to `test/integration/fixtures/repo/.harness/extensions/flat-legacy.ts` as a permanent artifact; T014 — Done-When expanded to a 3-point checklist (grep zero, breadcrumb present, prose read-through); Risks — spec's two accepted assumptions (baked-TS-constant briefing, repo-trusted instructions) recorded explicitly.

### Forward-Compatibility Matrix

| Consumer | Requirement | Mode | Verdict | Evidence |
|----------|-------------|------|---------|----------|
| /plan-6 implementing agent | unambiguous tasks without plan-5 expansion (Simple) | task-table sufficiency | ✅ | 17 path-specific tasks, D1–D5 inline, AC map complete |
| Next dogfood run (express/click/cobra) | internally consistent consumer flow — no surface still flat-form | encapsulation lockout / shape mismatch | ✅ | T010 scaffold + T014 skills + T016 docs all flip in the same phase; field test = the dogfood run itself |
| CLI envelope/exit-code contract (P4/P5/P6) | D1–D5 respect status semantics | contract drift | ✅ | degraded→0 (D2, verified consequence-free), unconfigured→2 / error E145→1 (D3); E143–E145 unassigned today, added in T002 |
| Future extension-enhancements-N installer | package shape is groundwork, not a dead end | lifecycle ownership | ✅ | entry + instructions convention + free-form internals leave registry/checksum/version concerns fully open |

**Outcome alignment** (FC agent, verbatim): "The plan, as written, ADVANCES the VPO Outcome — 'A zero-context agent landing in any harnessed repo can self-brief in one hop: `harness help` → AGENTS START HERE → `harness instructions` → per-verb briefings' — across all six surfaces (help banner, instructions act, authored briefings, folder-form discovery, governance doc, skill breadcrumbs)."

**Standalone?**: No — four named downstream consumers engaged.

Overall: ⚠️ VALIDATED WITH FIXES (4 applied; Status remains READY)
