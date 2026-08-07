# Execution Log — Plan 050 Phase 1 (T001–T006)

**Coder**: pij-1mx6yf1 (flow-pair) · **Orchestrator**: pij-4s10mb · **Date**: 2026-07-04

Implemented the whole phase in one run: a counts-only `artifact` event kind + a pure
extractor registry, wired into the existing telemetry capture window.

## Per-task

- **T001 — `ArtifactEvent` type + kind + serializer + rollup exclusion** ✅
  `events.ts`: added `artifact` to `EventKind`/`EVENT_KINDS`, new `ArtifactType` union,
  `ArtifactEvent` interface, and the `Event` union. `segment.ts serializeEvent`: an
  `artifact` case that REBUILDS the `counts`/`enums` maps (never spreads input) and drops
  non-finite counts — allowlist by construction. `rollup.ts computeRollup`: excluded
  `artifact` from the timed-work filter beside `flow_log` (capture-time `t` must not skew
  wall/gap/stage math — Finding 06).

- **T002 — `artifact-semantics.ts` (NEW): registry + 10 extractors** ✅
  Pure, defensive, modelled on `flow-log.ts`. Extractors: review, plan, workshop, dossier,
  tasks, execution-log, backpressure, validation, ship-report, flight-plan. Thin regex
  counters (KISS); grammar lifted from this repo's own artifacts. Two construction gates:
  counts omit zero-valued keys (garbage → `{}`, AC-04); enums map to a fixed vocabulary with
  an `other` fallback (AC-05). Includes the capture helper `artifactSemanticsEvents` +
  `resolveArtifactPath` (out-of-repo → skip).

- **T003 — contracts round-trip** ✅
  `semconv.ts`: 8 `A.ARTIFACT_*` attrs. `otlp/logs.ts`: `encodeEvent` + `decodeEvent`
  `artifact` cases — `counts`/`enums` ride as kvlist attrs (like `checks.gates`), empty maps
  omitted so a garbage artifact round-trips exactly. `harness-otlp.schema.json`: extended the
  frozen `harness_attributes` allowlist (kept scope_version 2.2 — additive, no bump).
  `segment.schema.json`: added `artifact` to the kind enum + item props with
  `additionalProperties:false` on `size`. `reconstruction.test.ts`: ALL_KINDS 14→15, the
  "every kind round-trips" case green with `artifact`.

- **T004 — wire into capture-service** ✅
  Threaded `cwd` into `buildInput`; the pass runs after `caps.files` extraction, stamped at
  the capture `timecode`. Composed via a new `withArtifactEvents` helper (appended last,
  rollup-excluded, like flow_log). Guarded read inside the helper: skips missing/unreadable
  (reader → null), oversized (>512 KiB), binary (NUL byte), and out-of-repo paths; dedups a
  path present in both written+edited (written wins).

- **T005 — tests** ✅
  `artifact-semantics.test.ts` (NEW, 47 cases): per-extractor fixtures with known counts,
  the `other` allowlist gate, per-extractor garbage→`{}` defensive parse, throwing-extractor
  fallback, registry dispatch (incl. plan-validation NOT shadowed by the plan matcher), path
  resolution, the capture helper (missing/oversized/binary/out-of-repo/dedup), and the
  privacy shape (secret prose absent from the serialized event; keys exactly the allowlisted
  set). `capture-service.test.ts`: 3 integration cases — AC-01 edited review → one event;
  AC-04 missing/oversized → no event, no throw; AC-03 two windows → two snapshots stamped at
  distinct capture times.

- **T006 — docs + gate** ✅
  Added an "Artifact semantics (`artifact`)" subsection + a kinds-table row to
  `docs/how/telemetry.md`. `just build` (re-embeds docs) then the composite gate green.

## Gate verdict

`just checks` → **exit 0**, `status: degraded` (all HARD gates ok): tests, biome, typecheck,
check:docs, check:flows, check:telemetry-fixtures, check:doctrine-parity, skills-check,
windows-check. Full telemetry suite 671 green; new files 47 + 3 green.

Two `degraded` (warn-launch, non-blocking, exit 0) gates are **pre-existing, not mine**:
- arch-check: 1 warn in `sync-service.ts → git-write-port.ts` (services-ports-type-only).
- markdown-lint: 11 findings — none in `docs/how/*.md` (my telemetry.md edit is clean).

## Deviations / discoveries

- **`plan_id` serialized as omit-when-absent** (`plan_id?: string`), not the workshop's
  literal `string | null` — matches the repo's optional-field idiom (`flow.from`, etc.) and
  keeps the serialize↔decode round-trip symmetric.
- **schema_version stays 2.2** — the new attrs/props are purely additive; the frozen
  `harness-otlp-schema.test.ts` + `segment-schema.test.ts` pin `2.2` and top-level
  `SEGMENT_FIELD_KEYS` (unchanged). Event_stream item props are not part of the frozen
  top-level key set, so no bump was warranted.
