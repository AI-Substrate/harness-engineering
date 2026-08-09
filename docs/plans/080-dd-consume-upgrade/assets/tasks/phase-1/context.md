# Phase 1 context brief — Take the dependency and rewire the four consumers

**Tasks**: [tasks.dd.json](./tasks.dd.json) (`tk-0001..tk-0005`; read `tasks.dd.md` for the rendered view — never edit either by hand, use `harness dd` verbs)
**Plan**: [../../../plan.dd.json](../../../plan.dd.json) · **Workshop (authoritative)**: [../../workshops/001-consume-shape-four-decisions.md](../../workshops/001-consume-shape-four-decisions.md) · **Proofs**: [../../backpressure.dd.json](../../backpressure.dd.json)

## Executive briefing

Harness consumes dd today as an in-repo fork (`services/dd`, 45 files). dd now ships
standalone as `@ai-substrate/dd` from `github:AI-Substrate/dd#<sha>` (public repo,
`prepare` builds on install, npm registry never touched for dd). This phase takes the
dependency and rewires **every import that has a verified public home** — all non-plan
symbols across the 4 surviving consumer files. Plan-semantics imports
(`services/dd/plan`) **deliberately remain on the fork** — phase 2's trial owns them.
The bar: `just build && just test` green (423-test flow/plan suite), plus the dogfood
pair (`flow orient` + `plan validate` on this very plan's documents).

## What was already proven (don't re-derive)

- **Round 2 rewired `flow.ts`+`fence.ts` against the packaged SDK**: tsc exit 0, 423/21
  green. Repeat that pattern; it's known-good.
- **POC at `7e570bc`**: install 9s, packs (no `src/`), 9 root + 4 `./node` runtime
  exports, foreign-port injection works, `tracked===null`, D7 drive-rooted resolution
  clean, strict tsc accepts consumer-owned ports.
- Symbol homes at the pin: `FsDocLoader`/`MemoizingDocLoader`/`resolveMapSeed`/
  `traverseCorpus` → `./links` (or barrel); `ConventionSchemaResolver` → barrel/`./schema`;
  `escapeCell`/`headingSlug` → `./render/renderer`; core `parse`/`validateWalk`/
  `resolveAddressFile`/`parseAddress`/`isAddressFailure` + types `DdDoc`/`DdIssue`/
  `DocLoader`/`SchemaResolver` → barrel.

## Hard rules (from ratified decisions + execution guardrails — violations are review REJECTs)

1. **Pin by full 40-char sha, floor `f712ded`** (the `type SchemaFs` export) — take the
   latest green head, name the sha in the execution log. Never float, never `file:`.
2. **`npm install` runs with the sandbox disabled** (git cannot write `~/.npm` cache
   under it; npm's retry masks the cause as "destination already exists").
3. **Annotate ports at the declaration** (`const fs: SchemaFs = …`) so type errors land
   where the object is written. Port contracts live in the shipped `dist/*.d.ts` — read
   them, never guess (`SchemaFs` = `readdir`+`exists`+`readText`; hash port is
   `sha256Hex`).
4. **No shim for a missing SDK surface** — if a symbol has no public home, STOP and
   report (that's a phase-2/dd matter, never a local workaround).
5. **plan-semantics imports stay on the fork this phase**: `buildPlanIndex`, `itemKey`,
   `PlanDocument`, `ReadyReading`, `readPlanCheck`, `readPlanReadiness` (index.ts) and
   `PlanEdge`/`PlanIndex`/`PlanItem` (pr-body.ts) keep importing `services/dd/plan`.
6. **`tracked` branches on `=== false`, never `!tracked`** — `null` means "host has no
   tracking concept" and flows through `acts/flow.ts` deliberately.
7. Harness commands run **in-tree**: `node harness/cli/bin/harness.js …` (no global).
8. Environment-first posture: friction is work — `harness observe` it when it bites;
   dd-implementation defects go to the dogfood ledger
   (`../../dogfood-ledger.md`), never absorbed.

## Files touched

| File | Change |
|------|--------|
| `harness/cli/package.json` (+ root lockfile) | add pinned dep |
| `harness/cli/src/acts/flow.ts` | rewire imports (drop `services/dd/links`, `services/dd/schema`, `./dd/shared.js` FsDocLoader) |
| `harness/cli/src/acts/plan/fence.ts` | `DdDoc` type from the barrel |
| `harness/cli/src/acts/plan/pr-body.ts` | render imports from `./render/renderer`; plan types stay |
| `harness/cli/src/acts/plan/index.ts` | core/links/schema imports from the package; plan imports stay |
| `harness/cli/test/…` (new) | the promoted probe-trio integration spec |

## Known tripwires

- The arch suite **byte-pins `semantics.ts`** (`dd-plan-semantics-frozen.test.ts`) —
  phase 1 must NOT touch that file; if a change trips the pin, that's a wrong turn.
- Two boundary guard tests skip package specifiers (by design, D-4) — do not "fix" them.
- Worktree cwd resets between tool calls — `cd` per command.
