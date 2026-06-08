# Add-Extension Skill (+ scaffold command) Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-08
**Spec**: [add-extension-skill-spec.md](./add-extension-skill-spec.md)
**Workshop**: [workshops/001-scaffold-template-set-and-layout.md](./workshops/001-scaffold-template-set-and-layout.md) (authoritative)
**Status**: READY

## Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No `[NEEDS CLARIFICATION]` markers remain; 3 spec Open Questions have defaults (architect-locked below). |
| G2 | Constitution | PASS | P5 (scaffold stub returns `unconfigured`) is *satisfied by design*. `new` is a CORE command (like `help`/`doctor`), not a verb → P10 "no hardcoded verb list" intact. P8 original behavior justified: scaffolding is a genuine gap. No HIGH-impact violation → no Deviation Ledger needed. |
| G3 | Architecture | PASS | New files placed per layer rules: act in `acts/`, logic in `services/scaffold/`, `node:fs` confined to the `NodeFs` adapter. FsPort write methods are additive. |
| G4 | ADR Compliance | N/A | No `docs/adr/` present. |
| G5 | Structure | PASS | All required sections present and populated. |
| G6 | Testing Alignment | PASS | Spec = Hybrid (TDD for the CLI scaffolder, manual for skill prose). Task table is test-first for every code unit; skill/docs tasks are manual-verify. Acceptance criteria are observable. |
| G7 | Domain Completeness | PASS | No formal `docs/domains/` registry (Constitution §5 — domains not initialized). Conceptual domains tracked for traceability; Domain Manifest covers every file. No NEW formal domain requiring `domain.md`. |

> **Harness loop sections omitted by design**: this repo has no `docs/project-rules/engineering-harness.md` (it is the meta-repo *about* harnesses). Testing falls back to the standard vitest suite + `just fft`, which IS the feedback loop here.

## Summary

Make extending the harness a two-move action. **(1)** Add `harness new <name>` — a new **core** command (third reserved name after `help`/`doctor`) that scaffolds an *empty but immediately loadable* extension into `<cwd>/.harness/extensions/`, with `--wrap <cmd>`, `--js`, and `--force` variants. The freshly scaffolded stub returns `ctx.unconfigured(...)` so it loads, lists in `doctor`/`help`, and honestly reports "not built yet" from second zero (Constitution P5). **(2)** Add a thin, context-aware `add-extension` skill that reuses intent already gathered by a spec-driven flow when it's obvious, asks only when it isn't, calls `harness new`, fills the handler, and verifies with `doctor`/`help`. Templates live as pure string-builder functions in the CLI package (survives `npx`/bundling, snapshot-testable). A `docs/how/extend-the-harness.md` guide documents the whole flow.

## Target Domains

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| harness CLI (`harness/cli/`) | existing | **modify** | Add the `new` core command, `services/scaffold/`, and FsPort write methods |
| skills suite (`skills/`) | existing | **create** | New `skills/add-extension/` authoring skill (not a code domain — a skill folder) |
| extension runtime (plan 005) | existing | **consume** | Reuse discovery path, contract types, Envelope helpers, `RESERVED_NAMES` — no behavioral change beyond adding `new` to the reserved set |

