# Arch Conformance Exemplar Extension (`arch-check`) Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-10
**Spec**: [arch-conformance-extension-spec.md](./arch-conformance-extension-spec.md)
**Status**: READY

## Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No `[NEEDS CLARIFICATION]` markers remain; Rounds 1–2, validation pins, and the grill session are all recorded in spec Clarifications |
| G2 | Constitution | PASS | One P12 (publication boundary) leak found during gate evaluation — an internal exemplar project name in the spec Clarifications and `the-flow.md` — **sanitized before this plan was emitted** (both now reference only the gitignored `scratch/` path). P10 runtime-dep rule checked: dependency-cruiser is a *target-repo* dev tool shelled via `ctx.exec`, never imported by the distributed CLI → `devDependencies` is correct (npx `--omit=dev` consumers hit the specced `unconfigured`/exit 2 path). P5/P6 confirmed: warn-launch maps to the kernel's documented `degraded → 0`; missing tool/config → `unconfigured`/2. No deviations → no ledger |
| G3 | Architecture | PASS | Zero `harness/cli/src` changes (verified: VerbContext + envelope factories already supply everything — Finding 01). Extension lives in `.harness/extensions/` (the sanctioned consumer-side surface, architecture §5). `vitest.config.ts` + CI edits are repo-substrate config (§6), not layer violations |
| G4 | ADR Compliance | N/A | No `docs/adr/` in this repo |
| G5 | Structure | PASS | All required sections present; cross-references resolve |
| G6 | Testing Alignment | PASS | Hybrid per spec with the TDD lane ordered: T003 (RED fixtures+tests) precedes T004 (GREEN mapping) and T005 (extension shell); E2E lane enumerated in T007; mock policy honored (JSON fixtures; any verb-level test fakes go through the exec port — no `vi.mock`); Test Doc blocks mandated per rules §6.3 |
| G7 | Domain Completeness | PASS | No `docs/domains/` registry (constitution §5: domain governance not initialized — informal areas tracked for traceability, matching spec). All 4 spec domains present + 1 plan-added substrate row; Domain Manifest covers every file in the task table |

## Summary

The repo's hexagonal architecture is documented prose with no deterministic sensor; this plan ships the third exemplar extension — a `harness arch-check` verb wrapping dependency-cruiser against 7 committed rules — in one phase. The investigation and PoC are done (rules proven on the live tree: 66 modules, 0 violations, seeded violation caught by the right rule), so the work is: install the devDependency, commit the root rule config **at `warn` severity (grill decision: visible, never blocking, until severities are deliberately promoted)**, build the extension TDD-first around a pure violations→envelope mapping, wire a CI step through the verb with a `::warning::` annotation on `degraded`, and ship the briefing + how-guide that make this the copyable "deterministic back pressure as an extension" pattern. No CLI core code changes; the only substrate touches are a vitest include widening (the spec-delegated test-placement decision) and the CI step.

