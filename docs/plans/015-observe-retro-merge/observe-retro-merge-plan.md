# Observe–Retro Merge Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-10
**Spec**: [observe-retro-merge-spec.md](./observe-retro-merge-spec.md)
**Status**: READY

## Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No `[NEEDS CLARIFICATION]` markers; spec Open Questions "none blocking"; D-5/D-6/D-12/D-13 are recorded vetoable defaults, not gaps |
| G2 | Constitution | PASS | P2 (FsPort/EnvPort/ProcessPort/Clock only in the observe service), P3 (fakes via ports, no mocking frameworks), P4/P5/P6 (envelope + honest `unconfigured` exit 2 + documented exits), P7 (doctor complaint prescribes the fix), P10 (`observe` is a reserved **core act** like `record`/`instructions`, not a verb-list violation; **zero new runtime deps** — D2 rejects a `yaml` package). No Deviation Ledger needed |
| G3 | Architecture | PASS | Entrypoint → Act → Service → Port layering; single `process.exit` site untouched; `ensureTemp()` relocated to a shared services module so observe-service never imports another command's internals (D1) |
| G4 | ADR Compliance | N/A | No `docs/adr/` directory exists |
| G5 | Structure | PASS | All required sections present; cross-references resolve (findings 01–09 ↔ task notes) |
| G6 | Testing Alignment | PASS | Hybrid per spec: RED task precedes GREEN task for every CLI area (T001→T002, T003→T004, T005→T006, T007→T008); manual/dogfood verification explicit on prose tasks (T009–T013); criteria measurable |
| G7 | Domain Completeness | PASS | No `docs/domains/` registry (constitution §5 — informal areas, matching the spec's note); all 4 spec domains present with role; manifest covers every task-table file; no NEW domains |

## Summary

The harness CLI gains a core **`harness observe`** act — capture one friction observation per call (CLI-resolved identity, schema validation at write, per-kind sequential IDs, ISO timestamps, append to the gitignored transient buffer `.harness/temp/<bucket>/session-buffer.md`), plus `--list [--json]` / `--clear` that sweep **all buckets by default**, and a doctor convention check proving the transient class stays gitignored. The two skills `eng-harness-3-observe` (186 lines) and `eng-harness-4-retro` (517 lines) merge into one friction-lifecycle skill under 703 lines: mechanics move to the CLI, prose keeps only judgment — headlined by the simple-mode Rule 5 question pair, with token-leak framing in the harvest. Single phase, TDD for CLI core, dogfood drain as the end-to-end proof.

## Target Domains

> No `docs/domains/` registry exists (constitution §5: domain governance not initialized). Informal areas as declared in the spec.

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| harness-cli core (`harness/cli/src`) | existing (informal) | modify | New `observe` core act + service (identity → validate → ID/timestamp → append; `--list`/`--clear`); `observe` in `RESERVED_NAMES`; `ensureTemp()` shared + invoked at capture; doctor temp-hygiene convention check; core briefing teaches the verb; E146 error code |
| harness skills (`skills/eng-harness-loop/`) | existing (informal) | modify | Merge observe skill into `eng-harness-4-retro` (<703 lines, AC-14 inventory honored); delete `eng-harness-3-observe/`; re-point `eng-harness-flow` dispatch/routing (D7) |
| setup skills (`skills/eng-harness-setup/`) | existing (informal) | modify | One-line pointer in `eng-harness-0-setup/SKILL.md`: temp hygiene is doctor-checked, never commit `.harness/temp/` (D8 — the decided "light touch") |
| repo docs & config refs (`README.md`, `INSTALL.md`, `.minih.json`, `docs/how/`, `skills/README.md`) | existing (informal) | modify | Retire the old slug on every live surface; `record-and-record-types.md` gains the two storage classes + capture verb; `gen:docs` regen |

## Domain Manifest

> Paths relative to repo root `/Users/jordanknight/substrate/harness-engineering`.

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `harness/cli/src/services/observe/observe-service.ts` | harness-cli core | internal | NEW — capture/list/clear logic: identity chain, validation, per-kind ID scan, bucket sweep |
| `harness/cli/src/services/observe/buffer-codec.ts` | harness-cli core | internal | NEW — constrained YAML-block entry serializer + tolerant parser (D2/D3) |
| `harness/cli/src/services/shared/temp.ts` | harness-cli core | internal | NEW — `ensureTemp()`, `TEMP_GITIGNORE`, dir constants relocated from record-service (D1) |
| `harness/cli/src/services/record/record-service.ts` | harness-cli core | internal | Import `ensureTemp` from shared module; behavior unchanged (existing tests are the sensor) |
| `harness/cli/src/acts/observe.ts` | harness-cli core | internal | NEW — commander wiring (positional description + flags), envelope + exit mapping; mirrors `acts/record.ts` |
| `harness/cli/src/app.ts` | harness-cli core | internal | Register observe act (alongside `registerRecordAct`, app.ts:173 pattern) |
| `harness/cli/src/services/extensions/registry.ts` | harness-cli core | internal | `RESERVED_NAMES` += `'observe'` |
| `harness/cli/src/output/error-codes.ts` | harness-cli core | contract | New code **E146 `OBSERVE_BUFFER_UNREADABLE`** (additive; E146–E149 free, scaffold owns E150+) |
| `harness/cli/src/services/doctor/doctor-service.ts` | harness-cli core | internal | Temp-hygiene probe added to `checkConventions()` (E144 pattern, D5) |
| `harness/cli/src/services/instructions/core-instructions.ts` | harness-cli core | internal | Baked briefing gains capture-verb + drain section (AC-8) |
| `harness/cli/test/services/observe/observe-service.test.ts` | harness-cli core | internal | NEW — RED suite for capture/list/clear service logic |
| `harness/cli/test/acts/observe.test.ts`, `harness/cli/test/integration/observe.test.ts` | harness-cli core | internal | NEW — act envelope/exit tests + compaction-simulation integration (two `buildProgram` runs over one FakeFs) |
| `harness/cli/test/services/doctor/doctor-service.test.ts`, `harness/cli/test/services/instructions/*.test.ts` | harness-cli core | internal | Extended for the new convention check + briefing content |
| `skills/eng-harness-loop/eng-harness-4-retro/SKILL.md` | harness skills | internal | REWRITE — the merged friction-lifecycle skill (<703 lines) |
| `skills/eng-harness-loop/eng-harness-3-observe/` | harness skills | internal | DELETED (entire folder) |
| `skills/eng-harness-loop/eng-harness-flow/SKILL.md` | harness skills | internal | 10 refs: dispatch slug-map row, routing-table mid-build row, param docs, precondition matrix — re-pointed per D7 |
| `skills/README.md` | harness skills | internal | 3 refs updated |
| `skills/eng-harness-setup/eng-harness-0-setup/SKILL.md` | setup skills | internal | One-line doctor-convention pointer (D8) |
| `README.md`, `INSTALL.md`, `.minih.json` | repo docs & config refs | internal | 1 ref each — slug retirement |
| `docs/how/record-and-record-types.md` | repo docs & config refs | internal | Two storage classes, capture verb, drain materialization (2 old refs die here) |
| `harness/cli/src/services/docs/docs-content.ts` | repo docs & config refs | internal | Regenerated via `npm run gen:docs` (never hand-edited) |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | **`ensureTemp()` is exported and reusable** — `record-service.ts:87–97`, takes `RecordDeps` (fs/proc/clock ports), idempotent, writes `TEMP_GITIGNORE` (`# Crash-resilient agent scratch — never committed.\n*\n`) | Relocate to `services/shared/temp.ts` (D1); observe-service calls it on every capture; record-service re-imports; record tests stay green |
| 02 | Critical | **Doctor already has the convention seam** — `checkConventions()` (`doctor-service.ts:110–130`) returns `ConventionComplaint[]` `{folder, detail: "E144: …", next_action}` and flips the layer to degraded (exit 0) | Add a temp-hygiene probe to the same function (D5) — zero new render paths, mirroring 014's D2 |
| 03 | Critical | **`RESERVED_NAMES` (`registry.ts:45`) lacks `observe`** — E142 conflict rejection only protects names in the set; an extension could shadow the core act | Add `'observe'` in the same change that registers the act (T004) |
| 04 | High | **Record's ID scheme is not reusable** — `nextOrdinal()` (`record-service.ts:69–79`) is per-day directory ordinal; observations need per-kind counters *within a bucket's buffer*, tolerant of malformed blocks | New scan in observe-service: parse bucket buffer, max numeric suffix per kind prefix, +1; malformed blocks skipped, never rewritten (AC-3) |
| 05 | High | **Schema enums are fixed** in `skills/eng-harness-loop/eng-harness-4-retro/references/retro.schema.json`: kinds `difficulty/magic-wand/gift/insight/coordination/improvement-suggestion/confusion` (prefixes `DL/MW/GFT/INS/COORD/SUGG/CONF`), severities `blocking/degrading/annoying`, targets free-form conventional | Validate `--kind`/`--severity` against these at write; reject with allowed values in `next_action` (AC-4); targets pass through |
| 06 | High | **Stale-dist trap**: `docs-content.ts` is generated; drift-guard test (`test/services/docs/docs-content.test.ts`) + CI `check:docs` (`git diff --exit-code`) both gate it. 014 retro hit this (OH-003) | T011 enforces the order: edit `docs/how/` → `npm run gen:docs` → `npm run build` → test |
| 07 | High | **`eng-harness-flow` carries 10 live refs** incl. the slug-resolution map (`observe → eng-harness-3-observe`, line ~150) and the mid-build routing row (line ~63); leaving them dangles callers on a deleted slug | D7: re-point both to `eng-harness-4-retro`; capture itself becomes `harness observe` (noted in the row); T010 sweeps all 10 |
| 08 | High | **Buffer path + format are already canonical** — `.harness/temp/<agent>/session-buffer.md`, append-only YAML blocks with required `id/kind/description`, optional `target/severity/workaround/suggested_encoding`, nested `system.compound` (`status/source/first_seen_at`). Act-wiring precedent: `acts/record.ts:35–100` registered at `app.ts:173`; integration pattern: `buildProgram(...).parseAsync` + fakes (`test/integration/scaffold.test.ts:27–100`) | D2: keep the format and path exactly — the CLI becomes the writer of the same shape the old skill taught, so external repos' hand-written entries remain readable (D3) |
| 09 | High | **The briefing is a baked TS constant** — `core-instructions.ts:11–49` is the only zero-context channel; AC-8 fails if the verb isn't taught there | T007/T008 add a capture+drain section to `CORE_INSTRUCTIONS` with a content test pinning the strings |

## Implementation

**Objective**: Land the `harness observe` capture/list/clear act with transient-storage hygiene (ensureTemp at capture + doctor check), merge the two skills into one sub-703-line friction-lifecycle skill with the question pair as the headline signal, and retire the old slug from every live surface — one phase, suite green from both cwds.

**Testing Approach**: Hybrid (per spec) — Full TDD for all CLI behavior (RED test task before each GREEN impl task; fakes only via ports, constitution P3); manual/dogfood verification for skill prose and reference sweeps (no deterministic sensor for prose — a recorded back-pressure gap in `.harness/engineering-harness.md`).

### Design Decisions (resolving the spec's deferred-to-plan-3 choices)

- **D1 — Mechanism route (spec D-7)**: a **dedicated observe service**, not the record contract's `placement?` hook. Observations are not records — different ID scheme (per-kind-per-bucket vs per-day ordinal), different lifecycle (truncated, never committed), no template/slug machinery. Wiring them through record-type placement would force record semantics onto a non-record; the `placement?` hook stays reserved for actual record-type growth. Shared mechanics (`ensureTemp`, `TEMP_GITIGNORE`, dir constants) move to `services/shared/temp.ts` so neither service imports the other's internals (architecture dependency rule).
- **D2 — Buffer storage format (spec workshop question)**: **keep YAML-blocks-in-markdown at `.harness/temp/<bucket>/session-buffer.md`** — the exact shape the old skill taught. The CLI writes entries via a constrained serializer (flat fields + the `system.compound` block, stable field order) and reads via a tolerant parser (split on `^- id:` block starts; a block that fails to parse or lacks required fields counts as *malformed* — skipped, counted, never rewritten). **Rejected alternative**: JSONL (machine-safer but breaks every legacy buffer + the human-readable scratch property); **rejected**: adding a `yaml` runtime dependency (the entry grammar is a small contract, the CLI is the sole writer going forward, and the npx-installed core stays at `commander`+`jiti` only).
- **D3 — Legacy entries (spec risk #1)**: dissolved by D2 — same format, same path, so pre-merge hand-written entries parse normally. Deviant blocks surface honestly as `malformed_skipped` in the `--list` envelope (count per sweep) with the raw text preserved on disk; nothing is silently dropped. No migration step, no manual pre-drain required.
- **D4 — Identity sanitization (extends spec D-11, vetoable like its parent)**: bucket = `--agent` flag → `HARNESS_AGENT` env (`EnvPort.get`) → literal `agent`. The resolved value is sanitized to lowercase-kebab (non-alphanumerics → `-`, collapsed); an empty or whitespace-only value (e.g. `HARNESS_AGENT=""`) is treated as unset and falls through the chain. Sanitization never fails, so capture never fails on identity — the same `slugify()` posture record-service already uses for filenames.
- **D5 — Doctor placement**: the temp-hygiene probe joins `checkConventions()` — complaint **only** when `.harness/temp/` exists *without* its nested `.gitignore`. Shape matches the E144 precedent (prose detail + prescription, no new error code needed for a convention complaint): detail names the missing file, `next_action: "create .harness/temp/.gitignore (any harness observe/record call restores it)"`, layer flips degraded (exit 0). No temp dir yet → ok; no `.harness/` at all → doctor behavior unchanged.
- **D6 — Empty/edge envelope semantics**: `--list` with nothing pending → `ok` + empty `observations[]` (honest empty state); `--clear` with nothing to clear → `ok` + `data.cleared: 0`; **no `.harness/` directory → `unconfigured` exit 2** with `next_action` naming harness setup (capture, list, and clear all consistent with AC-4); validation rejection → `unconfigured` exit 2, allowed values in `next_action`; unreadable buffer mid-sweep → `error` exit 1, **E146 `OBSERVE_BUFFER_UNREADABLE`**. Description minimum = 10 characters measured as JS string length (the schema's `minLength` semantics).
- **D7 — Flow dispatch (spec AC-12 choice)**: **re-point, don't remove** — `eng-harness-flow`'s slug map and mid-build routing row point at `eng-harness-4-retro` (the merged skill's in-flight capture section), with the row note clarifying that capture itself is one CLI call (`harness observe`). Removing the row would orphan the mid-build entry point.
- **D8 — Setup-skill touch (spec left the file list open)**: exactly one line in `skills/eng-harness-setup/eng-harness-0-setup/SKILL.md`, in whichever step provisions/describes `.harness/`, locked verbatim: *"`.harness/temp/` is transient agent scratch — never committed; the CLI self-heals its nested `.gitignore` and `harness doctor` checks the convention."* No other setup files; doctor is the enforcement point, not setup prose.
- **D9 — `--list --json` envelope shape (locks AC-7's annotation)**: `data = { observations: [{ bucket, id, kind, description, target?, severity?, workaround?, suggested_encoding?, first_seen_at }], buckets_scanned: string[], malformed_skipped: number }` — entries verbatim from the buffer, annotated with their bucket; `--agent` narrows `buckets_scanned` to one. Locked here so the merged SKILL.md can name exact fields.
- **D10 — CLI writes the full compound block**: every captured entry includes `system.compound: { status: open, source: agent-self, first_seen_at: <ClockPort ISO> }` — identical to the old skill's template, so drained entries carry the lifecycle fields the harvest already expects.

### Tasks

> Paths relative to repo root. Strand A = CLI core (TDD pairs), Strand B = skills merge, Strand C = docs/refs + verification. Harness-loop rows (T000, T013) are advisory scaffolding, never gates.

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T000 | **Harness boot pre-flight** — `just test` + `npx harness doctor --json` | — | — | Suite green (~317 tests), doctor `ok`, extensions 2 loaded | Harness loop (L3); `/plan-6` auto-fires |
| [x] | T001 | **RED — capture service tests**: all 7 kinds accepted / unknown kind+severity rejected with allowed values in `next_action`; description boundary (9 chars rejected, 10 accepted — JS string length per D6); identity chain (flag → `HARNESS_AGENT` via FakeEnv → `agent`) + kebab sanitization + empty-env-treated-as-unset; per-kind sequential IDs (`DL-001`→`DL-002`, independent counters; first capture of a kind among other kinds' entries starts at 001); ID scan skips malformed blocks (incl. non-numeric suffixes); append-only (existing content byte-preserved); `ensureTemp` invoked every capture (FakeFs shows dir + nested `.gitignore` after capture into fresh repo); no `.harness/` → `unconfigured`; unreadable buffer → E146; tolerant parser proven against the old skill's exact template incl. `system.compound` | harness-cli core | `harness/cli/test/services/observe/observe-service.test.ts` | Tests encode D2–D6, D10 + AC-1..AC-5; fail before impl | Findings 04, 05, 08 |
| [x] | T002 | **GREEN — observe service + codec + shared temp**: `observe-service.ts` (capture path), `buffer-codec.ts` (serializer + tolerant parser), relocate `ensureTemp`/`TEMP_GITIGNORE`/constants to `services/shared/temp.ts`, update record-service import, add E146 to error-codes table | harness-cli core | `harness/cli/src/services/observe/observe-service.ts`, `harness/cli/src/services/observe/buffer-codec.ts`, `harness/cli/src/services/shared/temp.ts`, `harness/cli/src/services/record/record-service.ts`, `harness/cli/src/output/error-codes.ts` | T001 green; **all existing record tests untouched and green** (relocation sensor); architecture test suite (`test/architecture/` — no `node:fs` in services) green over the new files | Finding 01; D1 |
| [x] | T003 | **RED — list/clear + act + integration tests**: `--list --json` sweeps all buckets (entries bucket-annotated, `buckets_scanned`, `malformed_skipped` per D9 — incl. a seeded malformed block yielding `malformed_skipped: 1` with valid entries still returned), `--agent` scopes (nonexistent bucket → `ok` empty), empty → `ok` empty array; `--clear` truncates (files kept) all buckets / scoped, `cleared` count, empty → `ok` 0; act envelope + exit mapping (0/2/1) for every D6 branch; **compaction simulation**: capture via one `buildProgram` run, `--list` via a second over the same FakeFs returns the entry | harness-cli core | `harness/cli/test/acts/observe.test.ts`, `harness/cli/test/integration/observe.test.ts` (+ list/clear cases in the service test file) | Tests encode AC-7/AC-8 + D6/D9; fail before impl | Integration pattern: `scaffold.test.ts:27–100` |
| [x] | T004 | **GREEN — act + registration + reservation**: `acts/observe.ts` (positional description, `--kind --target --severity --workaround --suggested-encoding --agent --list --json --clear`), register in `app.ts`, add `'observe'` to `RESERVED_NAMES` | harness-cli core | `harness/cli/src/acts/observe.ts`, `harness/cli/src/app.ts`, `harness/cli/src/services/extensions/registry.ts` | T003 green; `--json` first-class; reserved-name conflict test (extension named `observe` → E142) green | Findings 03, 08 |
| [x] | T005 | **RED — doctor temp-hygiene tests**: temp dir without nested `.gitignore` → convention complaint + `next_action` + overall `degraded` (exit 0); protection present → ok; no temp dir → ok; no `.harness/` → existing doctor output unchanged | harness-cli core | `harness/cli/test/services/doctor/doctor-service.test.ts` | Tests encode D5 + AC-6; fail before impl | Finding 02 (E144 pattern) |
| [x] | T006 | **GREEN — doctor probe**: temp-hygiene check in `checkConventions()` via `FsPort.exists` | harness-cli core | `harness/cli/src/services/doctor/doctor-service.ts` | T005 green; existing doctor tests green | Zero new render paths |
| [x] | T007 | **RED — briefing content tests**: `CORE_INSTRUCTIONS` names `harness observe`, the `--list --json`/`--clear` drain path, and the transient-vs-committed storage classes; envelope-contract section still precedes the capture section (index comparison) | harness-cli core | `harness/cli/test/services/instructions/instructions-service.test.ts` (extend) | String + ordering assertions fail before edit | Finding 09; AC-8 sensor |
| [x] | T008 | **GREEN — briefing edit**: add capture-verb + drain section to the baked core briefing | harness-cli core | `harness/cli/src/services/instructions/core-instructions.ts` | T007 green; briefing still leads with envelope contract | |
| [x] | T009 | **Merged skill rewrite**: `eng-harness-4-retro/SKILL.md` becomes the one friction-lifecycle skill — in-flight capture section headlined by the D-13 question pair (verbatim, own named section, ≥3 worked examples: boot dance re-derived / architecture rule eyeballed / endpoint inferred with no smoke path); capture = one `harness observe` call; drain reads `--list --json` (all-buckets sweep), presents `[s/t/p/e/d/a]`, materializes via `harness record retro` returned `data.path`, clears via `--clear`; question pair repeated as an explicit drain beat (same locked wording); harvest gains token-leak recurrence framing (display only); capture-during-drain race documented as accepted; all AC-14 (a)–(i) behaviors carried over | harness skills | `skills/eng-harness-loop/eng-harness-4-retro/SKILL.md` | `wc -l` < 703; both D-13 strings grep-hit twice (capture section + drain beat); AC-14 (a)–(i) each locatable; no hand-parsed buffer paths in drain prose (only `--list`/`--clear`/`data.path`) | Manual verification; ACs 9–14 |
| [x] | T010 | **Delete + reference sweep**: remove `skills/eng-harness-loop/eng-harness-3-observe/`; update `eng-harness-flow/SKILL.md` (slug map + mid-build routing row re-pointed per D7, param docs, precondition matrix — all 10 refs), `skills/README.md` (3), `README.md` (1), `INSTALL.md` (1), `.minih.json` (1); add the D8 one-liner to `eng-harness-0-setup/SKILL.md` | harness skills, setup skills, repo docs & config refs | (listed in Domain Manifest) | From repo root: `grep -rn "harness-3-observe" --exclude-dir=docs/plans --exclude-dir=.git .` → zero hits; flow skill's mid-build row + slug map point at `eng-harness-4-retro` AND the row note names `harness observe` as the capture mechanism (`grep "harness observe" skills/eng-harness-loop/eng-harness-flow/SKILL.md` ≥ 1 hit) | Finding 07; D7/D8 |
| [x] | T011 | **docs/how + regen**: rewrite `record-and-record-types.md` sections — committed records vs transient observations (two storage classes), the capture verb, drain materialization; then `npm run gen:docs` → `npm run build` → suite | repo docs & config refs | `docs/how/record-and-record-types.md`, `harness/cli/src/services/docs/docs-content.ts` (generated) | `npm run check:docs` clean; docs drift-guard test green | Finding 06 — order is load-bearing |
| [ ] | T012 | **Verification sweep**: AC-12 grep (exact command from T010 Done-When, run fresh); `wc -l` on the merged skill (< 703); **AC-14 mapping table** — one row per inventory item (a)–(i) giving the merged skill's section heading + line number where it survives (greppable anchors where mechanical: both D-13 strings ×2, `[s/t/p/e/d/a]`, `[r]esolved`/`[w]ontfix`/`[s]tale`); AC-13 no-overclaim pass (every CLI behavior the skill names exists in code) | all | — | Grep output, line count, and the filled 9-row AC-14 mapping table pasted into execution log — an empty or unlocatable row blocks sign-off | ACs 12–14; validation CRITICAL fix |
| [ ] | T013 | **Dogfood drain session** (doubles as the harness-loop retro seam): real `npx harness observe` captures in this repo during this build → run the merged skill's `--drain` → save at least one entry via `harness record retro` (use returned `data.path`) → `--clear`; record evidence paths | all | A committed record exists under `.harness/records/retro/<date>/`; `--list` empty after clear; transcript evidence in execution log | AC-9 end-to-end; harness loop `[s/t/p/e/d/a]` |
| [ ] | T014 | **Final validation**: `just fft` green; `npm run test` from repo root green; `cd harness/cli && npx vitest run` green (AC-15 both cwds); `npx harness doctor --json` ok; smoke `npx harness observe "test entry…" --kind insight` then `--list` then `--clear` | all | All green; every spec AC checked against observed output | AC-15 |

### Acceptance Criteria

- [ ] AC-1: capture happy path — `ok` exit 0, schema-valid entry appended with CLI-assigned per-kind ID + ISO timestamp; no path/ID/timestamp supplied by the agent; `observe` reserved
- [ ] AC-2: identity never demanded — flag → `HARNESS_AGENT` → default bucket `agent`; capture never fails on identity
- [ ] AC-3: consecutive per-kind IDs, independent counters, all 7 kinds; malformed blocks skipped by the ID scan; buffer never rewritten
- [ ] AC-4: bad kind/severity/short description → `unconfigured` exit 2 with allowed values in `next_action`, buffer unchanged; unreadable buffer → `error` exit 1 E146; no `.harness/` → `unconfigured` exit 2
- [ ] AC-5: `ensureTemp()` fires at capture time — fresh repo capture leaves no new tracked files; no repo-root `.gitignore` writes
- [ ] AC-6: doctor — temp without nested `.gitignore` → convention complaint + `degraded` exit 0; protected or no temp dir → ok
- [ ] AC-7: `--list --json` sweeps all buckets (bucket-annotated entries per D9), `--agent` scopes; `--clear` truncates what list returns, files kept
- [ ] AC-8: zero-context path — `npx harness instructions` teaches capture + drain; entry captured before a simulated wipe is returned by `--list` after it
- [ ] AC-9: merged skill drains via `--list --json` → `[s/t/p/e/d/a]` → `harness record retro` `data.path` → `--clear`; proven by one real dogfood session (T013)
- [ ] AC-10: both D-13 questions verbatim in both placements (headline capture section + drain beat) with ≥3 worked examples — grep-verifiable
- [ ] AC-11: harvest labels recurrence with cost framing (display only; clustering logic unchanged)
- [ ] AC-12: observe skill folder removed; merged skill < 703 lines; zero live-surface references to the retired slug (flow dispatch re-pointed per D7)
- [ ] AC-13: no overclaim — every CLI behavior in the prose is implemented
- [ ] AC-14: preserved-behaviors inventory (a)–(i) all present in the merged skill
- [ ] AC-15: suite green from `harness/cli` and repo root; new behavior TDD-covered with fakes; existing record/retro tests unaffected

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Codec strictness mis-classifies legacy hand-written entries as malformed | Medium | Low | D3: skipped entries are counted (`malformed_skipped`) and preserved on disk — visible, recoverable by hand; tolerant parser tested against the old skill's exact template incl. `system.compound` |
| `ensureTemp` relocation breaks record-service consumers | Low | Medium | T002 Done-When pins all existing record tests untouched-and-green; relocation is import-path-only |
| Capture-during-drain race loses an entry (no file lock) | Low | Low | Accepted per spec (per-agent single-session model); documented in the merged skill (T009) |
| Stale `docs-content.ts` fails drift guard / CI | Medium | Medium | T011 hard-orders edit → `gen:docs` → `build` → test; `check:docs` is the sensor (014 OH-003 lesson) |
| Dispatch-table re-point missed → callers route to a dead slug | Medium | Low | T010 enumerates all 10 flow-skill refs; T012's grep sweep is the proof |
| Merged skill creeps back over 703 lines during review fixes | Low | Medium | `wc -l` check in both T009 Done-When and T012 sweep |
| Preservation drift — the prose rewrite silently drops an AC-14 behavior (spec's stated main thesis risk); prose has no deterministic sensor | Medium | Medium | T012's mandatory 9-row mapping table (section + line per item) + AC-13 no-overclaim pass + T013 dogfood exercising the drain for real; the prose-sensor gap stays honestly recorded in `.harness/engineering-harness.md` |
| Out-of-repo copies (global `~/.claude`, the-flow alias table, installed packs) still reference the old slug | High | Low | Explicit spec non-goal; flagged follow-up (014 precedent) |

**Accepted assumptions** (carried from spec): universal retro schema v1.0 frozen; `harness record retro` remains the sole committed-record writer; bucket isolation is opt-in provenance (D-11); CLI single-process appends make concurrent capture safe; buffer not file-locked.

## Agent Harness Strategy

- **Current Maturity**: L3 (improvement loop active — `.harness/engineering-harness.md`)
- **Target Maturity**: L3 (this plan *is* an Improve-beat: it encodes the observe mechanics the loop kept re-inferring)
- **Boot Command**: `just test` (cd harness/cli && vitest run --coverage, ~5s warm)
- **Health Check**: `npx harness doctor --json` (`ok` + 2 extensions loaded)
- **Interaction Model**: the CLI itself — `npx harness <verb> --json`, one envelope per command
- **Evidence Capture**: envelope `data`/`evidence[]`, vitest coverage output, doctor layer report
- **Pre-Phase Validation**: T000 (Boot→Interact→Observe pre-flight; `/plan-6` auto-fires it)

## Harness Loop

- **Backpressure Check** (`/harness-2-backpressure`): not run for this plan (user proceeded straight to architect — advisory, absence changes nothing). The spec's validation already confirmed AC-1..AC-8 map to deterministic sensors; the known prose gap (SKILL.md has no sensor) is recorded in `.harness/engineering-harness.md`.
- **Boot** (`/harness-1-boot`): T000 pre-flight at phase start; `UNAVAILABLE` is not an error.
- **Observe**: silent friction capture throughout — fittingly, mid-build captures can dogfood `harness observe` itself the moment T004 lands.
- **Retro** (`--drain`): T013 *is* the drain at the phase seam, run for real as the AC-9 proof; `--harvest` at plan completion.
- **Best-effort**: every item above is advisory and never blocks.

---

## Validation Record (2026-06-10)

### Validation Thesis

**Raison d'être**: Convert the validated 15-AC spec into an executable single-phase build order with every spec-deferred decision resolved (D-7 mechanism route, buffer format, legacy handling, dispatch choice, setup-file list, edge semantics), so the implementing agent builds without re-deriving design.

**Value claim**: Implementation becomes mechanical; friction capture becomes deterministic and compaction-lossless; the skill surface shrinks without losing behavior.

**Artifact promise**: 15 tasks covering all 15 ACs; decisions D1–D10 grounded in line-verified code facts; honest READY gate matrix.

**Intended beneficiaries**: the /plan-6 implementing agent (Simple — consumes the inline task table directly), pipeline skills auto-firing `--drain`/`--harvest`, zero-context agents, external repos holding legacy hand-written buffers.

**Proof target**: Implementation. **Thesis source**: observe-retro-merge-spec.md + original-ask.md (not inferred).

**Thesis verdict**: Advanced — value claim delivered at buildable-contract level; confidence 0.88 (FC agent).

**Main thesis risk**: preservation drift during the prose rewrite (AC-14 has no deterministic sensor) — mitigated post-fix by T012's mandatory 9-row mapping table + the <703 hard gate + AC-13 + the T013 dogfood drain; now also an explicit Risk row.

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Coherence + Source-Truth | factual accuracy vs source (findings 01–09 line-verified), internal coherence, constitution/architecture conformance | 0 genuine (one deps-shape nit fixed: `RecordDeps` includes clock) | ✅ SOUND — P2/P3/P4–P6/P7/P10 confirmed, no Deviation Ledger; "ready for /plan-6" |
| Completeness + Risk | 15-row AC coverage matrix, deferred-decision resolution audit (10/10 resolved), TDD ordering, Done-When testability, edge cases, CS honesty | 1 CRITICAL + 5 HIGH + 4 MEDIUM + 2 LOW — all fixed or dispositioned (see below) | ⚠️ → ✅ COMPLETE WITH FIXES |
| Thesis + Forward-Compatibility | 9 thesis failure modes, 5 FC modes × 4 consumers, D-11/D-12/D-13 drift check | 0 blockers; flagged D4 sanitization as a beneficial extension of spec D-11 (surfaced to user as vetoable) and the AC-14 manual-sensor honesty gap (now a Risk row) | ✅ READY, confidence 0.88, FC 4/4 PASS |

**Fixes applied (2026-06-10)**: CRITICAL — T012 upgraded from "checklist read-through" to a mandatory 9-row AC-14 mapping table (section + line per item; empty row blocks sign-off). HIGH — T001 gains the 9/10-char description boundary, empty-`HARNESS_AGENT`-as-unset, first-capture-of-a-kind, and non-numeric-suffix cases; T003 gains the seeded-malformed `malformed_skipped: 1` envelope test and nonexistent-bucket scope case; T010/T012 Done-Whens now carry the exact repo-root grep command and require the flow row to name `harness observe`. MEDIUM — T007 asserts envelope-before-capture ordering; T002 cites the architecture test suite as the no-`node:fs` sensor; D6 pins the length rule (JS string length); D8 locks the setup-skill line verbatim. LOW (dispositioned, no change) — capture-during-drain race already documented as accepted; out-of-repo copies already a flagged non-goal/follow-up.

### Forward-Compatibility Matrix

| Consumer | Requirement | Mode | Verdict | Evidence |
|----------|-------------|------|---------|----------|
| /plan-6 implementing agent | unambiguous inline tasks, Simple mode | task-table sufficiency | ✅ | 15 path-specific tasks, D1–D10 inline, AC map complete, no plan-5 expansion needed |
| Pipeline skills auto-firing `--drain`/`--harvest` | slug + flag + invocation-shape stability | shape mismatch / contract drift | ✅ | D-5 slug kept; D-12 flags locked; T009 drain uses returned `data.path`; `.minih.json` re-point in T010 |
| Zero-context agents | `npx harness instructions` teaches capture + drain; deterministic buffer path | encapsulation lockout | ✅ | T007/T008 briefing tests; AC-8 compaction simulation in T003 |
| External repos with legacy hand-written buffers | old YAML entries still parse; nothing silently dropped | test boundary / lifecycle | ✅ | D2 keeps format+path; D3 `malformed_skipped` count + on-disk preservation; T001 tests the old template verbatim |

**Outcome alignment** (echoed verbatim from the Forward-Compatibility agent): "The plan answers the original ask: 'capture survives context compaction and costs the agent one command instead of 186 lines of re-inferred convention' — yes, via `npx harness observe` + transient buffer + deterministic path + preserved AC-14 behaviors."

**Standalone?**: No — four named downstream consumers engaged.

Overall: **VALIDATED WITH FIXES** (Status remains **READY**)
