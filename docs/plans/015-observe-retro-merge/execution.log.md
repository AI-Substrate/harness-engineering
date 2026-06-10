# Execution Log — 015 observe-retro-merge (Build, single phase T000–T014)

**Started**: 2026-06-10T02:45Z · **Mode**: Simple (inline tasks) · **Skill**: plan-6-v2-implement-phase-companion
**Companion**: code-review-companion, run `2026-06-10T12-44-41-380Z-6236` (booted fresh; briefing sent 02:45:52Z)

Convention: RED/GREEN pairs are committed atomically (014 precedent — every commit green/bisectable). Companion pinged per commit, fire-and-forget.

---

## T000 — Harness boot pre-flight ✅

- Boot: `just test` → **317/317 green** (~0.7s warm; coverage 91.88% stmts).
- Interact/Observe: `npx harness doctor --json` → **status ok**, 5 layers ok, **2 extensions loaded**, branch `feat/harness-cli-core`.
- Verdict: ✅ HEALTHY. Companion active (verdict `active` after ~60s boot; the first `minih status` check showed the *prior completed* run — the `verdict=='active'` filter from the skill was load-bearing).

## T001 — RED capture-service tests ✅

- `harness/cli/test/services/observe/observe-service.test.ts` (new): 21 tests encoding D2–D6 + D10 and AC-1..AC-5 — all 7 kinds w/ prefixes; full `system.compound` block; 9/10-char description boundary (JS length); identity chain incl. kebab sanitize + empty/whitespace `HARNESS_AGENT` as unset; per-kind sequential IDs (independent counters, first-of-kind 001, legacy continuation DL-003); ID scan skips malformed + non-numeric suffixes; append-only byte-preservation; `ensureTemp` on every capture (+ idempotence); no-`.harness/` unconfigured; E146 unreadable buffer; tolerant parser proven against the old skill's **verbatim commented template** + the 7-space-indent `system.compound` variant; serializer round-trip.
- RED evidence: suite failed to load (module `services/observe/*` absent) — confirmed before implementation.

## T002 — GREEN observe service + codec + shared temp ✅

