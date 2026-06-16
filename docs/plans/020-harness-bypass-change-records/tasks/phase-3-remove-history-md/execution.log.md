# Execution Log — Phase 3: Remove history.md

**Plan**: harness-bypass-change-records · **Phase 3 of 5** · **Mode**: Full · **CS-2**
**Started**: 2026-06-16 · **Companion**: `code-review-companion` run `2026-06-16T07-18-47-309Z-3ebc` (Power-On-Mode)

---

## T000 — Harness pre-flight seam (`--event pre-implement`)

Fired `/eng-harness-flow --event pre-implement --phase "Phase 3: Remove history.md" --plan-dir docs/plans/020-harness-bypass-change-records --json`.

- Repo is the worked example — S0 (CLI installed + `harness doctor` `status: ok`, all 5 layers green incl. `record-types: 3 core`), S2 (governance doc at `.harness/engineering-harness.md`), S4 (boot = `just test`) all hold → router crosses into the engineering dispatch and routes `pre-implement` → **boot validation**.
- Boot (`just test` → `cd harness/cli && npx vitest run --coverage`): **64 files / 637 tests passed, 1.04s**. Coverage 90.85% stmts.
- **Verdict: HEALTHY** → proceed to tasks.

## T001 — Migrate the one history.md row → harness-change record

- Read `.harness/history.md`: single data row dated **2026-06-10** (cwd-independent test suite; trigger plan-014 orchestrator retro OH-001/OH-003; evidence suite 317/317 green).
- Scaffolded via `harness record harness-change --slug migrate-cwd-independent-test-suite` → `.harness/records/harness-change/2026-06-16/001-migrate-cwd-independent-test-suite.md`.
- Provenance auto-stamped (8 frozen keys, all non-null): `record_kind`, `harness_version 0.3.0`, `branch`, `repo`, `created_at` (the **migration** moment 2026-06-16T07:21:03Z), `agent claude-code`, `plan_id`, `schema_version 1.0`.
- Filled the 3 body keys: `change_type: fixture`, `target` (the cli test suite — cwd-independent path resolution), `resolves: "plan-014 orchestrator retro OH-001/OH-003"`. Body preserves the **original 2026-06-10 date** as its first line + the row's Improvement/Trigger/Evidence prose, plus a "migrated from the retired history.md ledger" note. No 5th frontmatter key (contract = `change_type`/`target`/`resolves` + provenance).
- **Migrate-before-delete**: record committed *before* T002 deletes the file (data safety; git history shows the ordering).
- Committed alone (commit A `3354d79`, explicit pathspec — 1 file changed; the 93 staged presentation deletions stayed uncommitted). Companion pinged `review-request: T001 3354d79`.

## T002 — Delete `.harness/history.md`

- `git rm .harness/history.md` — file gone, deletion staged. Only after T001's record was committed.

## T003 — TEST (RED) — `history-md-guard.test.ts`

- Added `harness/cli/test/architecture/history-md-guard.test.ts`, mirroring `no-direct-node-io.test.ts`: `REPO_ROOT` from `import.meta.url` (4 levels up from `test/architecture/`), recursive `.md` walk of `['skills','docs/how','.harness']`, regex `/\.harness\/history\.md/`, `expect(offenders).toEqual([])`. Excludes `.harness/records` + `.harness/temp` (so the migration record + Phase-1 source comments don't false-trip).
- Ran → **RED**, listing exactly the **7** live offender files (the migration record correctly excluded). TDD red confirmed.

## T004 — Sweep the 7 docs → GREEN

- Reworded/deleted every `history.md` reference (both `.harness/`-prefixed *and* bare) per the Sweep Map — 17 edits across the 7 files:
  - `.harness/engineering-harness.md` — L3 snapshot now points at the `harness-change` record.
  - `governance-doc.md` — intro, separation-of-concerns bullet, snapshot row; **G3 section rewritten** (kept as `## G3 ·` to preserve G4/G5 numbering — no renumber) to "the change ledger = `harness-change` records"; G5 Improve-beat row → "a `harness-change` record is written".
  - `maturity-assessment.md` — trajectory line, **L3 rung** (`a harness-change record exists` / evidence `≥1 harness-change record`), **L4 cadence**.
  - `getting-started.md` — Improve quick-ref row, ASCII loop line, **removed** the file-tree `history.md` line and added `harness-change/` to the `records/` tree, maturity-ladder prose.
  - `eng-harness-1-boot/SKILL.md` — STATUS-mode trajectory read + compounding-value paragraph (boot "never writes to it").
  - `eng-harness-4-retro/SKILL.md:385` — field-source comment only (`:85` Kinds list left for Phase 4).
  - `eng-harness-flow/SKILL.md:342` — references-table line.
- Re-ran guard → **GREEN**. Confirming grep across guard scope → **zero** remaining `history.md` refs (bare or prefixed).

## T005 — VERIFY (no-regression gate)

- Full vitest: **638 passed** (65 files = 637 baseline + the new guard). ✓
- `tsc -p harness/cli/tsconfig.json --noEmit` → **exit 0**. ✓
- `biome check harness/cli` → 154 files, no fixes. ✓
- `npm run check:docs` → **exit 0**, and `git diff` on `harness/cli/src/services/docs/docs-content.ts` is **CLEAN** — confirming none of the 7 swept files are gen:docs sources (validate-v2's finding holds; the swept skill/gov docs are not in `docs-manifest.json`). ✓
- Migration record present: `.harness/records/harness-change/2026-06-16/001-migrate-cwd-independent-test-suite.md` (proves the "row migrated" leg of AC-8 — the guard alone only proves "no live refs"). ✓
- **Guard spot-check**: a re-introduced `.harness/history.md` ref in a throwaway `skills/__guard_spotcheck__.md` made the guard go **RED** (caught it); removing the scratch returned it to **GREEN**. The sensor genuinely catches regressions.
