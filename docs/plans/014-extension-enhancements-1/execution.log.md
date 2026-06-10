# Execution Log — 014 extension-enhancements-1 (Build, single phase)

**Plan**: [extension-enhancements-1-plan.md](./extension-enhancements-1-plan.md) · **Mode**: Simple (inline tasks T001–T017)
**Skill**: plan-6-v2-implement-phase-companion
**Companion**: `code-review-companion`, run `2026-06-10T10-44-33-424Z-8149` (booted fresh 2026-06-10; briefing sent 00:45Z, msg `01KTQFV3PTZ962CR78JE2JGM71`)
**Companion docs**: [AGENTS_README](https://github.com/AI-Substrate/minih/blob/main/AGENTS_README.md) · [companion-mode protocol](https://github.com/AI-Substrate/minih/blob/main/docs/how/companion-mode.md)

## Pre-Phase Agent Harness Validation

| Stage | Result | Notes |
|-------|--------|-------|
| Boot | 🔴 UNAVAILABLE | No `.harness/engineering-harness.md` (nor legacy `docs/project-rules/*` doc) exists yet — T015 authors it. No boot command to run. |
| Interact | — | n/a |
| Observe | — | n/a |

**Verdict**: UNAVAILABLE (not an error) → standard testing per plan: vitest + fakes, `just fft` as the suite sensor. After T015 lands, `eng-harness-1-boot` here reports the doc (AC-13 sensor).

## Commit discipline (deviation note)

RED/GREEN task pairs (T001+T002, T003+T004, T005+T006, T007+T008, T009+T010) are committed **atomically** — one commit per pair — so every commit on the branch stays green/bisectable. RED state is still proven by running the suite between writing tests and implementing (evidence recorded per task below). Companion pings carry both task IDs.

Pre-existing uncommitted changes (013 closeout files, 11 closed flow states, 014 plan artifacts) are **not** swept into task commits — each commit stages only its own files.

## Companion findings ledger (reconciled at debrief)

> **Protocol note**: zero live finding-messages arrived during the phase — the companion's farewell explains a minih `wait_for_any` issue meant queued task pings weren't seen live; it reviewed all 12 review tasks plus a **final range sweep** at drain time and delivered everything in the farewell envelope (verdict REQUEST_CHANGES, 8 findings). All 8 reconciled below; the post-farewell fix commit is **`1a6d5c9`** (suite 317/317 after; check:docs clean).

| Finding | Severity | Surface | Disposition |
|---------|----------|---------|-------------|
| F001 E144 next_action used an absolute path (vs E143's repo-relative guidance) | MEDIUM | doctor-service | **ADDRESSED INLINE** `1a6d5c9` — repo-relative via `relative(proc.cwd(), folder)`; tests updated |
| F002 scaffold name pattern allowed trailing/doubled hyphens | MEDIUM | scaffold-service | **ADDRESSED INLINE** — `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$` + 2 rejection tests |
| F003 collect mode missed dated retro subdirs (`retro/<date>/<file>.md`) — copied nothing from the current layout | **HIGH** | validate-harness-flow | **ADDRESSED INLINE** — one-level subdir walk preserving the date segment |
| F004 stale assessment schema path in next_action | MEDIUM | validate-harnessability | **ADDRESSED INLINE** — canonical path; ALSO fixed stale worker fire flags (old skill source/name) found on the same surface |
| F005 one remaining legacy-location wording | MEDIUM | eng-harness-2-backpressure | **ADDRESSED INLINE** — removed |
| F006 README overclaimed that setup authors the governance doc | MEDIUM | README.md:114 | **ADDRESSED INLINE** — honest wording (harness init writer deferred; doc hand-maintained) |
| F007 cli README + authoring-verbs + examples still taught flat layout (bundled into docs-content) | MEDIUM | harness/cli docs | **ADDRESSED INLINE** — package-form rewrite, examples `git mv`'d to folders, gen:docs regen |
| F008 CI package-smoke scaffolded FLAT fixtures — would fail (or mis-assert) under folder-only discovery | **HIGH** | .github/workflows/ci.yml | **ADDRESSED INLINE** — folder packages + briefings + explicit flat-E143 rejection assertion |

**Upstream issue filed**: the `wait_for_any` gotcha (queued task messages invisible until `inbox_list`; idle-budget farewell superseded by queued work) is reported as [AI-Substrate/minih#40](https://github.com/AI-Substrate/minih/issues/40) for the minih agent to work on — includes repro sketch, telemetry evidence, and the companion's transcript-surface magic wand as related context.

**Companion farewell** (run `2026-06-10T10-44-33-424Z-8149`, exited `completed`): workedWell = per-commit pings catch localized drift early; the final range sweep caught the CI sensor mismatch local tests can't see. magicWand (target: coordination/minih) = first-class transcript/query surface for sent findings + ack mappings at shutdown. Full retro appended to `docs/retros/code-review-companion.md` (compound `docs/harness/agents/` tree absent in this repo → legacy ledger used, consistent with 013 precedent).

## User addendum (mid-build, 2026-06-10) — scope note for T012

The `validate-harness-flow` `instructions.md` (T012) must brief the operator agent to:
1. **Check target-repo retros**: verify workers left retros, magic wands, and other valuable feedback **in the target repos** (the harness loop running inside each repo).
2. **Separately** read and check the **minih worker retros + magic wands** (the worker runtime's farewell artifacts) — an explicit, distinct step, not to be confused with the in-repo harness retros above.
3. On top of the general thesis of what the extension computes and the operator's judgment role.

## Task entries

### T001 + T002 — folder-only discovery + rejected-entry records (commit `46c3c8a`)

- **RED**: rewrote `discovery.test.ts` to the D1 contract (12 tests: chain precedence, flat rejection w/ per-name reasons, `.tsx`-manifest-only, containment, dedupe, nested-manifest internals, sort order, cwd) + 2 registry tests for rejected→E143 synthesis. Ran: **15 failed / 11 passed** — RED proven.
- **GREEN**: `discovery.ts` returns `{candidates, rejected}`; `ENTRY_CHAIN = extension.ts → extension.js → index.ts → index.js` after manifest; flat code files → rejected with `unsupported flat layout — move to <name>/extension.ts`. `registry.ts`: `ExtensionRegistryOptions.rejected` → synthesized `failed` records via the (now code-parameterised) `failed()` helper carrying E143. `error-codes.ts`: +E143/E144/E145. `app.ts` `loadRegistry` passes `discovery.rejected` through (mechanical call-site update — shape change, noted as planned-adjacent).
- **Tests updated**: `app.test.ts` loadRegistry seedings → folder form + new flat-rejection wiring test; `error-codes.test.ts` table snapshot +3 codes.
- **Evidence**: `test/services/extensions/` 45/45 green; full suite 273 passed / 11 failed — the 11 are exactly Finding 03's fixture-bound integration tests (`integration/extensions.test.ts` ×9 → T011; `integration/scaffold.test.ts` ×2 → T010). Documented interim red; full-green checkpoint is T011's Done-When.
- 📡 Companion ping: `review-request: T001+T002 46c3c8a`.

### T003 + T004 — instructions service + act (commit `637fe46`)

- **RED**: `instructions-service.test.ts` (10 tests: baked payload, multi-verb shared file, runtime reload, unknown/missing/unreadable outcomes) + `acts/instructions.test.ts` (8 tests: envelope/exit wiring per D3, human-mode raw briefing, D4 live-edit) + registry reserved-name test. Proven: 2 module-missing suites + 1 reserved-name failure.
- **GREEN**: `core-instructions.ts` (baked briefing: role split "harness brings determinism, you bring inference", envelope contract + exit codes, 3-hop self-brief loop, briefing locations); `instructions-service.ts` (`instructionsPathFor` per D5 — `dirname(record.entryPath)/instructions.md`; missing/unreadable split via FsPort `exists`/`readText` semantics); `acts/instructions.ts` (record.ts pattern); registered in `app.ts` after `record`; `instructions` added to `RESERVED_NAMES`.
- **Tests updated**: app.test.ts + index.test.ts buildProgram command-list assertions gained `instructions`.
- **Evidence**: targeted suites 75/75; full suite (from `harness/cli`) 290 passed / 11 failed — still exactly the Finding 03 fixture set. **Gotcha logged**: running vitest from repo root (not `harness/cli`) breaks 4 cwd-relative tests (architecture scandir + NodeFs probes) — false alarm, justfile's `cd harness/cli` is load-bearing.
- contract.ts untouched (D5 guard holds).
- 📡 Companion ping: `review-request: T003+T004 637fe46`.

### T005 + T006 — help AGENTS START HERE + has_instructions (commit `724ab9c`)

- **RED**: 4 new help-service failures (agents_start_here field, per-verb has_instructions shape, leading banner line, instructions in command list).
- **GREEN**: `buildHelp(registry, fs)` — FsPort injected for existence probes only (D4); `VerbSummary.has_instructions`; `HelpContent.agents_start_here`; human render leads with `▶ AGENTS START HERE: npx harness instructions`; 📖 marker per briefed verb; stale flat-layout prose (PURPOSE, EMPTY_HINT, `new <name>` line) flipped to folder form; `harness instructions` prepended to safe_first_actions. `registerHelpAct` gains the `fs` param; app.ts passes `deps.fs`.
- **Evidence**: suite from `harness/cli`: 293 passed / 11 known fixture failures.
- 📡 Companion ping: `review-request: T005+T006 724ab9c`.

### T007 + T008 — doctor package-convention wail (commit `d1395cb`)

- **RED**: 4 convention tests (clean bill w/ briefing; E144 complaint + degraded + record-stays-loaded; always-present core instructions layer; render path incl. E143 flat detail) + 1 doctor-act layer-list update.
- **GREEN**: `ConventionComplaint` on `DoctorReport.conventions[]` (D5 guard: complaint lives on the report, NOT on `ExtensionRecord`); `checkConventions` probes loaded record folders via FsPort; extensions layer `!ok` on violations with `, K missing instructions.md` suffix + author-this next_action; new `instructions` core layer (always ok, advertises the baked briefing); renderer prints complaint + arrow under each violating record. Existing doctor tests migrated to folder-form entry paths with seeded briefings.
- **Evidence**: suite (from `harness/cli`): 297 passed / 11 known fixture failures.
- 📡 Companion ping: `review-request: T007+T008 d1395cb`.

### T009 + T010 — folder-form scaffold + starter instructions.md (commit `f29e44d`)

- **RED**: 14 failures (folder paths for all variants, instructionsPath in outcome, starter-briefing content incl. no-"prompt" guard, `.record.ts` retirement, no `--flat` flag, E152 on entry file, `--force` preserves authored briefing).
- **GREEN**: `starterInstructions(name)` template (guided TODO addressed to the calling agent: computes/judgment/watch-out sections); scaffold-service writes `<name>/extension.<ext>` + `instructions.md` (briefing written only when absent — `--force` replaces code, not judgment); outcome gains `instructionsPath`; reserved message derives from RESERVED_NAMES. Act reports both paths; human mode prints both Created lines.
- **Bonus green**: `integration/scaffold.test.ts` updated to the folder contract and now passes — scaffolded package proven loadable end-to-end via real NodeFs + folder-only discovery + real jiti (T009's "scaffolded output passes discovery" Done-When, proven with the real loader ahead of T011).
- **Evidence**: suite: 302 passed / 9 failed — ONLY `integration/extensions.test.ts` (physical fixtures, T011's job) remains.
- 📡 Companion ping: `review-request: T009+T010 f29e44d`.

### T011 — fixture migration + AC-14 loader proof (commit `3f03fad`)

- `git mv` for all 6 physical fixtures → folder form; `flat-legacy.ts` added as the **permanent** rejection fixture (header comment forbids "fixing" it); `subby/` package added: `extension.ts` imports `./lib/helper.ts` and runs via the **real** JitiLoader — **AC-14 proven; Finding 05 jiti risk retired** before T012's production split. `hello/instructions.md` fixture proves `has_instructions:true` + `instructions hello` end-to-end. Doctor integration asserts 4 loaded / 2 failed / 3 convention wails / degraded.
- **Evidence**: `just fft` → **315/315 green, 44 files** (coverage 91.8% stmts). The interim red window (T002→T011) is closed.
- 📡 Companion ping: `review-request: T011 3f03fad`.

### T012 — validate-harness-flow package move + briefing (commit `39df3fb`)

- `git mv` → `validate-harness-flow/extension.ts` (90% similarity preserved); helpers (`lastRunId`, `captureNewRun`, `writeFile`, `readJson`, `copyInto`) → `lib/worker-io.ts` with the slug parameterised; entry imports `./lib/worker-io.ts` — **AC-14 proven in production** (real jiti, this repo).
- **Genuine `instructions.md` authored** incorporating the user's mid-build addendum: operator judgment loop = (1) read the actual work in each clone, (2) verify **target-repo retros** carry magic wands + valuable feedback, (3) **separately** harvest the **minih worker farewell retros** (explicitly distinct from #2, labelled as such), (4) echo-vs-real verdict per repo; surfaced-never-auto-implemented.
- **Evidence**: `npx harness doctor` → package loaded, conventions `[]` (briefing present); flat `validate-harnessability.ts` correctly E143-failed (T013's job); `validate-harness-flow --help` renders; `instructions validate-harness-flow` serves the briefing; bare `instructions` lists it in `verbs_with_instructions`.
- 📡 Companion ping: `review-request: T012 39df3fb`.

### T013 — validate-harnessability package move + briefing (commit `b3c57ce`)

- `git mv` → `validate-harnessability/extension.ts` (100% similarity — no split needed at 250 lines); genuine `instructions.md`: fan-out mechanics, operator validation loop (self-grade ≠ fact; in-clone artifacts; schema; evidence spot-checks; separate minih-retro harvest), watch-outs.
- **Evidence**: `npx harness doctor` → **ok** (2 loaded / 0 failed / 0 conventions); `instructions validate-harnessability` serves the briefing; `verbs_with_instructions` = both.
- 📡 Companion ping: `review-request: T013 b3c57ce`.

### T014 — skills normalization (commit `f069465`)

- Boot: canonical-only governance read (UNAVAILABLE wording, verdict table, STATUS mode all updated) + **new Step 0** self-brief (`npx harness instructions --json`, then per-verb briefings; graceful skip when no CLI). Legacy chain dropped from assessment SKILL + both templates (`.md` AND `.json` — json added for the grep Done-When), backpressure (×2), retro (×1), governance-doc reference (read-order section now single-location). Flow skill: worked example rewritten to post-014 reality (two packages + governance doc), `boot.*` → `boot/` sensor row. Governance-doc template gains the **AGENTS START HERE breadcrumb row** (AC-12). **Scope addition (logged)**: `eng-harness-0-add-extension` flat-path prose → package form (FC "no surface still flat-form" demanded it; not in T014's file list).
- **Done-When**: (a) `grep -r "docs/project-rules.*harness" skills/` → **0**; (b) breadcrumb present in `governance-doc.md`; (c) read-through of each edited skill done — folder-form prose throughout.
- 📡 Companion ping: `review-request: T014 f069465`.

### T015 — repo governance doc + stale refs (commit `91346f2`)

- `.harness/engineering-harness.md` hand-written: breadcrumb + 8 grounded BIO fields (boot `just test` — proven green, 315 tests, ~1.4s wall; health `harness doctor --json`; interact = envelope surface; observe = envelopes/coverage/doctor/dogfood artifacts; signal inventory table; evidence paths; 3 honest back-pressure gaps; **L2** snapshot with named L3 candidate). AGENTS.md caveat rewritten (repo now HAS the doc; setup still off-limits; zero-context start = `npx harness instructions`); README setup bullet → canonical path.
- **Done-When**: `grep -n "docs/project-rules/engineering-harness" AGENTS.md README.md` → empty ✓; boot command green ✓ (boot here now reads the doc instead of UNAVAILABLE).
- 📡 Companion ping: `review-request: T015 91346f2`.

### T016 — extend-the-harness rewrite + gen:docs (commit `18942c5`)

- Doc rewritten: folder layout as the ONLY form (E143 + doctor guidance for flats); new "Agent instructions" section (audience, convention, runtime loading, E144 wail, help discoverability, starter shape); **minih `prompt.md`/`instructions.md` distinction drawn exactly once** (worker-inside-runtime vs calling-agent-outside, "never copy one into the other"); scaffold tables show `instructionsPath`; verify section includes `harness instructions <verb>`; safety note covers briefing trust domain. `npm run gen:docs` regenerated `docs-content.ts`; `check:docs` CLEAN; "prompt" grep → only the permitted minih call-out.
- **Gotchas logged**: (1) `just test | grep` masks vitest's exit code — the commit landed before a red test surfaced; (2) the red test was `integration/docs.test.ts` byte-compare against a **stale dist** — `npm run build` fixed it, no source change. Suite re-proven 315/315.
- 📡 Companion ping: `review-request: T016 18942c5`.

### T017 — final validation sweep (evidence)

- `just fft` → **315/315 green, 44 files** (fix + format + coverage suite).
- Manual smoke in this repo (all via the built CLI):
  - **AC-1**: `instructions --json` → ok, baked briefing, `verbs_with_instructions: [validate-harness-flow, validate-harnessability]`, exit 0.
  - **AC-2**: `instructions validate-harness-flow` → ok; live-edit proof on a scratch extension: v1 → edit file → v2 served on next invocation, no rebuild.
  - **AC-3**: `instructions nosuchverb` → `unconfigured`, **exit 2**, next_action points at `harness help`.
  - **AC-4**: human help leads with `▶ AGENTS START HERE: npx harness instructions`; `--json` carries `agents_start_here` + per-verb `has_instructions: true` ×2.
  - **AC-5/AC-9**: removed a briefing → doctor `degraded` **exit 0** with `E144` complaint + author-this next_action; record stayed loaded; core `instructions` layer always present.
  - **AC-7**: doctor ok — 2 loaded / 0 failed / 0 conventions; both briefings serve.
  - **AC-8**: `new tryout` → `tryout/extension.ts` + `tryout/instructions.md`; doctor saw 3 loaded; verb ran `unconfigured` exit 2; cleaned up after.
  - **AC-6/AC-14**: pinned by suite (flat-legacy E143 fixture; subby subfolder import via real jiti) + T012's production `lib/worker-io.ts`.
  - **AC-10–13**: architecture tests green (ports/fakes); `check:docs` clean; T014 grep zero + breadcrumb; T015 doc + grep empty.
- Phase complete: T001–T017 all [x]; 14/14 ACs checked in the plan.

