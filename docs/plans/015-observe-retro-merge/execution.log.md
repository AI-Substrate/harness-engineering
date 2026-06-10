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

## T012 — Verification sweep ✅

- **AC-12 grep (fresh, repo root)**: `grep -rn "harness-3-observe" --exclude-dir=docs/plans --exclude-dir=.git .` → **exit 1, zero hits**. Flow-row proof: `grep -c "harness observe" skills/eng-harness-loop/eng-harness-flow/SKILL.md` → **5** (≥1 required).
- **Line count**: `wc -l skills/eng-harness-loop/eng-harness-4-retro/SKILL.md` → **386** (< 703).
- **D-13 strings**: magic-wand question ×**2**; proof-gap question at lines **46** (headline capture section) and **159** (drain beat) — both placements, locked wording.

### AC-14 mapping table (mandatory — one row per preserved behavior, section + line in the merged SKILL.md)

| Item | Behavior | Section heading | Line(s) |
|---|---|---|---|
| (a) | Calibration targets: ≤1 self-prompt/5 min, ≤5 entries/session, soft | § Calibration (soft targets, anti-over-introspection) | 104–105 |
| (b) | Task-boundary heuristic — self-prompt only when buffer empty | § Calibration → **Task-boundary heuristic** | 107–109 |
| (c) | Cross-session leftover check at auto-firing skill start (bucket-sweeping via `--list` all-buckets default) | § `--drain` → When to fire → **Cross-session leftover check** | 129 |
| (d) | Drain menu `[s/t/p/e/d/a]`: selective save · `/plan-5 --fix` emission · `/plan-1b` emission · encode staging w/ mandatory Validation footer · dismiss | § `--drain` Step 2 (menu 162–165) + Step 3 (`[s]ave` 206, `[t]ask` 212, `[p]lan` 216, `[e]ncode` 220–246 incl. footer template 229, `[d]ismiss all` 248) | 162–250 |
| (e) | Harvest lifecycle ops `[r]esolved` / `[w]ontfix` / `[s]tale` (in-place status mutations) | § `--harvest` Step 5 — Action menu | 360–362 |
| (f) | Three-tier encoding-hint generation (entry field → kind/target templates → fallback) | § Encoding-hint generation (one line per entry) | 256–260 |
| (g) | Plan-id detection (cwd → branch → null) | § `--drain` Step 4 — Plan-ID detection | 252–254 |
| (h) | Harvest clustering/prioritization, stale thresholds (4w/2w), `--json` contract, prune dry-run | § `--harvest` Step 3 (stale 307, top-10 order 308) + `--json` (334–346) + Pruning (364–366) | 305–366 |
| (i) | Buffer-non-empty advisory at harvest start | § Buffer-non-empty advisory | 285–289 |

All 9 rows locatable — no empty rows; sign-off proceeds.

- **AC-13 no-overclaim pass** (every CLI behavior the skill names, verified in code): capture flags incl. `--suggested-encoding`/`--agent` (acts/observe.ts) ✓; per-kind sequential IDs + ISO timestamps + full `system.compound` (observe-service + codec, D10) ✓; validation w/ allowed values, `unconfigured` exit 2 (D6) ✓; identity chain never fails (resolveBucket, D4) ✓; gitignore self-heal at capture + doctor convention check (ensureTemp + checkConventions) ✓; `--list --json` all-buckets/bucket-annotated/`malformed_skipped` (D9) ✓; `--clear` truncate-files-kept ✓; `record retro` dated-subdir `data.path` (record-service) ✓; `harness instructions` teaches capture+drain (CORE_INSTRUCTIONS) ✓. No claim without an implementation.

## T013 — Dogfood drain session ✅ (the harness-loop retro seam, run for real)

- Pending before drain: `--list --json` → 2 entries (`SUGG-001` user note + `DL-001` FakeFs gap), bucket `agent`, `malformed_skipped: 0`.
- `[a]ll-save` (autonomous default at a phase seam): `npx harness record retro --slug "015-observe-retro-merge-build-drain" --json` → **`data.path = .harness/records/retro/2026-06-10/002-015-observe-retro-merge-build-drain.md`** (CLI-owned dated-subdir placement; ordinal 002 after a pre-existing 001). Envelope written with entries verbatim; DL-001 marked `status: encoded, resolved_by: e4a943a` (fixed within this same build); SUGG-001 stays `open` (`source: user`).
- `npx harness observe --clear` → `{cleared: 2, buckets_scanned: ["agent"], malformed_skipped: 0}`; follow-up `--list` → **0 observations**. AC-9 proven end-to-end against the real CLI in this repo.
- Template note: the scaffolded retro template's status enum is `open|suggested|encoded|wontfix|stale|dismissed` — "resolved" is not a status; `[r]esolved` maps to `encoded` (the merged skill states this correctly).

## T014 — Final validation ✅

- `just fft` → green (suite + coverage; 91.9% functions / 92.3% lines).
- `npm run test` from **repo root** → 374/374. `cd harness/cli && npx vitest run` → 374/374 (**AC-15 both cwds**).
- `npx harness doctor --json` → `status: ok`, 2 extensions loaded.
- Smoke: `npx harness observe "T014 smoke entry…" --kind insight` → `INS-001`; `--list` → 1; `--clear` → 1 cleared, sweep empty after.