## Target Domains

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| repo root config (`package.json`, `.dependency-cruiser.cjs`) | existing (informal) | **modify** | dependency-cruiser devDependency (lockfile-pinned); root rule config derived from [`poc-arch-rules.cjs`](./poc-arch-rules.cjs) with severities flipped to `warn` |
| harness extensions (`.harness/extensions/`) | existing (informal) | **modify** (new package within) | `arch-check/` package: `extension.ts` + pure `mapping.ts` + colocated tests/fixtures + `instructions.md`. Auto-discovered; no core registration |
| CI (`.github/workflows/ci.yml`) | existing (informal) | **modify** | `build-test` job gains a verb-invoking step after Build; `::warning::` on `degraded`; fails on non-zero exit |
| repo docs (`docs/how/`, `README.md`) | existing (informal) | **modify** | how-guide per AC-11's 7-item outline; one-line README pointer |
| repo engineering substrate (`harness/cli/vitest.config.ts`, `.harness/engineering-harness.md`) | existing (informal) | **modify** *(plan-added)* | vitest include widened to collect extension tests (resolves the spec's test-placement note); harness governance doc updated (3 loaded extensions, new sensor row) |

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `package.json` (root) | repo root config | internal | add `dependency-cruiser` to `devDependencies` |
| `package-lock.json` | repo root config | internal | version pin |
| `.dependency-cruiser.cjs` **(new)** | repo root config | contract | the rule contract every consumer shares (verb, raw depcruise, CI) |
| `.harness/extensions/arch-check/extension.ts` **(new)** | harness extensions | internal | verb shell: preflight → exec → parse → mapping → ctx factory |
| `.harness/extensions/arch-check/mapping.ts` **(new)** | harness extensions | internal | pure violations→envelope mapping (the TDD half) |
| `.harness/extensions/arch-check/mapping.test.ts` **(new)** | harness extensions | internal | 4-fixture RED/GREEN suite with Test Doc blocks |
| `.harness/extensions/arch-check/fixtures/{clean,error-violation,warn-only,malformed}.json` **(new)** | harness extensions | internal | pinned depcruise JSON shapes |
| `.harness/extensions/arch-check/instructions.md` **(new)** | harness extensions | contract | agent briefing (contract-mandated) |
| `harness/cli/vitest.config.ts` | repo engineering substrate | cross-domain | include widened by one glob — test config only, `src/` untouched |
| `.github/workflows/ci.yml` | CI | internal | one new step in `build-test` |
| `docs/how/architecture-conformance.md` **(new)** | repo docs | internal | AC-11 pattern guide |
| `README.md` | repo docs | internal | one-line pointer |
| `.harness/engineering-harness.md` | repo engineering substrate | cross-domain | healthy reading "2 loaded" → 3; add arch-check sensor row; soften the "prose-only hexagonal rules" gap |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | `VerbContext` already supplies the entire needed surface: `ctx.cwd`, `ctx.exec(cmd, args?, {cwd?})`, `ctx.fs.exists/readText`, and envelope factories `ok/degraded/unconfigured/error` that the kernel finalizes into the canonical Envelope + exit code (`harness/cli/src/services/extensions/contract.ts:59–85`, factory declarations at 77–84; implementations + finalize in `verb-context.ts:49–132`). Types import from `'harness-engineering/contract'` (root `exports` map) | Extension is a thin shell — no hand-rolled envelope, no `node:*` imports, no core changes. `mapping.ts` stays pure (takes parsed depcruise JSON + rule comments, returns a status/violations/next_action decision the shell feeds to ctx factories) |
| 02 | Critical | Vitest collects only `test/**/*.test.ts` under `harness/cli` (`harness/cli/vitest.config.ts:5`); zero tests exist outside that tree today | Resolve the spec's test-placement note: **colocate tests with the extension** (the exemplar must travel with its tests — consumer repos have no `harness/cli/test/`) and widen the include with `'../../.harness/extensions/**/*.test.ts'` (two levels up — the config lives at `harness/cli/`, the repo root at `../../`; validate-v2 caught the one-level version resolving to a nonexistent path). Documented as a deliberate extension of rules §6.5's CLI-core test layout; Test Doc blocks still mandatory |
| 03 | High | Constitution P12 leak: an internal exemplar project name sat in tracked files (spec Clarifications, `the-flow.md`) after the external-exemplar comparison | Sanitized pre-emptively (edits applied before this plan); pattern reminder encoded: tracked docs may point at gitignored `scratch/` paths, never carry the private identifiers themselves |
| 04 | High | The suite already has `test/architecture/` (single `process.exit` site; no `node:fs` in services) — prior art for architecture sensors | Complementary, not redundant: those are point checks on specific idioms; depcruise proves the whole import graph. How-guide explains the relationship; nothing is removed |
| 05 | High | CI run steps execute under bash with `-e` semantics (ubuntu, node 22/24 matrix); a step that captures the verb's output for `jq` parsing will mask or trip on its exit code unless captured explicitly | Step shape pinned in T008: `out=$(npx --no-install harness arch-check --json) || code=$?`, echo the envelope, status via `jq -r .status`, count via `jq '.data.violations | length'` (guaranteed whenever depcruise ran, per the spec's data shape) → `::warning::` when `degraded`, then `exit ${code:-0}`. Placement pinned: **final step of `build-test`, after "Test with coverage"** |
| 06 | High | `ctx.cwd` is the invocation cwd (extension discovery itself scans `<cwd>/.harness/extensions`), so the verb effectively runs from repo root; from any other cwd the config/bin won't resolve | Preflight in T005: `ctx.fs.exists` on both `./node_modules/.bin/depcruise` and `.dependency-cruiser.cjs` at `ctx.cwd` → `unconfigured`/exit 2 with a next_action that names both the install command and "run from the repo root" |

