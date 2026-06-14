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
- Commit `feat(init): FX001-1` · companion pinged.
