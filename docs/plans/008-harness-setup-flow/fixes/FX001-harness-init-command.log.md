# Execution log — FX001: `harness init`

**Plan**: 008-harness-setup-flow · **Fix**: [FX001](./FX001-harness-init-command.md)
**Branch**: `feat/harness-init-command` (off `main`)
**Companion**: `code-review-companion` — runId `2026-06-15T07-57-06-414Z-c5c8` (Power-On-Mode, briefed)
**Testing approach**: TDD-leaning — builder snapshot + act/service FakeFs tests; full `vitest run` + `npm run build` gate before commit.

---

## Setup

- Branched `feat/harness-init-command` off `main` (never commit to default branch; the staged `docs/harness-presentations/…` renames are the user's WIP — left untouched, every commit scoped by explicit pathspec).
- **Pre-implement harness seam**: this is the harness's own repo (dogfood). Its boot/health substrate (`just test` / `harness doctor`) was exercised directly as the "prove it runs before code" check — **green baseline: 515 tests pass / 52 files, `npm run build` clean**. Router-skill seam not invoked as a sub-skill here; the boot intent is satisfied deterministically by the green baseline. Best-effort/advisory — never blocks.
- Companion booted + briefed (hazards: never-fake-success / L0 honesty, canonical heading set+order, never-clobber, E190 non-collision, no `node:fs` in the service, packaging-zero-change).

---

## Tasks

### FX001-1 — skeleton template + pure builder ✅

- Added `harness/cli/src/services/init/governance-template.ts`: `GOVERNANCE_SKELETON` constant (workshop §1 bytes, verbatim) + pure `buildGovernanceSkeleton(): string`. **Zero imports** — the builder never touches fs/clock (Constitution P2); the act owns the I/O.
- Section set + order mirror the canonical governance doc (`## Boot command` … `## Current maturity snapshot`); maturity seeded `L0` in its own **trailing** section; `## Injection map` is an empty table for `eng-harness-0-adopt` Step 3; every BIO/signal field is a `TODO` placeholder — never a faked value (honesty invariant).
- Test `test/services/init/governance-template.test.ts` — 8 cases: returns-constant, canonical heading set+order, AGENTS-START-HERE breadcrumb, L0 trailing section, empty injection map, **never-fakes** (every BIO/signal body is a `<!--` placeholder), **purity** (no I/O imports — reads its own source), + a committed inline snapshot (byte drift guard). **Full suite: 524 green.**
- Commit `feat(init): FX001-1` (`b40d6c1`) · companion pinged.
- **Companion verdict FX001-1**: APPROVE_WITH_NOTES — skeleton confirmed honest L0-only, I/O-free, empty placeholders + empty injection-map table. 1 MEDIUM finding **F001** (contract drift, resolved — see FX001-2/3 below). 0 HIGH/CRITICAL.

### FX001-2 + FX001-3 — act + service wiring, envelope + exit + E190 ✅

- `services/init/init-service.ts`: `initGovernance({fs,proc}) → InitOutcome`. Resolves the doc path from `proc.cwd()` (POSIX, plan 017); **exists-check FIRST** → existing doc returns `created:false` with **no** mkdirp/write (never-clobber); absent → `mkdirp .harness/` then `writeText(buildGovernanceSkeleton())`, both under one guard → `E190` on failure. `GOVERNANCE_DOC = 'engineering-harness.md'`. No Clock (static skeleton).
- `acts/init.ts`: `registerInitAct(program, io, {fs,proc,clock})` — maps the outcome to the envelope (created/exists → `ok` exit 0, failure → `error` exit 1), `evidence[0].path` = the doc, `maturity_seed:'L0'` **only on `created:true`**. JSON + human ports mirror `record`.
- Wiring: `'init'` added to `RESERVED_NAMES` (`registry.ts`); `registerInitAct` registered in `app.ts` `main` (after `doctor`); `ErrorCodes.INIT_WRITE_FAILED = 'E190'` (E150 confirmed taken). Surface-pinning tests (app/index command lists, error-codes table) extended to include `init`/E190.
- Tests: `test/services/init/init-service.test.ts` (create / never-clobber / E190 on write+mkdirp failure) + `test/acts/init.test.ts` (created envelope w/ L0 seed + evidence, existing w/o seed, E190 no-stack, human Created / Already-present) + reserved-name conflict case in `registry.test.ts`.
- **Live smoke** (`node harness/cli/bin/harness.js init --json`): clean temp dir → `created:true`, mkdirp `.harness/`, 1741-byte doc; re-run → `created:false`, **byte-identical**; this repo → existing doc **untouched**.
- **F001 resolved** (companion MED): `governance-doc.md` contents-table order swapped (Injection map before Back-pressure gaps) so all sources agree — single authoritative order.
- Gates: **full suite 535 green**, `npm run build` clean, `harness arch-check` **ok (0 violations)**, biome clean.
- Commit `feat(init): FX001-2/3` · companion pinged.
