# Harness Skills Install Implementation Plan

**Mode**: Simple
**Plan Version**: 1.1.0
**Created**: 2026-06-09
**Spec**: [harness-skills-install-spec.md](./harness-skills-install-spec.md)
**Status**: READY

## Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No `[NEEDS CLARIFICATION]` remain; 4 forks resolved in spec Round 2. |
| G2 | Constitution | PASS | `skills` is a **core capability**, not a dynamic verb — the constitution already establishes this category: Principle 7 calls `doctor` "a **core** capability (**not a verb**)", and Principle 10's "core hardcodes no **verb** list" governs *project-command-wrapping verbs* (run/build/test) owned by extensions, **not** the fixed harness-infra set (help/doctor/new/docs). `skills install` is harness infrastructure (installing the harness's own skills), so it joins that fixed set — Principle 10 is not in scope. Pass-through honours **Principle 8 (wrap, don't rebuild)**; uses ExecPort (P2), FakeExec (P3), stable envelope + `--help` (P4), documented exit codes (P6), `next_action` on failure (P7), evidence-of-install (P9). No deviation ledger entry needed. |
| G3 | Architecture | PASS | Act → Service → Port→Adapter layering preserved (`acts/skills.ts` → `services/skills/` → injected `ExecPort`). No `node:child_process` in the service; no `process.exit` outside the kernel. |
| G4 | ADR Compliance | N/A | No `docs/adr/` in repo. |
| G5 | Structure | PASS | All required Simple-mode sections present + populated. |
| G6 | Testing Alignment | PASS | Lightweight: argv-builder unit test (T006/T009) + fake-exec pass-through test before the real install (T012). |
| G7 | Domain Completeness | PASS | Conceptual domains (no `docs/domains/` registry); Target Domains + Domain Manifest cover every file in the task table. |

## Summary

Add a first-class, core `harness skills install` command that is a thin, transparent **pass-through** to Vercel Labs' `npx skills@latest add …` CLI — it announces the exact invocation before running, always passes `-y` (so the blocking picker never appears), and lets the caller pick CLI target(s) and global/project-local. Import the four harness-loop skills from `jakkaj/tools` and regroup **all seven** of this repo's skills into two category folders (`skills/eng-harness-setup/`, `skills/eng-harness-loop/`) with `eng-harness-*` slugs — a layout that also satisfies Vercel's `skills/<category>/<slug>/` discovery. The `eng-harness-0-setup` skill then **offers** (never forces) to run the command, and the closing step performs a real install into a throwaway target to prove the whole path end-to-end.

## Target Domains

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| harness-cli (`harness/cli/`) | existing | modify | New core `skills` command: act + pure service + ExecPort pass-through; reserved-name + help wiring. |
| skills corpus (`skills/`) | existing | modify | Import 4 loop skills; regroup all 7 into `eng-harness-{setup,loop}/`; rename slugs + frontmatter; rewrite `skills/README.md`. |
| docs (`docs/`, `INSTALL.md`, CLI README) | existing | modify | Update live references to the new slugs/paths + document the new command + Vercel attribution. |

_No `docs/domains/registry.md` — domains are conceptual groupings for this Simple plan._

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `skills/eng-harness-loop/eng-harness-{1-boot,2-backpressure,3-observe,4-retro}/**` | skills corpus | content | Imported loop skills (NEW in this repo). |
| `skills/eng-harness-setup/eng-harness-0-{setup,harnessability-assessment,add-extension}/**` | skills corpus | content | Renamed setup-family skills. |
| `skills/README.md` | skills corpus | content | Rewrite for two-category layout + new command. |
| `README.md` (repo root) | docs | content | Old-slug refs + `-s` example + old skill paths → new layout + `harness skills install`. |
| `.minih.json` | harness-cli | internal | `skills.include` lists old slugs → update to new slugs/categories so minih still loads them. |
| `INSTALL.md` | docs | content | Slug/`-s` examples + loop-skills-now-hosted-here framing. |
| `docs/how/extend-the-harness.md` | docs | content | `add-extension` path/slug refs → new path; re-inlined by gen-docs. |
| `harness/cli/src/output/error-codes.ts` | harness-cli | internal | Add `E170 SKILLS_INSTALL_FAILED`. |
| `harness/cli/src/services/skills/skills-service.ts` | harness-cli | internal | NEW — pure `buildInstallArgv()` + run helper (testable). |
| `harness/cli/src/services/skills/contract.ts` | harness-cli | contract | NEW — `SkillsInstallOptions` / result types. |
| `harness/cli/src/acts/skills.ts` | harness-cli | internal | NEW — `skills install` act (announce → ExecPort → envelope). |
| `harness/cli/src/app.ts` | harness-cli | internal | Register `registerSkillsAct` in `buildProgram`. |
| `harness/cli/src/services/help/help-service.ts` | harness-cli | internal | List `skills` in core-command help text. |
| `harness/cli/src/services/scaffold/**` | harness-cli | internal | Add `skills` to `harness new` reserved-name set (E151). |
| `harness/cli/test/skills.test.ts` | harness-cli | test | NEW — argv-builder unit + fake-exec pass-through tests. |
| `harness/cli/README.md` | docs | content | Document the `skills install` surface. |
| `harness/cli/src/services/docs/docs-content.ts` | harness-cli | generated | Regenerated by `npm run gen:docs` after editing `extend-the-harness.md`. |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | The `justfile` already wraps `npx skills@latest add "$(pwd)" …` (`list-skills`, `install-skills-{local,global}`) — the canonical pass-through shape, slug-agnostic. | Mirror that shape in the core command; default `--source` to the GitHub repo `AI-Substrate/harness-engineering` (works from any consumer repo), not `$(pwd)`. |
| 02 | High | Loop `SKILL.md` files carry frontmatter `name: harness-1-boot` etc.; `npx skills` slug = **directory name**, but the `name:` field is the skill's self-identity. | On rename, update both the directory name **and** the frontmatter `name:` + intra-suite cross-references. |
| 03 | High | `docs/how/extend-the-harness.md` is **inlined** into the committed `docs-content.ts` via `gen-docs`; a CI drift check (`npm run check:docs`) fails if stale. | After editing that doc for the new slug/path, run `npm run gen:docs` and commit the regenerated file. |
| 04 | High | `harness new` reserves core names (help/doctor/new/docs → E151); a new core `skills` command must join that set or an extension could shadow it. | Add `skills` to the scaffold reserved-name set (T008). |
| 05 | Medium | CLI is agent-first/non-blocking; literal interactive prompting would block agents. | Flags are the contract (`--target`, `--global`); the *skill* asks. Optional: prompt only when human + interactive TTY; otherwise missing `--target` → `E108` with a next_action listing valid targets. |
| 06 | Medium | Renaming the loop skills breaks external slug refs (`the-flow` routing, `plan-6` companion) that live in other repos. | Out of scope (recorded in spec); update only **live, in-repo** references. Note the follow-up in `skills/README.md`. |

## Implementation

**Objective**: Ship a core `harness skills install` pass-through, host all seven skills under `eng-harness-{setup,loop}/`, wire the setup skill's offer, and prove the install into a throwaway target.

**Testing Approach**: Lightweight — pure `buildInstallArgv()` unit tests + a fake-exec pass-through test (assert `npx` + exact argv + announce output + error envelope on non-zero), then a real install into a temp location as end-to-end proof. Mocks: targeted (FakeExec only; no real network in unit tests). Real network only in the closing temp-install verification.

### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T001 | **G1** Import the 4 loop skills from `~/github/tools/skills/harness/*` into `skills/eng-harness-loop/` as `eng-harness-1-boot … eng-harness-4-retro` (copy each skill dir incl. `references/`). | skills corpus | `skills/eng-harness-loop/**` | 4 skill dirs present, each with `SKILL.md` + bundled `references/` intact. | Source files copied (not git-moved — they originate in another repo). |
| [x] | T002 | **G2** `git mv` the 3 setup-family skills into `skills/eng-harness-setup/`: `engineering-harness-setup→eng-harness-0-setup`, `harnessability-assessment→eng-harness-0-harnessability-assessment`, `add-extension→eng-harness-0-add-extension`. | skills corpus | `skills/eng-harness-setup/**` | 3 dirs relocated/renamed; git history preserved (`git mv`). | |
| [x] | T003 | **G2** Update each (imported + renamed) skill's frontmatter `name:` to its new slug and fix intra-suite slug cross-references. | skills corpus | `skills/eng-harness-*/**` | `grep -rn "name: \(harness-[0-9]\|engineering-harness-setup\|harnessability-assessment\|add-extension\)" skills/` returns nothing; cross-refs point to new slugs. | Finding 02. External-repo refs left alone (Finding 06). |
| [x] | T004 | **G2** Update **all live docs + configs** to new slugs/paths: rewrite `skills/README.md` (two-category layout + new `harness skills install`); fix root `README.md` (old-slug refs, `-s harnessability-assessment` example, `skills/engineering-harness-setup/` paths → new layout + new command); fix `INSTALL.md` (slugs, `-s` examples, "loop skills now hosted here"); fix `docs/how/extend-the-harness.md` path/slug; update `.minih.json` `skills.include` (and any `agents/**` skill-discovery config) to the new slugs/categories; then `npm run gen:docs`. | docs + skills corpus | `skills/README.md`, `README.md`, `INSTALL.md`, `docs/how/extend-the-harness.md`, `.minih.json`, `harness/cli/src/services/docs/docs-content.ts` | `grep -rn` for the 7 old slugs across **live** files (excl. `docs/plans/**`, `scratch/**`, `node_modules/**`) returns nothing; `npm run check:docs` clean. | Findings 02, 03; validators flagged `README.md` + `.minih.json` as missed blast-radius. |
| [x] | T005 | **G3** Add `E170 SKILLS_INSTALL_FAILED` to the error-code table. | harness-cli | `harness/cli/src/output/error-codes.ts` | Constant exported; referenced by the act. | |
| [x] | T006 | **G3** Create pure service: `buildInstallArgv({ source, targets[], global, yes })` → `string[]` (always `add` + source + `-y`; repeated `-a <target>`; `-g` iff global) + `contract.ts` types. | harness-cli | `harness/cli/src/services/skills/{skills-service.ts,contract.ts}` | Function pure (no I/O); returns exact argv; unit-tested in T009. | No `node:*` imports. |
| [x] | T007 | **G3** Create act `registerSkillsAct`: `skills` parent + `install` subcommand; options `--target <cli...>` (repeatable), `--global`, `--source <repo>` (default `AI-Substrate/harness-engineering`); **announce** the exact `npx …` line + vercel-labs/skills link before running — **to stderr in human mode**, and **inside the envelope (`data.command` + `next_action`) in `--json` mode** (never prose on stdout, so the JSON envelope stays parseable); shell out via injected `ExecPort` (`npx`, argv); map result → envelope (ok w/ evidence + next_action; non-zero → `E170` w/ next_action). Missing `--target`: **only** when `stdout.isTTY` && human mode → interactive prompt; in JSON/non-TTY/agent mode → `E108` with a `next_action` listing valid targets (never block). | harness-cli | `harness/cli/src/acts/skills.ts`, `harness/cli/src/app.ts` | `harness skills install --help` works; registered in `buildProgram`; never spawns a child directly; `--json` stdout is a single valid envelope. | Findings 01, 05. Always `-y` (AC3). |
| [x] | T008 | **G3** Wire `skills` into core help text + add to `harness new` reserved-name set. | harness-cli | `harness/cli/src/services/help/help-service.ts`, `harness/cli/src/services/scaffold/**` | `harness help` lists `skills`; `harness new skills` → `E151`. | Finding 04. |
| [x] | T009 | **G3** Tests: unit-test `buildInstallArgv` (target fan-out, `-g` on/off, always-`-y`, default source); pass-through test with `FakeExec` (asserts `npx` + exact argv, announce-to-stderr/JSON-data, `E170` on non-zero exit); **update existing tests that hardcode the core-command surface** now that `skills` is added: `harness/cli/test/acts/help.test.ts` (help lists `skills`), `harness/cli/test/services/scaffold/scaffold-service.test.ts` (`skills` reserved → E151), `harness/cli/test/integration/cli-commands.test.ts` (command registration). | harness-cli | `harness/cli/test/skills.test.ts` + the 3 existing test files above | `npm test` green; new + updated tests cover the seams. | Principle 3 (fakes, not mocks). Validator: adding a core verb churns these snapshots. |
| [x] | T010 | **G4** Edit `eng-harness-0-setup` SKILL.md: add an **opt-in** step offering `harness skills install` (ask target/scope, never auto-run) + on decline print the exact "to install later, run: `harness skills install --target <cli> [--global]`" line + vercel-labs/skills pointer. | skills corpus | `skills/eng-harness-setup/eng-harness-0-setup/SKILL.md` | SKILL contains the offer + later-run line; no forced install. | AC9. |
| [x] | T011 | **G5** Build, lint, test the CLI. | harness-cli | (repo root) | `npm run build && npm run lint && npm test` all green. | AC10. |
| [x] | T012 | **G5** Real pass-through install into **one** reproducible throwaway target: `repo=$(mktemp -d)`, init a minimal repo there, run `harness skills install --target claude-code` (project-local, **no** `-g`) with `--source` pointed at this working tree (or the GitHub repo), then assert the `eng-harness-*` skills landed under the temp repo's CLI-local skills dir; `rm -rf` the temp dir at the end. | harness-cli + skills corpus | temp dir (not committed) | Command exits 0 with evidence; temp repo's local skills dir contains the imported/renamed skills; temp dir cleaned up. | AC11. One topology only (project-local) to stay deterministic. Needs network; if offline, fall back to the FakeExec proof (T009) + a `--help`/dry check and note the deferral. |
| [x] | T013 | **G5** Final docs pass: document the `skills install` surface in `harness/cli/README.md`; confirm README/INSTALL show the new path + Vercel attribution; re-run `npm run check:docs`. | docs | `harness/cli/README.md` | Docs updated; `npm run check:docs` clean. | AC1. |

### Acceptance Criteria

- [ ] AC1 — `harness skills install --help` lists target/global options + a vercel-labs/skills pointer (T007/T013).
- [ ] AC2 — the command prints the exact `npx skills@latest add AI-Substrate/harness-engineering …` line before running it (stderr in human mode; in `data`+`next_action` for `--json`, keeping stdout a clean envelope) (T007).
- [ ] AC3 — the invocation always includes `-y` and ≥1 `-a <target>` (T006/T009).
- [ ] AC4 — global adds `-g`; project-local omits it; multiple targets → repeated `-a` (T006/T009).
- [ ] AC5 — shells out only through the injected `ExecPort` (no direct child/shell), verified by FakeExec test (T009).
- [ ] AC6 — `npx`/network failure → structured `E170` envelope with `next_action`, no stack trace (T007/T009).
- [ ] AC7 — the 4 loop skills exist under `skills/eng-harness-loop/` with `SKILL.md` + references intact (T001).
- [ ] AC8 — all 7 skills regrouped under `eng-harness-{setup,loop}/`; every live reference resolves (incl. `skills/README.md`, root `README.md`, `INSTALL.md`, `docs/how/extend-the-harness.md`, `.minih.json`, internal SKILL cross-links, gen-docs inputs); no dangling old-slug links (T002–T004).
- [ ] AC9 — `eng-harness-0-setup` offers the install (opt-in) + prints the later-run line; never auto-runs (T010).
- [ ] AC10 — `npm run build`, `npm run lint`, `npm test` pass (T011).
- [ ] AC11 — skills installed into a throwaway target via the pass-through, and verified present (T012).
- [ ] AC12 — `--json` emits a `status`/`data`/`error`/`next_action` envelope for the new command (T007/T009).

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Vercel discovery doesn't find skills at the chosen depth | Low | High | Two-category layout = exactly `skills/<category>/<slug>/`; verify with `just list-skills` / dry run during T004/T012. |
| `npx skills` flag surface drifts (`-a`/`-g`/`-y`/`--skill`) | Low | Med | Pin behaviour behind `buildInstallArgv` (one change point); announce-before-run lets the user catch a bad invocation. |
| Temp-install test needs network/GitHub and may be flaky | Med | Low | Treat T012 as a manual/at-the-end verification, not a unit test; FakeExec covers the deterministic seams. |
| Renaming breaks external `the-flow`/`plan-6` slug refs | Certain (accepted) | Med | Out of scope; recorded as a follow-up in spec + `skills/README.md` (Finding 06). |
| `check:docs` drift after editing inlined doc | Med | Low | T004 runs `gen:docs`; T013 re-checks. |
| Adding a core `skills` command churns existing snapshot/expectation tests (help text, scaffold reserved-name, integration command list) | High | Low | T009 explicitly updates `help.test.ts`, `scaffold-service.test.ts`, `cli-commands.test.ts` alongside the new `skills.test.ts`. |
| `--json` announce text corrupts the stdout envelope | Med | Med | T007 routes announce to stderr (human) / `data`+`next_action` (JSON); AC2/AC12 enforce a clean stdout envelope. |

---

## Validation Record (2026-06-09)

### Validation Thesis

**Raison d'être**: The repo's skills have no first-class installer; this plan makes the harness install its own skills via the canonical Vercel `npx skills add` CLI, host all 7 skills coherently under `eng-harness-{setup,loop}/`, and have the setup skill offer the install.
**Value claim**: One transparent, target-aware install command any consumer repo inherits with the published CLI; the suite reads as one product.
**Artifact promise**: A downstream `/plan-6` agent can implement the 13 tasks with minimal clarification; the rename is complete for live refs and doesn't break existing CLI behaviour.
**Intended beneficiaries**: the `/plan-6` implementer, users installing the harness skills, future maintainers.
**Proof target**: Implementation.
**Evidence standard**: tasks map to real CLI seams; ACs testable; pass-through proven by FakeExec + a real temp install.
**Thesis source**: `harness-skills-install-spec.md` + user messages.
**Thesis verdict**: Advanced (after fixes).
**Main thesis risk**: the new core `skills` command must be a constitution-safe core capability (not a dynamic verb) — addressed by the strengthened G2 rationale citing Principle 7's `doctor`-is-a-core-capability precedent.

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Source-Truth & Coherence | Source Truth, Deployment/Ops, Domain Boundaries | 2 HIGH (README.md, .minih.json blast-radius) → fixed (T004) | ⚠️ → ✅ |
| Risk, Completeness & CS | Completeness, Evidence Sufficiency, Edge Cases, Complexity | 1 HIGH (JSON announce) + 3 MED (.minih.json, existing-test churn, T012 scope) → fixed (T004/T007/T009/T012) | ⚠️ → ✅ |
| Thesis Alignment & Forward-Compat | Thesis Alignment, Forward-Compatibility, Constitution | 1 HIGH (Principle-10 rationale) + 1 MED (TTY gate) → fixed (G2/T007) | ⚠️ → ✅ |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| `/plan-6` implementer | Build every task from a real seam; FakeExec extends cleanly; clear Done-When | shape mismatch | ✅ | Tasks map to concrete files/ports/tests; pure argv builder + FakeExec pass-through explicit. |
| `harness help` | Surface `skills` without breaking envelope/help semantics | contract drift | ✅ | T008 wires help text; T009 updates `help.test.ts`. |
| `harness doctor` | Remain stable; no regression from new core command | lifecycle ownership | ✅ | No doctor behaviour change; only command registration. |
| Existing CLI `--json` consumers | Stable envelope + exit codes; clean stdout | test boundary | ✅ | AC2/AC12 + T007 route announce off stdout; `E170` mapped. |
| External slug consumers (`the-flow`, `plan-6` in other repos) | Old `harness-1-*` slugs not silently broken | contract drift | ❌ (accepted) | Out of scope per spec; recorded as a follow-up. |

**Thesis alignment**: Value claim advanced at Implementation proof level; main residual risk (core-verb constitution fit) resolved via the Principle-7 precedent in G2.

**Outcome alignment**: "Give the harness a first-class way to install its own skills" and the suite "reads as one product." — with the blast-radius (README/.minih.json), JSON-announce, and constitution fixes applied, the plan as written advances this outcome.

**Standalone?**: No — downstream consumer `/plan-6` exists in the plan tree.

Overall: ⚠️ VALIDATED WITH FIXES — all 4 HIGH + 3 MEDIUM issues applied to the plan; remaining ❌ row is an explicitly accepted non-goal (external-repo slugs).
