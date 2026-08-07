# Markdown-Lint Harness Extension
**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-19
**Status**: READY
**Spec source**: unified (this file)

📚 Incorporates findings from `research-dossier.md`.

## Business Specification

### Research Context
Six parallel research threads (extension contract, markdown landscape, tool integration, fft/CI wiring, prior learnings, loader feasibility) produced `research-dossier.md`. Headlines: this is a pure **"wrap, don't rebuild"** job — all three capabilities exist as installed npm packages (markdownlint-cli2 0.22.1, remark-validate-links 13.1.0, mermaid 11.15.0); the repo has **351 tracked `.md`** files and **119 mermaid fences across 73 files**, none currently linted; the proven extension pattern is a thin `extension.ts` shell + pure unit-tested `lib/` + colocated tests + `instructions.md`.

### Summary
Add one harness verb, **`harness markdown-lint`**, that wraps three third-party tools behind a single honest envelope — (1) standard markdown lint (markdownlint-cli2), (2) headless mermaid syntax validation of ` ```mermaid ` fences (`mermaid.parse()` in a subprocess), (3) in-repo link + heading-anchor validation (remark-validate-links) — then wire it into `just fft`. It turns markdown health from eyeballed into deterministic back pressure, matching the existing `arch-check`/`skills-check` extensions, and dogfoods the extension-authoring path end-to-end.

### Goals
- One verb runs all three checks over the repo's **authored** markdown and aggregates them into one envelope.
- **Warn-launch posture**: findings report as `degraded`/exit 0 (visible, non-blocking) until authored docs are clean, then promote to `error`/exit 1.
- Wrap third-party tools via `ctx.exec` (local bins) + a subprocess mermaid runner — implement only the glue (fence extraction + envelope decision).
- Wire into `just fft` (and optionally an npm script + CI) **additively**, without breaking the shared tree for parallel agents.

### Non-Goals
- Not rendering mermaid to images (no Chromium/mmdc) — syntax validation only.
- Not checking **external** http(s) URLs (in-repo links + anchors only).
- Not linting generated/transient markdown (`docs/plans/**`, `.harness/**`, `agents/**`, `the-flow.md`, `*.fltplan.md`, `tasks/**`, `reviews/**`).
- Not auto-fixing markdown (no `--fix`, no remark file rewriting).
- Not shipping these tools to consumers (devDependencies only; the published package excludes `.harness/extensions/`).

### Target Domains
| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| _(none)_ | n/a | n/a | No domain registry exists (`docs/domains/registry.md` absent). The work fits the existing `.harness/extensions/` boundary; no domain is created, modified, or consumed. |

### Testing Strategy
**Approach**: Lightweight (Simple-mode default). **Rationale**: the I/O shell is thin and proven by running the verb; the **pure logic** (mermaid-fence extraction + the 3-way envelope decision) carries the risk and gets focused unit tests. **Focus areas**: `lib/extract.ts`, `lib/decision.ts`. **Excluded**: the `ctx.exec` plumbing (covered by running the verb + `harness doctor`). **Mock usage**: avoid mocks — table/fixture-driven tests over real markdown/mermaid samples (matches arch-check/skills-check). Colocated `*.test.ts` already run under `just test` via the existing vitest glob (`harness/cli/vitest.config.ts` includes `../../.harness/extensions/**/*.test.ts`).

### Documentation Strategy
**Location**: `docs/how/` + the required per-extension `instructions.md`. **Rationale**: `docs/how/extend-the-harness.md` is the established home for extension guidance; add a brief mention of the new verb there. The `instructions.md` briefing is mandatory (doctor flags `E144` without it). No README change (internal dogfood tooling).

### Complexity
- **Score**: CS-3 (medium)
- **Breakdown**: S=1, I=1, D=0, N=1, F=1, T=1 (sum 5)
- **Confidence**: 0.85
- **Assumptions**: the interrupted `npm install` completes and the local bins resolve; mermaid `parse()` works headless (already spike-proven, Node 22 + mermaid 11.15.0).
- **Dependencies**: markdownlint-cli2, remark-cli, remark-validate-links, mermaid (already declared devDependencies).
- **Risks**: lint noise over never-linted docs (see Risks); exotic mermaid rejected by parser (mitigated by warn-launch).
- **Phases**: 1 (Simple).

### Acceptance Criteria
- **AC-01** — `harness markdown-lint` is a loaded verb: `harness doctor` lists it `loaded` with `instructions.md` present; `harness help` shows it.
- **AC-02** — It runs all three checks (lint, in-repo links/anchors, mermaid syntax) over the authored-docs scope and returns **one** aggregated envelope.
- **AC-03** — Envelope honesty: real findings → `degraded`/exit 0 (warn-launch); clean → `ok`/exit 0 carrying evidence counts (files linted, fences parsed, links checked); a missing tool/config → `unconfigured`/exit 2 with a `next_action`.
- **AC-04** — Generated/transient markdown is excluded; the verb reports **zero** findings sourced from `docs/plans/**`, `.harness/**`, `agents/**`, `**/the-flow.md`, `**/*.fltplan.md`, `**/tasks/**`.
- **AC-05** — The pure logic (fence extraction + envelope decision) is unit-tested and the tests pass under `just test`.
- **AC-06** — `just fft` invokes `harness markdown-lint` and stays green on authored docs.
- **AC-07** — The mermaid check runs **headless** (no Chromium) via a subprocess `.mjs` runner.

### Risks & Assumptions
- **Lint noise**: markdownlint defaults may flag many existing authored docs → tune the rule set / scope to green before promoting the gate (warn-launch keeps `fft` safe meanwhile).
- **Mermaid strictness**: mermaid 11.x `parse()` may reject valid-but-exotic diagrams → warn-launch keeps it non-blocking; refine the runner / allowlist if needed.
- **Anchor false positives**: remark anchor-checking on generated headings → scope excludes generated docs.
- **Assumption**: running the harness CLI in this repo is via `node harness/cli/bin/harness.js` (AGENTS.md; not npx).

### Open Questions
- None blocking. The markdownlint rule set is tuned empirically in the "tune to green" task, not decided up front.

### Workshop Opportunities
| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| _(none)_ | — | The design is settled by the dossier (tools, pattern, scope, posture all resolved). | — |

### Clarifications
#### Session 2026-06-19
- **Workflow Mode** → **Simple** (one phase, ordered tasks). *User-selected.*
- **Gate posture** → **Warn-launch**: findings = `degraded`/exit 0, promoted to `error`/exit 1 once authored docs are clean. *User-selected.* (Mirrors how `arch-check` shipped.)
- **Testing Strategy** → Lightweight (default): unit-test the pure libs; prove the shell by running the verb. *Defaulted from repo convention.*
- **Mock Usage** → Avoid mocks; real fixtures. *Defaulted (matches existing extensions).*
- **Documentation Strategy** → `docs/how/` + required `instructions.md`. *Defaulted.*
- **Scope knob** → config-driven authored-docs scope, with an optional `--dir` override (skills-check precedent). *Defaulted.*
- **Mermaid runner** → subprocess `.mjs` (research-recommended, isolates the heavy ESM graph). *Defaulted.*
- **Verb shape** → one verb runs all three checks and aggregates; no per-check sub-commands in v1. *Defaulted.*

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: none — all resolved.

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | y | informs Key Findings, scope, tool invocations, prior learnings |
| workshops/*.md | n | — |

## Implementation Plan

### Gate Matrix
| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | Two forks resolved (Mode, gate posture); remainder defaulted from convention; no critical `[NEEDS CLARIFICATION]`. |
| G2 | Constitution | PASS | Textbook fit: P5 honesty (`unconfigured`), P7 next_action, P8 wrap-don't-rebuild, P9 evidence counts, P10 extension-owned verb, P11 fast `fft` feedback. No violations → no Deviation Ledger. |
| G3 | Architecture | PASS | Lives in `.harness/extensions/` (not `harness/cli/src`); all I/O via `ctx`; pure libs carry no `node:*` imports — honours the extension contract. |
| G4 | ADR Compliance | N/A | No `docs/adr/`. |
| G5 | Structure | PASS | All required Simple-mode sections present. |
| G6 | Testing Alignment | PASS | Lightweight: validation tasks present; pure libs unit-tested; ACs measurable. |
| G7 | Domain Completeness | N/A | No domain registry. |

### Summary
Build the `markdown-lint` extension as a thin `extension.ts` shell over three third-party tools, with pure unit-tested `lib/` helpers (fence extraction, envelope decision) and a subprocess mermaid runner. Author config that scopes the checks to authored docs and excludes generated/transient markdown. Tune to green, then wire into `just fft` last. Warn-launch posture means the verb is visible-but-non-blocking until authored docs are clean.

### Domain Manifest
| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `.harness/extensions/markdown-lint/extension.ts` | n/a | internal | Verb shell — preflight + `ctx.exec` ×3 + aggregate. |
| `.harness/extensions/markdown-lint/lib/extract.ts` | n/a | internal | Pure: extract ` ```mermaid ` fences (path + line) from md text. |
| `.harness/extensions/markdown-lint/lib/decision.ts` | n/a | internal | Pure: 3 sub-results → warn-launch envelope decision. |
| `.harness/extensions/markdown-lint/lib/mermaid-runner.mjs` | n/a | internal | Subprocess: `import('mermaid')` + `parse()`, prints JSON. |
| `.harness/extensions/markdown-lint/extract.test.ts` | n/a | test | Colocated unit tests for extract.ts. |
| `.harness/extensions/markdown-lint/decision.test.ts` | n/a | test | Colocated unit tests for decision.ts. |
| `.harness/extensions/markdown-lint/instructions.md` | n/a | doc | Required agent briefing. |
| `.markdownlint-cli2.jsonc` | n/a | config | markdownlint rules + ignores (authored-docs scope). |
| `.remarkrc.json` | n/a | config | remark-validate-links plugin config. |
| `justfile` | n/a | internal | Add `lint-md` recipe; include in `fft`. |
| `package.json` | n/a | internal | Confirm devDeps; optional `lint:md` script. |
| `docs/how/extend-the-harness.md` | n/a | doc | Brief mention of the new verb. |
| `.github/workflows/ci.yml` | n/a | internal | Optional additive CI step. |

### Key Findings
| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | Untuned lint over 351 never-linted files + a constant `fft` gate would break the loop for every agent in this shared tree (ML-01/04, FW-01). | Narrow scope to authored docs; tune to green (T009) **before** wiring `fft` (T010); warn-launch makes landing safe. |
| 02 | High | mermaid is a heavy browser-oriented ESM graph; no existing extension imports a runtime third-party package (LD-07, TI-04). | Isolate mermaid in a subprocess `.mjs` runner invoked via `ctx.exec('node', …)`; never `import('mermaid')` inside `extension.ts`. |
| 03 | High | Bare `npx` silently scans 0 modules; child exit codes can lie (PL-01/02). | Call `./node_modules/.bin/markdownlint-cli2` and `remark` by local path; check `.code` **and** parse output (markdownlint issues → stderr). |
| 04 | High | remark is a processor — `--output` rewrites files (TI-03). | Run check-only: `remark --use remark-validate-links --frail --quiet .` (no `--output`). |
| 05 | Medium | Shelling from an extension is an injection hazard (PL-03). | Build `args[]` arrays for `ctx.exec`; never interpolate paths into a `bash -c` string. |
| 06 | Medium | Colocated `*.test.ts` already run under `just test` via the vitest glob; bare `ok` envelopes are weak (QT, PL-07). | No test wiring needed; return real evidence counts, not bare `ok`. |
| 07 | Medium | devDependency placement is correct — the published `files` whitelist excludes `.harness/extensions/` (LD-06). | Keep the four tools as devDependencies; dogfood-only. |

### Implementation
**Objective**: Ship a loaded, green `harness markdown-lint` verb wrapping three tools, wired into `just fft` last.
**Testing Approach**: Lightweight — colocated vitest unit tests on the pure libs (`extract.ts`, `decision.ts`), table/fixture-driven, no mocks; the shell is proven by running the verb + `harness doctor`.

#### Scope contract (frozen at T007 — the implement→tune handoff)
The verb's scope is a **fixed contract**, not a tuning variable. The tune step (T009) may relax markdownlint **rules** only; it must never widen these globs.
- **Include (authored prose)**: `README.md`, `AGENTS.md`, `AGENTS_README.md`, `INSTALL.md`, `CHANGELOG.md`, `docs/guide/**`, `docs/how/**`, `docs/project-rules/**`, `harness-foundations/**`, `skills/**`, `harness/cli/docs/**`, `harness/cli/README.md`
- **Ignore**: `docs/plans/**`, `.harness/**`, `agents/**`, `docs/retros/**`, `harness/cli/test/**`, `**/reviews/**`, `node_modules`, `dist`, `coverage`, `scratch`, `**/the-flow.md`, `**/*.fltplan.md`, `**/tasks/**`
- **markdownlint rule policy**: first pass = stock markdownlint defaults; T009 disables only rules that conflict with established authored-doc conventions, each disable recorded with a one-line rationale. No rule is added.
- **Links**: relative in-repo files + heading anchors only; external http(s) URLs are not checked (remark-validate-links default).

#### Tasks
| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T001 | Complete the dependency install; confirm local bins resolve | n/a | `package.json`, `node_modules/.bin/` | `npm install` clean; `./node_modules/.bin/markdownlint-cli2` and `./node_modules/.bin/remark` exist; `node -e "require('mermaid/package.json')"` ok; `harness doctor` still 4+1 loaded | Finishes the interrupted install |
| [ ] | T002 | Scaffold via `harness new markdown-lint`; restructure to shell + `lib/` | n/a | `.harness/extensions/markdown-lint/` | Folder has `extension.ts` + `instructions.md`; `harness doctor` shows it `loaded`; bare run returns `unconfigured` | Dogfoods `harness new` |
| [x] | T003 | Write pure `lib/extract.ts` (mermaid-fence extractor) + `lib/decision.ts` (warn-launch envelope mapper) | n/a | `…/lib/extract.ts`, `…/lib/decision.ts` | Pure, synchronous, no `node:*`; exports typed functions; fence extractor returns `{path,line,text}[]` | Per finding 02/03 |
| [x] | T004 | Colocated unit tests for the pure libs | n/a | `…/extract.test.ts`, `…/decision.test.ts` | `just test` green; covers valid/invalid fences, all four envelope states | Per finding 06 |
| [ ] | T005 | Write `lib/mermaid-runner.mjs` subprocess (import mermaid, `parse({suppressErrors:true})`, print JSON) | n/a | `…/lib/mermaid-runner.mjs` | `node …/mermaid-runner.mjs` validates a good fence (ok) and a bad fence (invalid) via stdin/args → JSON | Per finding 02 |
| [ ] | T006 | Implement `extension.ts` shell: preflight → `ctx.exec` markdownlint-cli2 + remark + mermaid-runner → aggregate via `decision.ts` | n/a | `…/extension.ts` | `harness markdown-lint` runs all three; honest envelope; `next_action` on every non-ok; never throws | Per findings 03/04/05; argv only |
| [x] | T007 | Author config: `.markdownlint-cli2.jsonc` (rules + ignores) + `.remarkrc.json` | n/a | `.markdownlint-cli2.jsonc`, `.remarkrc.json` | **This task FREEZES the scope contract** (T009 may only relax rules, never widen scope). Ignores = `docs/plans/**`, `.harness/**`, `agents/**`, `docs/retros/**`, `harness/cli/test/**`, `**/reviews/**`, `node_modules`, `dist`, `coverage`, `scratch`, `**/the-flow.md`, `**/*.fltplan.md`, `**/tasks/**`; remark scoped to the SAME authored-docs set (§ Scope contract). markdownlint first pass = stock defaults | Per finding 01; scope = § Scope contract |
| [x] | T008 | Author `instructions.md` agent briefing | n/a | `…/instructions.md` | `harness instructions markdown-lint` serves it; `harness doctor` shows no `E144` | What it computes / your role / watch-outs / outcomes |
| [x] | T009 | Tune to green over the **frozen** scope (T007) by disabling conflicting markdownlint rules **only** — never widening scope; record the disabled-rule list + rationale | n/a | configs + docs | A recorded `harness markdown-lint --json` run over the frozen scope returns `ok` or `degraded` with an **enumerated** findings list (each finding either fixed or recorded as a disabled-rule rationale); excluded dirs contribute **zero** findings (AC-04) | Per finding 01; rules-only, scope frozen |
| [x] | T010 | Wire into `just fft` (+ optional npm script + optional CI step) — **only after T009's green baseline** | n/a | `justfile`, `package.json`, `.github/workflows/ci.yml` | T009 green baseline reached first; then `fft: fix format test lint-md`; `lint-md` calls `node harness/cli/bin/harness.js markdown-lint`; `just fft` green | Additive; wire last; per FW-01/05 |
| [x] | T011 | Update `docs/how/extend-the-harness.md` to mention the verb | n/a | `docs/how/extend-the-harness.md` | Doc references `harness markdown-lint` and what it checks | Light touch |
| [x] | T012 | Capture a dogfood retro / magic-wand after first run | n/a | `.harness/records/retro/` or `docs/retros/` | A retro note records friction + any harness/CLI improvement found | Per PL-08 (AGENTS.md) |

### Acceptance Coverage Map
| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | T002, T008 | `harness doctor` / `harness help` show `loaded` + 📖 |
| AC-02 | T006 | running `harness markdown-lint` exercises all three checks |
| AC-03 | T003, T006 | `decision.test.ts` (states) + live run (`--json` envelope) |
| AC-04 | T007, T009 | live run reports no findings from excluded dirs |
| AC-05 | T003, T004 | `just test` green |
| AC-06 | T010 | `just fft` green |
| AC-07 | T005 | `mermaid-runner.mjs` runs under `node`, no Chromium |

### Risks
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| markdownlint defaults too strict for existing authored docs | High | Medium | Tune rule set + scope (T007/T009); warn-launch keeps `fft` green meanwhile |
| mermaid `parse()` rejects valid-but-exotic diagrams | Medium | Medium | Warn-launch (non-blocking); refine runner / record exceptions |
| remark anchor false positives on generated headings | Medium | Low | Scope excludes generated docs |
| Parallel agents' in-flight markdown trips the verb | Medium | Low | Warn-launch (degraded, not error); scope to stable authored dirs |
| Interrupted `npm install` left node_modules partial | High | Low | T001 completes install + verifies bins before anything depends on them |
| `ctx.cwd` / run-root resolution brittle (PL-09) — bins, config, and globs all resolve relative to the invocation cwd | Medium | Medium | Resolve every path from `ctx.cwd`; preflight the required bins/config in T006 and return `unconfigured` + `next_action` if the expected run-root layout is absent (never crash) |

---

## Validation Record (2026-06-19)

### Validation Thesis
**Raison d'être**: Turn the user ask (markdown linter + mermaid syntax check + in-repo link validation, wrapped as one third-party-based extension added to `just fft`) into a buildable, safe implementation that won't break the shared tree.
**Value claim**: Building the extension becomes cheaper/safer via a sequenced green-first-then-wire task list, warn-launch posture, and a tested pure-lib design.
**Artifact promise**: The implement stage can build the verb from the task table + ACs without re-deriving the design.
**Intended beneficiaries**: the implement-stage agent + human reviewer; all agents in the shared tree (protected by warn-launch + the frozen scope).
**Proof target**: Implementation.
**Evidence standard**: testable ACs, task Done-Whens, real file paths, dossier-grounded tool invocations.
**Thesis source**: `original-ask.md` + `research-dossier.md` (grounded, not inferred).
**Thesis verdict**: Advanced.
**Main thesis risk**: (resolved) build-time scope/rule decisions were deferred — now pinned by the § Scope contract.

| Agent | Lenses Covered | Thesis Axes Covered | Issues | Verdict |
|-------|---------------|---------------------|--------|---------|
| Coherence & Completeness | System Behavior, Edge Cases, Hidden Assumptions, Integration & Ripple | Implementation Readiness, Downstream Usefulness | 1 MED + 1 LOW, fixed | ⚠️→✅ |
| Risk, Evidence & Proof-Level | Evidence Sufficiency, Proof-Level Fit, Technical Constraints, Deployment & Ops, Security | Evidence Sufficiency, Safety to Change | 1 MED, fixed | ⚠️→✅ |
| Thesis Alignment & Forward-Compatibility | Thesis Alignment, Forward-Compatibility, Domain Boundaries, Concept Documentation | Thesis Alignment, Downstream Usefulness, Review Compression | 1 MED + 1 LOW, fixed | ⚠️→✅ |

**Lens coverage**: 13/15. **No CRITICAL or HIGH issues.** All 5 MEDIUM/LOW findings fixed (ignore-set expansion, frozen § Scope contract + rules-only tune, two Done-When tightenings, `ctx.cwd` risk row).

### Forward-Compatibility Matrix
| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| implement stage | Build `harness markdown-lint` directly from T001–T012 without redesigning scope/rules | contract drift (plan→implement) | ✅ (after fix) | § Scope contract freezes include/ignore + rule policy; T007/T009/T010 Done-Whens bind it |

**Thesis alignment**: Value claim advanced at proof target Implementation; main thesis risk (deferred build-time scope) resolved by pinning the § Scope contract.
**Outcome alignment**: "add a markdown linter... check that mermaid's render and that links are valid (in repo links)... use third party where possible, just wrap it up in an extension... then we add that extension as part of our just fft flow." — the plan advances this, and with the scope/rules now pinned the implementer can build it without reopening design decisions.
**Standalone?**: No — downstream consumer is the implement stage (Simple mode builds directly from the task table).

Overall: VALIDATED WITH FIXES
