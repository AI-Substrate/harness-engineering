# Phase 4: Chore Nodes — Execution Log

**Plan**: [024-first-class-flow-system](../../first-class-flow-system-plan.md) · **Phase**: Phase 4: Chore Nodes
**Mode**: Full · **Testing**: Full TDD (RED→GREEN→REFACTOR) per Phase 1/2
**Companion**: `code-review-companion` (Power-On-Mode) — run `2026-06-18T22-07-07-751Z-4b93`
**Constraint**: NO commits this phase (uncommitted-until-PR). Companion reviews per-task frozen diffs under `.harness/temp/`.
**Open decisions (proceeding on dossier leans)**: name=`chore` · encoding=nested `chore:{kind,importance}` via flat flags · threshold deferred (3 rail modes).

---

### T001 — harness-loop overlay: +todo/+skipped · ✅ done
- **Change**: `statuses[]` in `harness-loop.schema.json` gains `todo` + `skipped`; description notes the chore-lifecycle rationale. Regenerated `schemas-content.ts` via `npm run gen:flows` (wrote 2 schemas + 1 template).
- **TDD**: `test/services/flow/flow-chore.test.ts` (new) — RED first (3 failing: `todo`/`skipped` not in vocabulary), GREEN after the overlay edit + regen. 4/4 pass.
- **Evidence**: the closed-vocabulary guard still rejects an undeclared status (`bogus-status` → issue), proving this is purely additive via the **overlay-declared-status path** (`flow-schema.ts:252`) — no validator change. AC-03/AC-10.
- **Companion**: `.harness/temp/T001.diff` sent (review-request: T001).
- **Infra note**: minih resolves its agent registry from **cwd** → all minih calls must run from repo root (a `harness/cli` cwd yields E121 "no agents"). Companion process PID alive, long-polling.

### T002 — shared-core: `chore` first-class optional · ✅ done
- **Change**: `chore` added to `flow.schema.json` node `optional[]` (beside `command`); `schemas-content.ts` regenerated.
- **TDD**: T002 block in `flow-chore.test.ts` — RED on the declarative assertion (`nodeOptional` lacked `chore`), GREEN after the edit + regen. The round-trip assertion passed even pre-edit (tolerant validator, `flow-schema.ts:198`) — T002 promotes it from tolerated to declared. 6/6 pass.
- **Companion**: `.harness/temp/T002.diff` sent.

### T003 — validate chore object · ✅ done
- **Change**: new `chore` descriptor block in `flow.schema.json` (`kinds` + `importances`), mirroring `authority`. `flow-schema.ts`: `CoreDescriptor.chore`, `ResolvedFlowSchema.{choreKinds,choreImportances}`, merged in `resolveFlowSchema` (with defensive `DEFAULT_CHORE_*` fallbacks), and a chore-validation block in `validateFlowDoc` after the authority check. `schemas-content.ts` regenerated.
- **Design**: enums are **data-driven** (declared in the core descriptor), not magic strings — same pattern as `authorityValues`. `importance` has **no `required` level** by design (advisory invariant, ws004 C3) — a node can never be gated by a chore.
- **TDD**: T003 block in `flow-chore.test.ts` — RED on the 3 rejection cases (bad kind, `required` importance, non-object), GREEN after. Full schema suite **29/29**, no regressions.
- **Schema layer (T001–T003) complete.** Companion: `.harness/temp/T003.diff` sent; no findings raised on T001–T003.

### T004 — thread chore + command through mutations · ✅ done
- **Change**: `Chore` interface added to `flow-events.ts`; `FlowNode` gains explicit `chore?: Chore` + `command?: string` (promoted from the index-signature pass-through). `NodeSpec` += `command?`/`chore?`; `materialize()` spreads both (deep-copying the chore object) using the same spread-optional pattern as `zone`/`authority`.
- **TDD**: T004 block in `flow-chore.test.ts` — RED (materialize dropped chore/command), GREEN after threading. `addNode` + `insertNode --after` both persist + round-trip-validate. 44/44 (30 existing mutation tests intact).
- **Companion**: `.harness/temp/T004.diff` sent.

