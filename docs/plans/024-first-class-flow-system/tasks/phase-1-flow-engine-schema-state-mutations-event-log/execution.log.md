# Execution Log — Phase 1 (Flow engine: schema, state, mutations, event log)

**Plan**: [first-class-flow-system-plan.md](../../first-class-flow-system-plan.md) · **Mode**: Full · **TDD** · **Companion**: `code-review-companion` (run `2026-06-18T00-27-49-683Z-f765`, `--no-skills`)
**Branch**: `024-first-class-flow-system` · **Pre-flight boot**: HEALTHY (639 tests green on unmodified main)

> Log facts + evidence, not a monologue (Elegance: `00-routing.md` § Shared conventions). The task table carries the detail.

---

## T001 — Frozen contract-snapshot sensor ✅

- **Commit**: `38dd47b` `test(024): freeze --hook/--event/--hooks/--json contract snapshot [T001]`
- **What**: `harness/cli/test/contract/hooks-snapshot.test.ts` + `__snapshots__/hooks-snapshot.test.ts.snap`. Reads the canonical contract source (`skills/eng-harness-flow/references/00-routing.md`), extracts the three contract sections (Lifecycle hooks + `--event`→`--hook` alias map / `--json` routing envelope / `--hooks` Shape A manifest), and freezes them as a byte snapshot. Structural guards assert the 5 closed hooks, the additive `hook` envelope field, and `manifest_version: 1`.
- **Evidence**: `vitest run test/contract/hooks-snapshot.test.ts` → 4 passed + 1 todo; 1 snapshot written (143 lines). Green on **unmodified main** before any other task (blocking gate satisfied). Full suite still 639 green.
- **Checkpoint 2** (`it.todo`) — flow-Envelope `data` shapes (`create`/`show`/`event`) — deferred to T015 as the final Phase-1 act.
- **Discovery** → see Discoveries table (the `--hook/--hooks` contract is **skill-owned**, not a CLI command — the snapshot freezes skill-doc bytes, not executed CLI output).

## T002 — `E3xx` flow error block ✅

- **Commit**: `bf694f6` `feat(024): allocate E300-E309 flow error block [T002]`
- **What**: 10 additive codes (`FLOW_SCHEMA_INVALID` E300 … `FLOW_EDGE_INVALID` E309) appended to `output/error-codes.ts`; `E305 FLOW_NODE_INVALID` documents both causes (node-not-found OR illegal-transition). `E108 INVALID_ARGS` reused for insert-node mutual-exclusivity (not re-allocated). Exhaustive `toEqual` contract test extended.
- **Evidence**: `error-codes.test.ts` 2 passed; biome clean; E300–E309 verified free (highest was E204).

## T003 — `gen:flows` bundle pipeline ✅