- `src/services/shared/temp.ts` (new): `ensureTemp`/`TEMP_GITIGNORE`/`HARNESS_DIR`/`TEMP_DIR` relocated from record-service (D1); `TempDeps` is a structural subset so existing `RecordDeps` callers pass unchanged.
- `src/services/record/record-service.ts`: imports + **re-exports** `ensureTemp` (existing test import path untouched); local dup constants removed. **All record tests untouched and green** (relocation sensor ✅).
- `src/services/observe/buffer-codec.ts` (new): constrained serializer (stable field order, JSON-quoted free text, full compound block) + tolerant parser (splits on `- id:` block starts; strips the old template's inline `# comments`; unknown kind/bad id/missing description → malformed, counted, never rewritten). **No yaml dependency** (D2).
- `src/services/observe/observe-service.ts` (new): `captureObservation` (validate → resolveBucket → per-kind ID over valid entries → ensureTemp + append) **plus `listObservations`/`clearObservations`** (all-buckets sweep, bucket-annotated entries, `malformed_skipped`; unreadable-mid-sweep fails before any truncation) — list/clear tested in T003.
- `src/output/error-codes.ts`: **E146 OBSERVE_BUFFER_UNREADABLE** added; pinned-table test extended.
- Evidence: full suite **345/345 green** from `harness/cli`; biome clean; architecture suite (no `node:fs` in services) green over the new files.
- Discovery: biome formats multi-line signatures back to one line under its width — `--write` pass needed before commit (lint is part of the per-pair loop).

## T003+T004 — list/clear + act + registration ✅ (commit e4a943a)

- T003 RED: act envelope/exit tests for every D6 branch (`test/acts/observe.test.ts`), compaction simulation + E142 reservation (`test/integration/observe.test.ts`), list/clear service cases (sweep annotation, scoped/nonexistent bucket, clear counts, unreadable-mid-sweep fails BEFORE truncation).
- T004 GREEN: `acts/observe.ts` (D-12 flags; sweep next_action teaches the drain), app.ts registration, `'observe'` in `RESERVED_NAMES`.
- **Discovery (DL-001, captured via the verb itself)**: `FakeFs.readdir` didn't reflect dynamically created dirs — the write-then-list integration came back falsely empty. NodeFs would have seen the bucket. Fixed by deriving mkdirp-created child dirs in `FakeFs.readdir` (seeded order preserved; pinned in fake-fs.test.ts). Three command-list pins (app/index tests) extended with `observe`.
- Dogfood live the moment T004 landed: `npx harness observe` captured SUGG-001 (user's mid-build note: harness-boot extension + AGENTS.md dogfood clause) and DL-001 (the FakeFs gap) into `.harness/temp/agent/session-buffer.md`. 367/367.

## T005+T006 — doctor temp-hygiene probe ✅ (commit 3f1cee9)

- Probe in `checkConventions()`: complaint only when `.harness/temp/` exists without its nested `.gitignore`; prescription names the self-heal path. Extensions layer flips degraded (exit 0) — including the previously unreachable empty-registry case; instructions-vs-temp suffix wording kept exact for the pinned E144 case; orphaned complaints rendered in text view (P7). 372/372.
- Deviation note (documented, small): D5 said "zero new render paths" — the temp complaint isn't tied to an extension folder, so renderDoctorText needed a 6-line orphaned-complaint loop inside the existing extensions block, or text-mode users would never see the prescription (P7 outranks the slogan). JSON surface unchanged.

## T007+T008 — core briefing capture+drain section ✅ (commit b0cef6f)

- `CORE_INSTRUCTIONS` gains "## Friction capture (observe as you work)": verb, identity chain, two storage classes, `--list --json` → `record retro` (data.path) → `--clear` drain. Ordering pinned: envelope contract still leads. 374/374.

## T009 — merged skill rewrite ✅

- `eng-harness-4-retro/SKILL.md` rewritten as the one friction-lifecycle skill: **386 lines** (< 703; the two originals totalled 703). Both D-13 questions verbatim ×2 (headline "The two questions" section + drain beat); 3 worked examples (boot dance / architecture rule eyeballed / endpoint with no smoke path) each with a real capture command; capture = one `npx harness observe` call; drain reads `--list --json`, materializes via `harness record retro` returned `data.path` (dated-subdir layout corrected — old flat-path prose died), clears via `--clear`; `[s/t/p/e/d/a]` + Validation footer + `[r]esolved`/`[w]ontfix`/`[s]tale` preserved; harvest gains token-cost recurrence framing; capture-during-drain race documented as accepted. Drain prose contains no hand-parsed buffer paths (buffer path appears only as background in frontmatter).
- Self-caught: first draft's frontmatter named the retired slug ("subsumes eng-harness-3-observe") — would have failed the AC-12 zero-hit grep; rephrased to "the retired standalone observe skill".

## T010 — delete + reference sweep ✅

- `skills/eng-harness-loop/eng-harness-3-observe/` deleted (git rm).
- `eng-harness-flow/SKILL.md`: mid-build routing row → `npx harness observe` one-liner (judgment → `eng-harness-4-retro` § in-flight capture); `at=observe` param doc → runs the CLI verb; precondition note rewritten; slug map `observe` → `eng-harness-4-retro` (re-pointed per D7, never removed); "four loop skills" → three.
- `skills/README.md` (3 refs), `README.md` (1), `INSTALL.md` (1), `.minih.json` (1) — retired. D8 line added verbatim to `eng-harness-0-setup/SKILL.md` step 3.
- **Repo-root grep proof**: `grep -rn "harness-3-observe" --exclude-dir=docs/plans --exclude-dir=.git .` → **zero hits** (exit 1); `grep -c "harness observe" eng-harness-flow/SKILL.md` → 5.

## T011 — docs/how + regen ✅

- `record-and-record-types.md`: "Records vs the scratch buffer" → "Two storage classes" with the capture verb, drain materialization, malformed honesty, doctor convention check.
- Order held: edit → `npm run gen:docs` → `npm run build` → suite **374/374 from harness/cli** (finding 06 / 014 OH-003 lesson). `docs-content.ts` regenerated, never hand-edited.