### T005 — wire `--command` on add-node + insert-node · ✅ done
- **Change**: `--command <cmd>` option added to both `add-node` and `insert-node` in `acts/flow.ts`; threaded into `NodeSpec.command`. Closes the ws-003 §I2 gap (the flag was specified in the workshop but never shipped, so `command` was unsettable via CLI — confirmed by Source-Truth in validation).
- **Scope**: add-node + insert-node per the dossier; `set-node --command` left as a follow-up (flagged to the companion).
- **TDD**: act-level tests in `test/acts/flow.test.ts` (Phase 4 block) — RED (commander rejected `--command` as unknown), GREEN after wiring. 16/16 act tests.
- **Companion**: `.harness/temp/T005-T006.diff` sent (T005 scope).

### T006 — flat chore flags → nested object + badChore guard · ✅ done
- **Change**: `--chore-kind`/`--importance` flags on add-node + insert-node; `choreFromFlags()` (acts/flow.ts) assembles the nested `chore:{kind,importance}` (Q2 = nested-via-flat). `badChore()` in flow-mutations.ts mirrors `badZone` — pre-write `E108` on a bad enum, nothing written; called in both `addNode` and `insertNode` after the zone guard. `CHORE_KINDS`/`CHORE_IMPORTANCES` mirror the shared-core vocab (as `ZONE_VALUES` mirrors zones); `required` is **absent** by design.
- **Co-landed with T005** (same act handlers).
- **TDD**: bad `--chore-kind` → E108 + file byte-unchanged; `required` importance rejected; valid flags assemble the nested object. A half-specified chore (one flag) → empty-string half → E108.
- **Companion**: `.harness/temp/T005-T006.diff` sent (T006 scope).

### T007 — chore-aware square pips · ✅ done
- **Change**: `CHORE_PIP` map (`□`/`■`/`▨`) + `pipOf()` returns squares for chore nodes (`▣` for strongly-recommended+todo); diamonds unchanged for the spine. Tolerant fallback `□`.
- **Design**: pips **always** render — the `--chores` mode (T008/T009) only collapses NAMES, never the pips (ws004 C5: "square pips always").
- **TDD**: T007 block in `flow-chore.test.ts` (via `renderRailBody`) — RED (chores drew diamonds), GREEN after. Renderer suite 27/27 intact — confirms no non-chore drift (no fixture regen needed for T007).
- **Companion**: `.harness/temp/T007.diff` sent.

