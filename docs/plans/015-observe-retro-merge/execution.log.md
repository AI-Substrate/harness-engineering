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
