# Retro — Plan 006 Add-Extension Skill

**Date**: 2026-06-08 · **Mode**: Simple, single phase (companion build) · **Verdict**: clean

## Companion (code-review-companion) — run 2026-06-08T19-55-47-799Z-3769

- **Findings**: 4 sent (F001–F004), all dispositioned.
  - F001 (MEDIUM) FakeFs.mkdirp not recursive → fixed (register parent segments).
  - F002 (MEDIUM) wrap templates don't escape generated JS → fixed (reject unsafe `--wrap`, E108).
  - F003 (MEDIUM) wrapJs not byte-asserted → fixed (added byte-exact fixture).
  - F004 (MEDIUM) mkdirp drops leading slash → **false positive** (verified); added abs-path guard test.
- **magicWand** → **minih**: expose the canonical project root + output path to the agent shell, and fail boot fast if `MINIH_PROJECT_ROOT` ≠ repo root.

## minih e2e agent (install-and-validate-test-extension) — run 2026-06-08T20-22-14-091Z-4ed2

- **Verdict PASS** — scaffolded a wrap verb via the skill in a throwaway repo; doctor loaded, help listed, invoke ok exit 0.
- **magicWand** → **minih**: export `MINIH_PROJECT_ROOT`/`MINIH_OUTPUT_PATH` into SDK shells.
- Difficulties: MH-001 (minih env — route upstream), MH-002 (project: doctor reports `degraded` in a consumer repo — **FU-006-01**), MH-003 (project: wrap next_action — **fixed**).

## Cross-agent signal

Both the companion AND the e2e agent independently flagged the **minih `MINIH_PROJECT_ROOT` env** gap. High-confidence upstream item for minih.

## Orchestrator (me)

- **Worked well**: test-first + companion-per-commit caught real template/fake issues at commit time (cheap fixes); the byte-exact template fixtures made drift impossible; the integration test closed the scaffold→load loop convincingly.
- **Friction**: `.minih.json` `skills.include` forces skill resolution for *every* agent at boot — the companion couldn't boot until the `add-extension` SKILL.md existed (had to stub it first). Lesson encoded in the execution log's pre-build discoveries.
- **Magic wand** (project): `harness doctor` should distinguish source-tree vs installed-package consumer checks (FU-006-01) so a healthy install doesn't read `degraded`.

## Follow-ups

- **FU-006-01**: `harness doctor` consumer-repo `degraded` false signal (from MH-002). Candidate small plan touching `services/doctor/`.
- **Upstream (minih)**: `MINIH_PROJECT_ROOT` env exposure / boot preflight (companion + e2e agent converged).