- **Real bug caught by a test**: the plan matcher first required a leading `/docs/plans/`,
  which repo-relative capture paths (`docs/plans/…`) never carry — it would have silently
  matched no plan file in production. Fixed to `(?:^|\/)docs\/plans\/…`.
- **`git add` of the generated `docs-content.ts`** was required for `check:docs`
  (`git diff --exit-code`) to pass. Staged only that generated artifact; no commit (the
  orchestrator owns commits). Pre-existing dirty files (041 plan/the-flow.json, 048
  the-flow.json) were left untouched — forbidden paths.

---

## Fix round 1 (review verdict FIX_REQUIRED → 3 findings)

**Coder**: pij-1mx6yf1 · **Date**: 2026-07-04 · Packet: `fix-packet-1.md` · Review: `reviews/review.phase-1.md`

- **F1 (HIGH) — verdict regex missed unbolded grammar** ✅
  The review extractor required the verdict to be BOLD (`\*\*(TOKEN)\*\*`), so real
  artifacts like `**Verdict**: ✅ APPROVE_WITH_NOTES …` (044 review) and `**Verdict**:
  FIX_REQUIRED` returned `null`. Replaced with "first UPPER_SNAKE token on the verdict
  line, regardless of bold/emoji wrapping": `/\*\*Verdict\*\*:[^\n]*?([A-Z][A-Z_]{2,})/`
  — still gated by `VERDICT_VOCAB` (`other` fallback), and it takes the FIRST token so
  `✅ **APPROVE** (FIX_REQUIRED → …)` resolves to `APPROVE`, not the parenthetical.
  Verified live against the two real repo review files (044 → `APPROVE_WITH_NOTES`, 050 →
  `FIX_REQUIRED`). The **validation** extractor already used the decoration-agnostic
  `[A-Z][A-Z ]+` pattern (handles `VALIDATED WITH FIXES` unbolded) — left as-is, now
  covered by an explicit multi-word test. New fixtures: bolded, unbolded, emoji-prefixed,
  first-token-wins.

- **F2 (HIGH) — counts/enums were open key maps** ✅
  `segment.schema.json` shipped `counts`/`enums` as `additionalProperties:{type:…}` — an
  open string-keyed channel. Closed it: enumerated the **global fixed key union** across
  all 10 extractors as explicit `properties` with `additionalProperties:false` on both
  maps, and constrained each `enums` property to its fixed vocab `enum […, 'other']`.
  Mirrored the key discipline in TS: `events.ts` now exports `ARTIFACT_COUNT_KEYS` /
  `ARTIFACT_ENUM_KEYS` (`as const`) + `ArtifactCountKey` / `ArtifactEnumKey`;
  `ArtifactEvent.counts/enums` became `Partial<Record<…Key, …>>`, and `put()` / the
  extractor accumulators are keyed — a rogue key is now a **compile error**. OTLP decode
  rebuilds into plain maps at the wire boundary (reconstruction is untyped by design).
  New tests: schema↔TS key parity; a planted un-enumerated nested key is REPORTED
  (ajv-free `additionalProperties:false` check, mirroring `segment-schema-nested.test.ts`);
  every extractor emits ONLY schema-enumerated keys over a marker-rich fixture; every
  emitted enum VALUE is within its schema vocabulary.

- **F3 (MED) — inventory gaps vs workshop rows** ✅
  - **Row 9 (workshop opportunities)** — `planExtractor` now emits `workshop_opps` =
    DISTINCT `WS-<n>` marker count (the flow's structural workshop-opportunity id; deduped
    so a repeated `WS-1` counts once).
  - **Row 22 (chore status incl. todo)** — `flightPlanExtractor` now emits chore-SCOPED
    `chores_done` / `chores_skipped` / `chores_todo` (todo = a chore whose status is
    neither `done` nor `skipped`, the same unfinished-chore predicate as
    `flow-mutations.ts listChores`), alongside the existing global `done`/`skipped` node
    rollup.
  - **Row 10 (unresolved gaps) — narrowed, with citation.** The workshop says "count
    `⚠️ GAP:` markers + Unresolved Gaps rows"; the `## Unresolved Gaps` section is prose
    (e.g. `- None — all gates PASS` would fabricate a gap), so `gaps` counts the honest
    `⚠️ GAP:` marker only. Consistent with the "structural markers only" extractor rule
    (workshop § Extractor registry rule 3). AC-02/AC-05 wording remains accurate (they
    reference the inventory generically and the `additionalProperties:false` guarantee,
    which F2 strengthens).

**Gate**: `just build` exit 0; `just checks` → **exit 0**, `status: degraded` (all HARD
gates ok: tests, biome, typecheck, check:docs, check:flows, check:telemetry-fixtures,
check:doctrine-parity, skills-check, windows-check). `artifact-semantics.test.ts` now 55
cases green. The same two warn-launch degradeds (arch-check `services-ports-type-only`;
markdown-lint 11 findings, none in `docs/how/*.md`) are pre-existing, not mine. Staged the
regenerated `docs-content.ts` for `check:docs`; no commit.