## Implementation

**Objective**: Ship the `arch-check` exemplar extension end-to-end — committed warn-severity rules, TDD-proven envelope mapping, honest degradation states, CI through the verb, and the docs that make the pattern copyable.

**Testing Approach**: Hybrid (per spec, pinned): mandatory TDD for `mapping.ts` (4 fixtures, RED before GREEN, Test Doc blocks per rules §6.3); E2E for rules + wiring (clean run, seeded violation, degradation states, doctor); fixtures are real JSON, any verb-level fake implements the exec port (no `vi.mock`).

### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T000 | **Harness boot** — `/harness-1-boot` pre-flight (Boot→Interact→Observe) | — | — | `just test` green; `harness doctor --json` reads `ok` (2 extensions loaded) before any change | _Harness loop — advisory_ |
| [x] | T001 | Install `dependency-cruiser` as root devDependency | repo root config | `package.json`, `package-lock.json` | `./node_modules/.bin/depcruise --version` succeeds after `npm install`; lockfile committed | AC-1. devDependency is correct per P10 (target-repo tool, shelled not imported; npx consumers hit `unconfigured`) |
| [x] | T002 | Create root `.dependency-cruiser.cjs` from [`poc-arch-rules.cjs`](./poc-arch-rules.cjs): all 7 rules, severities flipped `error`→`warn` (the sole divergence), comments kept verbatim, `doNotFollow: node_modules`, **no** `tsConfig` | repo root config | `.dependency-cruiser.cjs` | Raw run from repo root (`./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type json harness/cli/src`) reports modules > 0 and **0 violations** on the current tree | AC-2; gotchas #1/#2 in header comment |
| [x] | T003 | **RED**: scaffold `.harness/extensions/arch-check/`, write the 4 JSON fixtures + `mapping.test.ts` asserting § Envelope & Exit Contract (status, exit intent, counts, **sorted violations** `from`→`to`→`rule`, comment join); widen vitest include | harness extensions; repo engineering substrate | `mapping.test.ts`, `fixtures/*.json`, `harness/cli/vitest.config.ts` | Suite collects the new tests from both cwds and they **fail** (no mapping yet); every test carries a Test Doc block | AC-10 RED. Include: `'../.harness/extensions/**/*.test.ts'` (Finding 02) |
| [x] | T004 | **GREEN**: implement pure `mapping.ts` — signature pinned `mapToDecision(parsed, rules)` (rule comments passed in as data, never imported); severity partition error/warn; deterministic sort; degraded `next_action` names the violated rule(s) + count with the promote guidance | harness extensions | `mapping.ts` | All T003 tests pass; no I/O, no `node:*`, fully synchronous pure function | AC-10 GREEN |
| [x] | T005 | Implement `extension.ts` (`HarnessVerb`, name `arch-check`): preflight bin+config exist at `ctx.cwd` (→ `unconfigured`), `ctx.exec` the local depcruise binary, parse stdout (malformed → `error` with stderr in `details`), delegate to mapping, return via ctx factories; never throws | harness extensions | `extension.ts` | All six § Envelope & Exit Contract rows produce the pinned status/exit/next_action; gotcha #1 (bare-npx scans 0 modules) as a source comment; types via `'harness-engineering/contract'` | AC-5/6/7; Findings 01, 06 |
| [x] | T006 | Write `instructions.md` briefing: what arch-check proves (and the proof boundary), the outcome-state table, what to do on failure, the rule-change discipline (never weaken a rule in the PR that trips it), gotcha #1, and the no-durable-evidence note (counts live in `data`; per P9) | harness extensions | `instructions.md` | `harness instructions arch-check` prints it; named bare-npx warning present | AC-7/8 |
| [x] | T007 | E2E state walk: doctor loads clean; clean run → `ok`/0 with real counts + empty violations; seeded violation (`help-service.ts` importing `../../adapters/fs/node-fs.js`) → `degraded`/0 naming `services-only-adapter-ports` with comment quoted in `next_action`, then revert; config temporarily moved → `unconfigured`/2; bin path absent (simulate) → `unconfigured`/2 with install command | harness extensions | — (verification) | Manual E2E walk (implementer-run commands): contract rows 1/3/4/5 observed live with pinned status + exit codes; rows 2 (error-severity) and 6 (malformed JSON) are unit-fixture-proven via AC-10 — stated honestly, not claimed E2E; tree restored clean (AC-3 re-verified after revert) | AC-3/4/5/8; warn-launch makes the seed land as `degraded`, per grill decision |
| [ ] | T008 | Add CI step to `build-test` as the **final step, after "Test with coverage"**: run `npx --no-install harness arch-check --json`, emit `::warning::` + violation count (`jq '.data.violations | length'`) when status is `degraded`, propagate exit code | CI | `.github/workflows/ci.yml` | Step green on current tree; degraded path proven by a temporary seeded run on the PR (or documented dry-run reasoning); crash/`unconfigured` would redden the build (non-zero) | AC-9; Finding 05 step shape + placement |
| [ ] | T009 | Write `docs/how/architecture-conformance.md` per AC-11's 7 items (rules+rationale, adapt-the-pattern sketch, writing agent-actionable comments, both gotchas, severity-ramp workflow incl. this repo's warn-launch, proof boundary, rule-change discipline) + one-line README pointer | repo docs | `docs/how/architecture-conformance.md`, `README.md` | Guide covers all 7 outline items; `npm run check:docs` green — if the drift guard flags the new `docs/how/` file as bundled, run `npm run gen:docs` and commit the regenerated bundle | AC-11; relationship to `test/architecture/` explained (Finding 04) |
| [ ] | T010 | Update harness governance: `.harness/engineering-harness.md` healthy reading (3 extensions loaded), add arch-check row to the deterministic signal inventory, soften the "hexagonal rules are prose-only" honesty gap | repo engineering substrate | `.harness/engineering-harness.md` | Doc matches post-plan reality; doctor healthy reading text correct | Keeps the governance doc honest (currently "2 loaded"); search the healthy-reading text fragment — don't assume line numbers |
| [ ] | T011 | Regression sweep: full vitest suite from repo root and from `harness/cli`; `harness doctor --json` stays `ok`; `just fft` clean | — | — (verification) | All green from both cwds; no convention complaints | AC-12 |
| [ ] | T012 | **Harness retro** — `/harness-4-retro --drain` the session buffer | — | — | Friction notes drained at the phase seam (`[s/t/p/e/d/a]`) | _Harness loop — advisory_ |