### T008 — importance-aware name collapse (show/collapse/hide) · ✅ done
- **Change**: `ChoreRailMode` type + `CHORE_RAIL_MODES` (exported for the act). `railNames(band, mode)` replaces the inline `nameSeg`: spine always named; chore named `▸label` when `show` or `strongly-recommended`; `collapse` folds recommended/optional → `[*]`/`[*N]`; informational dropped; `hide` drops un-named chore names (pip survives). `renderRailBody`/`renderRailLine` gain `mode` (default `collapse`); embedded `renderRail` keeps the default.
- **Invariant**: pips always render; mode touches only names. `strongly-recommended` is un-hideable in every mode (the advisory invariant's only teeth — still never blocks).
- **No drift**: `railNames` over an all-spine band == the old `nameSeg`, so non-chore renders are byte-identical (renderer suite 27/27, no fixture regen).
- **TDD**: T008 block in `flow-chore.test.ts` — RED on collapse/hide/informational/`[*2]`, GREEN after. **Co-develops with T009** (the CLI flag that sets the mode).
- **Companion**: `.harness/temp/T008.diff` sent.

### T009 — `rail --chores show|collapse|hide` · ✅ done
- **Change**: `--chores <mode>` on the `rail` act (default `collapse`); validated against `CHORE_RAIL_MODES` (fail-fast `E108` before path resolution); threaded to `renderRailLine(doc, mode)`.
- **TDD**: act tests — `show` renders the name, default `collapse` → `[*]` (name hidden), `hide` drops name+marker (pip stays), `bogus` → `E108`. 19/19 act tests.
- **Renderer layer (T007–T009) substrate complete; T011 mermaid class next.** Companion: `.harness/temp/T009.diff` sent. **Inbox at the renderer boundary: 10 msgs, all outbound — no companion findings on T001–T009.**

### T011 — distinct mermaid chore class · ✅ done
- **Change**: `classDef chore fill:#E0F2F1,stroke:#00897B,stroke-dasharray:3 2;` added to `CLASS_DEFS` + a `🧰 chore (upkeep)` legend entry; `nodeClass` precedence now **harness > decision > chore > status** (chore wins over its status class, not over the seam-violet/decision-rhombus). Tolerant — old renderers ignore `.chore` and draw by status (incremental-safe, ws004 C5).
- **Full build green** (`npm run build` = gen:docs + gen:flows + tsc) — the whole Phase-4 feature **typechecks**. Golden fixtures regenerated (`flight-plan-024.md`, `kitchen-sink.md`).
- **TDD**: T011 block in `flow-chore.test.ts` — RED (chore rendered `:::unknown`), GREEN. Renderer+chore suites **59/59**.
- **check:flows nuance (no-commit mode)**: the render-drift sub-check (`node scripts/flow-fixtures.mjs --check`) passes **clean (exit 0)**. Full `npm run check:flows` reports a diff only on its `git diff --exit-code schemas-content.ts` sub-check — because the bundle is **legitimately regenerated but uncommitted** (the diff is exactly the chore-optional + chore descriptor + harness-loop statuses). It passes fully once committed at PR time.
- **Renderer layer (T007–T009, T011) complete.** Companion: `.harness/temp/T011.diff` sent.

### T010 — `harness flow chores` read verb · ✅ done
- **Change**: `listChores(doc): ChoreRow[]` in flow-mutations.ts (a READ — no clone/event) projects each chore node → `{id,label,status,kind,importance,command,anchor,runnable}`. `anchor` = `branch_of` else first predecessor (where the upkeep sits); `runnable` = kind ∈ {skill,command} (builtin/manual → false). `chores` subcommand in acts/flow.ts: `--json` → `{chores,count}` envelope; human → `renderChoresTable` (notes "agent can't run" for builtin/manual).
- **TDD**: act tests — 2 chores (command/builtin) with correct kind/importance/anchor/runnable; empty flow → `[]`. 51/51 (act + mutations).
- **Companion**: `.harness/temp/T010.diff` sent.

### T012 — tests + golden fixture + C7 events · ✅ done
- **C7 (events)**: chore insert/tick ride a `chore` discriminator in `node-created` + `status-changed` `details{}` — **no new event kind** (ws004 C7). Implemented in `addNode`/`insertNode`/`setStatus`.
- **Golden fixture**: new `test/services/flow/fixtures/render/chore-nodes.json` (inline + excursion + decision-orthogonality chores; all four square pips `□■▨▣`; the chore mermaid class) → `chore-nodes.md` auto-generated (gen:flow-fixtures auto-discovers; the golden-parity test auto-covers it).
- **Consolidation tests** (flow-chore.test.ts): two-overlay chore validation (**AC-03** — enums are core, so a chore validates under `test-flow` too); chore-on-`decision` orthogonality (C1); full insert→validate→render(`:::chore`)→`listChores` lifecycle.
- **Discovery**: the orthogonality test first used status `todo` under `test-flow` and failed — because chore **statuses** are overlay-declared (only harness-loop + the-flow opt into todo/skipped). Correct behaviour; the test now uses a `test-flow` status. Confirms chore is orthogonal to BOTH type and status-vocabulary.
- **FULL CLI SUITE: 833/833 across 75 files; render drift clean (3 fixtures).**
- **Companion**: `.harness/temp/T012.diff` sent.

### T013 — the-flow host overlay (cross-repo) · ✅ source done + verified · ⏸ deploy deferred
- **Change (source)**: added `todo`/`skipped` to `~/github/tools/skills/SDD/the-flow/references/flight-plan.schema.json` `statuses[]` (+ a description clause) so the-flow flight plans can carry chores (the 028 resolution: loop seams ride the host spine as chores). **Separate repo** (`git@github.com:jakkaj/tools.git`, SSH) — the no-vendor rule holds (never copied into this repo).
- **Verified end-to-end** (built CLI, `--schema`/precedence): `create flight-plan --schema <edited source>` → ok; a **todo-status chore node validates** under the overlay (ok); a **bogus status is rejected (E300)** — proving the overlay is genuinely enforced, so the todo-pass is meaningful. Temp `.harness/schemas/flows/` overlay used for the add-node resolve, then fully cleaned up.
- **Deferred (per dossier CLI-first order + no-commit mode)**: the **deploy** (copy source → `~/.claude/skills/the-flow/`, which is the LIVE skill this session — not mutated mid-flow), the **tools-repo commit/push**, and the fresh-load verify all wait for the CLI to publish at PR time. **Rollback** = revert the skill edit + `harness update --pin <prev>`.
- **Why safe to edit pre-publish**: the added statuses are inert until a chore node uses them; additive + reversible.
- **Companion**: `.harness/temp/T013.diff` sent (captured from the tools repo).

### T014 — docs + mermaid rework · ✅ done
- **Change**: reworked `docs/how/harness-flow.md` (user ask: "a little pedestrian — add mermaids"). Added **3 mermaids** (flow model/shape · the read→mutate→validate→write verb pipeline · the chore lifecycle state diagram) — **all validated clean with `mmdc`** — plus an annotated rail diagram and a full **Chores** section (attribute, kind/importance, the flags, the `chores` verb, square pips `□■▨▣`, the `show/collapse/hide` rail modes, the 028 big-picture). Verb table updated (chores + new flags + `rail --chores`); the stale "command unsettable" gap is gone.
- **Standalone guide** (not bundled into `docs-content.ts`) → no generated-bundle churn. Docs + flow + act suites **181/181**.
- **Companion**: `.harness/temp/T014.diff` sent.

---

## Phase complete — all 14 tasks ✅ (T013 deploy deferred to CLI publish)

- **Tests**: full CLI suite **833/833** across 75 files; render-drift check clean (3 fixtures incl. the new `chore-nodes`); `npm run build` (tsc) green.
- **check:flows**: render-drift sub-check passes; the schema-bundle git-cleanliness sub-check trips only on the uncommitted (regenerated) `schemas-content.ts` — resolves at commit/PR time.
- **No commits** (per constraint): every change sits uncommitted for PR time; companion reviewed each task via frozen `.harness/temp/T0NN.diff` patches.

---

## Companion debrief (code-review-companion, run `2026-06-18T22-07-07-751Z-4b93`)

Drain ping (cumulative phase diff) → `control:stop` → farewell read (`agents/code-review-companion/runs/.../output/report.json`). Companion exited `completed`.

**Farewell summary** (verbatim): *"Reviewed Plan 024 Phase 4 chore-node work across 14 task diffs plus the final cumulative sweep. The core shape is sound: chore remains an optional orthogonal node attribute, overlay-declared chore statuses stay out of the shared status validator, rail rendering preserves non-chore behavior, and importance remains advisory rather than gating. No HIGH or CRITICAL issues were found. Three MEDIUM contract/documentation drifts were reported…"*

**Findings reconciliation** (3 MEDIUM — all **ADDRESSED INLINE**):

| # | Finding | Disposition |
|---|---------|-------------|
| 1 | `set-node` lacks `--command` though the F4 discovery named add/insert/**set**-node | **Fixed** — `--command` added to `set-node` (`acts/flow.ts`); threads `fields.command` through the merge path. New act test (set-node --command on an existing node). |
| 2 | Event discriminator persisted only `chore: <kind>`; C7 (ws004 §153-154) specifies the `{kind, importance}` **pair** | **Fixed** — both `node-created` + `status-changed` now carry `chore: { kind, importance }` (`flow-mutations.ts`); T012 assertions updated to the pair. |
| 3 | The new guide's pipeline says "every mutation validates" but `flow event` is append-only (no node re-validation) | **Fixed** — `harness-flow.md` narrowed: pipeline is "structural mutation"; an explicit `event` caveat + a dotted append-only branch in the diagram (also added the missing `set-node` to the validated path). |

**magicWand** (companion's own follow-up wish — about **minih tooling**, not Phase 4): *"the final report helper could automatically materialize sent findings with ackOf IDs from the coordination ledger instead of requiring manual reconstruction."* → filed as a note for the minih repo; not in this phase's scope.

**Post-fix gate**: full CLI suite **834/834** · `tsc` green · render drift clean · 3 doc mermaids valid. **No HIGH/CRITICAL ever raised; all MEDIUMs closed.**

---

## Post-debrief tweak (UX) — dropped the named-chore `▸` marker

User feedback on the live rail: the `▸` prefix on a named chore (ws004 C5 / T008's `▸label`) read as a **cursor / "you are here"** indicator — the opposite of its meaning. Not a bug (it matched the spec), but a poor glyph choice. **Decision: remove the name-lane marker entirely** — the square pip (`▣ ■ □ ▨`) already signals chore-ness, so a named chore now renders its plain label (same as a spine stage; the pip is the sole chore signal). `railNames` in `flow-renderer.ts` updated (+ doc comments + `docs/how/harness-flow.md` example); a `.not.toContain('▸')` regression guard added to the show-mode test. No goldens contained `▸` → no fixture drift. Full suite **834/834**; global `harness` relinked (`just build`).
