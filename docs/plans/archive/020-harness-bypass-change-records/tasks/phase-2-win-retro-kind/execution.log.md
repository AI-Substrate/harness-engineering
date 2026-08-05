# Execution Log — Phase 2: win retro kind

**Plan**: [harness-bypass-change-records-plan.md](../../harness-bypass-change-records-plan.md)
**Phase**: Phase 2 of 5 · **Mode**: Full · **Companion**: `code-review-companion` (minih Power-On)
**Started**: 2026-06-16

---

## T000 — Harness pre-flight seam (`--event pre-implement`)

- **Router**: installed (`~/.agents/skills/eng-harness-flow`). Fired `/eng-harness-flow --event pre-implement --phase "Phase 2: win retro kind" --plan-dir docs/plans/020-harness-bypass-change-records --json`.
- **Decision**: `route` → boot validation (engineering zone; S0+S2+S4 hold — `harness doctor status: ok`, governance doc present, boot = `just test`).
- **Boot verdict**: **healthy** — `npx vitest run` → **633 passed (64 files), 2.4s**. Green baseline established (matches Phase-1 close).
- **Ground-truth confirmation**: `harness doctor` shows 3 core record types (retro, harness-bypass, harness-change ✓ from Phase 1) and the retro template still lists exactly **7 kinds** (`difficulty…confusion`, prefixes `DL/MW/GFT/INS/COORD/SUGG/CONF`) — the state Phase 2 changes.
- **Outcome**: proceed to tasks.

## Companion setup (C0 / C0a)

- `minih 0.2.1`; `gh` authed. No active run found → booted `code-review-companion`.
- **Run ID**: `2026-06-16T15-59-40-923Z-d583` (`verdict: active`).
- Briefing sent (one-shot, `type=briefing`): plan/spec/phase/tasks paths, the 5 hazards (the `:344` toEqual RED driver, no-ajv KF-05, the coordinated `schema_version` bump, the harness-bypass/change Non-Goal, path-scoped commits), and domain context. Peer `verdict: listening`.

---

## T001 + T002 — observe codec RED→GREEN (`win` 8th kind)