### Acceptance Criteria

- [ ] AC-1: dependency-cruiser devDependency installed, lockfile-pinned; `--version` succeeds after `npm ci`
- [ ] AC-2: root `.dependency-cruiser.cjs` committed — 7 rules at `warn`, comments on every rule, no `tsConfig`
- [ ] AC-3: clean tree → `ok`/exit 0, real counts, empty violations (via `npx --no-install harness arch-check --json`)
- [ ] AC-4: seeded violation → `degraded`/exit 0 naming `services-only-adapter-ports`, comment quoted in `next_action`; revert restores AC-3
- [ ] AC-5: all six envelope states demonstrated (unit fixtures + E2E walk), `next_action` on every non-ok
- [ ] AC-6: guardrails — no `node:*` imports, all I/O via `ctx.exec`/`ctx.fs`, never throws
- [ ] AC-7: `./node_modules/.bin/depcruise` invocation only; bare-npx gotcha in source comment + briefing
- [ ] AC-8: doctor shows `arch-check` loaded, zero complaints; `harness instructions arch-check` prints the briefing
- [ ] AC-9: CI runs the verb (never raw depcruise); non-zero exit fails the build; `::warning::` on `degraded`; green today
- [ ] AC-10: mapping is a pure function with RED→GREEN tests over the 4 fixtures, asserting status/exit-intent/counts/ordering/comment-join
- [ ] AC-11: how-guide ships all 7 outline items; `check:docs` green
- [ ] AC-12: full suite green from both cwds; doctor `ok`

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| depcruise version drift changes JSON shape | Low | Medium | Lockfile pin; mapping reads only pinned `summary` fields; malformed-JSON state fails loudly (`error`/1) |
| Warn parking lot — violations accumulate, nobody promotes | Medium | Medium | `::warning::` annotation on every PR (T008); how-guide ramp doctrine: "a rule lives at `warn` only while a named cleanup is in flight; otherwise promote or delete" (T009) |
| Verb invoked from a subdirectory resolves nothing | Low | Low | Preflight → `unconfigured`/2 with "run from repo root" next_action (T005, Finding 06) |
| Widened vitest include pulls future extension tests into the CLI coverage run | Medium | Low | Intended behavior (extensions get tested by default); noted here so it's never read as accidental |
| Rules ossify the architecture | Medium | Low | One root file, per-rule comments, rule-change discipline + ramp documented in guide and briefing |