- **Commit**: `c7b3194` `build(024): gen:flows bundle pipeline + wiring [T003]`
- **What**: `scripts/gen-flows.mjs` (mirrors `gen-docs.mjs`) inlines harness-owned `services/flow/schemas/*.{schema,template}.json` → committed `schemas-content.ts` (`BUNDLED_FLOW_SCHEMAS` + `BUNDLED_FLOW_TEMPLATES`), biome-normalised, zero runtime fs. `package.json`: `gen:flows` script; `build` = `gen:docs && gen:flows && tsc`.
- **Decision (logged)**: pipeline + **empty bundle** lands in T003; schemas authored in T006 (preserves test-first; the generator can't inline non-existent files). See Discoveries.
- **Evidence**: `npm run gen:flows` → wrote 0 schemas + 0 templates (empty bundle); biome clean; `tsc --noEmit` OK. Generator `mkdir -p`s its greenfield output dir + tolerates an empty/absent schemas dir.
- **Fix during task**: first run hit ENOENT (greenfield `services/flow/` dir) → added `mkdirSync(recursive)` before write.

## T004 + T005 + T006 — schema resolution & validation ✅

- **Commit**: `f7fc71f` `feat(024): shared-core + overlay schema resolution & validation [T004,T005,T006]`
- **What**: `flow.schema.json` (shared-core field shape) + `harness-loop.schema.json` (bundled overlay) + `flow-schema.ts` (`resolveFlowSchema` precedence + `validateFlowDoc` + `checkSchemaVersion`) + `test-flow.schema.json` fixture + 14 tests. Bundle regenerated (2 schemas).
- **Decision (logged)**: **hand-rolled validator over a CLI-owned descriptor** (no JSON-Schema dep; mirrors `recordTypeShapeIssues`). Existing `flight-plan.schema.json` is REFERENCE-ONLY; the-flow conforms via `--schema` in Phase 3. See Discoveries.
- **Evidence**: T004/T005 RED first (module missing) → GREEN (14 pass) after T006; full suite **659 green + 1 todo**; tsc + biome clean.

## T007 + T008 + T009 — service + atomic state I/O ✅

- **Commit**: `<pending>` `feat(024): flow-service create/new/show/list + atomic temp+rename + E308 [T007,T008,T009]`
- **What**: `FsPort.rename` (port + `NodeFs` `renameSync` + `FakeFs` in-memory move w/ `renames[]`) · `flow-events.ts` (leaf: `FlowDoc`/`FlowNode`/`FlowEvent`/`FlowComment`/`FlowProvenance` types + event-id/duck-typer/builders — drives T010-T014) · `flow-service.ts` (`createFlow`/`newFlowSchema`/`showFlow`/`listFlows`/`readFlowDoc`/`writeFlowAtomic`) · `harness-loop.template.json` (+ regen `gen:flows` → bundle now 2 schemas + 1 template) · `flow-service.test.ts` + `legacy-flow.json`/`fresh-empty-flow.json` fixtures.
- **Containment (T007)**: write paths (`--path`/default) `isWithin`-guarded → `E303`; `--schema`/`--template` are READ paths, isWithin-exempt (out-of-repo skill schema accepted, in-repo write redirect accepted).
- **E308 (T008)**: `isLegacyFlow` keys on the POSITIVE signal — flow-shaped (`nodes`/`cursor`) **and** no `provenance` block — NEVER on empty `events[]`; the fresh-empty fixture (provenance present, `events: []`) does NOT trip it. Honest hedging `next_action`.
- **Create (T009)**: deep-copies the resolved template's `nodes[]` verbatim (`structuredClone`), stamps root identity + the 7-key provenance (`branch`=`created_from_branch`), fires the `created` (CRT-001) event, validates, atomic temp+rename. `--bare`=root-only; bad `--template`→`E300`; unknown type→`E304`.
- **Evidence**: `vitest run test/services/flow test/adapters/fs` → 49 pass; full suite **678 pass + 1 todo** (was 659); `tsc --noEmit` clean; biome clean.
- **Discoveries**: see table (FsPort.rename additive + throws-not-swallows; harness-loop template authored; FlowProvenance inlined to keep flow-events a leaf).

## Companion debrief (run `2026-06-18T00-27-49-683Z-f765`)

- **Coverage**: reviewed T001/T002/T003 commit boundaries; **stood down on an idle check-in BEFORE the schema group** (f7fc71f, T004–T006) → schema group is **companion-unreviewed** (covered by a re-booted companion on resume, or the review stage).
- **Findings reconciliation**: T001 ✅ approved (no findings) · T003 ✅ approved (no findings) · T002 ⚠️ **1 MEDIUM** (E307/E108 comment overlap) → **FIXED `7533e1a`** (companion stood down, so verification deferred to resume/review).
- **magicWand** (follow-up candidate): a `minih report draft --slug <s> --run <id>` command emitting a schema-valid farewell-JSON skeleton. *(Backlog — not Phase 1 scope.)*
- **Difficulties** (annoyances, logged): MH-001 root `npm test` path matched no files yet exited 0 (false-green risk) → ran focused `vitest run <file>` from `harness/cli`; MH-002 two overlapping farewell output schemas.
- Run verdict: `degraded` (farewell-JSON self-validation nit `/findings/0 missing id` — not a code issue). 106 tool calls, ~19 min.