> Domain governance is not initialized (Constitution §5); these are *conceptual* domains for traceability. No `docs/domains/<slug>/domain.md` is created.

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `harness/cli/src/adapters/fs/fs-port.ts` | harness CLI | contract | Add `mkdirp` + `writeText` to the port interface |
| `harness/cli/src/adapters/fs/node-fs.ts` | harness CLI | internal | Implement write via `node:fs` (adapter-only) |
| `harness/cli/src/adapters/fs/fake-fs.ts` | harness CLI | internal | In-memory write + records (for fake-driven TDD) |
| `harness/cli/src/services/scaffold/templates.ts` | harness CLI | internal | Pure string builders for the 4 starters |
| `harness/cli/src/services/scaffold/scaffold-service.ts` | harness CLI | internal | Validate name → resolve path (via injected `ProcessPort.cwd()`) → pick template → write |
| `harness/cli/src/output/error-codes.ts` | harness CLI | contract | Add the `E15x` scaffold error band |
| `harness/cli/src/services/extensions/registry.ts` | harness CLI | internal | Add `new` to `RESERVED_NAMES` |
| `harness/cli/src/acts/new.ts` | harness CLI | internal | Composition root for `harness new` |
| `harness/cli/src/app.ts` | harness CLI | internal | Register the `new` act alongside `help`/`doctor` |
| `harness/cli/docs/authoring-verbs.md` | harness CLI | — | Point at `harness new`; cross-link the how-to |
| `skills/add-extension/SKILL.md` | skills | — | The authoring skill |
| `skills/add-extension/README.md` | skills | — | Skill quick-start (convention) |
| `skills/add-extension/AUTHORING.md` | skills | — | Skill authoring notes (convention) |
| `docs/how/extend-the-harness.md` | docs | — | Canonical user guide (indexable for future docs-on-CLI) |
| `.minih.json` | repo | — | Wires the `add-extension` skill into minih agents (`path:skills`) |
| `scripts/new-test-repo.sh` | repo | — | Reusable throwaway test-repo generator (manual + agent testing) |
| `agents/install-and-validate-test-extension/*` | agents | — | minih e2e test agent (prompt, schemas, fixture repo) |
| `harness/cli/test/adapters/fs/fake-fs.test.ts` | harness CLI | test | FsPort write contract |
| `harness/cli/test/services/scaffold/templates.test.ts` | harness CLI | test | Byte-exact starter output |
| `harness/cli/test/services/scaffold/scaffold-service.test.ts` | harness CLI | test | Validation + path + flag matrix + errors |
| `harness/cli/test/acts/new.test.ts` | harness CLI | test | Act envelope + exit codes |
| `harness/cli/test/integration/scaffold.test.ts` | harness CLI | test | Scaffolded file loads via the REAL loader |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | `FsPort` is **read-only** today (`exists`/`readText`/`readdir` — `fs-port.ts:7`). The scaffolder must write a file and create `.harness/extensions/`. | Extend `FsPort` with `mkdirp` + `writeText` (additive — no existing reader breaks); implement in `NodeFs`, record in `FakeFs`. Do this FIRST (T001–T004). |
| 02 | High | `new` must be reserved or an extension could shadow the core command. `RESERVED_NAMES = {help, doctor}` (`registry.ts:15`). | Add `new` → `{help, doctor, new}`. This is consistent with P10 (core commands ≠ verbs). |
| 03 | High | A kebab verb name (`ci-smoke`) is not a valid JS identifier for the local `const`. | Templates camelCase `<name>` → `<ident>`; name validation guarantees a leading letter so `<ident>` is always valid. |
| 04 | High | Templates read at runtime from loose files break under `npx`/bundling. | Templates are **pure functions** returning strings (workshop §3, Option A); no file reads, snapshot-testable. |
| 05 | Medium | The scaffolded file must actually load via the real discovery/loader, not just be written. | Integration test (T016) scaffolds into a temp repo and asserts the real loader reports it `loaded` + the verb returns `unconfigured`. |
| 06 | Medium | `new` runs even in `--no-extensions` safe mode (it's core). | Register in `buildProgram` next to `help`/`doctor`, outside the extension-discovery path. |
| 07 | High | The scaffold service must root `.harness/extensions/` the SAME way discovery does, or a scaffolded file could land off the discovery path. Discovery uses `join(proc.cwd(), …)` (`discovery.ts:32`); `ProcessPort.cwd()` is the canonical cwd source. | Thread `ProcessPort` into the scaffold service + its act; root via `join(proc.cwd(), '.harness', 'extensions', '<name>.<ext>')`. Never call `process.cwd()` in a service (Constitution P2). Test with `FakeProcess`. |

## Implementation

**Objective**: Ship `harness new` (deterministic, test-first) + the thin `add-extension` skill + the `docs/how/` guide, all consistent with the Implementation-Ready workshop.

**Testing Approach**: Hybrid — Full TDD with injected fakes for every code unit (Constitution P3: fakes, never `vi.mock`); manual/dogfood verification for the skill prose and docs. Test tasks precede their implementation tasks below.

**Architect-locked decisions** (from spec Open Questions; workshop-aligned):
- **Q1** command name → **`new`** (`harness new <name>`).
- **Q2** → **core command** (reserved), not a bundled extension.
- **Q3** default stub return → **`ctx.unconfigured(...)`** (exit 2).

### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | T001 | **Test**: FakeFs records `writeText` + `mkdirp` (idempotent, parents created) | harness CLI | `harness/cli/test/adapters/fs/fake-fs.test.ts` | Failing tests assert written content is retrievable + `mkdirp` is no-op when present | Finding 01; TDD-red |
| [ ] | T002 | Extend `FsPort` interface with `mkdirp(path): void` + `writeText(path, contents): void` | harness CLI | `harness/cli/src/adapters/fs/fs-port.ts` | Interface compiles; doc comment notes write was added for the scaffolder | Finding 01; `contract` |
| [ ] | T003 | Implement write in `NodeFs` (`mkdirSync({recursive:true})`, `writeFileSync`) | harness CLI | `harness/cli/src/adapters/fs/node-fs.ts` | `node:fs` confined to this adapter; T001 green for the fake path | Finding 01; G3 boundary |
| [ ] | T004 | Implement write+record in `FakeFs` | harness CLI | `harness/cli/src/adapters/fs/fake-fs.ts` | T001 fully green | Finding 01 |
| [ ] | T005 | **Test**: each template fn (`minimalTs/minimalJs/wrapTs/wrapJs`) emits the byte-exact workshop §4 output for `greet` / `test --wrap "npm test"` | harness CLI | `harness/cli/test/services/scaffold/templates.test.ts` | Failing snapshot/equality tests for all 4 variants incl. camelCase ident (`ci-smoke`→`ciSmoke`) | Workshop §4; Finding 03; TDD-red |
| [ ] | T006 | Implement template functions (pure, parameterized) | harness CLI | `harness/cli/src/services/scaffold/templates.ts` | T005 green; output matches workshop §4a–4d verbatim | Finding 04; Workshop §3 |
| [ ] | T007 | Add `E15x` band: `SCAFFOLD_INVALID_NAME`/`NAME_RESERVED`/`FILE_EXISTS`/`WRITE_FAILED` | harness CLI | `harness/cli/src/output/error-codes.ts` | Codes E150–E153 exported with comments | Workshop §6; `contract` |
| [ ] | T008 | Add `new` to `RESERVED_NAMES` | harness CLI | `harness/cli/src/services/extensions/registry.ts` | Set is `{help, doctor, new}`; existing reserved tests still green | Finding 02 |
| [ ] | T009 | **Test**: scaffold-service — valid name happy path (returns target path + variant), folder created, file written via FakeFs; cwd supplied via `FakeProcess` | harness CLI | `harness/cli/test/services/scaffold/scaffold-service.test.ts` | Failing tests for `.ts`, `--js`, `--wrap`, `--wrap --js`; asserts path is `<fakeCwd>/.harness/extensions/<name>.<ext>` | Workshop §2/§8; Finding 07; TDD-red |
| [ ] | T010 | **Test**: scaffold-service error paths — invalid name (E150), reserved (E151), exists-no-force (E152), write fail (E153); `--force` overwrites | harness CLI | `harness/cli/test/services/scaffold/scaffold-service.test.ts` | Failing tests; each error carries a `next_action`; no file written on validation failure | Workshop §5/§6; TDD-red |
| [ ] | T011 | Implement `scaffold-service.ts` (receives `ProcessPort` + `FsPort`; root path = `join(proc.cwd(), '.harness', 'extensions', '<name>.<ext>')` — the SAME rooting as `discovery.ts:32`; validate → resolve path → pick template → `mkdirp` → `writeText`) | harness CLI | `harness/cli/src/services/scaffold/scaffold-service.ts` | T009 + T010 green; pure logic behind injected ports — no `node:fs` and no `process.cwd()` import | Findings 01–04, 07; G3 |
| [ ] | T012 | **Test**: `new` act — builds the Envelope (`ok` with `{path, verb, variant}`), maps errors → exit 1, wires real adapters | harness CLI | `harness/cli/test/acts/new.test.ts` | Failing tests via `buildProgram(...).parseAsync` asserting envelope + `exit:N` | Mirrors doctor act test pattern; TDD-red |
| [ ] | T013 | Implement `registerNewAct` (composition root: construct `NodeFs` + `NodeProcess` + clock, inject into the service, finalize via exit kernel) | harness CLI | `harness/cli/src/acts/new.ts` | T012 green; no business logic in the act; service rooted via the injected `ProcessPort` | P2/P4; Findings 06, 07 |
| [ ] | T014 | Register `new` act in `buildProgram` next to `help`/`doctor` (runs in `--no-extensions` mode) | harness CLI | `harness/cli/src/app.ts` | `harness new --help` shows usage; core path unaffected | Finding 06 |
| [ ] | T015 | **Test**: integration — scaffold into a temp repo fixture, then load via the REAL loader; assert `loaded` + invoking the verb returns `unconfigured` (exit 2) | harness CLI | `harness/cli/test/integration/scaffold.test.ts` | Failing end-to-end test (real `NodeFs` + real jiti/loader) | Finding 05; AC2/AC3; TDD-red |
| [ ] | T016 | Make T015 green (no code change expected beyond T001–T014; debug if not) | harness CLI | — | Full integration test green | Proof the loop closes |
| [ ] | T017 | Author the `add-extension` skill: SKILL.md (thin context-aware flow: obvious→reuse, ambiguous→ask, call `harness new`, fill, verify with `doctor`/`help`) + README + AUTHORING | skills | `skills/add-extension/{SKILL.md,README.md,AUTHORING.md}` | Skill reads standalone; explicitly does NOT duplicate the CLI templates; manual dogfood: run it, it scaffolds + verifies | Spec context-aware stance; manual-verify |
| [ ] | T018 | Write `docs/how/extend-the-harness.md` (covers `harness new` all flags/variants + the skill flow; standalone + indexable) | docs | `docs/how/extend-the-harness.md` | Guide is self-contained; AC13; manual review | Spec Documentation Strategy; future docs-on-CLI |
| [ ] | T019 | Update `authoring-verbs.md` — `harness new` as the starting point (replace "hand-copy a starter"); cross-link the how-to | harness CLI | `harness/cli/docs/authoring-verbs.md` | Manual read; links resolve | Keeps manual in sync |
| [ ] | T020 | Run `just fft` (Biome + full vitest + coverage) green; smoke `harness new`/`doctor`/`help` on the built `dist` | harness CLI | (repo root) | All tests green, biome clean, installed-bin smoke passes (scaffold → loads → `unconfigured`) | Constitution P11; verify gate |
| [ ] | T021 | **Reusable test-repo setup**: `scripts/new-test-repo.sh [dest]` + a `just test-repo` recipe that generates a fresh throwaway repo with the basics (a `package.json` with a real `demo` script, `git init`, no `.harness/`) and prints the path — the single, easy way to spin up "real testing" folders for humans AND agents | harness CLI | `scripts/new-test-repo.sh`, root `justfile` | `just test-repo` (or the script) emits a ready temp repo path; re-runnable; used by manual + minih e2e | Recurring infra — we'll do a lot of real-agent testing |
| [ ] | T022 | **E2E (minih)**: run the `install-and-validate-test-extension` agent (scaffolded at `agents/install-and-validate-test-extension/`) — it uses the T021 setup to make a throwaway repo, installs the core, drives the `add-extension` skill to author a verb, and independently validates load/help/invoke | skills + harness CLI | `agents/install-and-validate-test-extension/`, `.minih.json` | Agent verdict `PASS`: skill authored the extension, `doctor` shows `loaded`, `help` lists it, invoking returns the expected Envelope status/exit | Dogfoods the feature; skill wired via `.minih.json` `path:skills` |
| [ ] | T023 | **Collect feedback + magic wand** from the T022 run (and `minih difficulties`): triage `retrospective.workedWell/confusing/magicWand/difficulties`, route project-layer items into harness/skill improvements + the difficulty ledger, minih-layer items upstream | — | (run artifacts) | Retrospective reviewed; each finding dispositioned (fix / file / defer); convention per `AGENTS.md` | Mandatory after every minih run (AGENTS.md) |

### Acceptance Criteria

- [ ] AC1: `harness new greet` creates `.harness/extensions/greet.ts` and returns an `ok` Envelope whose `data` includes the created path. (T009/T013)
- [ ] AC2: `harness doctor` lists the scaffolded extension as `loaded`; `harness help` shows the verb. (T015/T016)
- [ ] AC3: invoking the fresh verb returns `unconfigured` (exit 2) with a `next_action` — never a crash, never a silent `ok`. (T015/T016)
- [ ] AC4: `harness new test --wrap "npm test"` emits the wrap-a-real-command starter (a `ctx.exec(...)` body). (T005/T006)
- [ ] AC5: `harness new greet --js` emits `greet.js` with a JSDoc contract reference and no runtime contract import. (T005/T006)
- [ ] AC6: `harness new help` (or `doctor`/`new`) is rejected (E151) and writes no file. (T010)
- [ ] AC7: scaffolding over an existing file fails (E152, no overwrite) unless `--force`. (T010)
- [ ] AC8: an invalid name (empty/spaces/path separators/leading digit/uppercase) is rejected (E150), writes no file. (T010)
- [ ] AC9: the skill reuses an obvious already-gathered intent without re-asking. (T017, manual)
- [ ] AC10: with no prior context, the skill asks for the minimum, then scaffolds + fills + verifies. (T017, manual)
- [ ] AC11: after authoring, the skill surfaces `doctor`/`help` output proving the verb is live. (T017, manual)
- [ ] AC12: the skill folder follows `skills/add-extension/{SKILL.md,README.md,AUTHORING.md}`. (T017)
- [ ] AC13: `docs/how/extend-the-harness.md` documents `harness new` + the skill, standalone + indexable. (T018)
- [ ] AC14: the `install-and-validate-test-extension` minih agent passes end-to-end (skill authors an extension in a temp repo; it loads + runs); its retrospective/magic-wand is collected and dispositioned. (T022/T023)
- [ ] AC15: a reusable test-repo setup (`scripts/new-test-repo.sh` + `just test-repo`) spins up a fresh throwaway repo with basics in one command, used by both manual and agent testing. (T021)

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Builds on unmerged 004+005 (`feat/harness-cli-core`) | High | Low | Continue on that branch; do not branch off `main`. Noted for `/plan-8`. |
| `FsPort` write extension ripples to other FsPort consumers | Low | Medium | Additive interface change; existing readers untouched; full suite (T020) catches regressions. |
| Template drift vs the real contract (`HarnessVerb` shape changes later) | Low | Medium | Templates assert against workshop §4 fixtures; integration test (T015) loads via the real loader so a contract drift fails fast. |
| "Context-aware" skill over-encodes | Medium | Low | Spec DECIDED stance: thin (obvious→use, ambiguous→ask); no context hierarchy. Enforced in review of T017. |
| `--wrap` shell-quoting expectations | Low | Low | v1 whitespace-split only; in-file comment + docs note the non-goal. |

## Unresolved Gaps

None — all gates PASS. Plan is **READY**.

---

## Validation Record (2026-06-08)

### Validation Thesis

**Raison d'être**: A Simple-mode plan to ship `harness new` (deterministic core scaffold command) + a thin context-aware `add-extension` skill, making harness extension near-zero-friction.

**Value claim**: Authoring an extension becomes a two-move action; the scaffolded stub loads and honestly returns `unconfigured` from second zero.

**Artifact promise**: A `/plan-6` build agent can execute the 20-task table with minimal clarification.

**Intended beneficiaries**: The implementation agent (build phase), then future extension authors.

**Proof target**: Implementation.

**Evidence standard**: Tasks map to the workshop's verbatim fixtures + constitution compliance; test-first ordering; concrete file paths.

**Thesis source**: spec + workshop 001 + constitution.

**Thesis verdict**: Advanced.

**Main thesis risk**: None material; the plan holds the deterministic-scaffold + thin-skill split.

| Agent | Lenses Covered | Thesis Axes Covered | Issues | Verdict |
|-------|---------------|---------------------|--------|---------|
| Thesis & Coherence | Thesis Alignment, Coherence, Testing-order, Cross-refs | Implementation Readiness, Attention Reduction | 0 | ✅ |
| Forward-Compat & Constitution | Constitution, Architecture, Forward-Compatibility | Safety to Change, Agent Readiness | 1 HIGH (fixed) | ⚠️ → ✅ |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| /plan-6 build agent | Unambiguous task contracts (cwd rooting) | Contract drift | ✅ (after fix) | T011/T013 now thread `ProcessPort`; root = `join(proc.cwd(), …)` per `discovery.ts:32` |
| /plan-8 merge | Architecture-compliant impl | Contract drift | ✅ | Service depends on injected ports; no `process.cwd()`/`node:fs` in services |

**Thesis alignment**: Value claim advanced at Implementation proof level; Strong evidence; no material thesis risk.

**Outcome alignment**: Yes — the plan advances a two-step extension flow (scaffold command + thin authoring skill); the cwd/root contract is now explicit, making it executable.

**Standalone?**: No — downstream `/plan-6` build phase consumes this plan.

Overall: **VALIDATED WITH FIXES** — the one HIGH forward-compat finding (cwd rooting under-specified) was fixed inline (Finding 07 + T009/T011/T013); plan remains READY.