## Agent Harness Strategy

- **Current Maturity**: L3 (improvement loop active)
- **Target Maturity**: L3 — unchanged; this plan *adds a deterministic sensor* to the harness rather than raising the loop's maturity
- **Boot Command**: `just test` (full suite, ~5s warm)
- **Health Check**: `npx harness doctor --json` (healthy = `ok`, exit 0; reads 2 loaded extensions today, 3 after T010)
- **Interaction Model**: CLI verbs with `--json` envelopes
- **Evidence Capture**: JSON envelopes (`data` + `evidence[]`), vitest coverage output, CI logs
- **Pre-Phase Validation**: Required — T000 runs Boot→Interact→Observe before any change

## Harness Loop

- **Backpressure Check** (`/harness-2-backpressure`): **consciously skipped by user decision** (recorded in `the-flow.json`) — this plan *builds* the sensor, and the spec's § Envelope & Exit Contract already maps every AC to a deterministic check. No `backpressure-coverage.md` exists; nothing gates on it.
- **Boot** (`/harness-1-boot`): T000 pre-flight; `/plan-6` auto-fires it. `UNAVAILABLE` is not an error.
- **Observe** (`harness-3-observe`): silent friction capture throughout; SUGG-001…010 already pending in the buffer.
- **Retro** (`/harness-4-retro --drain`): T012 at the phase seam; `--harvest` at plan completion.
- **Best-effort**: all advisory, never gates.

---

## Validation Record (2026-06-10)

### Validation Thesis

**Raison d'être**: Convert the validated + grilled spec into a single-phase executable plan with **zero open decisions** — the spec delegated exactly one (test placement); everything else (especially the late grill decisions: warn-launch, `::warning::` annotation, rule-change discipline) must carry forward without drift.