- **T001 (RED)** — extended `observe-service.test.ts`: added `win:'WIN'` to the local `KIND_PREFIXES` map (the `:344` `toEqual` breaker driver), retitled the three "7 kinds/values" tests → "8", added an explicit `kind=win → WIN-001` capture test, and the positive-additivity `parseBuffer` round-trip of a hand-written `win` legacy block. Ran the file → **5 failed / 33 passed**, exactly the intended RED (win-loop iteration, explicit win capture, `toContain('win')`, the `toEqual` breaker, the win legacy-parse `malformed:1`).
- **T002 (GREEN)** — added `win: 'WIN'` to `OBSERVATION_KINDS` (`buffer-codec.ts`, 8th kind; comment bumped 7→8) and `win` to the hand-maintained Kinds line in `core-instructions.ts:60`. **No edit** to `acts/observe.ts` or `observe-service.ts` — they derive from `Object.keys(OBSERVATION_KINDS)` (validation `:111`, error-message `:117`) and the prefix lookup (`:157`), so `win` auto-propagated. Re-ran observe + instructions → **49 passed**.
- **Discovery**: the `:130` "rejects unknown kind" message is built from `kinds.join(', ')`, so adding `win` to the codec made the error list `win` automatically — I strengthened that test with `toContain('win')` rather than just retitling it (turns the "8 kinds" rename into a real assertion).
- **Commit A** `271c731` (path-scoped: buffer-codec.ts, core-instructions.ts, observe-service.test.ts — 3 files, 0 presentation files).
- ⚠️ **Gotcha (recovered)**: my first attempt used `git commit` with **no pathspec** after `git add <my files>` — but the 93 presentation deletions were *already staged* in the index, so the pathspec-less commit swept them in. Caught immediately via `git show --stat`; the commit was local-only (never pushed). Recovery: `git reset --soft HEAD~1` (preserves all staged state) → re-commit with `-F <msgfile> -- <explicit 3 paths>` (the `-m` must precede `--`, else it's parsed as a pathspec). Net: only the 3 code files committed; the 93 deletions stay staged exactly as the user left them. **Lesson**: with pre-staged unrelated WIP in the index, ALWAYS commit with an explicit pathspec — `git add` + bare `git commit` is unsafe.

## T003 + T004 — retro schema/template RED→GREEN (`win` enum + 1.0→1.1)

- **T003 (RED)** — extended `retro-template.test.ts` (zero enum assertions before): (b) enum-membership — parse the schema JSON, assert `$defs.Entry.properties.kind.enum` ∋ `win` (+ the 7 originals remain); (c) `schema_version` lockstep — extract `RETRO_TEMPLATE`'s value via `frontmatter()` + `/^schema_version:\s*"([^"]+)"/m` and assert `=== schema['x-schema-version'] === '1.1'`. Reused the file's existing `JSON.parse(readFileSync(SCHEMA_PATH))` + `frontmatter()` helpers. Ran → **2 failed / 3 passed** (enum lacks `win`; template still `1.0`) — intended RED; the regex correctly extracted `1.0`, proving the extraction works.
- **T004 (GREEN)** — (1) added `"win"` to `retro.schema.json` `$defs.Entry.properties.kind.enum`; (2) added top-level `"x-schema-version": "1.1"` (the committed-decision anchor — JSON Schema 2020-12 ignores unknown keywords); (3) bumped `RETRO_TEMPLATE` `schema_version` `"1.0"→"1.1"` + added `win`/`WIN` to the template's kind + prefix-default comments; (4) added `WIN (win)` to the schema's recommended-prefix doc string. Ran `test/services/record/` → **39 passed** (3 files).
- **T005(b) verified inline**: `record-service.test.ts` stays green — it reads `schema_version` dynamically (presence, not the literal), so the bump is safe exactly as Phase 1 (T003b) designed. The synthetic `:332` `TEMPLATE` fixture (literal `"1.0"`) is untouched.
- **Non-Goal honored**: `harness-bypass.ts` / `harness-change.ts` NOT touched — still `schema_version: "1.0"` (independent contracts).
- **Commit B** `eca4117` (path-scoped: retro.schema.json, retro.ts, retro-template.test.ts — 3 files, 0 presentations; explicit pathspec, lesson from commit A applied).

## T005 — VERIFY additivity + no regression (all gates green)

- **(a) Positive additivity** — the `win` legacy-block `parseBuffer` round-trip (T001c) is GREEN (`malformed: 0`), proving 1.0-era hand-written buffers with the new kind parse. Since there is no ajv (KF-05), "existing 1.0 retros still validate" reduces to "the 7 originals remain in the 1.1 enum superset" — asserted in T003b — plus the legacy-parse cases staying green.
- **(b)** `record-service.test.ts` provenance tests green (dynamic `schema_version` read — Phase-1 design held).
- **(c) Full suite**: `cd harness/cli && npx vitest run` → **637 passed (64 files)** = 633 baseline + 4 new (2 observe, 2 retro-template). Zero regressions.
- **(d)** `tsc -p harness/cli/tsconfig.json --noEmit` → clean; `npx biome check harness/cli` → clean (153 files).
- **(e) bonus** `npm run check:docs` → exit 0 (gen:docs regenerated `docs-content.ts` with **no diff**) — confirms `core-instructions.ts` + `retro.ts` are NOT gen:docs sources and the `docs/how/*` kind lists are correctly untouched (deferred to Phase 5).
- **arch-check / skills-check**: no such script at repo root (confirmed) — N/A; no service-graph change anyway (`buffer-codec.ts` stays a pure grammar module, no new `node:*` imports → P2 intact).

## T006 — Harness phase-end seam (`--event phase-end`)

- Fired `/eng-harness-flow --event phase-end --plan-dir docs/plans/020-harness-bypass-change-records --json`.
- **Router decision**: `route` → `eng-harness-4-retro --drain` (engineering zone; observe buffer **non-empty**, so drain precedes harvest).
- **Pending entry**: exactly 1 — `INS-001` (kind `insight`, `first_seen_at: 2026-06-11`, about the kernel `formatError` dropping a verb's top-level `data` on the error path / arch-check's `data.violations` claim). It is a **prior-session** entry, unrelated to plan 020 Phase 2. **Not auto-encoded/dismissed** — that's a user `[e]/[d]` decision; best-effort, never blocks (invariant #4). Surfaced to the user for a separate drain decision.
- 🔎 **Dogfooding finding (live)**: this phase's *own* friction (the git-pathspec gotcha, the `toEqual`/error-message insight) was captured to **this execution log + the Discoveries table**, NOT to the `harness observe` buffer — so the phase-end drain finds none of it. This is exactly the gap the `harness-flow-integration-dossier.md` diagnoses: the-flow's implement verb has no Observe seam, so Retro drains an (effectively) empty-of-this-session buffer. `win` (just shipped) is the kind this very session would have used to record "the companion + test-first cadence worked well." Recommend the integration-dossier fix (dual-write friction-kind discoveries to `harness observe`) as a follow-up — a textbook `harness-change`.

---

## Companion findings reconciliation (`code-review-companion`, run `…d583`)

Companion reviewed both code commits (`reviewedIds`: the T001-T002 + T003-T004 pings) and raised **1 MEDIUM**, **0 HIGH/CRITICAL**.

| # | Severity | Finding | Disposition |
|---|----------|---------|-------------|
| F1 | MEDIUM (Domain Compliance / Contract Drift) | `retro.schema.json` + `RETRO_TEMPLATE` now accept `kind: win`, but two user-facing guidance surfaces still list only 7 kinds: `eng-harness-4-retro/SKILL.md:85` and `AGENTS_README.md:193`. Agents following those surfaces won't discover the new positive signal. | **ACCEPTED → deferred-with-tracking** (the finding's own second recommended option). The companion caught two stale mirrors the dossier's validate-v2 pass missed — genuinely valuable. Verified both, then mapped each to its owning phase: **`eng-harness-4-retro/SKILL.md` → Phase 4** (it already edits this SKILL.md for the `win` capture beat; editing now would overlap), **`AGENTS_README.md` → Phase 5** (it's a `gen:docs` *source* — confirmed: editing it regenerates `docs-content.ts` — so it's the same docs-sync bucket as `docs/how/*`). Both land before the single plan merge, so no stale guidance ships. Flight-plan P4/P5 notes updated to carry these. |

**Debrief**: sent `control:stop` (acking the finding) → companion reached `verdict: completed`. No `magicWand` or extra farewell summary emitted (the single MEDIUM was its only finding) → nothing further to file.

**Why not fix in-phase**: `core-instructions.ts` was fixed in Phase 2 because it's a standalone TS constant (not a gen:docs source, no test pins it). The two companion-flagged surfaces are different: one is owned by Phase 4, the other is a generated-docs source owned by Phase 5's docs-sync + `check:docs` gate. Pulling either into Phase 2 would bleed scope across the plan's deliberate phase boundaries. (I briefly edited AGENTS_README in-phase, saw `check:docs` regenerate `docs-content.ts`, recognized it as a gen source, and reverted — see the revert above.)

## Phase 2 — COMPLETE

All 6 tasks `[x]`. 2 RED→GREEN pairs landed test-first; full suite **637 green**; tsc + biome + check:docs clean; provenance + backward-compat intact; both new record types stayed at their independent `1.0`. Two path-scoped commits (`271c731`, `eca4117`) + this phase-close commit. The 93 staged presentation deletions were never touched.