**Value claim**: an implementing agent executes T000–T012 without re-research; all 12 spec ACs reachable; constitution-compliant by construction.

**Proof target**: Implementation. **Thesis source**: `original-ask.md` + spec Clarifications (not inferred).

**VPO**: Vector — spec → {/plan-6 implementer (Simple: consumes the inline task table directly), `ci.yml`, doctor, `engineering-harness.md`, future promotion-to-error PR}. Outcome (verbatim): *"use code to actually validate that our implementations are following that pattern."*

### Agent Results

| Agent | Lens | Issues | Verdict |
|-------|------|--------|---------|
| Coherence | ordering, internal + spec↔plan consistency, structure | 1 MEDIUM (T007 manual-vs-automated ambiguity) — fixed | ⚠️ → ✅ |
| Risk & Completeness | source-truth (8/8 claims verified), missing tasks, edge states, CS challenge | 1 HIGH (CI step placement ambiguous) + 4 MEDIUM + 2 LOW — fixed or rejected (see below) | ⚠️ → ✅ |
| Thesis Alignment | 9 named failure modes | **none** — all grill decisions survived intact; zero non-goal creep; assumptions stated not silent | ✅ PASS |
| Forward-Compatibility | 5 consumers × 5 failure modes | 2 HIGH (vitest glob off-by-one-level; CI placement) + 2 MEDIUM + 1 LOW — fixed | ⚠️ → ✅ |

### Fixes applied in this pass

1. **vitest include glob corrected** `'../.harness/…'` → `'../../.harness/extensions/**/*.test.ts'` (FC HIGH — the one-level path resolved to a nonexistent `harness/.harness/`).
2. **CI step placement pinned**: final step of `build-test`, after "Test with coverage"; jq paths pinned (`.status`, `.data.violations | length`) (Risk HIGH / FC HIGH / FC MEDIUM).
3. **T004 mapping signature pinned**: `mapToDecision(parsed, rules)` — comments passed as data (purity); degraded `next_action` content pinned (Risk MEDIUM ×2).
4. **T007 made honest**: manual E2E walk covering contract rows 1/3/4/5; rows 2/6 unit-fixture-proven (Coherence MEDIUM / Risk LOW).
5. **T009 gen:docs contingency** + **T010 fragment-search note** + **Finding 01 line-ref precision** (FC LOW / FC MEDIUM / Risk LOW).

**Rejected findings**: "GitHub Actions bash lacks `-e`" (false positive — run steps default to `bash -e`; wording softened to "-e semantics" anyway); "use `import.meta.url` resolution for the vitest glob" (over-engineering — corrected root-relative glob is the vitest idiom).

### Thesis Verdict (from the Thesis Alignment agent)

- **Thesis understood?** Yes · **Value claim advanced?** Yes · **Proof level**: Target = Implementation; Actual = Implementation-ready · **Evidence quality**: Strong
- **Main thesis risk**: rules may ossify the architecture over time — mitigated by the rule-change discipline + severity ramp in briefing and guide.

**Outcome alignment** (Forward-Compatibility agent, verbatim): The plan advances the spec's outcome verbatim — "use code to actually validate that our implementations are following that pattern" — by shipping a deterministic sensor (dependency-cruiser rules) + envelope mapping (TDD-proven), CI integration, and the copyable pattern guide. However, five contract-drift and shape-mismatch issues (T003 include path, T008 placement, AC-9 jq path, T010 doc-scanning, T009 docs-content.ts ownership) will require explicit fixes during implementation to avoid rework or test failures. None are design-level; all are resolvable with unambiguous edits to the plan or spec before /plan-6 begins. *(Synthesizer note: all five were fixed in this same validation pass — see "Fixes applied" above — so the condition is satisfied and /plan-6 starts clean.)*

Overall: **VALIDATED WITH FIXES** — Status remains **READY**.
